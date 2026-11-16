require('../config/env');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const pool = require('../db/pool');

const projectDir = path.join(__dirname, '..');
const defaultManifest = path.join(projectDir, 'data', 'artworld-source', 'manifest.json');
const mediaDir = path.join(projectDir, 'storage', 'media');

function categorySlug(name) {
  return new Map([
    ['Antalya', 'antalya'], ['Gündem', 'gundem'], ['Siyaset', 'siyaset'],
    ['Asayiş', 'asayis'], ['Ekonomi', 'ekonomi'], ['Dünya', 'dunya'],
    ['Eğitim', 'egitim'], ['Sağlık', 'saglik'], ['Turizm', 'turizm'],
    ['Spor', 'spor'], ['Kültür Sanat', 'kultur-sanat'], ['Yaşam', 'yasam'],
    ['Türkiye', 'turkiye'], ['Canlı Yayın', 'canli-yayin'], ['Resmi Reklamlar', 'resmi-reklamlar']
  ]).get(name) || 'gundem';
}

function validCoverMime(mime) {
  return new Map([
    ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']
  ]).get(mime);
}

async function importArticle(article, client) {
  const slug = typeof article.slug === 'string' ? article.slug.slice(0, 220) : '';
  const headline = typeof article.headline === 'string' ? article.headline.trim().slice(0, 500) : '';
  const standfirst = typeof article.standfirst === 'string' ? article.standfirst.trim().slice(0, 5000) : '';
  const sourceUrl = typeof article.source_url === 'string' && /^https:\/\/(?:www\.)?artworld\.com\.tr\/haber-[^/]+\.html$/.test(article.source_url)
    ? article.source_url
    : '';
  const publishedAt = typeof article.published_at === 'string' ? new Date(article.published_at) : null;
  const updatedAt = typeof article.updated_at === 'string' ? new Date(article.updated_at) : null;
  if (!slug || !headline || !sourceUrl || !publishedAt || Number.isNaN(publishedAt.valueOf())) return 'invalid';

  const existing = await client.query('SELECT id FROM articles WHERE slug = $1 OR source_url = $2 LIMIT 1', [slug, sourceUrl]);
  if (existing.rowCount) return 'existing';

  const categoryResult = await client.query('SELECT id FROM categories WHERE slug = $1 AND is_active = TRUE', [categorySlug(article.category)]);
  const categoryId = categoryResult.rows[0]?.id || null;
  let coverMediaId = null;
  let createdFilePath = '';

  if (article.cover?.file && validCoverMime(article.cover.mime_type)) {
    const relativeFile = path.resolve(projectDir, 'data', 'artworld-source', article.cover.file);
    const sourceDir = path.resolve(projectDir, 'data', 'artworld-source', 'media') + path.sep;
    if (relativeFile.startsWith(sourceDir)) {
      const bytes = await fs.readFile(relativeFile);
      if (bytes.length > 0 && bytes.length <= 6 * 1024 * 1024) {
        const extension = validCoverMime(article.cover.mime_type);
        const storageKey = `${randomBytes(20).toString('hex')}.${extension}`;
        await fs.mkdir(mediaDir, { recursive: true });
        createdFilePath = path.join(mediaDir, storageKey);
        await fs.writeFile(createdFilePath, bytes, { flag: 'wx', mode: 0o640 });
        const media = await client.query(
          `INSERT INTO media_assets (storage_key, original_name, mime_type, byte_size, alt_text, source_credit, rights_note)
           VALUES ($1, $2, $3, $4, $5, 'Art World TV', $6) RETURNING id`,
          [storageKey, path.basename(relativeFile), article.cover.mime_type, bytes.length, headline, `Arşiv aktarımı; kaynak haber: ${sourceUrl}`]
        );
        coverMediaId = media.rows[0].id;
      }
    }
  }

  try {
    const body = Array.isArray(article.body) ? article.body.filter((block) =>
      block && ['paragraph', 'heading', 'quote'].includes(block.type) && typeof block.text === 'string' && block.text.trim()
    ).map((block) => ({ type: block.type, text: block.text.slice(0, 20_000) })) : [];
    const result = await client.query(
      `INSERT INTO articles
         (slug, headline, standfirst, body, status, primary_category_id, cover_media_id,
          source_name, source_url, seo_title, seo_description, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 'published', $5, $6, $7, $8, $9, $10, $11, $11, $12)
       RETURNING id`,
      [slug, headline, standfirst, JSON.stringify(body), categoryId, coverMediaId,
        'Art World TV', sourceUrl, article.seo_title || headline, article.seo_description || standfirst,
        publishedAt.toISOString(), updatedAt && !Number.isNaN(updatedAt.valueOf()) ? updatedAt.toISOString() : publishedAt.toISOString()]
    );
    const articleId = result.rows[0].id;
    await client.query(
      `INSERT INTO article_revisions (article_id, revision_number, snapshot, change_note)
       VALUES ($1, 1, $2::jsonb, 'Art World TV kaynak arşivinden içe aktarıldı')`,
      [articleId, JSON.stringify({ headline, standfirst, body, status: 'published', primary_category_id: categoryId, cover_media_id: coverMediaId })]
    );
    await client.query(
      `INSERT INTO article_workflow_events (article_id, from_status, to_status, note)
       VALUES ($1, NULL, 'published', 'Art World TV kaynak arşivinden içe aktarıldı')`, [articleId]
    );
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, after_data)
       VALUES ('article.imported', 'article', $1, $2::jsonb)`,
      [articleId, JSON.stringify({ source_url: sourceUrl, category: article.category || 'Gündem' })]
    );
    return 'imported';
  } catch (error) {
    if (createdFilePath) await fs.unlink(createdFilePath).catch(() => {});
    throw error;
  }
}

async function main() {
  const manifestPath = path.resolve(process.argv[2] || defaultManifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('İçe aktarılacak haber bulunamadı.');
  const counts = { imported: 0, existing: 0, invalid: 0, failed: 0 };
  for (const article of manifest) {
    if (article.error) { counts.failed += 1; continue; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const status = await importArticle(article, client);
      await client.query('COMMIT');
      counts[status] += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      counts.failed += 1;
      process.stderr.write(`Aktarım hatası (${article.source_url || article.slug}): ${error.message}\n`);
    } finally { client.release(); }
  }
  process.stdout.write(`Art World TV aktarımı tamamlandı: ${counts.imported} yeni, ${counts.existing} zaten vardı, ${counts.invalid} geçersiz, ${counts.failed} hata.\n`);
  await pool.end();
  if (counts.failed) process.exitCode = 1;
}

main().catch(async (error) => {
  process.stderr.write(`Aktarım başlatılamadı: ${error.message}\n`);
  await pool.end();
  process.exitCode = 1;
});
