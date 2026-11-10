// POST /api/explain   — the "I don't get it" tutor
// body: { title, text, question, answer: what the student answered, ask: the student's question, history: [{role, text}], lang, figure }
// returns: { reply }

const { callText, systemBlocks, sectionBlock, questionForChecker, handler, httpError } = require('../lib/claude');

const TUTOR = `You are now a patient tutor. A secondary-school student is stuck on the practice question below.
- Answer what they ask, in plain words a 15-year-old understands. Build on what they wrote, and say exactly where their thinking went wrong if it did.
- Keep it short: 2-6 sentences, or a few bullet points ("- "). No headings.
- For calculations, show the working step by step, one step per line, with units.
- Use the textbook section as the source of truth. A simple everyday analogy is fine if it helps.
- Do not just repeat the explanation they already saw; explain it a different way.
- Use **bold** for the key idea. Formulas in LaTeX between $ signs.
- If they ask about something unrelated to this subject, gently bring them back to the question.`;
const ZH = `Reply in Traditional Chinese as used in Hong Kong (standard written Chinese, with Hong Kong subject terms). The student may write in English, Chinese or Cantonese.`;

module.exports = handler(async (body, usage) => {
  const q = body.question;
  if (!q || typeof q !== 'object') throw httpError(400, 'No question sent.');
  const ask = String(body.ask || '').trim().slice(0, 1500);
  if (!ask) throw httpError(400, 'No question asked.');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
  const fig = q.figure && typeof body.figure === 'string' ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.figure } }] : [];
  const context = `${TUTOR}${body.lang === 'zh-HK' ? '\n' + ZH : ''}\n\n<question>\n${questionForChecker(q, true)}\n</question>\n` +
    `<explanation_shown>${String(q.explanation || '')}</explanation_shown>\n<student_answer>${String(body.answer || '(none)').slice(0, 3000)}</student_answer>`;
  // First turn carries the context; later turns are the conversation so far.
  const list = [];
  const first = history.length ? history[0] : { role: 'user', content: ask };
  if (first.role !== 'user') throw httpError(400, 'Bad conversation.');
  list.push({ role: 'user', content: [...fig, { type: 'text', text: `${context}\n\nStudent: ${first.content}` }] });
  for (const m of history.slice(1)) list.push(m);
  if (history.length) list.push({ role: 'user', content: ask });
  // turns must alternate
  for (let i = 1; i < list.length; i++) if (list[i].role === list[i - 1].role) throw httpError(400, 'Bad conversation.');
  const reply = await callText({ messages: { system: systemBlocks(sectionBlock(body.title, body.text)), list }, usage, step: 'tutor' });
  return { reply: reply || 'Sorry, I could not answer that. Please try asking another way.' };
});
