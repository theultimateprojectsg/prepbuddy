// POST /api/coach — the study coach on the Today screen. It sees a snapshot of the student's progress
// (made on their device) and answers questions like "How am I doing?" or "What should I work on this week?".
// body: { snapshot (text), ask, history: [{role, text}], lang }   returns: { reply, usage }
const { callText, checkAccess, readJson, newUsage, httpError } = require('../lib/claude');

const COACH = `You are the study coach inside PrepBuddy, an exam-practice app for Hong Kong secondary students (HKDSE). PrepBuddy turns the student's own textbooks into practice questions.
Below is a snapshot of this student's progress, made just now from their practice history. Use it to answer.
- Be specific: name the books and chapters, and quote their real numbers. Never make up scores or chapters that are not in the snapshot.
- Be warm and honest, like a good tutor. Praise real progress; say plainly what needs work.
- Keep replies short: 2-6 sentences, or a few bullet points ("- "). Use **bold** for the key point. No headings, no tables.
- When you suggest what to do, give concrete steps they can do in PrepBuddy, ideally with a rough time or number of questions:
  practise a chapter (choose it on the book's page), "Get me closer to 100%", a timed chapter test (80% to pass), fix questions in the Mistake book, do the daily reviews, revision notes or flashcards, or a DSE-style mock paper.
- For a weekly plan, give one short line per day (or per study session), based on their weakest chapters, mistakes and reviews due.
- How mastery works (explain only if asked): it combines being tested, covering the whole chapter, accuracy, harder questions, remembering in reviews, and fixing mistakes. A chapter stays at 70% or below until they pass a timed chapter test, and reaches 100% only after passing tests on two different days.
- If the snapshot shows little or no practice, say so kindly and tell them how to start.
- You only coach on studying. If they ask about something else, answer in one line at most and bring them back to their studies. You cannot see the questions' content, only the scores.`;
const ZH = `Reply in Traditional Chinese as used in Hong Kong (standard written Chinese). The student may write in English, Chinese or Cantonese.`;

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw httpError(405, 'Use POST.');
    checkAccess(req);
    const body = await readJson(req);
    const ask = String(body.ask || '').trim().slice(0, 1500);
    if (!ask) throw httpError(400, 'No question asked.');
    const snapshot = String(body.snapshot || '').slice(0, 14000);
    const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
    while (history.length && history[0].role !== 'user') history.shift();
    const list = [...history, { role: 'user', content: ask }];
    for (let i = 1; i < list.length; i++) if (list[i].role === list[i - 1].role) throw httpError(400, 'Bad conversation.');
    const system = [{ type: 'text', text: `${COACH}${body.lang === 'zh' ? '\n' + ZH : ''}\n\n<progress_snapshot>\n${snapshot || '(no practice yet)'}\n</progress_snapshot>` }];
    const usage = newUsage();
    const reply = await callText({ messages: { system, list }, usage, step: 'tutor', maxTokens: 900 });
    res.statusCode = 200; res.end(JSON.stringify({ reply: reply || 'Sorry, I could not answer that. Please try asking another way.', usage }));
  } catch (e) {
    res.statusCode = e.status || 500; res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
