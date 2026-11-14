// POST /api/generate
// body: { title, text, items: [{level, type}], avoid: [string] }
// returns: { questions: [...] } in the same order as items (possibly fewer)

const { GRADES, band } = require('../lib/learner');
const { levelText, langNote, kindNote, primaryEnRules, KIND_RULES, LEVELS, GEN_SYSTEM, FIGURE_RULES, callTool, sectionBlock, handler, httpError } = require('../lib/claude');

const TYPES = { mcq: 'MCQ', graph: 'CHOOSE-THE-GRAPH', short: 'SHORT-ANSWER', structured: 'STRUCTURED', essay: 'ESSAY (extended writing)' };

module.exports = handler(async (body, usage) => {
  const items = Array.isArray(body.items) ? body.items.slice(0, 4) : [];
  if (!items.length) throw httpError(400, 'No questions requested.');
  for (const it of items) {
    if (!LEVELS[it.level] || !TYPES[it.type]) throw httpError(400, 'Bad question request.');
  }
  // Page images for FIGURE questions (base64 JPEG), at most 2 per call.
  const figures = (Array.isArray(body.figures) ? body.figures : []).filter((f) => typeof f === 'string' && f.length < 900000).slice(0, 2);
  // Picture regions found in each page image (from the PDF itself), to help the AI box the whole figure.
  const regions = (Array.isArray(body.figureRegions) ? body.figureRegions : []).slice(0, figures.length)
    .map((rs) => (Array.isArray(rs) ? rs.filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)).slice(0, 8) : []));
  const regionText = regions.some((rs) => rs.length)
    ? '\n\nDetected picture regions ([left, top, right, bottom] fractions):\n' + regions.map((rs, i) => rs.length ? `Image ${i + 1}: ${rs.map((r, k) => `R${k + 1} [${r.join(', ')}]`).join('; ')}` : '').filter(Boolean).join('\n')
    : '';
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(-40).map((s) => String(s).slice(0, 200));

  // How big written questions are depends on the student's grade (when a parent has set it).
  // The student's grade decides; with no profile (e.g. admin starter questions) the book's level does.
  const lg = body.learner && String(body.learner.grade || '').toUpperCase();
  const bl = String(body.bookLevel || '').toUpperCase().replace(/^PRIMARY\s*/, 'P').replace(/^SECONDARY\s*/, 'S').trim();
  const g = GRADES.includes(lg) ? lg : GRADES.includes(bl) ? bl : '';
  const bd = g ? band(g) : '';
  const primaryEn = body.kind === 'language' && (body.lang || 'en') === 'en' ? primaryEnRules(bd) : '';
  const SIZE = { p12: { structured: '2 short parts totalling 2-3 marks', short: '1 mark' }, p34: { structured: '2-3 short parts totalling 3-5 marks', short: '1-2 marks' },
    p56: { structured: '2-4 parts totalling 4-6 marks', short: '1-3 marks' } }[bd] || { structured: '2-4 parts totalling 4-8 marks', short: '2-3 marks' };
  const wanted = items.map((it, i) =>
    `${i + 1}. A level ${it.level} ${TYPES[it.type]} ${it.figure && figures.length && it.type !== 'graph' ? 'FIGURE ' : ''}question. Level ${it.level} means: ${levelText(it.level, body.learner || (g ? { grade: g } : null)) || LEVELS[it.level]}` +
    (it.type === 'structured' ? ` Give a short scenario or data in the stem, then ${SIZE.structured}.` : '') +
    (it.type === 'short' ? ` One part, ${SIZE.short}.` : '') +
    (it.type === 'essay' ? ' One part holding the writing task (genre, purpose, audience, about 200-400 words), with a rubric.' : '') +
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
    `Write exactly these ${items.length} questions, in this order:\n${wanted}` + (KIND_RULES[body.kind] !== undefined ? kindNote(body.kind) : '') + (primaryEn ? `\n\n${primaryEn}` : '') + focusText + targetText +
    (figures.length && items.some((it) => it.figure) ? `\n\n${FIGURE_RULES}${regionText}` : '') + langNote(body.lang, 'write') +
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
    // An essay the section can't support (not a language book) comes back as a structured question.
    if (type === 'essay' && !(Array.isArray(q.rubric) && q.rubric.length >= 2)) type = 'structured';
    const choice = type === 'mcq' || type === 'graph';
    return {
      ...q,
      level: items[i].level,
      type,
      options: choice ? q.options : undefined,
      correct_option: choice ? q.correct_option : undefined,
      graphs: type === 'graph' ? q.graphs : undefined,
      parts: choice ? [] : type === 'essay' ? [{ ...((q.parts || [])[0] || { label: '', prompt: q.stem || '' }), label: '', marks: q.rubric.reduce((t, r) => t + (Number(r.marks) || 0), 0), mark_scheme: ((q.parts || [])[0] || {}).mark_scheme || [] }] : (q.parts || []),
      rubric: type === 'essay' ? q.rubric : undefined,
      figure: items[i].figure && type !== 'graph' && q.figure && Number(q.figure.image) >= 1 && Number(q.figure.image) <= figures.length ? q.figure : undefined,
    };
  });
  return { questions };
});
