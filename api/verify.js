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

  const blind = await callTool({
    system: VERIFY_SYSTEM, sectionBlock: block, toolName: 'answer', maxTokens: 2000, usage, step: 'check',
    instruction: `<question>\n${questionForChecker(q, false)}\n</question>\n\nAnswer this question as a top student would, using only the section.`,
  });
  if (q.type === 'mcq' && blind.option !== q.correct_option) {
    problems.push(`checker chose ${blind.option || '?'}, key says ${q.correct_option}`);
  }

  const check = await callTool({
    system: VERIFY_SYSTEM, sectionBlock: block, toolName: 'report', maxTokens: 2000, usage, step: 'check',
    instruction: `<question>\n${questionForChecker(q, true)}\n</question>\n\n<independent_answer>\n${blind.answer}\n</independent_answer>\n\n` +
      'Judge the answer key. Where the independent answer and the key disagree, decide which the section supports.',
  });
  if (!check.key_correct) problems.push('answer key disputed');
  if (!check.unambiguous) problems.push('ambiguous');
  if (!check.level_ok) problems.push('level mismatch');
  if (problems.length && check.problems) problems.push('checker notes: ' + check.problems);

  return { passed: problems.length === 0, problems };
});
