// POST /api/learn   — a short guided lesson on one chapter, taught step by step like a tutor would
// body: { title, text, lang, kind }
// returns: { intro, steps: [{ heading, explain, example, check: { question, options, answer, why } }], summary }

const { callTool, callText, streamText, systemBlocks, MODELS, TOOLS, sectionBlock, handler, httpError, APP_GUIDE } = require('../claude');

// Buddy beside the lesson: answers the student's questions about the step they're on.
const CHAT = `You are Buddy, a patient private tutor teaching this textbook section to a Hong Kong student in a guided lesson. The student is on the lesson step shown below and has a question.
- Answer what they ask in plain words for their level. Explain it a different way from the lesson text: a simpler explanation, an everyday analogy, or a new worked example (different numbers or sentences).
- Keep it short: 2-6 sentences, or a few short steps one per line. Use **bold** for the key idea. LaTeX between $ signs only for real maths.
- Use the textbook section as the source of truth.
- If they haven't answered the step's quick check yet, don't tell them which option is right: help them understand the idea and give a hint, then let them try. Once they've answered, you may explain the answer fully.
- End with a short question to check they've got it, or invite them to carry on with the lesson, when that fits.
- They may also ask how to use PrepBuddy or how to study: answer briefly using the app guide, then bring them back to the lesson.

<app_guide>
${APP_GUIDE}
</app_guide>`;
const ZH = 'Reply in Traditional Chinese as used in Hong Kong (standard written Chinese, with Hong Kong subject terms), unless the student writes in English.';

const RULES = `You are now a friendly private tutor teaching this section to a Hong Kong student who is meeting it for the first time.
Write a short guided lesson, the way a good tutor would teach it in 10-15 minutes:
- intro: 1-2 sentences on what they'll learn and why it matters.
- 4-7 steps, in the order the section teaches. Each step teaches ONE idea:
  - heading: a few words.
  - explain: 2-5 short sentences in plain words. Build on the previous steps. Use the section's key terms and **bold** them the first time.
  - example: a worked example or a concrete illustration from the section (for maths and science: work it through step by step, one step per line; for languages: an example sentence or word use). Leave empty only if it truly doesn't fit.
  - check: one quick multiple-choice question that tests whether they UNDERSTOOD this step (not a trick, not trivia), with 3-4 options, the index of the correct option (0-based), and a one-sentence why.
- summary: 3-5 short points to remember.
- Use only what the section says. Keep the level right for the student: simpler words for younger students.
- LaTeX between $ signs only for real maths; plain sums stay as plain text.`;

module.exports = handler(async (body, usage, emit) => {
  if (body.ask !== undefined) {
    const ask = String(body.ask || '').trim().slice(0, 1500);
    if (!ask) throw httpError(400, 'No question asked.');
    const st = body.step && typeof body.step === 'object' ? body.step : null;
    const c = st && st.check;
    const stepText = st ? `<lesson_step>\nHeading: ${String(st.heading || '').slice(0, 200)}\n${String(st.explain || '').slice(0, 3000)}${st.example ? `\nExample: ${String(st.example).slice(0, 2000)}` : ''}${c ? `\nQuick check: ${String(c.question || '').slice(0, 1000)}\nOptions: ${(c.options || []).map((o, i) => `${'ABCD'[i]}. ${String(o).slice(0, 300)}`).join(' | ')}${body.picked !== undefined && body.picked !== null ? `\nThe student chose ${'ABCD'[body.picked] || '?'}; the correct answer is ${'ABCD'[c.answer] || '?'}. ${String(c.why || '').slice(0, 500)}` : '\nThe student has NOT answered the quick check yet (you do not know the answer for this chat).'}` : ''}\n</lesson_step>`
      : `<lesson_step>${body.where === 'end' ? 'The student has finished the lesson.' : 'The lesson has not started yet.'}</lesson_step>`;
    const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
    while (history.length && history[0].role !== 'user') history.shift();
    const context = `${CHAT}${body.lang === 'zh-HK' ? '\n' + ZH : ''}\n\n${stepText}`;
    const list = [];
    const first = history.length ? history[0] : { role: 'user', content: ask };
    list.push({ role: 'user', content: `${context}\n\nStudent: ${first.content}` });
    for (const m of history.slice(1)) list.push(m);
    if (history.length) list.push({ role: 'user', content: `${stepText}\n\nStudent: ${ask}` });
    for (let i = 1; i < list.length; i++) if (list[i].role === list[i - 1].role) throw httpError(400, 'Bad conversation.');
    const system = systemBlocks(sectionBlock(body.title, body.text));
    const reply = emit
      ? (await streamText({ body: { model: MODELS.tutor, max_tokens: 1200, tools: TOOLS, tool_choice: { type: 'none' }, system, messages: list }, usage, onText: emit })).text
      : await callText({ messages: { system, list }, usage, step: 'tutor', maxTokens: 1200 });
    return { reply: reply || 'Sorry, I could not answer that. Please try asking another way.' };
  }
  const out = await callTool({
    system: RULES,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: 'Write the guided lesson for this section.' +
      (body.kind === 'language' ? ' This is a language subject: teach the vocabulary, grammar or writing skill the section is about, with example sentences.' +
        (/(^|\n)Read first:/.test(String(body.text || '')) ? ' TEXT FIRST, the way Hong Kong English textbooks teach: step 1 shows the "Read first" text (in "example"; if it is long, the part that shows the target language best, at most 120 words), asks the student to notice the target language in it (the "As you read, look for" line says what), and its quick check is about spotting that language in the text. Later steps teach the rules, using sentences from that text as examples where possible. Do not make a step out of the "Key words" list or the "Your task" section: the app shows those separately after the lesson.' : '') : '') +
      (body.lang === 'zh-HK' ? '\n\nLANGUAGE: Write everything in Traditional Chinese as used in Hong Kong schools.' : ''),
    toolName: 'save_lesson',
    maxTokens: 6000,
    usage,
    step: 'notes',
  });
  const arr = (x) => (Array.isArray(x) ? x : []);
  const steps = arr(out.steps).filter((s) => s && s.heading && s.explain).slice(0, 8).map((s) => {
    const c = s.check || {};
    const options = arr(c.options).map(String).slice(0, 4);
    const ans = Number.isInteger(c.answer) && c.answer >= 0 && c.answer < options.length ? c.answer : -1;
    return { heading: String(s.heading), explain: String(s.explain), example: String(s.example || ''),
      check: options.length >= 2 && ans >= 0 && c.question ? { question: String(c.question), options, answer: ans, why: String(c.why || '') } : null };
  });
  if (!steps.length) throw Object.assign(new Error('Could not write a lesson for this chapter.'), { status: 502 });
  return { intro: String(out.intro || ''), steps, summary: arr(out.summary).map(String).slice(0, 6) };
});
