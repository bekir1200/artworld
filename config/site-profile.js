const categories = [
  { name: 'Antalya', slug: 'antalya' },
  { name: 'Gündem', slug: 'gundem' },
  { name: 'Siyaset', slug: 'siyaset' },
  { name: 'Asayiş', slug: 'asayis' },
  { name: 'Ekonomi', slug: 'ekonomi' },
  { name: 'Dünya', slug: 'dunya' },
  { name: 'Eğitim', slug: 'egitim' },
  { name: 'Sağlık', slug: 'saglik' },
  { name: 'Turizm', slug: 'turizm' },
  { name: 'Spor', slug: 'spor' },
  { name: 'Kültür Sanat', slug: 'kultur-sanat' },
  { name: 'Yaşam', slug: 'yasam' },
  { name: 'Türkiye', slug: 'turkiye' },
  { name: 'Canlı Yayın', slug: 'canli-yayin' },
  { name: 'Resmi Reklamlar', slug: 'resmi-reklamlar' }
];

const profile = {
  brand: 'Art World TV',
  website: 'https://www.artworld.com.tr/',
  publisher: 'Akdeniz Radyo Televizyon Tanıtım Hizmetleri A.Ş.',
  representative: 'Cevdet Dönmez',
  editorInChief: 'Gözde Dolayman',
  address: '470 Sokak, K.Erkal İş Merkezi No: 4 Kat: 2, Muratpaşa / Antalya',
  phone: '+90 532 211 80 55',
  emails: ['artworld.com.tr@gmail.com', 'info@artworldtv.com.tr'],
  uets: '35756-96579-49812',
  hostingProvider: 'Halit Eliaçık',
  hostingAddress: 'Yeni Mahalle Belediye Pasajı No:3 Kapı No:02, 43300 Tavşanlı / Kütahya',
  youtube: 'https://www.youtube.com/@artworld_tv-anahaberajans%C4%B1',
  liveTv: 'https://www.artidijitalmedya.com/tv/artworld/',
  liveEmbed: 'https://www.artidijitalmedya.com/embed/tv/artworld/',
  videoArchive: 'https://www.artworld.com.tr/canli_yayin_art_world_tv-haberleri',
  rss: 'https://www.artworld.com.tr/rss.xml',
  sourceMap: 'https://www.artworld.com.tr/sitemap.xml',
  categories,
  programs: ['Gündem Özel', 'İz Bırakanlar', 'Spor Vizyon', 'Hayatın İçinden'],
  archiveSections: [
    { name: 'Foto Galeri', url: 'https://www.artworld.com.tr/fotograf' },
    { name: 'Video Galeri', url: 'https://www.artworld.com.tr/video' },
    { name: 'Yazarlar', url: 'https://www.artworld.com.tr/yazarlar' },
    { name: 'Röportajlar', url: 'https://www.artworld.com.tr/roportajlar' },
    { name: 'Seçim Özel', url: 'https://www.artworld.com.tr/secim-sonuclari' },
    { name: 'Yerel Haber', url: 'https://www.artworld.com.tr/antalya-haber' },
    { name: 'Arşivler', url: 'https://www.artworld.com.tr/arsiv' },
    { name: 'Resmi Reklamlar', url: 'https://www.artworld.com.tr/resmi_reklamlar-haberleri' }
  ],
  services: [
    'Hava Durumu', 'Yol ve Trafik', 'Namaz Vakitleri', 'Piyasalar', 'Puan Durumu',
    'Nöbetçi Eczaneler', 'Astroloji', 'Sinemalar', 'Rüya Tabirleri',
    'Gazete Manşetleri', 'Tarihte Bugün', 'Günün Sözü'
  ],
  editorialPrinciples: [
    'Haberleri doğrulamaya, güvenilir kaynakları belirtmeye ve yanlış bilgi yayımlamaktan kaçınmaya özen gösteririz.',
    'Kişilerin özel hayatına ve insan onuruna saygı gösterir; ayrımcı, aşağılayıcı veya şiddeti özendiren içeriklerden kaçınırız.',
    'Mahkeme kararı kesinleşmeden kişileri suçlu ilan etmeyiz; iddia ve kesinleşmiş bilgiyi birbirinden açıkça ayırırız.',
    'Reklam ve sponsorlu içerikleri editoryal haberlerden ayırt edilecek biçimde etiketleriz.',
    'Yanlış veya eksik yayınlarda düzeltme ve cevap başvurularını değerlendiririz.'
  ],
  adBenefits: [
    'Reklam gösterimi, tıklama ve dönüşüm gibi ölçülebilir sonuçlar',
    'Kampanya performansını izlemeye uygun raporlama',
    'Hedef kitleye ve yayın alanına göre planlama',
    'Kreatif ve yayın tarihlerini değiştirebilen esnek kampanyalar'
  ]
};

module.exports = profile;
