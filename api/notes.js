// POST /api/notes   — revision notes and flashcards for one chapter
// body: { title, text, lang }
// returns: { sections, key_terms, formulas, flashcards }

const { langNote, callTool, sectionBlock, handler } = require('../lib/claude');

const NOTES_RULES = `You are now writing revision notes for a secondary-school student revising this section for exams.
- Cover the examinable ideas in the order the section teaches them. Be accurate and concise; no padding.
- Points are short (one idea each) and use the section's own key terms.
- Flashcards test one fact or idea each; mix definitions, explanations ("why…"), processes and, if any, formulas or calculations.
- Use only what the section says.`;

module.exports = handler(async (body, usage) => {
  const out = await callTool({
    system: NOTES_RULES,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: 'Write the revision notes, key terms, formulas and flashcards for this section.' +
      (body.lang === 'zh-HK' ? '\n\nLANGUAGE: Write everything in Traditional Chinese as used in Hong Kong schools (standard written Chinese, Hong Kong subject terms).' : ''),
    toolName: 'save_notes',
    maxTokens: 8000,
    usage,
    step: 'notes',
  });
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    sections: arr(out.sections).filter((s) => s && s.heading).map((s) => ({ heading: String(s.heading), points: arr(s.points).map(String) })),
    key_terms: arr(out.key_terms).filter((k) => k && k.term).map((k) => ({ term: String(k.term), meaning: String(k.meaning || '') })),
    formulas: arr(out.formulas).filter((f) => f && f.formula).map((f) => ({ formula: String(f.formula), meaning: String(f.meaning || '') })),
    flashcards: arr(out.flashcards).filter((c) => c && c.front && c.back).map((c) => ({ front: String(c.front), back: String(c.back) })),
  };
});
