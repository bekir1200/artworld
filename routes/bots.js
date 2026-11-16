const pool = require('../db/pool');
const { runBot, _assertPublicHttpUrl: assertPublicHttpUrl } = require('./bot-runner');
function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }
function httpError(status, message){ const e=new Error(message); e.status=status; return e; }
// Origin başlığı zorunlu ve host ile aynı olmalı (CSRF'e karşı).
function requireSameOrigin(req){
  const origin = req.headers.origin;
  let ok = false;
  try { ok = Boolean(origin) && new URL(origin).host === req.headers.host; } catch { ok = false; }
  if(!ok) throw httpError(403, 'Geçersiz istek kaynağı.');
}

// RSS adresini kaydetmeden önce doğrular. Boş/null ise null döner (RSS'siz ajans serbest).
// Özel/loopback/link-local/metadata adresleri ve DNS'i çözülemeyen adresler reddedilir.
async function normalizeRssUrl(value){
  if(value === undefined || value === null) return null;
  const rssUrl = String(value).trim();
  if(rssUrl === '') return null;
  if(!/^https?:\/\/\S+$/i.test(rssUrl)){
    throw httpError(400, 'RSS adresi boş olabilir ya da http(s):// ile başlamalıdır.');
  }
  try {
    await assertPublicHttpUrl(rssUrl);
  } catch {
    throw httpError(400, 'RSS adresi herkese açık bir internet adresi olmalı.');
  }
  return rssUrl;
}

// Ajans adından agency_key üretir (ASCII, küçük harf, tire ayraçlı).
function slugifyAgencyKey(name){
  const base = name.toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return base || 'ajans';
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith('/api/admin/bots')) return false;
  if(!user || !['admin','editor_in_chief','editor'].includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    const rest = pathname.slice('/api/admin/bots'.length).replace(/\/+$/, '');

    // GET /api/admin/bots : tüm ajans yapılandırmaları
    if(method === 'GET' && rest === ''){
      const result = await pool.query(
        `SELECT id, agency_key, agency_name, rss_url, is_active, last_run_at, last_result, last_inserted
           FROM content_bots
          ORDER BY agency_name ASC`
      );
      sendJson(res, 200, { bots: result.rows });
      return true;
    }

    // POST /api/admin/bots : yeni ajans (ad zorunlu, RSS isteğe bağlı, varsayılan pasif)
    if(method === 'POST' && rest === ''){
      requireSameOrigin(req);
      const body = await readJson(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const nameLength = Array.from(name).length;
      if(nameLength < 2 || nameLength > 100){
        throw httpError(400, 'Ajans adı 2-100 karakter olmalıdır.');
      }
      if(body.isActive !== undefined && typeof body.isActive !== 'boolean'){
        throw httpError(400, 'isActive boolean olmalıdır.');
      }
      const isActive = body.isActive === true;
      const rssUrl = await normalizeRssUrl(body.rssUrl);
      const baseKey = slugifyAgencyKey(name);
      let created = null;
      // agency_key UNIQUE: çakışırsa sonuna sayı ekleyerek tekrar dene.
      for(let attempt = 1; attempt <= 50 && !created; attempt += 1){
        const agencyKey = attempt === 1 ? baseKey : `${baseKey}-${attempt}`;
        try {
          const inserted = await pool.query(
            `INSERT INTO content_bots (agency_key, agency_name, rss_url, is_active)
             VALUES ($1, $2, $3, $4)
             RETURNING id, agency_key, agency_name, rss_url, is_active, last_run_at, last_result, last_inserted`,
            [agencyKey, name, rssUrl, isActive]
          );
          created = inserted.rows[0];
        } catch (error) {
          if (error.code !== '23505') throw error;
        }
      }
      if(!created) throw httpError(409, 'Ajans anahtarı oluşturulamadı; farklı bir ad deneyin.');
      sendJson(res, 201, { bot: created });
      return true;
    }

    // POST /api/admin/bots/:id/run : ajansı şimdi çek (aktif/pasif fark etmez)
    const runMatch = rest.match(/^\/(\d+)\/run$/);
    if(method === 'POST' && runMatch){
      requireSameOrigin(req);
      const id = Number(runMatch[1]);
      const bot = await pool.query('SELECT id, rss_url FROM content_bots WHERE id = $1', [id]);
      if(bot.rowCount === 0) throw httpError(404, 'Ajans bulunamadı.');
      if(!bot.rows[0].rss_url || !String(bot.rows[0].rss_url).trim()) throw httpError(400, 'Önce RSS adresi girin.');
      const result = await runBot(id);
      sendJson(res, 200, { result });
      return true;
    }

    // PATCH /api/admin/bots/:id : RSS adresi ve aktif/pasif durumu
    const match = rest.match(/^\/(\d+)$/);
    if(method === 'PATCH' && match){
      requireSameOrigin(req);
      const id = Number(match[1]);
      const body = await readJson(req);
      if(!Object.prototype.hasOwnProperty.call(body, 'isActive') || typeof body.isActive !== 'boolean'){
        throw httpError(400, 'isActive boolean olmalıdır.');
      }
      // rssUrl gönderilmezse mevcut değer korunur.
      const hasRssUrl = body.rssUrl !== undefined;
      const rssUrl = hasRssUrl ? await normalizeRssUrl(body.rssUrl) : null;
      const result = await pool.query(
        `UPDATE content_bots
            SET rss_url = CASE WHEN $4::boolean THEN $2::text ELSE rss_url END,
                is_active = $3,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id`,
        [id, rssUrl, body.isActive, hasRssUrl]
      );
      if(result.rowCount === 0) throw httpError(404, 'Ajans bulunamadı.');
      sendJson(res, 200, { ok: true });
      return true;
    }

    // DELETE /api/admin/bots/:id : ajansı sil.
    // content_bots'a bağlı alt tablo yok (articles yalnızca source_url metni tutar), bu yüzden tek deyim yeterli ve atomiktir.
    if(method === 'DELETE' && match){
      requireSameOrigin(req);
      const id = Number(match[1]);
      const result = await pool.query('DELETE FROM content_bots WHERE id = $1 RETURNING id', [id]);
      if(result.rowCount === 0) throw httpError(404, 'Ajans bulunamadı.');
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res,404,{error:'Adres bulunamadı.'}); return true;
  }
  catch(err){ sendJson(res, err.status||400, {error: err.message||'İşlem başarısız.'}); return true; }
}
module.exports = { handle };
