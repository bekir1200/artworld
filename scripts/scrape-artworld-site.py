#!/usr/bin/env python3
"""Prepare a local import manifest from Art World TV's public sitemap and articles."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import Lock
from urllib.parse import urljoin, urlparse
import json
import re
import time
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup

BASE = "https://www.artworld.com.tr"
SITEMAP = f"{BASE}/sitemap.xml"
RSS = f"{BASE}/rss.xml"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "artworld-source"
MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 300 * 1024 * 1024
MAX_WORKERS = 8
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
CONTENT_NS = "http://purl.org/rss/1.0/modules/content/"
MEDIA_NS = "http://search.yahoo.com/mrss/"
DC_NS = "http://purl.org/dc/elements/1.1/"
ALLOWED_HOSTS = {"www.artworld.com.tr", "artworld.com.tr"}

counter_lock = Lock()
total_image_bytes = 0


def get(url, stream=False):
    if urlparse(url).scheme not in {"http", "https"} or urlparse(url).hostname not in ALLOWED_HOSTS:
        raise ValueError("Kaynak etki alanı izinli değil")
    last_error = None
    for attempt in range(2):
        try:
            current_url = url
            for _ in range(6):
                parsed = urlparse(current_url)
                if parsed.scheme not in {"http", "https"} or parsed.hostname not in ALLOWED_HOSTS:
                    raise ValueError("Yönlendirme kaynak etki alanının dışına çıktı")
                response = requests.get(
                    current_url,
                    timeout=(6, 15),
                    allow_redirects=False,
                    headers={"User-Agent": "ArtWorldTV-Archive-Import/1.0"},
                    stream=stream,
                )
                if not response.is_redirect:
                    break
                current_url = urljoin(current_url, response.headers["Location"])
                response.close()
            else:
                raise ValueError("Çok fazla yönlendirme")
            response.raise_for_status()
            return response
        except Exception as error:  # keep the batch moving if an old URL is unavailable
            last_error = error
            time.sleep(0.25 * (attempt + 1))
    raise RuntimeError(str(last_error))


def xml_locs(xml_bytes, parent_tag):
    root = ET.fromstring(xml_bytes)
    return [node.text.strip() for node in root.findall(f".//{{{SITEMAP_NS}}}{parent_tag}/{{{SITEMAP_NS}}}loc") if node.text]


def rss_records():
    try:
        root = ET.fromstring(get(RSS).content)
    except Exception as error:
        print(f"RSS alınamadı; site haritası kullanılacak: {error}")
        return {}
    records = {}
    for item in root.findall(".//item"):
        link = (item.findtext("link") or "").strip()
        encoded = item.find(f"{{{CONTENT_NS}}}encoded")
        thumbnail = item.find(f"{{{MEDIA_NS}}}thumbnail")
        creator = item.find(f"{{{DC_NS}}}creator")
        if link:
            records[link] = {
                "headline": item.findtext("title", "").strip(),
                "standfirst": item.findtext("description", "").strip(),
                "body_text": (encoded.text or "").strip() if encoded is not None else "",
                "category": item.findtext("category", "").strip(),
                "author": (creator.text or "").strip() if creator is not None else "",
                "published_at": item.findtext("pubDate", "").strip(),
                "cover_url": thumbnail.get("url", "") if thumbnail is not None else "",
            }
    return records


def clean_text(value):
    return re.sub(r"\s+", " ", value or "").strip()


def image_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None, None


def save_cover(url, slug):
    global total_image_bytes
    if not url or urlparse(url).hostname not in ALLOWED_HOSTS:
        return None
    media_dir = OUTPUT / "media"
    for extension, mime in (("webp", "image/webp"), ("jpg", "image/jpeg"), ("png", "image/png")):
        existing = media_dir / f"{slug[:150]}.{extension}"
        if existing.is_file():
            return {"file": f"media/{existing.name}", "mime_type": mime, "byte_size": existing.stat().st_size, "source_url": url}
    try:
        response = get(url, stream=True)
        data = response.raw.read(MAX_IMAGE_BYTES + 1, decode_content=True)
        if not data or len(data) > MAX_IMAGE_BYTES:
            return None
        extension, mime = image_extension(data)
        if not extension:
            return None
        with counter_lock:
            if total_image_bytes + len(data) > MAX_TOTAL_IMAGE_BYTES:
                return None
            total_image_bytes += len(data)
        media_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{slug[:150]}.{extension}"
        file_path = media_dir / filename
        file_path.write_bytes(data)
        return {"file": f"media/{filename}", "mime_type": mime, "byte_size": len(data), "source_url": url}
    except Exception:
        return None


def category_name(soup, rss):
    meta = soup.find("meta", attrs={"property": "article:section"})
    value = clean_text(meta.get("content") if meta else "") or rss.get("category", "")
    value = value.upper().replace("İ", "I").replace("Ş", "S").replace("Ğ", "G").replace("Ü", "U").replace("Ö", "O").replace("Ç", "C")
    mapping = {
        "ANTALYA": "Antalya", "GUNDEM": "Gündem", "SIYASET": "Siyaset",
        "ASAYIS": "Asayiş", "EKONOMI": "Ekonomi", "DUNYA": "Dünya",
        "EGITIM": "Eğitim", "SAGLIK": "Sağlık", "TURIZM": "Turizm",
        "SPOR": "Spor", "KULTUR SANAT": "Kültür Sanat", "YASAM": "Yaşam",
        "TURKIYE": "Türkiye", "CANLI YAYIN / ART WORLD TV": "Canlı Yayın",
        "RESMI REKLAMLAR": "Resmi Reklamlar",
    }
    return mapping.get(value, "Gündem")


def parse_time(value):
    value = clean_text(value)
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError:
        try:
            return datetime.strptime(value, "%a, %d %b %Y %H:%M:%S %z").isoformat()
        except ValueError:
            return ""


def scrape_article(url, rss_map):
    slug = Path(urlparse(url).path).stem
    try:
        response = get(url)
        soup = BeautifulSoup(response.content, "html.parser")
        rss = rss_map.get(url, {})

        def meta(name, key="property"):
            node = soup.find("meta", attrs={key: name})
            return clean_text(node.get("content") if node else "")

        headline = meta("og:title") or rss.get("headline", "")
        standfirst = meta("og:description") or rss.get("standfirst", "")
        published_at = parse_time(meta("article:published_time")) or parse_time(rss.get("published_at", ""))
        updated_at = parse_time(meta("article:modified_time")) or published_at
        root = soup.select_one("article.article > .detail-container .row.b-row .col-8")
        content_row = None
        if root:
            content_row = next(
                (node for node in root.find_all("div", recursive=False)
                 if node.get_text(" ", strip=True) and "popup" not in (node.get("class") or [])),
                None,
            )
        body = []
        if content_row:
            for node in content_row.find_all(["h2", "p", "blockquote"]):
                text = clean_text(node.get_text(" ", strip=True))
                if not text or text == headline or text == standfirst:
                    continue
                block_type = "heading" if node.name == "h2" else "quote" if node.name == "blockquote" else "paragraph"
                body.append({"type": block_type, "text": text})
        if not body and rss.get("body_text"):
            body = [{"type": "paragraph", "text": clean_text(part)} for part in re.split(r"\n\s*\n", rss["body_text"]) if clean_text(part)]
        if not body and standfirst:
            body = [{"type": "paragraph", "text": standfirst}]

        image = meta("og:image") or rss.get("cover_url", "")
        cover = save_cover(image, slug)
        author = rss.get("author", "") or "Art World TV"
        return {
            "source_url": url,
            "slug": slug,
            "headline": headline or slug.replace("-", " ").title(),
            "standfirst": standfirst,
            "body": body,
            "category": category_name(soup, rss),
            "author_name": author,
            "published_at": published_at,
            "updated_at": updated_at,
            "cover": cover,
            "seo_title": headline,
            "seo_description": standfirst,
            "source_name": "Art World TV arşiv aktarımı",
        }
    except Exception as error:
        return {"source_url": url, "slug": slug, "error": str(error)}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    index_urls = xml_locs(get(SITEMAP).content, "sitemap")
    urls = []
    for index_url in index_urls:
        try:
            urls.extend(xml_locs(get(index_url).content, "url"))
        except Exception as error:
            print(f"Site haritası atlandı: {index_url} · {error}")
    urls = sorted({url for url in urls if urlparse(url).hostname in ALLOWED_HOSTS and re.search(r"/haber-[^/]+\.html$", url)}, reverse=True)
    rss_map = rss_records()
    partial_file = OUTPUT / "manifest.partial.json"
    previous = json.loads(partial_file.read_text(encoding="utf-8")) if partial_file.exists() else []
    results = [row for row in previous if not row.get("error")]
    completed_urls = {row.get("source_url") for row in results}
    remaining_urls = [url for url in urls if url not in completed_urls]
    print(f"Sitemap haber sayısı: {len(urls)} · RSS tam içerik sayısı: {len(rss_map)} · Tamamlanan: {len(results)} · Kalan/yeniden denenecek: {len(remaining_urls)}")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(scrape_article, url, rss_map): url for url in remaining_urls}
        for completed, future in enumerate(as_completed(futures), start=1):
            results.append(future.result())
            if completed % 25 == 0 or completed == len(futures):
                errors = sum(1 for row in results if row.get("error"))
                print(f"İşlendi: {len(results)}/{len(urls)} · Hata: {errors} · Kapak: {total_image_bytes // (1024 * 1024)} MB")
                (OUTPUT / "manifest.partial.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    results.sort(key=lambda row: row.get("published_at", ""), reverse=True)
    output_file = OUTPUT / "manifest.json"
    output_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT / "manifest.partial.json").unlink(missing_ok=True)
    errors = [row for row in results if row.get("error")]
    with (OUTPUT / "errors.json").open("w", encoding="utf-8") as file:
        json.dump(errors, file, ensure_ascii=False, indent=2)
    print(f"Manifest: {output_file}")
    print(f"Başarılı: {len(results) - len(errors)} · Hatalı: {len(errors)} · Kapak verisi: {total_image_bytes // (1024 * 1024)} MB")


if __name__ == "__main__":
    main()
