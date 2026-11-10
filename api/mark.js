// POST /api/mark
// body: { title, text, question, answers: [string per part] }
// returns: { parts: [{ awarded: [index into mark_scheme], marks, feedback }], tip }

const { langNote, MARK_RULES, callTool, sectionBlock, handler, httpError } = require('../lib/claude');

module.exports = handler(async (body, usage) => {
  const q = body.question;
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => String(a || '').slice(0, 4000)) : [];
  if (!q || !Array.isArray(q.parts) || !q.parts.length) throw httpError(400, 'No written question sent.');

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
    system: MARK_RULES,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction: `<question>\n${q.stem ? q.stem + '\n\n' : ''}${partsText}\n</question>\n\nMark each part. In "awarded", list the numbers of the mark-scheme points earned.${langNote(body.lang, 'mark')}`,
    toolName: 'mark',
    maxTokens: 2000,
    usage,
    step: 'mark',
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
