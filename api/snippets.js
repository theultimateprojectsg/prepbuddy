// POST /api/snippets   — a few short "quick look" cards (key terms, key ideas, exam tips) for one chapter,
// shown while its questions are being written. Uses the fast model; the chapter is usually already cached.
// body: { title, text, lang }
// returns: { snippets: [{ kind, title, text }] }

const { callTool, sectionBlock, handler } = require('../lib/claude');

const RULES = `A secondary-school student is waiting a few seconds for practice questions on this section. Write 6 short cards they can read in that time:
- 2 key terms (title = the term, text = what it means), 2 key ideas worth remembering, and 2 exam tips or common mistakes.
- Use only what the section says. Each card is one or two plain sentences, at most 35 words. No questions, no answers to give away.
- Pick the ideas most likely to be examined. Skip anything trivial (page numbers, headings, who wrote the book).`;

module.exports = handler(async (body, usage) => {
  const out = await callTool({
    system: RULES,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: 'Write the quick-look cards for this section.' +
      (body.lang === 'zh-HK' ? '\n\nLANGUAGE: Write the cards in Traditional Chinese as used in Hong Kong schools.' : ''),
    toolName: 'save_snippets',
    maxTokens: 1500,
    usage,
    step: 'check',
  });
  const kinds = new Set(['term', 'fact', 'tip']);
  const snippets = (Array.isArray(out.snippets) ? out.snippets : [])
    .filter((x) => x && x.title && x.text)
    .map((x) => ({ kind: kinds.has(x.kind) ? x.kind : 'fact', title: String(x.title).slice(0, 80), text: String(x.text).slice(0, 300) }));
  return { snippets };
});
