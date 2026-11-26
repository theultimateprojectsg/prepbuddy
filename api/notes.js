// POST /api/notes   — revision notes and flashcards for one chapter
// body: { title, text, lang }
// returns: { sections, key_terms, formulas, flashcards }

const { langNote, callTool, sectionBlock, handler } = require('../lib/claude');

const NOTES_RULES = `You are now writing revision notes for a secondary-school student revising this section for exams.
- Cover the examinable ideas in the order the section teaches them. Be accurate and concise; no padding.
- Points are short (one idea each) and use the section's own key terms.
- Flashcards test one fact or idea each; mix definitions, explanations ("why…"), processes and, if any, formulas or calculations.
- Use only what the section says.`;

// how notes are written in Japanese and French classrooms (was shared with the old lessons)
const TEACH = {
  ja: `JAPANESE CLASSROOM STYLE: write the way a Japanese teacher or a good 参考書 writes for this grade, not translated English.
- Headings are short and concrete (例: 「食べ物を表す単語」「Shall we ~? の使い方」), never vague ones like 「単語の見方」.
- Vocabulary is shown like a Japanese 単語帳: 英単語【品詞】意味, e.g. weekend【名詞】週末. Example sentences come with a 和訳 in （）.
- Grammar: the pattern first (例: Shall we ＋ 動詞の原形 ～?), then what it means and when to use it, then 例文（和訳）.
- Write natural, warm です・ます Japanese with kanji the grade knows; add furigana in （）only for harder kanji.`,
  fr: `FRENCH CLASSROOM STYLE: write the way a French teacher or a good manuel writes for this grade, not translated English.
- Short, concrete headings. Vocabulary as: mot (nature) : sens, then an example sentence with its translation.
- Grammar: the rule first, then when to use it, then examples. Natural French with "tu".`,
};
module.exports = handler(async (body, usage) => {
  const out = await callTool({
    system: NOTES_RULES,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: 'Write the revision notes, key terms, formulas and flashcards for this section.' +
      (body.kind === 'maths' ? ' Focus on methods, formulas and worked-example steps; flashcards can ask for a formula or the next step of a method.' : '') +
      (body.kind === 'language' ? ' Focus on the vocabulary, grammar points, text-type features and writing skills taught; key_terms are words/phrases with meanings and an example sentence.' : '') +
      langNote(body.lang, 'write') + (TEACH[body.lang] ? '\n\n' + TEACH[body.lang] : ''),
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
