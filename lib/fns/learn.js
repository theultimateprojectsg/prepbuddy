// POST /api/learn   — a short guided lesson on one chapter, taught step by step like a tutor would
// body: { title, text, lang, kind }
// returns: { intro, steps: [{ heading, explain, example, check: { question, options, answer, why } }], summary }

const { callTool, sectionBlock, handler } = require('../claude');

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

module.exports = handler(async (body, usage) => {
  const out = await callTool({
    system: RULES,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: 'Write the guided lesson for this section.' +
      (body.kind === 'language' ? ' This is a language subject: teach the vocabulary, grammar or writing skill the section is about, with example sentences.' : '') +
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
