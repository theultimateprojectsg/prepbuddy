// POST /api/bookinfo   — admin: suggest a library book's details from its first pages, so they needn't be typed.
// body: { fileName, pdfTitle, text } → { title, subject, level, kind, publisher, licence, credit, confidence }
const { callTool, checkAccess, readJson, newUsage, httpError } = require('../claude');
const LICENCES = ['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC-SA 4.0', 'Public domain', 'Licensed from the publisher', 'My own material'];
module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req); await require('../../lib/spend').gate();
    const body = await readJson(req);
    const usage = newUsage();
    const text = String(body.text || '').slice(0, 12000);
    if (text.length < 50) throw httpError(400, 'Not enough text to read the book’s details.');
    const out = await callTool({
      system: `These are the first pages of a textbook a Hong Kong tutoring app is adding to its library. Fill in its details from what the pages say (title page, copyright page, cover text, preface).
- title: the book's title as printed (with edition or volume if shown), not the file name unless nothing better.
- subject: the school subject in English as Hong Kong schools name it (e.g. Biology, Mathematics, English Language, 中國語文 for Chinese Language, Economics, History).
- level: one of "Primary", "S1–S3", "S4–S6 (HKDSE)", "IGCSE", "IB", or a short level printed in the book (e.g. "P3", "S2"). Use the book's level, not a guess from difficulty, unless nothing is printed.
- kind: science, maths, language or humanities.
- publisher: as printed, or "".
- licence: one of ${LICENCES.join(' | ')} — only an open licence if the pages actually state it (e.g. a Creative Commons notice); otherwise "Licensed from the publisher".
- credit: one short line to show students, e.g. "OpenStax Biology 2e, CC BY 4.0. Free at openstax.org." — include the licence if it is open.
- confidence: high, medium or low.`,
      sectionBlock: 'Book details request.', instruction: `File name: ${String(body.fileName || '').slice(0, 200)}\nPDF title field: ${String(body.pdfTitle || '').slice(0, 200)}\n\n<first_pages>\n${text}\n</first_pages>\n\nFill in the details.`,
      toolName: 'save_book_info', maxTokens: 800, usage, step: 'check' });
    const s = (x, n = 200) => String(x || '').trim().slice(0, n);
    res.statusCode = 200;
    res.end(JSON.stringify({ title: s(out.title, 160), subject: s(out.subject, 60), level: s(out.level, 40), kind: ['science', 'maths', 'language', 'humanities'].includes(out.kind) ? out.kind : 'science',
      publisher: s(out.publisher, 80), licence: LICENCES.includes(out.licence) ? out.licence : 'Licensed from the publisher', credit: s(out.credit, 240), confidence: s(out.confidence, 10), usage }));
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
