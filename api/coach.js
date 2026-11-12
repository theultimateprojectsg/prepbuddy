// POST /api/coach — the study coach on the Today screen. It sees a snapshot of the student's progress
// (made on their device) and answers questions like "How am I doing?" or "What should I work on this week?".
// body: { snapshot (text), ask, history: [{role, text}], lang, voice: 'en' | 'yue' when it's a spoken chat }   returns: { reply, action (or null): what to open in the app, usage }
const { callTextWithAction, streamText, ndjson, MODELS, voiceNote, checkAccess, readJson, newUsage, httpError, APP_GUIDE } = require('../lib/claude');

const COACH = `You are the study coach inside PrepBuddy, an exam-practice app for Hong Kong secondary students (HKDSE). PrepBuddy turns the student's own textbooks into practice questions.
Below is a snapshot of this student's progress, made just now from their practice history. Use it to answer.
- Be specific: name the books and chapters, and quote their real numbers. Never make up scores or chapters that are not in the snapshot.
- Be warm and honest, like a good tutor. Praise real progress; say plainly what needs work.
- Keep replies short: 2-6 sentences, or a few bullet points ("- "). Use **bold** for the key point. No headings, no tables.
- When you suggest what to do, give concrete steps they can do in PrepBuddy, ideally with a rough time or number of questions:
  practise a chapter (choose it on the book's page), "Get me closer to 100%", a timed chapter test (80% to pass), fix questions in the Mistake book, do the daily reviews, revision notes or flashcards, or a DSE-style mock paper.
- For a weekly plan, give one short line per day (or per study session), based on their weakest chapters, mistakes and reviews due. Keep the whole reply under about 200 words and finish every sentence.
- How mastery works (explain only if asked): it combines being tested, covering the whole chapter, accuracy, harder questions, remembering in reviews, and fixing mistakes. A chapter stays at 70% or below until they pass a timed chapter test, and reaches 100% only after passing tests on two different days.
- If the snapshot shows little or no practice, say so kindly and tell them how to start.
- Whenever you suggest something the student could start right now (a practice set, a test, reviews, the Mistake book…), ALSO call open_in_app with go_now false and 1-3 buttons, so they can start with one tap. The first button is your main suggestion, labelled like "OK, let's go!" or with what it starts ("Start: Cell Structure, 10 questions"); add other steps of the plan as further buttons. Write button labels in the language of your reply, at most about 6 words.
- You can open things in PrepBuddy for the student with the open_in_app tool (go_now true). Use it as soon as the student agrees to a step you suggested ("ok", "sounds good", "let's do it", "yes") or asks you to start or open something. When there are several steps in a plan, open the first one. Use the [codes] from the snapshot. When you use it, your reply is one short, natural line saying what you're opening (e.g. "Great, let's start with Cell Structure: 10 questions."), because the app goes there straight away. Don't use it while you are still asking questions or making the plan.
- You also help with using PrepBuddy itself (see the app guide below), e.g. "I can't find my book", "how do I…". Answer in 1-3 short steps and offer a button to the right screen.
- You only coach on studying and on using PrepBuddy. If they ask about something else, answer in one line at most and bring them back to their studies. You cannot see the questions' content, only the scores.

<app_guide>
${APP_GUIDE}
</app_guide>`;
const STEP = {
  action: { type: 'string', enum: ['practise', 'chapter_test', 'review', 'mistakes', 'weak_topics', 'mock_paper', 'notes', 'flashcards', 'book', 'progress', 'library', 'books', 'settings', 'star_shop', 'today'] },
  chapters: { type: 'array', items: { type: 'string' }, description: 'Chapter codes from the snapshot, e.g. ["B1.C3"].' },
  book: { type: 'string', description: 'Book code, e.g. "B1".' },
  count: { type: 'integer', minimum: 5, maximum: 30 },
};
const OPEN_TOOL = {
  name: 'open_in_app',
  description: 'Either take the student to a screen in PrepBuddy right away (go_now true: the app opens it right after your reply), or show buttons under your reply so they can start a suggested step with one tap (go_now false, with buttons).',
  input_schema: {
    type: 'object',
    properties: {
      go_now: { type: 'boolean', description: 'true: open it now (the student agreed or asked). false: only show buttons under your reply.' },
      buttons: { type: 'array', maxItems: 3, description: 'For go_now false: 1-3 buttons, main suggestion first.',
        items: { type: 'object', properties: { label: { type: 'string', description: 'Short button text, in the language of your reply.' }, ...STEP }, required: ['label', 'action'] } },
      action: { type: 'string', enum: ['practise', 'chapter_test', 'review', 'mistakes', 'weak_topics', 'mock_paper', 'notes', 'flashcards', 'book', 'progress', 'library', 'books', 'settings', 'star_shop', 'today'],
        description: 'practise = practice questions on chapters; chapter_test = timed chapter test; review = the reviews due today; mistakes = the Mistake book; weak_topics = questions they found hard; mock_paper = DSE-style mock paper for a book; notes / flashcards = revision notes or flashcards for chapters; book = the book\'s chapter page; progress = their progress page; library = the textbook library (to add a book); books = their Books tab; settings; star_shop; today = the Today screen.' },
      chapters: { type: 'array', items: { type: 'string' }, description: 'Chapter codes from the snapshot, e.g. ["B1.C3"]. Needed for practise and chapter_test; optional for notes, flashcards and book.' },
      book: { type: 'string', description: 'Book code, e.g. "B1", for mock_paper, weak_topics, notes, flashcards or book when no chapter is given.' },
      count: { type: 'integer', minimum: 5, maximum: 30, description: 'How many practice questions (practise only). Default 10.' },
    },
  },
};
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
    const system = [{ type: 'text', text: `${COACH}${body.lang === 'zh' ? '\n' + ZH : ''}${voiceNote(body.voice)}\n\n<progress_snapshot>\n${snapshot || '(no practice yet)'}\n</progress_snapshot>${body.screen ? `\n\nThe student is on this screen right now: ${String(body.screen).slice(0, 60)}.` : ''}` }];
    const usage = newUsage();
    const fallback = (out) => out.text || (out.action ? (body.lang === 'zh' ? '好，而家幫你打開。' : 'Okay, opening it now.') : '') || 'Sorry, I could not answer that. Please try asking another way.';
    if (body.stream) {
      // Spoken chat: stream the words so the browser can start speaking the first sentence straight away.
      const write = ndjson(res);
      const out = await streamText({ body: { model: body.voice ? MODELS.voice : MODELS.tutor, max_tokens: body.voice ? 500 : 2500, tools: [OPEN_TOOL], tool_choice: { type: 'auto' }, system, messages: list },
        usage, toolName: OPEN_TOOL.name, onText: (t) => write({ d: t }) });
      return res.end(JSON.stringify({ done: true, reply: fallback(out), action: out.action, usage }) + '\n');
    }
    const out = await callTextWithAction({ messages: { system, list }, usage, step: 'tutor', maxTokens: body.voice ? 500 : 2500, tool: OPEN_TOOL });
    res.statusCode = 200; res.end(JSON.stringify({ reply: fallback(out), action: out.action, usage }));
  } catch (e) {
    if (res.headersSent) return res.end(JSON.stringify({ error: e.message || 'Server error' }) + '\n');
    res.statusCode = e.status || 500; res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
};
