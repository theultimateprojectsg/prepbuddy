// POST /api/speaking   — HKDSE English Paper 4 practice: the individual response, marked from a transcript.
// step 'task': { topic } → { title, text, discussion, questions: [string] }
// step 'mark': { task, question, transcript, secs, words, fillers, pause } → feedback (bands are estimates)
const { callTool, checkAccess, readJson, newUsage, httpError } = require('../claude');

const CRIT = [
  ['Pronunciation & Delivery', 'clarity, pace, fluency, stress and intonation. You only have a speech-to-text transcript plus timing figures: judge pace, hesitation, fillers and self-correction from those, say plainly that pronunciation itself can’t be heard, and keep this band moderate unless the figures are clearly strong or weak'],
  ['Communication Strategies', 'answers the examiner’s question directly, engages with it, natural spoken style, signposting, rounding off'],
  ['Vocabulary & Language Patterns', 'range and accuracy of vocabulary, grammar and sentence patterns; idiomatic expressions'],
  ['Ideas & Organisation', 'relevant, well-developed ideas with reasons and examples, clear structure (answer, reasons, example, conclusion) within one minute'],
];
const TASK = `Write one realistic practice task for HKDSE English Language Paper 4 (Speaking), in the style of recent papers.
- title: a few words.
- text: a short original reading passage (120-180 words), e.g. a news report, blog post, letter or survey summary, on an issue Hong Kong secondary students can discuss.
- discussion: the group interaction task: "You are a group of students… Discuss…" with 3-4 bullet points to talk about (use "- " lines).
- questions: 4 individual response questions an examiner would ask one candidate after the discussion, related to the topic but not identical to the bullet points (e.g. "Do you think…?", "Some people say… What do you think?", "Should…?").
Original content only: do not copy a real past paper.`;
const MARK = `You are an experienced HKDSE English Paper 4 examiner and a kind speaking coach. Mark this candidate's one-minute INDIVIDUAL RESPONSE to the examiner's question.
Rate each domain on a 1-7 band (7 = outstanding, 4 = adequate, 1 = very limited):
${CRIT.map(([n, d]) => `- ${n}: ${d}`).join('\n')}
You get a speech-to-text transcript (recognition errors are possible: don't punish odd words that are probably mis-heard) and timing figures.
- strengths: 2-3 specific things they did well, quoting them.
- fixes: the 3 changes that would raise their bands most, each with a short quote from the transcript (or "" if it's about something missing) and how to fix it.
- phrases: 4 useful spoken phrases they could use next time for this kind of question (e.g. for giving an opinion, a reason, an example, concluding).
- sample: one way a strong candidate might answer this question, about 110-130 words (about one minute spoken), natural spoken English, with a clear opinion, two reasons and an example. Different ideas from the candidate's where possible.
- next_step: one sentence on what to practise next.
- If the transcript is very short, off-topic or empty, say so kindly in summary and give low bands.
Write in clear, simple English a secondary student understands.`;

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req);
    const body = await readJson(req);
    const usage = require('../learner').attachLearner(newUsage(), body);
    const done = (o) => { res.statusCode = 200; res.end(JSON.stringify({ ...o, usage })); };
    if (body.step === 'task') {
      const out = await callTool({ system: TASK + (body.topic ? `\nTopic area: ${String(body.topic).slice(0, 200)}.` : '\nPick a fresh, varied topic (school life, technology, environment, community, culture, health, careers…).'),
        sectionBlock: 'Speaking task request.', instruction: 'Write the task.', toolName: 'save_speaking_task', maxTokens: 2000, usage, step: 'tutor' });
      const qs = (Array.isArray(out.questions) ? out.questions : []).map(String).filter(Boolean).slice(0, 4);
      if (!out.text || qs.length < 2) throw httpError(502, 'Could not write a task. Please try again.');
      return done({ title: String(out.title || 'Speaking task').slice(0, 80), text: String(out.text).slice(0, 2000), discussion: String(out.discussion || '').slice(0, 1500), questions: qs });
    }
    if (body.step === 'mark') {
      const tr = String(body.transcript || '').trim().slice(0, 4000);
      if (tr.split(/\s+/).filter(Boolean).length < 8) throw httpError(400, 'I couldn’t hear enough to mark. Try again and speak for most of the minute.');
      const t = body.task || {};
      const out = await callTool({ system: MARK, sectionBlock: 'Speaking answer to mark.',
        instruction: `<topic>${String(t.title || '').slice(0, 100)}\n${String(t.text || '').slice(0, 2000)}</topic>\n<examiner_question>${String(body.question || '').slice(0, 400)}</examiner_question>\n<timing>Spoke for ${Math.round(Number(body.secs) || 0)} seconds of 60; ${Number(body.words) || 0} words (${Math.round((Number(body.words) || 0) / Math.max(1, Number(body.secs) || 60) * 60)} words per minute); fillers (um, er, like…): ${Number(body.fillers) || 0}; longest pause about ${Math.round(Number(body.pause) || 0)} seconds.</timing>\n<transcript>${tr}</transcript>\n\nMark it.`,
        toolName: 'save_speaking_feedback', maxTokens: 3000, usage, step: 'tutor' });
      const arr = (x) => (Array.isArray(x) ? x : []);
      const criteria = CRIT.map(([name]) => { const c = arr(out.criteria).find((x) => x && String(x.name || '').trim().toLowerCase() === name.toLowerCase()) || {}; return { name, band: Math.max(1, Math.min(7, Math.round(Number(c.band) || 1))), why: String(c.why || '') }; });
      return done({ criteria, summary: String(out.summary || ''), strengths: arr(out.strengths).map(String).slice(0, 3),
        fixes: arr(out.fixes).filter((f) => f && f.issue).slice(0, 3).map((f) => ({ issue: String(f.issue), quote: String(f.quote || ''), how: String(f.how || '') })),
        phrases: arr(out.phrases).map(String).slice(0, 5), sample: String(out.sample || ''), next_step: String(out.next_step || '') });
    }
    throw httpError(400, 'Unknown step.');
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
