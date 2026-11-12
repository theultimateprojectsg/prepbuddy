// POST /api/homework   — help with the student's own homework, from photos.
// step 'read': body { images: [base64 JPEG], lang }  → { title, subject, level, questions: [{ label, text, student_answer }], note }
// step 'chat': body { homework (text of the questions), ask, history: [{role, text}], lang } → { reply }
const { callTool, callText, checkAccess, readJson, newUsage, httpError, APP_GUIDE } = require('../claude');

const READ = `These are photos of a Hong Kong student's school homework or worksheet (primary 1 to secondary 6).
Transcribe every question exactly as printed, in its original language (Chinese or English), in order:
- Keep the numbering and sub-parts (1, 2(a), 甲, ①…), instructions, options (A–D), word banks, tables (as simple lines), and blanks (write ＿＿＿).
- Describe any picture or diagram the question needs in one short line in [brackets].
- If the student has already written an answer in handwriting, put it in student_answer exactly as written (spelling mistakes included); otherwise leave it empty. Don't correct it.
- Use LaTeX between $ signs only for real maths (fractions, powers, roots); plain sums stay as plain text.
- If a part of a page can't be read (blurry, cut off), say so in note.`;

const LIST = `This is a photo of a Hong Kong primary-school dictation list (默書 / spelling list): words, phrases or sentences the child must learn to write.
- List every item to be dictated, in order, exactly as printed (Traditional Chinese characters as printed, or English spelling). Keep punctuation inside sentences.
- Leave out headings, numbering, instructions, dates, page numbers and handwriting that is not part of the list.
- title: a short name, e.g. "中文默書 第五課" or "Spelling Unit 3".
- lang: 'yue' for Chinese read in Cantonese (the usual case in Hong Kong), 'cmn' if it says 普通話 / Putonghua, 'en' for English.`;

const TUTOR = `You are Buddy, a patient private tutor helping a Hong Kong student with their own school homework, shown below. A good tutor helps the student do it themselves:
- Don't give the final answers for them to copy. First make sure they understand what the question asks, teach the idea (with a similar example that uses different numbers or words), and give a hint. Ask them to try.
- When they give an answer, check it: say clearly if it's right. If it's wrong, point to where it goes wrong and give a hint; don't give the correct answer straight away.
- If they're still stuck after two or three hints, go through it step by step, asking them to do each step. For language questions (fill in the blank, grammar, 詞語, 句式), explain the rule and show it in a different sentence.
- Match their age: for young children (P1–P3) use very simple words and short sentences, and be encouraging.
- Keep replies short: 2-5 sentences, or a few short steps. Use **bold** for the key idea. LaTeX between $ signs only for real maths.
- Reply in the language the student writes in (Chinese: Traditional Chinese as used in Hong Kong).
- If the photos were hard to read for a question, ask them to type the question.
- They may also ask how to use PrepBuddy: answer briefly using the app guide.

<app_guide>
${APP_GUIDE}
</app_guide>`;


module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req);
    const body = await readJson(req);
    const usage = newUsage();
    if (body.step === 'read') {
      const images = (Array.isArray(body.images) ? body.images : []).filter((x) => typeof x === 'string' && x.length > 1000).slice(0, 6)
        .map((d, i) => ({ data: d.replace(/^data:image\/\w+;base64,/, ''), label: `Photo ${i + 1}:` }));
      if (!images.length) throw httpError(400, 'No photos sent.');
      const out = await callTool({ system: READ, sectionBlock: 'Homework photos from the student.', instruction: 'Transcribe the homework.', toolName: 'save_homework', maxTokens: 6000, usage, step: 'tutor', images });
      const qs = (Array.isArray(out.questions) ? out.questions : []).filter((q) => q && q.text).slice(0, 60)
        .map((q) => ({ label: String(q.label || '').slice(0, 20), text: String(q.text).slice(0, 2000), student_answer: String(q.student_answer || '').slice(0, 1000) }));
      if (!qs.length) throw httpError(422, body.lang === 'zh' ? '看不清楚相片中的題目，請再拍清楚一點。' : 'I couldn’t read any questions in these photos. Try again with brighter, sharper photos.');
      res.statusCode = 200;
      return res.end(JSON.stringify({ title: String(out.title || '').slice(0, 80), subject: String(out.subject || '').slice(0, 40), level: String(out.level || '').slice(0, 20), questions: qs, note: String(out.note || '').slice(0, 300), usage }));
    }
    if (body.step === 'list') {
      // A 默書 / spelling list from a photo: just the words or sentences to be dictated, in order.
      const images = (Array.isArray(body.images) ? body.images : []).filter((x) => typeof x === 'string' && x.length > 1000).slice(0, 3)
        .map((d) => d.replace(/^data:image\/\w+;base64,/, ''));
      if (!images.length) throw httpError(400, 'No photos sent.');
      const out = await callTool({ system: LIST, sectionBlock: 'A dictation list photo.', instruction: 'Read the dictation list.', toolName: 'save_dictation', maxTokens: 3000, usage, step: 'tutor', images });
      const items = (Array.isArray(out.items) ? out.items : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 60).map((x) => x.slice(0, 200));
      if (!items.length) throw httpError(422, body.lang === 'zh' ? '看不清楚相片中的默書內容，請再拍清楚一點。' : 'I couldn’t find a word list in this photo. Try a clearer photo.');
      res.statusCode = 200;
      return res.end(JSON.stringify({ title: String(out.title || '').slice(0, 60), lang: ['yue', 'cmn', 'en'].includes(out.lang) ? out.lang : 'yue', items, usage }));
    }
    const ask = String(body.ask || '').trim().slice(0, 1500);
    if (!ask) throw httpError(400, 'No question asked.');
    const hw = String(body.homework || '').slice(0, 20000);
    const history = (Array.isArray(body.history) ? body.history : []).slice(-12)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
    while (history.length && history[0].role !== 'user') history.shift();
    const list = [...history, { role: 'user', content: ask }];
    for (let i = 1; i < list.length; i++) if (list[i].role === list[i - 1].role) throw httpError(400, 'Bad conversation.');
    const system = [{ type: 'text', text: `${TUTOR}${body.lang === 'zh' ? '\nReply in Traditional Chinese as used in Hong Kong unless the student writes in English.' : ''}\n\n<homework>\n${hw}\n</homework>` }];
    const reply = await callText({ messages: { system, list }, usage, step: 'tutor', maxTokens: 1200 });
    res.statusCode = 200;
    res.end(JSON.stringify({ reply: reply || 'Sorry, I could not answer that. Please try again.', usage }));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
