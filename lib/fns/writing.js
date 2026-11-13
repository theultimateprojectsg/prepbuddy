// POST /api/writing   — composition practice with DSE-style, criteria-based feedback and redrafts.
// step 'prompt': { lang: 'en'|'zh', kind } → { prompt }                       a DSE-style writing task
// step 'read':   { images, what: 'essay'|'task' } → { text }                   transcribe a photo (handwriting kept as written)
// step 'mark':   { lang, kind, prompt, text, prev: { text, fb } } → feedback  (see SCHEMA in lib/claude.js, save_feedback)
const { callTool, checkAccess, readJson, newUsage, httpError } = require('../claude');

// The task types and criteria follow the HKDSE writing papers. Bands are estimates, never official marks.
const KINDS = {
  en_a: { lang: 'en', name: 'HKDSE English Paper 2, Part A (short guided task, about 200 words)', words: 200,
    crit: [['Content', 7, 'task fulfilment: all the required points covered and developed, relevant ideas, right audience, purpose and register'],
      ['Language', 7, 'accuracy and range of grammar, vocabulary and sentence structures; appropriate tone and style'],
      ['Organisation', 7, 'overall structure and paragraphing, cohesion and linking, conventions of the text type (letter, email, article…)']] },
  en_b: { lang: 'en', name: 'HKDSE English Paper 2, Part B (longer task, about 400 words)', words: 400,
    crit: [['Content', 7, 'task fulfilment, relevance, depth and development of ideas, awareness of audience and purpose, creativity where relevant'],
      ['Language', 7, 'accuracy and range of grammar, vocabulary and sentence structures; appropriate and effective tone and style'],
      ['Organisation', 7, 'overall structure, paragraphing, coherence and cohesion, conventions of the text type']] },
  zh_essay: { lang: 'zh', name: 'HKDSE 中國語文 卷二乙部 命題寫作（約 650 字或以上）', words: 650,
    crit: [['內容', 40, '立意、取材、見解：切題、內容充實、思想感情真摯、見解深刻'], ['表達', 30, '用詞準確、句式靈活、修辭運用、文句通順、表達手法'],
      ['結構', 20, '組織、段落安排、詳略、首尾呼應、過渡銜接'], ['標點字體', 10, '標點符號運用、錯別字、字體']] },
  zh_practical: { lang: 'zh', name: 'HKDSE 中國語文 卷二甲部 實用寫作（按題目字數上限）', words: 550,
    crit: [['內容', 30, '能否因應題目要求整理資料，並加以合理的補充、引申或發揮；立場明確、理據充分'], ['行文組織', 20, '格式、語氣是否切合身份及對象；組織及段落安排']] },
};

