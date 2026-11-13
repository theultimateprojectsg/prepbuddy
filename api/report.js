// POST /api/report — a student flags a question. It's saved for the admin to check (admin page → Reported questions).
// body: { reason, note, lang, book: { id, title, library, code }, unit: { id, title }, q: {...question}, answer }
const { checkAccess } = require('../lib/claude');
const { saveReport } = require('../lib/github');

const REASONS = ['wrong_answer', 'unclear', 'missing_figure', 'off_topic', 'typo', 'other'];
const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Use POST.' })); }
    checkAccess(req); await require('../lib/spend').gate();
    let body = req.body;
    if (!body || typeof body !== 'object') { const chunks = []; for await (const c of req) chunks.push(c); body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    if (!REASONS.includes(body.reason)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Pick what is wrong.' })); }
    const q = body.q || {};
    const report = {
      t: Date.now(), reason: body.reason, note: cut(body.note, 1000) || '', lang: cut(body.lang, 5),
      book: { id: cut((body.book || {}).id, 60), title: cut((body.book || {}).title, 200), library: cut((body.book || {}).library, 60), code: cut((body.book || {}).code, 20) },
      unit: { id: cut((body.unit || {}).id, 20), title: cut((body.unit || {}).title, 200) },
      q: JSON.parse(JSON.stringify(q, (k, v) => (k === 'img' ? undefined : typeof v === 'string' ? v.slice(0, 4000) : v)) || '{}'),
      answer: cut(body.answer, 3000) || '',
    };
    const path = await saveReport(report);
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, id: path }));
  } catch (e) {
    res.statusCode = e.status || 500; res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
