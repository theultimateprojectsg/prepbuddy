// POST /api/chapters   — tidy up the chapters found in an uploaded book
// body: { title, text: the book outline (contents pages + first lines of every page), pageCount, lang }
// returns: { chapters: [{ title, start, skip }] }

const { callTool, sectionBlock, handler } = require('../lib/claude');

const RULES = `You are now organising a textbook into revision chapters. Below the request is an outline of the book:
its contents pages (if found), the app's first guess at chapters, and the first lines of every PDF page.
- Find the divisions a student would revise by: normally the numbered sections (e.g. "2.1", "第一課") or, if those are very short, the chapters.
  Aim for parts of roughly 4-30 pages each.
- Titles must be the real headings as printed (with their numbers), in the book's own language. Fix any wrong or cut-off guess.
- start_page is the PDF page number (the "pN" in the outline). Printed page numbers often differ from PDF page numbers by a
  constant offset: use the "printed" numbers to convert contents-page numbers into PDF pages, and check against the page's first lines.
- Cover every page in order. Mark cover, contents, preface, index, glossary, answers, references and blank pages as skip.
- If the book has no headings at all, return sensible ranges with short descriptive titles taken from the pages' content.`;

module.exports = handler(async (body, usage) => {
  const n = Math.max(1, Math.min(5000, Number(body.pageCount) || 1));
  const out = await callTool({
    system: RULES,
    sectionBlock: sectionBlock(body.title || 'Book outline', body.text),
    instruction: `The book has ${n} PDF pages. List its chapters.`,
    toolName: 'save_chapters',
    maxTokens: 6000,
    usage,
    step: 'check',
  });
  const chapters = (Array.isArray(out.chapters) ? out.chapters : [])
    .map((c) => ({ title: String(c.title || '').slice(0, 140), start: Math.round(Number(c.start_page)), skip: !!c.skip }))
    .filter((c) => c.start >= 1 && c.start <= n);
  return { chapters };
});
