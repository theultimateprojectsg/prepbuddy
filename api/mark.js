// POST /api/mark
// body: { title, text, question, answers: [string per part], kind, lang, figure }
// returns: { parts: [{ awarded: [index into mark_scheme], marks, feedback }], tip }
//      or, for an essay: { essay: { criteria: [{ criterion, max, score, feedback }], improvements, tip }, total }

const { langNote, MARK_RULES, MARK_KIND, ESSAY_RULES, callTool, sectionBlock, handler, httpError } = require('../lib/claude');

module.exports = handler(async (body, usage) => {
  const q = body.question;
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => String(a || '').slice(0, 8000)) : [];
  if (!q || !Array.isArray(q.parts) || !q.parts.length) throw httpError(400, 'No written question sent.');
  const images = q.figure && typeof body.figure === 'string' ? [body.figure] : [];

  if (q.type === 'essay') {
    const rubric = Array.isArray(q.rubric) ? q.rubric : [];
    const text = (answers[0] || '').trim();
    if (!text) return { essay: { criteria: rubric.map((r) => ({ criterion: r.criterion, max: r.marks, score: 0, feedback: 'No answer written.' })), improvements: [], tip: '' }, total: 0 };
    const out = await callTool({
      system: ESSAY_RULES,
      sectionBlock: sectionBlock(body.title, body.text),
      instruction: `<task>\n${q.stem ? q.stem + '\n' : ''}${q.parts[0].prompt}\n</task>\n<rubric>\n${rubric.map((r, i) => `${i + 1}. ${r.criterion} (max ${r.marks}): ${r.descriptor}`).join('\n')}\n</rubric>\n` +
        `<student_writing words="${text.split(/\s+/).length}">\n${text}\n</student_writing>\n\nMark it.${langNote(body.lang, 'mark')}`,
      toolName: 'mark_essay', maxTokens: 3000, usage, step: 'mark', images,
    });
    const criteria = rubric.map((r, i) => {
      const c = (out.criteria || [])[i] || {};
      return { criterion: r.criterion, max: r.marks, score: Math.max(0, Math.min(r.marks, Math.round(Number(c.score) || 0))), feedback: String(c.feedback || '') };
    });
    return { essay: { criteria, improvements: (out.improvements || []).map(String).slice(0, 4), tip: String(out.tip || '') }, total: criteria.reduce((t, c) => t + c.score, 0) };
  }

  // Parts left blank get 0 without asking the AI.
  const blank = q.parts.map((p, i) => !(answers[i] || '').trim());
  if (blank.every(Boolean)) {
    return { parts: q.parts.map((p) => ({ awarded: [], marks: 0, feedback: 'No answer written.' })), tip: '' };
  }

  const partsText = q.parts.map((p, i) => [
    `PART ${i + 1} ${p.label || ''}: ${p.prompt} (${p.marks} mark${p.marks > 1 ? 's' : ''})`,
    'Mark scheme points:',
    ...(p.mark_scheme || []).map((pt, j) => `  ${j + 1}. ${pt}`),
    `Student's answer: ${blank[i] ? '(left blank)' : answers[i]}`,
  ].join('\n')).join('\n\n');

  const out = await callTool({
    system: MARK_RULES + (MARK_KIND[body.kind] ? '\n' + MARK_KIND[body.kind] : ''),
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: `<question>\n${q.stem ? q.stem + '\n\n' : ''}${partsText}\n</question>\n\nMark each part. In "awarded", list the numbers of the mark-scheme points earned.${langNote(body.lang, 'mark')}`,
    toolName: 'mark',
    maxTokens: 2000,
    usage,
    step: 'mark',
    images,
  });

  const parts = q.parts.map((p, i) => {
    const r = (out.parts || [])[i] || {};
    const n = (p.mark_scheme || []).length;
    let awarded = blank[i] ? [] : [...new Set((r.awarded || []).map((x) => Number(x) - 1).filter((x) => x >= 0 && x < n))];
    awarded = awarded.slice(0, p.marks);
    return { awarded, marks: awarded.length, feedback: blank[i] ? 'No answer written.' : String(r.feedback || '') };
  });
  return { parts, tip: String(out.tip || '') };
});
