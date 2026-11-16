// POST /api/uitr — translates the app's own buttons, menus and messages into French or Japanese, a batch at a time.
// body: { lang: 'fr' | 'ja', strings: [english, ...] } → { out: [translation, ...] }
// The browser keeps every translation, so each string is translated once per device. Book content is never sent here.
const { callText, checkAccess, readJson, newUsage, httpError, MODELS } = require('../claude');

const STYLE = {
  fr: `French, as a good French educational app for children (6-18) writes it, e.g. the tone of Lumni or Kartable: short, warm and natural, never a word-for-word copy of the English.
- Address the child with "tu". Use "vous" only for text clearly addressed to parents (setup, privacy, plans, parent reports, "for parents").
- School words French pupils use: contrôle, exercice, chapitre, leçon, réviser, dictée, fiche de révision, cahier d'erreurs, devoirs.`,
  ja: `Japanese, as a well-made Japanese learning app for children (e.g. スタディサプリ, 進研ゼミ) writes it: natural, warm and easy to read, never a word-for-word copy of the English.
- Speak to the child in friendly です/ます, or short casual phrases for buttons and Buddy's lines (〜しよう, 〜してね). Use polite 敬語 for text addressed to parents (setup, privacy, plans, reports, 保護者の方へ).
- Buttons are short verb phrases (はじめる, つづける, もどる, 答え合わせ). Headings are short noun phrases.
- Use the words Japanese schools use: 問題, 章, 単元, 復習, 小テスト / ミニテスト, 書き取り, 宿題, 作文, 正解, 不正解.
- Rephrase English structures naturally: "{0} of {1} right" is "{1}問中{0}問正解"; avoid literal calques like 簡単な確認 for "quick check" (use ミニテスト).
- Use common kanji; avoid rare kanji a primary pupil couldn't read.`,
};
const SCREENS = { home: 'the Today page (daily plan)', books: 'textbooks', practice: 'practice tools', progress: 'progress and readiness', settings: 'settings', learn: 'a guided lesson', homework: 'homework help', dictation: 'dictation (書き取り)', writing: 'writing practice', speaking: 'speaking practice', listening: 'listening practice', stars: 'the star shop (rewards)', plans: 'subscription plans', parent: 'the parent dashboard' };

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req); await require('../spend').gate();
    const body = await readJson(req);
    const lang = body.lang;
    if (!STYLE[lang]) throw httpError(400, 'Unknown language.');
    const strings = (Array.isArray(body.strings) ? body.strings : []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 40).map((s) => s.slice(0, 400));
    if (!strings.length) throw httpError(400, 'Nothing to translate.');
    const usage = newUsage();
    const text = await callText({
      messages: {
        system: `You are a native-speaker UX writer localising PrepBuddy, a study app for children, from English into ${STYLE[lang]}
${SCREENS[body.screen] ? `These strings are on ${SCREENS[body.screen]}.\n` : ''}Rules:
- Write what a native ${lang === 'ja' ? 'Japanese' : 'French'} app would say in that place: translate the meaning and intent, not the words. Keep it about as short as the English. Check that each line is correct and reads naturally before you answer.
- Keep placeholders like {0} and {1} exactly (you may move them where the grammar needs them).
- Keep emoji, symbols (· › → ✓ % #) and line breaks. Keep the names PrepBuddy and Buddy, and HKDSE, DSE, TSA, PSLE.
- Leave Chinese words such as 默書 or 呈分試 as they are. Leave a string unchanged if it is already in the target language, is a name or a code.
- The input is a JSON object of numbered strings. Reply with ONLY a JSON object with the same numbers as keys and each translation as the value, e.g. {"0": "...", "1": "..."}. Translate every one.`,
        list: [{ role: 'user', content: JSON.stringify(Object.fromEntries(strings.map((x, i) => [String(i), x]))) }],
      },
      maxTokens: 6000, usage, step: 'write',
    });
    // Keep whatever came back in good shape: one bad item never throws away the rest of the batch.
    let obj = null;
    try { obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object') throw httpError(502, 'Translation failed.');
    const out = strings.map((x, i) => { const v = obj[String(i)]; return typeof v === 'string' && v.trim() ? v.slice(0, 600) : null; });
    if (!out.some(Boolean)) throw httpError(502, 'Translation failed.');
    res.statusCode = 200;
    res.end(JSON.stringify({ out, usage }));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.status ? e.message : 'Something went wrong.' }));
  }
};
