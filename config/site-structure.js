const homeDefault = {
  modules: [
    { id: 'home-breaking', type: 'breaking', title: 'Son dakika', enabled: true, order: 10, limit: 10 },
    { id: 'home-hero', type: 'hero', title: 'Öne çıkan haberler', enabled: true, order: 20, limit: 3 },
    { id: 'home-briefing', type: 'briefing', title: 'Şimdi gündemde', enabled: true, order: 30, limit: 4 },
    { id: 'home-latest', type: 'latest', title: 'Günün seçkisi', enabled: true, order: 40, limit: 12 },
    { id: 'home-live', type: 'liveStream', title: 'Canlı yayın', enabled: true, order: 50, limit: 0 },
    { id: 'home-ad-top', type: 'adSlot', title: 'Reklam alanı', enabled: true, order: 5, limit: 0, placement: 'home-leaderboard', zone: 'full' },
    { id: 'home-popular', type: 'popular', title: 'Çok okunanlar', enabled: true, order: 80, limit: 4 },
    { id: 'home-video', type: 'videoPrograms', title: 'Programlarımız', enabled: true, order: 60, limit: 4 },
    { id: 'home-newsletter', type: 'newsletter', title: 'Gündem kutunuza gelsin', enabled: true, order: 100, limit: 0 },
    { id: 'home-category-blocks', type: 'categoryBlocks', title: 'Kategorilerden', enabled: true, order: 45, limit: 6, zone: 'main' },
    { id: 'home-latest-feed', type: 'latestFeed', title: 'Son dakika akışı', enabled: true, order: 55, limit: 8, zone: 'side' },
    { id: 'home-columnists', type: 'columnists', title: 'Köşe yazarları', enabled: true, order: 65, limit: 6, zone: 'main' },
    { id: 'home-poll', type: 'poll', title: 'Anket', enabled: true, order: 70, limit: 0, zone: 'side' },
    { id: 'home-photo-gallery', type: 'photoGallery', title: 'Foto galeri', enabled: true, order: 75, limit: 4, zone: 'main' },
    { id: 'home-video-gallery', type: 'videoGallery', title: 'Video galeri', enabled: true, order: 85, limit: 4, zone: 'main' },
    { id: 'home-movies', type: 'movies', title: 'Vizyondaki filmler', enabled: true, order: 90, limit: 8, zone: 'main' },
    { id: 'home-horoscope', type: 'horoscope', title: 'Burçlar', enabled: true, order: 95, limit: 12, zone: 'full' }
  ]
};

const articleDefault = {
  modules: [
    { id: 'article-breadcrumb', type: 'breadcrumb', title: '', enabled: true, order: 10 },
    { id: 'article-header', type: 'articleHeader', title: '', enabled: true, order: 20 },
    { id: 'article-cover', type: 'cover', title: '', enabled: true, order: 30 },
    { id: 'article-body', type: 'body', title: '', enabled: true, order: 40 },
    { id: 'article-ad-inline', type: 'adInline', title: 'Sponsor alanı', enabled: true, order: 50 },
    { id: 'article-ad-sidebar', type: 'adSidebar', title: 'Haber yanı reklamı', enabled: false, order: 55 },
    { id: 'article-share', type: 'share', title: 'Haberi paylaş', enabled: true, order: 60 },
    { id: 'article-related', type: 'related', title: 'İlgili haberler', enabled: true, order: 70 },
    { id: 'article-popular', type: 'popular', title: 'Çok okunanlar', enabled: false, order: 80 },
    { id: 'article-newsletter', type: 'newsletter', title: 'Art World TV bülteni', enabled: false, order: 90 }
  ]
};

module.exports = { defaults: { home: homeDefault, article: articleDefault } };
