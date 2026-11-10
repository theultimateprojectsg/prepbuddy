// POST /api/generate
// body: { title, text, items: [{level, type}], avoid: [string] }
// returns: { questions: [...] } in the same order as items (possibly fewer)

const { LEVELS, GEN_SYSTEM, callTool, sectionBlock, handler, httpError } = require('../lib/claude');

const TYPES = { mcq: 'MCQ', short: 'SHORT-ANSWER', structured: 'STRUCTURED' };

module.exports = handler(async (body, usage) => {
  const items = Array.isArray(body.items) ? body.items.slice(0, 4) : [];
  if (!items.length) throw httpError(400, 'No questions requested.');
  for (const it of items) {
    if (!LEVELS[it.level] || !TYPES[it.type]) throw httpError(400, 'Bad question request.');
  }
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(-40).map((s) => String(s).slice(0, 200));

  const wanted = items.map((it, i) =>
    `${i + 1}. A level ${it.level} ${TYPES[it.type]} question. Level ${it.level} means: ${LEVELS[it.level]}` +
    (it.type === 'structured' ? ' Give a short scenario or data in the stem, then 2-4 parts totalling 4-8 marks.' : '') +
    (it.type === 'short' ? ' One part, 2-3 marks.' : '')
  ).join('\n');

  const f = body.focus && Number(body.focus.of) > 1 ? body.focus : null;
  const focusText = f
    ? `\n\nSplit the section into ${Number(f.of)} roughly equal parts by position. Take these questions mainly from part ${Number(f.part)}, so that batches made in parallel cover different material.`
    : '';
  const instruction =
    `Write exactly these ${items.length} questions, in this order:\n${wanted}` + focusText +
    (avoid.length ? `\n\nQuestions already written for this section (test different ideas):\n- ${avoid.join('\n- ')}` : '');

  const out = await callTool({
    system: GEN_SYSTEM,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction,
    toolName: 'save_questions',
    usage,
  });

  const questions = (out.questions || []).slice(0, items.length).map((q, i) => ({
    ...q,
    level: items[i].level,
    type: items[i].type,
    options: items[i].type === 'mcq' ? q.options : undefined,
    correct_option: items[i].type === 'mcq' ? q.correct_option : undefined,
    parts: items[i].type === 'mcq' ? [] : (q.parts || []),
  }));
  return { questions };
});
