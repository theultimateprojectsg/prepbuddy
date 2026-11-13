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

// Primary pupils: a short passage to read aloud and simple questions about themselves (like the TSA speaking
// tasks), marked kindly against what is expected for their grade. Same four domains, so the screens stay the same.
const P_SIZE = { p12: ['30-50', '20-30'], p34: ['60-90', '40-60'], p56: ['90-130', '60-90'] };
const pband = (l) => { const g = l && String(l.grade || '').toUpperCase(); const L = require('../learner'); return L.GRADES.includes(g) && g[0] === 'P' ? { g, b: L.band(g) } : null; };
const TASK_P = (p) => `Write one short English speaking practice task for a Hong Kong ${p.g} primary pupil, like the TSA speaking tasks.
- title: a few words.
- text: a short, simple passage for the pupil to read aloud (${P_SIZE[p.b][0]} words) about a topic from a child's everyday life.
- discussion: one line telling the pupil what to do, e.g. "Read the passage aloud, then answer the questions."
- questions: 4 simple questions linked to the topic that a pupil can answer about themselves in about one minute (e.g. "What is your favourite…? Why?", "Tell me about…").
Use words a ${p.g} pupil knows. Original content only.`;
const MARK_P = (p) => `You are a kind, experienced Hong Kong primary school English teacher. Mark this ${p.g} pupil's spoken answer to the question.
Rate each domain on a 1-7 band against what is expected of a pupil of THIS grade (7 = excellent for their grade, 4 = fine with clear things to improve, 1 = very limited):
${CRIT.map(([n, d]) => `- ${n}: ${d}`).join('\n')}
You get a speech-to-text transcript (recognition errors are possible: don't punish odd words) and timing figures. Young pupils speak more slowly: don't expect fast speech.
- strengths: 2-3 specific things they did well, quoting them.
- fixes: at most 3 small, concrete things to try next time.
- phrases: 4 useful, simple phrases for this kind of question (e.g. "My favourite … is … because …").
- sample: one simple model answer (${P_SIZE[p.b][1]} words) a ${p.g} pupil could say.
- next_step: one short, friendly sentence.
Write in very simple English a primary pupil understands.`;

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req); await require('../../lib/spend').gate();
    const body = await readJson(req);
    const usage = require('../learner').attachLearner(newUsage(), body);
    const done = (o) => { res.statusCode = 200; res.end(JSON.stringify({ ...o, usage })); };
    if (body.step === 'listen') {
      // Listening practice (TSA / school listening style): a passage the app reads aloud, then multiple-choice questions.
      const L = require('../learner'); const g = String((body.learner && body.learner.grade) || '').toUpperCase();
      const b = L.GRADES.includes(g) ? L.band(g) : 'p34';
      const zh = body.lang === 'zh';
      const size = { p12: [60, 90, 3], p34: [100, 150, 4], p56: [150, 220, 5], s13: [200, 280, 5], s46: [250, 350, 6] }[b];
      const out = await callTool({ system: `Write one listening practice item for a Hong Kong ${g || 'P3-P4'} pupil, like the ${b[0] === 'p' ? 'TSA and school listening papers' : 'school listening papers'}.
- title: a few words.
- passage: ${size[0]}-${size[1]} ${zh ? 'Chinese characters, in natural spoken Cantonese-friendly written Chinese (書面語), Traditional characters' : 'words of natural spoken English'}. A dialogue between two named people or a short announcement, message or story from a child’s everyday life${body.topic ? ` about: ${String(body.topic).slice(0, 120)}` : ''}. Write it to be read aloud: no lists, no headings${zh ? '' : ', mark a new speaker with their name and a colon'}.
- questions: ${size[2]} multiple-choice questions, each with exactly 4 short options and one correct answer (answer = its index 0-3), answerable only by listening carefully (details, numbers, times, places, reasons, how someone feels). Vary the position of the right answer. why: one short sentence saying where the answer is in the passage.
Use words a ${g || 'P3-P4'} pupil knows. Write everything in ${zh ? 'Traditional Chinese' : 'English'}. Original content only.`,
        sectionBlock: 'Listening task request.', instruction: 'Write the listening item.', toolName: 'save_listening', maxTokens: 3000, usage, step: 'tutor' });
      const qs = (Array.isArray(out.questions) ? out.questions : []).filter((q) => q && q.q && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4)
        .slice(0, 6).map((q) => ({ q: String(q.q), options: q.options.map(String), answer: q.answer, why: String(q.why || '') }));
      if (!out.passage || qs.length < 2) throw httpError(502, 'Could not write a listening task. Please try again.');
      return done({ title: String(out.title || ''), passage: String(out.passage), lang: zh ? 'zh' : 'en', questions: qs });
    }
    if (body.step === 'task') {
      const pp = pband(body.learner);
      const out = await callTool({ system: (pp ? TASK_P(pp) : TASK) + (body.topic ? `\nTopic area: ${String(body.topic).slice(0, 200)}.` : (pp ? '\nPick a fresh topic from a child’s everyday life (family, friends, school, pets, food, festivals, hobbies, places in Hong Kong).' : '\nPick a fresh, varied topic (school life, technology, environment, community, culture, health, careers…).')),
        sectionBlock: 'Speaking task request.', instruction: 'Write the task.', toolName: 'save_speaking_task', maxTokens: 2000, usage, step: 'tutor' });
      const qs = (Array.isArray(out.questions) ? out.questions : []).map(String).filter(Boolean).slice(0, 4);
      if (!out.text || qs.length < 2) throw httpError(502, 'Could not write a task. Please try again.');
      return done({ title: String(out.title || 'Speaking task').slice(0, 80), text: String(out.text).slice(0, 2000), discussion: String(out.discussion || '').slice(0, 1500), questions: qs });
    }
    if (body.step === 'mark') {
      const tr = String(body.transcript || '').trim().slice(0, 4000);
      const pp = pband(body.learner);
      if (tr.split(/\s+/).filter(Boolean).length < (pp ? 4 : 8)) throw httpError(400, 'I couldn’t hear enough to mark. Try again and speak for most of the minute.');
      const t = body.task || {};
      const out = await callTool({ system: pp ? MARK_P(pp) : MARK, sectionBlock: 'Speaking answer to mark.',
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
