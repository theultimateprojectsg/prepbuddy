// POST /api/verify
// body: { title, text, question }
// returns: { passed: boolean, problems: [string] }
// Two independent passes: answer blind (without the key), then judge the key against the section.

const { VERIFY_SYSTEM, callTool, sectionBlock, questionForChecker, formatProblems, handler, httpError } = require('../lib/claude');

module.exports = handler(async (body, usage) => {
  const q = body.question;
  if (!q || typeof q !== 'object') throw httpError(400, 'No question sent.');
  const block = sectionBlock(body.title, body.text);

  const problems = formatProblems(q, body.text);
  if (problems.length) return { passed: false, problems };
  const fig = q.figure && typeof body.figure === 'string' ? [body.figure] : [];
  if (q.figure && !fig.length) return { passed: false, problems: ['figure image missing'] };

  const essay = q.type === 'essay';
  const blind = essay ? { answer: '(writing task: no single answer)', option: '' } : await callTool({
    system: VERIFY_SYSTEM, sectionBlock: block, toolName: 'answer', maxTokens: 2000, usage, step: 'check',
    images: fig,
    instruction: `<question>\n${questionForChecker(q, false)}\n</question>\n\nAnswer this question as a top student would, using only the section${fig.length ? ' and the attached figure' : ''}.`,
  });
  if ((q.type === 'mcq' || q.type === 'graph') && blind.option !== q.correct_option) {
    problems.push(`checker chose ${blind.option || '?'}, key says ${q.correct_option}`);
  }

  const check = await callTool({
    system: VERIFY_SYSTEM, sectionBlock: block, toolName: 'report', maxTokens: 2000, usage, step: 'check',
    instruction: `<question>\n${questionForChecker(q, true)}\n</question>\n\n<independent_answer>\n${blind.answer}\n</independent_answer>\n\n` +
      (essay ? 'This is a writing task. key_correct = the task is clear, fits what the section teaches, and the rubric suits it; unambiguous = the student knows exactly what to write.'
        : 'Judge the answer key. Where the independent answer and the key disagree, decide which the section supports.') +
      (fig.length ? ' The attached image is exactly what the student sees. Mark it ambiguous if the figure is cut off or unreadable, if the question needs something not visible in it, or if the answer is simply printed as a label in the figure.' : ''),
    images: fig,
  });
  if (!check.key_correct) problems.push('answer key disputed');
  if (!check.unambiguous) problems.push('ambiguous');
  if (!check.level_ok) problems.push('level mismatch');
  if (problems.length && check.problems) problems.push('checker notes: ' + check.problems);

  return { passed: problems.length === 0, problems };
});
