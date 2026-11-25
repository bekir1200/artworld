'use strict';
/* Haber başlığı benzerliği (paketsiz).
   Farklı ajanslardan gelen aynı olayı yakalamak için başlıklar kelimelere ayrılır, Türkçe karakter,
   büyük/küçük harf, kesme işareti ve bağlaçlar ayıklanır. Kelimeler ek farkına dayanıklı olsun diye
   ön ekle eşleştirilir ("kaza" ~ "kazası", "Antalya'da" ~ "Antalya").
   - Kelimeler başlık kümesindeki sıklığa göre ağırlıklandırılır (sık kelime az, nadir kelime çok sayılır).
   - Özel isimler ayrıca izlenir: iki başlıkta yalnız birinde geçen en az iki özel isim varsa
     ("… MMO Başkanı Kılıç'a ziyaret" / "… EMO Başkanı Tat'a ziyaret") başlıklar farklı olay sayılır.
   İlke: şüphede haber eklenir. Aynı olayı bir kez kaçırmak, farklı bir haberi atlamaktan daha az zararlı. */

function fold(text) {
  return String(text || '').toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

const STOPWORDS = new Set([
  've', 'ile', 'de', 'da', 'ki', 'bir', 'bu', 'şu', 'o', 'için', 'gibi', 'en', 'çok', 'daha', 'mi', 'mı',
  'mu', 'mü', 'ne', 'olan', 'oldu', 'olarak', 'ise', 'ya', 'veya', 'ama', 'fakat', 'her', 'tüm', 'son',
  'dakika', 'flaş', 'haber', 'haberi', 'video', 'galeri', 'özel', 'canlı', 'işte', 'yeni', 'kadar'
].map(fold));

const STEM = 5;          // karşılaştırmada kullanılan en fazla harf
const MIN_PREFIX = 4;    // iki kelime en az bu kadar ortak başlangıçla eşleşir
const UPPER = /^[A-ZÇĞİÖŞÜ]/;

function stemOf(word) {
  return /^\d+$/.test(word) ? word : word.slice(0, STEM);
}

// Başlığı karşılaştırılabilir kelime köklerine ve özel isim köklerine ayırır.
function analyze(headline) {
  const text = String(headline || '').replace(/(\d)[.,](\d)/g, '$1$2'); // 6,8 milyar -> 68
  const words = text.split(/[^0-9A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû'’`´]+/).filter(Boolean);
  const letters = text.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '');
  const allCaps = letters.length > 0 && letters.replace(/[^A-ZÇĞİÖŞÜ]/g, '').length / letters.length > 0.6;

  const tokens = [];
  const names = new Set();
  words.forEach((raw, index) => {
    const [base, ...suffix] = raw.split(/['’`´]/);      // Antalya'da -> Antalya + da
    for (const part of [base, ...suffix]) {
      const folded = fold(part);
      if (!folded || STOPWORDS.has(folded) || (folded.length < 2 && !/\d/.test(folded))) continue;
      tokens.push(stemOf(folded));
    }
    // Özel isim: büyük harfle başlayan kelime (cümle başı hariç, kısaltmalar dahil). Tamamı büyük
    // harfle yazılmış başlıklarda bu ayrım yapılamaz.
    const foldedBase = fold(base);
    if (!allCaps && UPPER.test(base) && foldedBase.length >= 2 && !STOPWORDS.has(foldedBase)
      && (index > 0 || /^[A-ZÇĞİÖŞÜ0-9]{2,}$/.test(base))) {
      names.add(stemOf(foldedBase));
    }
  });
  return { tokens: [...new Set(tokens)], names: [...names] };
}

function headlineTokens(headline) {
  return analyze(headline).tokens;
}

function tokensMatch(a, b) {
  if (a === b) return true;
  if (/^\d/.test(a) || /^\d/.test(b)) return false; // sayılar tam eşleşmeli ("2 yaralı" ≠ "3 yaralı")
  const n = Math.min(a.length, b.length);
  return n >= MIN_PREFIX && a.slice(0, n) === b.slice(0, n);
}

const UNIT = () => 1;

// Ağırlıklı benzerlik (0..1) ve ortak kelime sayısı. weight(token) -> sayı.
function similarity(tokensA, tokensB, weight = UNIT) {
  if (!tokensA.length || !tokensB.length) return { score: 0, overlap: 0, common: 0 };
  const used = new Set();
  let common = 0;
  let commonWeight = 0;
  for (const a of tokensA) {
    const index = tokensB.findIndex((b, i) => !used.has(i) && tokensMatch(a, b));
    if (index !== -1) {
      used.add(index);
      common += 1;
      commonWeight += (weight(a) + weight(tokensB[index])) / 2;
    }
  }
  const sum = (list) => list.reduce((total, t) => total + weight(t), 0);
  const weightA = sum(tokensA);
  const weightB = sum(tokensB);
  return {
    score: (2 * commonWeight) / (weightA + weightB),
    overlap: commonWeight / Math.min(weightA, weightB),
    common
  };
}

// Aynı olay mı? a, b: analyze() çıktısı.
function isSameStory(a, b, weight = UNIT) {
  // İki başlıkta da sayı varsa en az biri ortak olmalı ("2 yaralı" ≠ "3 ölü").
  const numbersA = a.tokens.filter((t) => /^\d+$/.test(t));
  const numbersB = b.tokens.filter((t) => /^\d+$/.test(t));
  if (numbersA.length && numbersB.length && !numbersA.some((n) => numbersB.includes(n))) return false;

  const s = similarity(a.tokens, b.tokens, weight);
  if (s.common < 3) return false;

  // Özel isimler (kişi, kurum, yer): iki başlıkta da diğerinde olmayan isim varsa konu farklıdır
  // ("… Kılıç'a ziyaret" / "… Tat'a ziyaret"). Fazladan isim yalnız bir başlıktaysa o başlık diğerinin
  // ayrıntılı hâli olabilir; bunun için kısa (isimsiz) başlığın neredeyse tamamı ötekinde geçmeli
  // ("Dalaman Çöğmen İlkokulu 100. yılını kutladı" ~ "… kutladı; Şahiner Erkılıç anıldı").
  const orphansA = a.names.filter((n) => !b.tokens.some((t) => tokensMatch(n, t))).length;
  const orphansB = b.names.filter((n) => !a.tokens.some((t) => tokensMatch(n, t))).length;
  if (orphansA && orphansB) return false;
  if (orphansA || orphansB) {
    const plain = orphansA ? b : a;   // fazladan ismi olmayan başlık
    if (s.common / plain.tokens.length < 0.9) return false;
  }

  return s.score >= 0.6 || (s.common >= 4 && s.overlap >= 0.85);
}

// Kelime ağırlıkları: başlık kümesinde ne kadar az geçiyorsa o kadar ağır (IDF).
function buildWeights(tokenLists) {
  const df = new Map();
  for (const tokens of tokenLists) for (const t of tokens) df.set(t, (df.get(t) || 0) + 1);
  const total = tokenLists.length;
  return (token) => Math.log((total + 1) / ((df.get(token) || 0) + 1)) + 1;
}

/* Son haberler içinde aynı olayı anlatan başlığı bulur.
   index = createIndex([{ id, headline }]); index.find(headline) -> eşleşen kayıt ya da null;
   index.add({ id, headline }) aynı çekimde eklenen haberleri de karşılaştırmaya katar. */
function createIndex(rows) {
  const items = rows.map((row) => ({ ...row, info: analyze(row.headline) }));
  let weight = buildWeights(items.map((item) => item.info.tokens));
  return {
    find(headline) {
      const info = analyze(headline);
      if (info.tokens.length < 3) return null;
      return items.find((item) => isSameStory(info, item.info, weight)) || null;
    },
    add(row) {
      items.push({ ...row, info: analyze(row.headline) });
      weight = buildWeights(items.map((item) => item.info.tokens));
    },
    get size() { return items.length; }
  };
}

module.exports = { analyze, headlineTokens, similarity, isSameStory, buildWeights, createIndex };
