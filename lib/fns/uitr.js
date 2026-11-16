// POST /api/uitr — translates the app's own buttons, menus and messages into French or Japanese, a batch at a time.
// body: { lang: 'fr' | 'ja', strings: [english, ...] } → { out: [translation, ...] }
// The browser keeps every translation, so each string is translated once per device. Book content is never sent here.
const { callText, checkAccess, readJson, newUsage, httpError } = require('../claude');

const STYLE = {
  fr: 'French. Children (6-18) use the app, and parents set it up. Address the child with "tu"; use "vous" only for text clearly addressed to parents (setup, privacy, plans, parent reports). Short, friendly, natural French as used in French schools (contrôle, exercice, chapitre, révision, dictée).',
  ja: 'Japanese. Children (6-18) use the app, and parents set it up. Use friendly polite Japanese (です/ます) for the child, and polite Japanese for text addressed to parents. Prefer simple words and common kanji, as Japanese learning apps do (テスト, 問題, 章, 復習, 書き取り). Buttons stay short.',
};

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req); await require('../spend').gate();
    const body = await readJson(req);
    const lang = body.lang;
    if (!STYLE[lang]) throw httpError(400, 'Unknown language.');
    const strings = (Array.isArray(body.strings) ? body.strings : []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 60).map((s) => s.slice(0, 400));
    if (!strings.length) throw httpError(400, 'Nothing to translate.');
    const usage = newUsage();
    const text = await callText({
      messages: {
        system: `You translate the interface of PrepBuddy, a study app, from English into ${STYLE[lang]}
Rules:
- Translate each string's meaning naturally for an app screen; keep it about as short as the English.
- Keep placeholders like {0} and {1} exactly (you may move them where the grammar needs them).
- Keep emoji, symbols (· › → ✓ % #) and line breaks. Keep the names PrepBuddy and Buddy, and HKDSE, DSE, TSA, PSLE.
- Leave Chinese words such as 默書 or 呈分試 as they are. Leave a string unchanged if it is already in the target language, is a name or a code.
- Reply with ONLY a JSON array of strings, the same length and order as the input.`,
        list: [{ role: 'user', content: JSON.stringify(strings) }],
      },
      maxTokens: 6000, usage, step: 'check',
    });
    let out = null;
    try { out = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch (e) { out = null; }
    if (!Array.isArray(out) || out.length !== strings.length) throw httpError(502, 'Translation failed.');
    res.statusCode = 200;
    res.end(JSON.stringify({ out: out.map((x, i) => (typeof x === 'string' && x.trim() ? x.slice(0, 600) : strings[i])), usage }));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.status ? e.message : 'Something went wrong.' }));
  }
};
