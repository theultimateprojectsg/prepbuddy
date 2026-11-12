// POST /api/explain   — the "I don't get it" tutor
// body: { title, text, before: true if the student hasn't answered yet, question, answer: what the student answered, ask: the student's question, history: [{role, text}], lang, figure, voice: 'en' | 'yue' when it's a spoken chat }
// returns: { reply }

const { callText, streamText, MODELS, TOOLS, voiceNote, systemBlocks, sectionBlock, questionForChecker, handler, httpError, APP_GUIDE } = require('../lib/claude');

// You are "Buddy", the one chat the student sees on this screen, so it also helps with things beyond this question.
const OTHER = `
- You are Buddy, the only chat on this screen, so students may ask about other things too: how to use PrepBuddy (see the app guide), how to study, or feeling stuck or stressed. Help briefly (1-3 sentences), then offer to get back to the question. For their scores, progress or a study plan, tell them the study coach on the Today screen can see their results. Never use this to give away the answer to the question.

<app_guide>
${APP_GUIDE}
</app_guide>`;
const TUTOR = `You are now a patient tutor. A secondary-school student is stuck on the practice question below.
- Answer what they ask, in plain words a 15-year-old understands. Build on what they wrote, and say exactly where their thinking went wrong if it did.
- Keep it short: 2-6 sentences, or a few bullet points ("- "). No headings.
- For calculations, show the working step by step, one step per line, with units.
- Use the textbook section as the source of truth. A simple everyday analogy is fine if it helps.
- Do not just repeat the explanation they already saw; explain it a different way.
- Use **bold** for the key idea. Formulas in LaTeX between $ signs.
- If they ask about something unrelated to this subject, gently bring them back to the question.${OTHER}`;
// Before the student has answered: help them understand the question, never give the answer away.
const BEFORE = `You are a patient tutor. A secondary-school student is working on the practice question below and has NOT answered it yet. They want help understanding it.
- Help them understand what the question is asking: rephrase it in plain words, explain words or terms they don't know, and remind them of the idea from the textbook section that it is about.
- Do NOT give the answer. Don't say which option is right or wrong, don't rule options in or out, don't work out the result, and don't write a model answer.
- A hint is fine if they ask: point them to the idea or the step to think about, as a question back to them, without giving the answer away.
- If they ask for the answer, kindly say you'll go through it with them once they've had a go, and give them a nudge on how to start.
- Keep it short: 2-5 sentences. Use **bold** for the key idea. Formulas in LaTeX between $ signs.
- Use the textbook section as the source of truth.${OTHER}`;
const ZH = `Reply in Traditional Chinese as used in Hong Kong (standard written Chinese, with Hong Kong subject terms). The student may write in English, Chinese or Cantonese.`;

module.exports = handler(async (body, usage, emit) => {
  const q = body.question;
  if (!q || typeof q !== 'object') throw httpError(400, 'No question sent.');
  const ask = String(body.ask || '').trim().slice(0, 1500);
  if (!ask) throw httpError(400, 'No question asked.');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
  const fig = q.figure && typeof body.figure === 'string' ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.figure } }] : [];
  // Before answering, the tutor doesn't even see the answer key, so it can't give it away.
  const context = body.before
    ? `${BEFORE}${body.lang === 'zh-HK' ? '\n' + ZH : ''}${voiceNote(body.voice)}\n\n<question>\n${questionForChecker(q, false)}\n</question>`
    : `${TUTOR}${body.lang === 'zh-HK' ? '\n' + ZH : ''}${voiceNote(body.voice)}\n\n<question>\n${questionForChecker(q, true)}\n</question>\n` +
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
  const system = systemBlocks(sectionBlock(body.title, body.text));
  const reply = emit
    ? (await streamText({ body: { model: MODELS.tutor, max_tokens: body.voice ? 500 : 1200, tools: TOOLS, tool_choice: { type: 'none' }, system, messages: list }, usage, onText: emit })).text
    : await callText({ messages: { system, list }, usage, step: 'tutor', maxTokens: body.voice ? 500 : 1200 });
  return { reply: reply || 'Sorry, I could not answer that. Please try asking another way.' };
});