// Primary writing: the length and expectations follow the child's grade (from the parent's profile).
const P_LEN = { en: { p12: [20, 60], p34: [60, 120], p56: [120, 200] }, zh: { p12: [60, 150], p34: [200, 350], p56: [350, 600] } };
function primaryKind(lang, learner) {
  const g = learner && String(learner.grade || '').toUpperCase();
  const L = require('../learner'); const b = L.GRADES.includes(g) && g[0] === 'P' ? L.band(g) : 'p34';
  const [lo, hi] = P_LEN[lang][b];
  return lang === 'en'
    ? { lang, primary: true, grade: g || 'P3-P4', name: `Hong Kong primary school English writing for a ${g || 'P3-P4'} pupil (about ${lo}-${hi} words)`, words: hi, min: Math.max(12, Math.round(lo * 0.6)),
      crit: [['Content', 7, 'answers the task, covers the guiding points, ideas that make sense for their age'], ['Language', 7, 'spelling, grammar and vocabulary taught at this grade; full sentences'], ['Organisation', 7, 'a clear beginning, middle and end; sentences in a sensible order; simple linking words']] }
    : { lang, primary: true, grade: g || 'P3-P4', name: `香港小學中文寫作（${g || '小三至小四'}，約 ${lo}-${hi} 字）`, words: hi, min: Math.max(30, Math.round(lo * 0.6)),
      crit: [['內容', 40, '切合題目、內容具體、有真實感受'], ['表達', 30, '用詞恰當、句子通順完整、運用所學的詞語及句式'], ['結構', 20, '分段清楚、有開首和結尾、內容次序合理'], ['標點字體', 10, '標點符號運用、錯別字']] };
}
const MARK = (k) => k.primary ? `You are a kind, experienced Hong Kong primary school teacher marking a ${k.grade} pupil's writing: ${k.name}.
Criteria (each on a 1-7 band, judged against what is expected of a pupil of THIS grade, not secondary school; 7 = excellent for their grade, 4 = fine with clear things to improve, 1 = very limited):
${k.crit.map(([n, max, d]) => `- ${n} (weighted ${max}): ${d}`).join('\n')}
Rules:
- Encourage first. Be specific and simple: quote the pupil's own words.
- strengths: 2-3 real strengths. fixes: at most 3 small, concrete changes (with a short quote and how to fix it). Never rewrite their work for them.
- corrections: up to 10 spelling, grammar, wrong-character (錯別字) or punctuation mistakes, each with the exact quote, the correction and a few simple words on why.
- next_step: one short, friendly sentence on what to practise next.
- If a previous draft and its feedback are given, also fill improved and still_to_do.
- If it is far too short or not a real attempt, say so kindly in summary.
- Write the feedback in ${k.lang === 'zh' ? 'simple Traditional Chinese a Hong Kong primary pupil understands' : 'very simple English a primary pupil understands (short sentences)'}.` : `You are an experienced HKDSE examiner and a caring writing tutor. Mark this student's writing for: ${k.name}.
Criteria (each rated on a 1-7 band; 7 = outstanding, 4 = adequate with clear weaknesses, 1 = very limited):
${k.crit.map(([n, max, d]) => `- ${n} (weighted ${max}): ${d}`).join('\n')}
Rules:
- Judge against the task. Be honest and specific: quote the student's own words. Don't inflate bands to be kind; do encourage.
- strengths: 2-3 real strengths. fixes: the 3 changes that would raise the bands most, each with a short quote from the essay and how to fix it (show HOW, but don't rewrite whole paragraphs for them).
- corrections: up to 15 language errors (grammar, wrong words, 錯別字, punctuation), each with the exact quote, the correction and a few words on why. Keep each quote short and exactly as written.
- next_step: one sentence on what to practise next.
- If a previous draft and its feedback are given, also fill improved: what got better in this redraft (be specific), and still_to_do: what still needs work.
- If the writing is far too short, off-topic or not a real attempt, say so kindly in summary and give low bands.
- Write the feedback in ${k.lang === 'zh' ? 'Traditional Chinese as used in Hong Kong schools' : 'clear, simple English a secondary student understands'}.`;

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req);
    const body = await readJson(req);
    const usage = require('../learner').attachLearner(newUsage(), body);
    const k = body.kind === 'en_p' ? primaryKind('en', body.learner) : body.kind === 'zh_p' ? primaryKind('zh', body.learner) : KINDS[body.kind];
    const done = (o) => { res.statusCode = 200; res.end(JSON.stringify({ ...o, usage })); };
    if (body.step === 'read') {
      const images = (Array.isArray(body.images) ? body.images : []).filter((x) => typeof x === 'string' && x.length > 1000).slice(0, 5)
        .map((d, i) => ({ data: d.replace(/^data:image\/\w+;base64,/, ''), label: `Page ${i + 1}:` }));
      if (!images.length) throw httpError(400, 'No photos sent.');
      const out = await callTool({ system: body.what === 'task'
        ? 'Transcribe the writing task (question) in this photo exactly as printed, including any reading materials, word limits and instructions. Keep the original language.'
        : 'Transcribe this student\'s handwritten writing exactly as written, page by page, in order. Keep every spelling mistake, wrong character (錯別字), grammar error and punctuation as the student wrote it: it is going to be marked, so do not correct anything. Keep paragraph breaks. Mark words you cannot read as [?].',
        sectionBlock: 'Photos from the student.', instruction: 'Transcribe it.', toolName: 'save_text', maxTokens: 6000, usage, step: 'tutor', images });
      const text = String(out.text || '').trim();
      if (!text) throw httpError(422, 'I couldn’t read the writing in these photos. Try clearer, brighter photos.');
      return done({ text: text.slice(0, 12000) });
    }
    if (!k) throw httpError(400, 'Unknown writing type.');
    if (body.step === 'prompt') {
      if (k.primary) {
        const out = await callTool({ system: `Write one writing task for ${k.name}, like a Hong Kong primary school composition (e.g. a guided composition: a title, a short situation, and 3-4 simple guiding questions to answer, one per line starting with "- "). ${body.topic ? `Topic: ${String(body.topic).slice(0, 200)}.` : 'Pick a topic from a child’s everyday life (family, school, a festival, a trip, a pet, a hobby).'} Use words a ${k.grade} pupil knows. Write it in ${k.lang === 'zh' ? 'Traditional Chinese' : 'English'}. Original task only.`,
          sectionBlock: 'Writing task request.', instruction: 'Write the task.', toolName: 'save_text', maxTokens: 1200, usage, step: 'tutor' });
        return done({ prompt: String(out.text || '').trim() });
      }
      const out = await callTool({ system: `Write one realistic practice writing task for ${k.name}, in the style of recent HKDSE papers (situation, role, audience, purpose, text type, and the points to cover${k.lang === 'zh' && body.kind === 'zh_practical' ? '; include short reading materials (資料一、資料二) to use, and a word limit' : ''}). ${body.topic ? `Topic area: ${String(body.topic).slice(0, 200)}.` : 'Pick a topic relevant to Hong Kong teenagers.'} Write it in ${k.lang === 'zh' ? 'Traditional Chinese' : 'English'}. Original task only; do not copy a real past paper.`,
        sectionBlock: 'Writing task request.', instruction: 'Write the task.', toolName: 'save_text', maxTokens: 2000, usage, step: 'tutor' });
      return done({ prompt: String(out.text || '').trim() });
    }
    if (body.step === 'mark') {
      const text = String(body.text || '').trim().slice(0, 12000);
      const n = k.lang === 'zh' ? text.replace(/\s/g, '').length : (text.match(/[A-Za-z’'-]+/g) || []).length;
      if (n < (k.min || 30)) throw httpError(400, k.lang === 'zh' ? '文章太短，未能批改。' : 'This is too short to mark. Write a bit more first.');
      const prev = body.prev && body.prev.text ? `\n\n<previous_draft>\n${String(body.prev.text).slice(0, 12000)}\n</previous_draft>\n<previous_feedback>\n${JSON.stringify(body.prev.fb || {}).slice(0, 4000)}\n</previous_feedback>` : '';
      const out = await callTool({ system: MARK(k), sectionBlock: 'Student writing to mark.',
        instruction: `<task>\n${String(body.prompt || '(no task given: judge it as a general piece of this type)').slice(0, 6000)}\n</task>\n\n<student_writing length="${n} ${k.lang === 'zh' ? 'characters' : 'words'}">\n${text}\n</student_writing>${prev}\n\nMark it.`,
        toolName: 'save_feedback', maxTokens: 5000, usage, step: 'tutor' });
      const arr = (x) => (Array.isArray(x) ? x : []);
      const bands = k.crit.map(([name, max]) => {
        const c = arr(out.criteria).find((x) => x && String(x.name || '').trim() === name) || {};
        const band = Math.max(1, Math.min(7, Math.round(Number(c.band) || 1)));
        return { name, max, band, why: String(c.why || '') };
      });
      return done({ criteria: bands, summary: String(out.summary || ''), strengths: arr(out.strengths).map(String).slice(0, 3),
        fixes: arr(out.fixes).filter((f) => f && f.issue).slice(0, 3).map((f) => ({ issue: String(f.issue), quote: String(f.quote || ''), how: String(f.how || '') })),
        corrections: arr(out.corrections).filter((c) => c && c.quote && c.fix).slice(0, 15).map((c) => ({ quote: String(c.quote), fix: String(c.fix), why: String(c.why || '') })),
        next_step: String(out.next_step || ''), improved: arr(out.improved).map(String).slice(0, 4), still_to_do: arr(out.still_to_do).map(String).slice(0, 3), count: n });
    }
    throw httpError(400, 'Unknown step.');
  } catch (e) {
    res.statusCode = e.status || 500;
    res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
