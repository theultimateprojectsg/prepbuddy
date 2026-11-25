// POST /api/insights — "What Buddy has noticed": reads a child's recent wrong answers and names the
// misunderstandings that keep coming back (e.g. "mixes up evaporation and boiling"), for the Progress page.
// body: { items: [{ id, ch, q, right, said, n }], lang, ui, learner } → { mixups: [{ title, detail, ids }] }
// Called at most about once a week per child; the browser keeps the result. No names are sent.
const { callText, checkAccess, readJson, newUsage, httpError, replyLang, attachLearner } = require('../claude');

const LANGS = { en: 'English', zh: 'Traditional Chinese as used in Hong Kong', fr: 'French', ja: 'Japanese' };

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    await checkAccess(req); await require('../spend').gate();
    const body = await readJson(req);
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((x) => ({
      id: String(x.id || '').slice(0, 120), ch: String(x.ch || '').slice(0, 120), q: String(x.q || '').slice(0, 600),
      right: String(x.right || '').slice(0, 500), said: String(x.said || '').slice(0, 500), n: Math.max(1, Math.min(9, Number(x.n) || 1)),
    })).filter((x) => x.id && x.q);
    if (items.length < 3) return res.end(JSON.stringify({ mixups: [] }));
    const lang = LANGS[body.lang] ? body.lang : 'en';
    const usage = attachLearner(newUsage(), body);
    const text = await callText({
      messages: {
        system: `You are an experienced primary and secondary school teacher looking over a child's recent wrong answers in a study app.
Find the misunderstandings that keep coming back: the same wrong idea, confusion or careless habit showing up in at least 2 of the answers (or 1 answer missed 2 or more times).
- Name each one as a teacher would tell a parent, specific to the content: "Mixes up evaporation and boiling", "Adds the bottom numbers when adding fractions", "Uses 'in' instead of 'on' for days". Never vague ("needs to read carefully", "struggles with science").
- Only what the answers really show. If no pattern repeats, return an empty list. At most 3, most costly first.
- title: at most 8 words. detail: one or two short sentences a parent understands: what the child does, with one tiny example from the answers, and why it costs marks. No praise, no advice list.
- ids: the ids of the answers that show it.
- Write title and detail in ${LANGS[lang]}${lang === 'zh' ? `. ${replyLang('zh')}` : ''}. Keep subject terms as the textbook uses them.
Reply with ONLY JSON: {"mixups":[{"title":"...","detail":"...","ids":["..."]}]}`,
        list: [{ role: 'user', content: JSON.stringify(items.map((x) => ({ id: x.id, chapter: x.ch, question: x.q, correct: x.right, child_answered: x.said, times_wrong: x.n }))) }],
      },
      maxTokens: 1500, usage, step: 'write',
    });
    let obj = null;
    try { obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { obj = null; }
    const known = new Set(items.map((x) => x.id));
    const mixups = (obj && Array.isArray(obj.mixups) ? obj.mixups : []).filter((m) => m && m.title).slice(0, 3).map((m) => ({
      title: String(m.title).slice(0, 90), detail: String(m.detail || '').slice(0, 320),
      ids: (Array.isArray(m.ids) ? m.ids : []).map(String).filter((id) => known.has(id)).slice(0, 12),
    }));
    res.statusCode = 200;
    res.end(JSON.stringify({ mixups, usage }));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.status ? e.message : 'Something went wrong.' }));
  }
};
