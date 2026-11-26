// POST /api/pilot   — the pilot: family codes and each device's activity (stored privately, see lib/pilot.js)
// step 'check':    { code }                     → { pilot: bool, ok: bool }         is the pilot on, and is this code good?
// step 'sync':     { code, device, snap }        → { ok, plan }                      this device's latest activity summary; plan set by the admin
// step 'feedback': { code, device, text, screen, name } → { ok }
const P = require('../pilot');
// Device summaries are shown on the admin page, so strip anything that could act as HTML or break out of an
// attribute, cap string lengths and nesting, and keep numbers as numbers.
function clean(v, depth = 0) {
  if (depth > 6) return null;
  if (typeof v === 'string') return v.replace(/[<>"'`]/g, '').slice(0, 300);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 400).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v).slice(0, 200)) o[String(k).replace(/[<>"'`]/g, '').slice(0, 80)] = clean(x, depth + 1); return o; }
  return null;
}
const { readJson } = require('../claude');
const page = (res, status, title, text) => { res.statusCode = status; res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1F2A4D;text-align:center"><h1 style="font-size:22px">${title}</h1><p style="color:#5A6380;line-height:1.5">${text}</p></body>`); };
async function reportLink(req, res) {
  const t = String(req.query.r || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  if (!P.pilotOn() || t.length < 10) return page(res, 404, 'Report not found', 'Please check the link. 請檢查連結。');
  const ln = (await P.readFile(`links/${t}.json`)).data;
  if (!ln || (await P.isRemoved(ln.code))) return page(res, 404, 'Report not found', 'This link isn’t active. 這個連結已失效。');
  const snap = (await P.readFile(`activity/${P.safe(ln.code)}/${P.safe(ln.device)}.json`)).data;
  const rep = snap && typeof snap.rep === 'string' && /^[A-Za-z0-9_-]+$/.test(snap.rep) ? snap.rep : null;
  if (!rep) return page(res, 200, 'Report not ready yet', 'Your child’s report appears here after they practise in PrepBuddy. 孩子在 PrepBuddy 練習後，報告便會在這裏顯示。');
  res.setHeader('cache-control', 'no-store'); res.statusCode = 302; res.setHeader('location', `/report.html#d=${rep}`); res.end();
}
module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  const send = (s, o) => { res.statusCode = s; res.end(JSON.stringify(o)); };
  try {
    // GET /r/<token>: a parent's link to their child's latest weekly report (made on the admin page → Weekly updates).
    // The token is random and maps to one child's device; the link always shows the report from their last sync.
    if (req.method === 'GET' && req.query && req.query.r) return reportLink(req, res);
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' });
    const body = await readJson(req);
    if (!P.pilotOn()) return send(200, { pilot: false, ok: true });
    let code = P.validCode(body.code);
    if (code && (await P.isRemoved(code))) code = null; // removed by the admin
    if (body.step === 'check') {
      // the family's display name for the welcome screen (the part before any brackets, e.g. "Chan family")
      let name = '';
      if (code && body.welcome) { try { const fam = (await P.readFile('families.json')).data || []; const f = fam.find((x) => x.code === code); name = f ? String(f.name || '').split('(')[0].trim().slice(0, 40) : ''; } catch (e) {} }
      return send(200, { pilot: true, ok: !!code, name });
    }
    if (!code) return send(401, { error: 'That family code isn’t right.' });
    const device = P.safe(body.device) || 'device';
    if (body.step === 'sync') {
      const snap = body.snap && typeof body.snap === 'object' ? body.snap : {};
      const raw = JSON.stringify(snap); if (raw.length > 60000) return send(413, { error: 'Too big.' });
      // the weekly report travels as one long base64url string: keep it whole (clean() would cut strings to 300)
      const rep = typeof snap.rep === 'string' && snap.rep.length < 40000 && /^[A-Za-z0-9_-]+$/.test(snap.rep) ? snap.rep : null;
      await P.writeFile(`activity/${code}/${device}.json`, { ...clean({ ...snap, rep: null }), rep, code, device, synced: Date.now() }, `Activity ${code}`);
      // Tell the device which plan the admin set for this family (if any).
      let plan = null; try { const fam = (await P.readFile('families.json')).data || []; const f = fam.find((x) => x.code === code); plan = (f && f.plan) || null; } catch (e) {}
      return send(200, { ok: true, plan });
    }
    if (body.step === 'feedback') {
      const text = String(body.text || '').trim().slice(0, 3000);
      if (!text) return send(400, { error: 'Nothing to send.' });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await P.writeFile(`feedback/${stamp}-${code}.json`, { at: Date.now(), code, device, name: String(body.name || '').slice(0, 40), screen: String(body.screen || '').slice(0, 60), text }, `Feedback ${code}`);
      return send(200, { ok: true });
    }
    send(400, { error: 'Unknown step.' });
  } catch (e) { send(e.status || 500, { error: e.message || 'Server error' }); }
};
