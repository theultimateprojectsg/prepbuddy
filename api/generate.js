// POST /api/generate
// body: { title, text, items: [{level, type}], avoid: [string] }
// returns: { questions: [...] } in the same order as items (possibly fewer)

const { langNote, LEVELS, GEN_SYSTEM, FIGURE_RULES, callTool, sectionBlock, handler, httpError } = require('../lib/claude');

const TYPES = { mcq: 'MCQ', graph: 'CHOOSE-THE-GRAPH', short: 'SHORT-ANSWER', structured: 'STRUCTURED' };

module.exports = handler(async (body, usage) => {
  const items = Array.isArray(body.items) ? body.items.slice(0, 4) : [];
  if (!items.length) throw httpError(400, 'No questions requested.');
  for (const it of items) {
    if (!LEVELS[it.level] || !TYPES[it.type]) throw httpError(400, 'Bad question request.');
  }
  // Page images for FIGURE questions (base64 JPEG), at most 2 per call.
  const figures = (Array.isArray(body.figures) ? body.figures : []).filter((f) => typeof f === 'string' && f.length < 900000).slice(0, 2);
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(-40).map((s) => String(s).slice(0, 200));

  const wanted = items.map((it, i) =>
    `${i + 1}. A level ${it.level} ${TYPES[it.type]} ${it.figure && figures.length && it.type !== 'graph' ? 'FIGURE ' : ''}question. Level ${it.level} means: ${LEVELS[it.level]}` +
    (it.type === 'structured' ? ' Give a short scenario or data in the stem, then 2-4 parts totalling 4-8 marks.' : '') +
    (it.type === 'short' ? ' One part, 2-3 marks.' : '') +
    (it.type === 'graph' ? ' The student picks which of 4 sketch graphs correctly shows a relationship the section describes ' +
      '(e.g. enzyme activity against temperature, population against time). Give the 4 graphs in "graphs" with identical axes and ' +
      'labels, 5-12 points each, as sketch values that show the shape; make the wrong graphs plausible misconceptions. ' +
      'Options are 4 short captions of each shape; correct_option is the right graph. If the section describes no such ' +
      'relationship, write an ordinary MCQ instead and leave "graphs" empty.' : '')
  ).join('\n');

  const f = body.focus && Number(body.focus.of) > 1 ? body.focus : null;
  const focusText = f
    ? `\n\nSplit the section into ${Number(f.of)} roughly equal parts by position. Take these questions mainly from part ${Number(f.part)}, so that batches made in parallel cover different material.`
    : '';
  const target = typeof body.target === 'string' && body.target.trim() ? body.target.slice(0, 1500) : '';
  const targetText = target
    ? `\n\nThis is a DRILL for a student who just lost marks. Every question must practise this exact idea, from different angles ` +
      `(recall it, explain it, apply it), using only what the section says about it:\n<missed_idea>\n${target}\n</missed_idea>\n` +
      'Do not repeat the original question or simply reword it.'
    : '';
  const instruction =
    `Write exactly these ${items.length} questions, in this order:\n${wanted}` + focusText + targetText +
    (figures.length && items.some((it) => it.figure) ? `\n\n${FIGURE_RULES}` : '') + langNote(body.lang, 'write') +
    (avoid.length ? `\n\nQuestions already written for this section (test different ideas):\n- ${avoid.join('\n- ')}` : '');

  const out = await callTool({
    system: GEN_SYSTEM,
    sectionBlock: sectionBlock(body.title, body.text),
    instruction,
    toolName: 'save_questions',
    usage,
    images: items.some((it) => it.figure) ? figures : [],
  });

  const questions = (out.questions || []).slice(0, items.length).map((q, i) => {
    let type = items[i].type;
    // A graph request the section couldn't support comes back as an ordinary MCQ.
    if (type === 'graph' && !(Array.isArray(q.graphs) && q.graphs.length === 4)) type = 'mcq';
    const choice = type === 'mcq' || type === 'graph';
    return {
      ...q,
      level: items[i].level,
      type,
      options: choice ? q.options : undefined,
      correct_option: choice ? q.correct_option : undefined,
      graphs: type === 'graph' ? q.graphs : undefined,
      parts: choice ? [] : (q.parts || []),
      figure: items[i].figure && type !== 'graph' && q.figure && Number(q.figure.image) >= 1 && Number(q.figure.image) <= figures.length ? q.figure : undefined,
    };
  });
  return { questions };
});
