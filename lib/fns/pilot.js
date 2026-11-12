// POST /api/pilot   — the pilot: family codes and each device's activity (stored privately, see lib/pilot.js)
// step 'check':    { code }                     → { pilot: bool, ok: bool }         is the pilot on, and is this code good?
// step 'sync':     { code, device, snap }        → { ok, plan }                      this device's latest activity summary; plan set by the admin
// step 'feedback': { code, device, text, screen, name } → { ok }
const P = require('../pilot');
const { readJson } = require('../claude');
module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  const send = (s, o) => { res.statusCode = s; res.end(JSON.stringify(o)); };
  try {
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' });
    const body = await readJson(req);
    if (!P.pilotOn()) return send(200, { pilot: false, ok: true });
    const code = P.validCode(body.code);
    if (body.step === 'check') return send(200, { pilot: true, ok: !!code });
    if (!code) return send(401, { error: 'That family code isn’t right.' });
    const device = P.safe(body.device) || 'device';
    if (body.step === 'sync') {
      const snap = body.snap && typeof body.snap === 'object' ? body.snap : {};
      const raw = JSON.stringify(snap); if (raw.length > 60000) return send(413, { error: 'Too big.' });
      await P.writeFile(`activity/${code}/${device}.json`, { ...snap, code, device, synced: Date.now() }, `Activity ${code}`);
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
