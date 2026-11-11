// Shared helpers for the server functions: Claude API calls, prompts and checks.
// The API key lives only in Vercel's environment variables (ANTHROPIC_API_KEY).

// Model per step. Change in Vercel → Settings → Environment Variables, then redeploy.
const MODELS = {
  write: process.env.PREPBUDDY_MODEL_WRITE || process.env.PREPBUDDY_MODEL || 'claude-sonnet-5-5',
  check: process.env.PREPBUDDY_MODEL_CHECK || 'claude-haiku-5-5',
  mark: process.env.PREPBUDDY_MODEL_MARK || process.env.PREPBUDDY_MODEL || 'claude-sonnet-5-5',
};
// The tutor and revision notes use the writing model by default: its copy of the chapter is usually already cached.
MODELS.tutor = process.env.PREPBUDDY_MODEL_TUTOR || MODELS.write;
MODELS.notes = process.env.PREPBUDDY_MODEL_NOTES || MODELS.write;
// Spoken chats with the study coach use the fast model, so replies start quickly.
MODELS.voice = process.env.PREPBUDDY_MODEL_VOICE || MODELS.check;
// USD per million tokens (platform.claude.com/docs/en/about-claude/pricing, Nov 2026).
const PRICES = {
  'claude-sonnet-5-5': { input: 2, cache_write: 2.5, cache_read: 0.10, output: 10 },
  'claude-haiku-5-5': { input: 0.10, cache_write: 0.125, cache_read: 0.01, output: 0.50 },
  'claude-opus-5-5': { input: 4, cache_write: 5, cache_read: 0.20, output: 20 },
};
const MAX_TEXT = 80000; // characters of textbook text accepted per request

const LEVELS = {
  1: 'Recall: state facts, name structures or terms.',
  2: "Understand: explain a process or idea in the student's own words.",
  3: 'Apply: use the knowledge on data, a table, a familiar experiment or a new example.',
  4: 'Analyse/evaluate: give an UNFAMILIAR scenario, experiment or data set and ask the student to evaluate a ' +
     'conclusion, spot flaws, design or improve an investigation, or predict and justify. A recall question or a ' +
     'routine calculation is NOT level 4, even if it is long.',
};

// One system prompt for every call, so the chapter text (also in the system prompt) is cached once
// and re-read cheaply by the writing, answering and judging calls alike.
const SYSTEM = `You help secondary-school students prepare for exams (default style: Hong Kong HKDSE).
Write in the language each request asks for (English unless told otherwise).
Each request says your job: write practice questions, check or mark one as a strict examiner, tutor a student, or write revision notes.
Use ONLY the textbook section below as the source of truth.
FORMULAS: write every formula, equation, number with a power, unit with a power and chemical formula in LaTeX between single
dollar signs, e.g. $v = u + at$, $E_k = \\frac{1}{2}mv^2$, $3.0 \\times 10^{8}\\ \\text{m s}^{-1}$, $\\ce{H2SO4}$, $\\ce{CH4 + 2O2 -> CO2 + 2H2O}$.
Ordinary words never go inside dollar signs, and a dollar sign is never used for anything else (write money as "HKD 50").`;

const GEN_SYSTEM = `Rules for writing questions:
- Base every question ONLY on the textbook section provided. Do not test facts that are not in it.
- Use exam style: clear command words (state, name, explain, describe, suggest, compare, evaluate),
  marks shown per part, MCQs with exactly 4 options and one unambiguously correct answer.
- MCQ distractors must be plausible misconceptions, not obviously wrong. Vary which letter is correct.
- Mark schemes list separate creditable points, one mark each; the number of points must be at least the marks for that part.
- Write questions in your own words. Never copy the textbook's own end-of-chapter questions.
- source_quote must be copied exactly from the section (plain text as printed, no LaTeX) and be at most 25 words.
- Keep it at secondary-school depth even if the textbook goes deeper.
- A structured question's stem is ONE coherent scenario, and every part relates to it.
- Each question must test a different idea from the questions already written (listed if any).
- Every question must be SELF-CONTAINED. Never refer to a numbered figure, table, page, example, activity or exercise of the textbook
  ("Figure 7.2", "Table 3", "p. 45", "圖 7.2", "表 3"), or to "the passage/table/graph above" unless it is given in this question.
  If the student needs data, a table or an extract, put it in the stem (tables as pipe rows).
- If the section has no teachable content (e.g. a contents page, index or acknowledgements), return an empty list.
- Calculation questions: give the data needed with units; the mark scheme credits the method, the working and the answer with unit.
- FULLY SPECIFIED: state every condition the answer depends on. Never rely on a "usual" or default case the student has to guess.
  If the topic has variants, name the one that applies. For example: a product on a single stock or a basket, and for a basket
  whether it is worst-of, best-of or average; physical or cash settlement; with or without daily accrual, knock-out or knock-in;
  which price or date is used; simple or compound interest; which unit or convention. If the section uses a term in more than
  one way, say which meaning you mean. A student who knows the topic well must not be able to read it another way and get a
  different answer.
- LAYOUT of a long stem (more than about two sentences): make it easy to read. Use blank lines (\n\n) between parts:
  the situation in one or two short sentences; then the given facts and figures as a list, one per line starting with "- ";
  then the actual question alone in the last paragraph. Keep short stems as one sentence. Never put the question in the middle.`;

const FIGURE_RULES = `FIGURE QUESTIONS: textbook pages are attached as images, numbered in order (image 1, image 2).
For each question marked FIGURE, pick one diagram, graph, photo or table from these pages and write a question the student
can only answer by looking at it (interpret it, explain what it shows, apply it, read a value, compare parts, predict).
- Set "figure": {"image": the image number, "box": [left, top, right, bottom]} as fractions 0-1 of that page image's width and height.
  The box must contain the WHOLE figure with all its labels, axes, keys and parts (a), (b)…, with a generous margin, but not the caption text below it.
  If the request lists detected picture regions for that image and the figure is one of them, also set "region" to its number.
- Choose a figure that makes sense on its own. Do not use a figure that only makes sense with another figure, or a figure whose labels are too small to read.
- Never ask something whose answer is printed as a label in the figure (e.g. "name part X" when the figure labels it).
- Refer to the figure as "the figure" / "the diagram" (or 「圖中」 in Chinese), never by its textbook figure number or page.
- Base the answer on the figure and the section text together. If no figure on the pages is suitable, write an ordinary question without "figure".`;

const VERIFY_SYSTEM = `You are now a strict exam examiner checking a practice question before students see it.`;

// Extra rules by subject type (the student's book is set to one of these).
const KIND_RULES = {
  science: '',
  maths: `SUBJECT: MATHEMATICS.
- Most questions are calculations or "show that"/prove questions using the methods the section teaches. Choose numbers so answers are clean.
- MCQ distractors are the answers produced by common mistakes (sign errors, wrong formula, forgetting a step).
- Written questions say "Show your working." Mark-scheme points are labelled like HKDSE: "M1: <method step>", "A1: <correct value, dependent on the method>", "B1: <independent fact>". Give the final answer with units where relevant.
- Explanations show the full working step by step, one step per line.`,
  language: `SUBJECT: LANGUAGE (the book teaches a language, e.g. English or Chinese).
- Test language skills, not world facts: reading comprehension of passages in the section (quote the extract you ask about in the stem, at most 150 words), vocabulary in context, grammar and usage taught in the section, and the text types/writing skills it teaches.
- For comprehension, the answer must be found in or inferred from the quoted extract.
- An ESSAY question is a writing task in a genre the section teaches (with purpose, audience and word count). Leave "parts" with one part holding the task, and give "rubric": HKDSE-style criteria — Content, Language, Organisation, each 7 marks — each with a short descriptor of what a top answer does for THIS task. Its mark_scheme lists 3-6 ideas a good answer might include.`,
  humanities: `SUBJECT: HUMANITIES (e.g. history, geography, economics, citizenship).
- Where the section gives data, maps, sources or case studies, write data-/source-based questions that quote or describe them in the stem.
- Include "explain", "compare" and "to what extent / evaluate" questions. For evaluation parts, mark-scheme points credit arguments on both sides and a justified conclusion.`,
};
const kindNote = (kind) => (KIND_RULES[kind] ? `\n\n${KIND_RULES[kind]}` : '');
const MARK_KIND = {
  maths: `- MATHS MARKING: "M" points are method marks — award them for a correct method even if there is an arithmetic slip. "A" points are accuracy marks — award them only if the related method mark is earned. "B" points are independent. Use follow-through: if the student uses their own wrong earlier value correctly, award the later method marks (not the accuracy mark for the wrong value). Accept equivalent forms and sensible rounding.`,
  language: `- LANGUAGE MARKING: judge the meaning against the extract; quoting the right part of the text earns the point unless the question says "in your own words". For vocabulary or grammar, the form must be correct.`,
};
const ESSAY_RULES = `You are now marking a student's piece of writing like a fair, experienced HKDSE examiner, using the rubric given.
- Score each criterion from 0 to its maximum, judging against the descriptor and the task (purpose, audience, length).
- Feedback per criterion: 1-2 sentences, specific to this text, naming one thing done well and the most important thing to improve.
- "improvements": 2-4 concrete rewrites or additions, each quoting a short phrase from the student's text and showing a better version.
- Short or off-task answers score low on all criteria.`;

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['mcq', 'graph', 'short', 'structured', 'essay'] },
          level: { type: 'integer', minimum: 1, maximum: 4 },
          stem: { type: 'string', description: 'The question (MCQ) or the context/data given before the parts. Tables as pipe rows.' },
          options: { type: 'array', items: { type: 'string' }, description: 'MCQ only: exactly 4 options, without A-D labels. For a graph question: 4 short captions describing each graph\'s shape.' },
          graphs: {
            type: 'array',
            description: 'Graph questions only: exactly 4 sketch graphs (options A-D), all with the same axes.',
            items: {
              type: 'object',
              properties: {
                x_label: { type: 'string', description: 'x-axis label with unit, e.g. "Temperature (°C)"' },
                y_label: { type: 'string', description: 'y-axis label with unit, e.g. "Rate of reaction"' },
                points: { type: 'array', description: '5-12 [x, y] points in increasing x, sketch values that show the shape', items: { type: 'array', items: { type: 'number' } } },
              },
              required: ['x_label', 'y_label', 'points'],
            },
          },
          correct_option: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: 'MCQ only.' },
          parts: {
            type: 'array',
            description: 'Non-MCQ: one or more parts. A short question has one part with an empty label.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: "e.g. '(a)', '(b)', or ''" },
                prompt: { type: 'string' },
                marks: { type: 'integer', minimum: 1 },
                mark_scheme: { type: 'array', items: { type: 'string' }, description: 'One creditable point per entry, each worth 1 mark.' },
              },
              required: ['label', 'prompt', 'marks', 'mark_scheme'],
            },
          },
          figure: {
            type: 'object',
            description: 'FIGURE questions only: which attached page image, and where the figure is on it.',
            properties: {
              image: { type: 'integer', minimum: 1, description: 'Number of the attached page image.' },
              box: { type: 'array', items: { type: 'number' }, description: '[left, top, right, bottom] as fractions 0-1 of the page image.' },
              region: { type: 'integer', description: 'Number of the detected picture region the figure is in, if listed.' },
            },
            required: ['image', 'box'],
          },
          rubric: {
            type: 'array', description: 'ESSAY questions only: the marking criteria.',
            items: { type: 'object', properties: { criterion: { type: 'string' }, marks: { type: 'integer', minimum: 1 }, descriptor: { type: 'string' } }, required: ['criterion', 'marks', 'descriptor'] },
          },
          explanation: { type: 'string', description: 'Why the answer is correct, for the student. 1-3 sentences.' },
          source_quote: { type: 'string', description: 'A short phrase (max 25 words) copied exactly from the section that supports the answer.' },
        },
        required: ['type', 'level', 'stem', 'explanation', 'source_quote'],
      },
    },
  },
  required: ['questions'],
};

const BLIND_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'Your full answer to the question.' },
    option: { type: 'string', enum: ['A', 'B', 'C', 'D', ''], description: 'MCQ only: the option you choose. Empty for other types.' },
    assumptions: { type: 'string', description: 'Anything you had to assume because the question did not say it (e.g. which variant of a product, which price, which convention). Empty if the question told you everything you needed.' },
  },
  required: ['answer', 'option', 'assumptions'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    key_correct: { type: 'boolean', description: 'Is the answer key correct and supported by the section?' },
    unambiguous: { type: 'boolean', description: 'Exactly one defensible answer (MCQ) / clear what is being asked?' },
    level_ok: { type: 'boolean', description: 'Does the question actually demand the stated thinking level?' },
    fully_specified: { type: 'boolean', description: 'Is every condition the answer depends on stated in the question? false if the answer relies on an unstated assumption or a default variant (e.g. a basket product without saying worst-of / best-of / average, the settlement method, which price or date is used, a convention) so that a knowledgeable student could reasonably reach a different answer.' },
    self_contained: { type: 'boolean', description: 'Does the student have everything needed? false if it mentions a figure, table, page, passage, example or data that is not given in the question itself (or the attached image).' },
    figure_complete: { type: 'boolean', description: 'If a figure image is attached: is the whole figure visible and readable, with nothing the question needs cut off at the edges? true if no figure.' },
    problems: { type: 'string', description: 'What is wrong. Leave empty if nothing is wrong.' },
  },
  required: ['key_correct', 'unambiguous', 'level_ok', 'fully_specified', 'self_contained', 'figure_complete', 'problems'],
};

const MARK_SCHEMA = {
  type: 'object',
  properties: {
    parts: {
      type: 'array',
      description: 'One entry per question part, in order.',
      items: {
        type: 'object',
        properties: {
          read: { type: 'string', description: 'HANDWRITTEN parts only: exactly what the student wrote, transcribed (maths in LaTeX between $ signs, keep their mistakes). Empty for typed parts.' },
          awarded: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the mark-scheme points the answer earns (as numbered in the request).' },
          feedback: { type: 'string', description: 'To the student, 1-2 short sentences: what earned marks and exactly what was missing or wrong. Second person, encouraging, no fluff.' },
        },
        required: ['awarded', 'feedback'],
      },
    },
    tip: { type: 'string', description: 'One short exam-technique tip for this student based on their answer, or empty.' },
  },
  required: ['parts', 'tip'],
};

const MARK_ESSAY_SCHEMA = {
  type: 'object',
  properties: {
    criteria: { type: 'array', description: 'One entry per rubric criterion, in order.', items: { type: 'object', properties: { score: { type: 'integer', minimum: 0 }, feedback: { type: 'string' } }, required: ['score', 'feedback'] } },
    read: { type: 'string', description: 'If the writing was HANDWRITTEN: the full transcription of what the student wrote (keep their mistakes). Empty if typed.' },
    improvements: { type: 'array', items: { type: 'string' }, description: '2-4 concrete improvements quoting the student and showing a better version.' },
    tip: { type: 'string', description: 'One overall tip for next time.' },
  },
  required: ['criteria', 'improvements', 'tip'],
};

const CHAPTERS_SCHEMA = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array', description: 'Every division of the book in order, from the first page to the last.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The title exactly as printed in the book, including its number (e.g. "2.1 Atoms and Isotopes", "第二章 行人須知").' },
          start_page: { type: 'integer', description: 'PDF page number where it starts (not the printed page number).' },
          skip: { type: 'boolean', description: 'true for parts that are not for revising: cover, contents, preface, index, glossary, answers, references, blank pages.' },
        },
        required: ['title', 'start_page', 'skip'],
      },
    },
  },
  required: ['chapters'],
};

const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array', description: '4-8 topic headings in the order the section teaches them.',
      items: { type: 'object', properties: { heading: { type: 'string' }, points: { type: 'array', items: { type: 'string' }, description: '2-5 short revision points, exam-useful facts and explanations.' } }, required: ['heading', 'points'] },
    },
    key_terms: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, meaning: { type: 'string' } }, required: ['term', 'meaning'] }, description: 'Up to 15 key terms with a one-line meaning.' },
    formulas: { type: 'array', items: { type: 'object', properties: { formula: { type: 'string' }, meaning: { type: 'string' } }, required: ['formula', 'meaning'] }, description: 'Formulas or equations in the section (LaTeX in $...$) with what each symbol means. Empty if none.' },
    flashcards: { type: 'array', items: { type: 'object', properties: { front: { type: 'string', description: 'A short question or term.' }, back: { type: 'string', description: 'The answer, 1-2 sentences.' } }, required: ['front', 'back'] }, description: '12-20 flashcards covering the most examinable points.' },
  },
  required: ['sections', 'key_terms', 'formulas', 'flashcards'],
};

// Added to a request when the chapter is in Chinese.
const LANG_ZH = `LANGUAGE: The textbook section is in Chinese. Write everything for the student (questions, options, parts,
mark-scheme points, explanations, feedback and tips) in Traditional Chinese as used in Hong Kong schools: standard written
Chinese (書面語), not colloquial Cantonese, and Hong Kong subject terminology as used in the section (e.g. 細胞膜, 光合作用).
Keep scientific symbols, units and formulae as they are. source_quote must still be copied exactly from the section.`;
const LANG_ZH_MARK = `LANGUAGE: The question is in Chinese. Write feedback and the tip in Traditional Chinese as used in Hong Kong schools
(standard written Chinese). Accept answers written in Chinese or English, and answers voice-typed in Cantonese, judging only the meaning.`;
const langNote = (lang, kind) => (lang === 'zh-HK' ? `\n\n${kind === 'mark' ? LANG_ZH_MARK : LANG_ZH}` : '');

const HAND_RULES = `HANDWRITTEN ANSWERS: some parts were written by hand on a phone; their photos are attached and labelled.
- First read each one carefully and put exactly what the student wrote in "read" (maths in LaTeX between $ signs; keep their spelling and mistakes; mark crossed-out work as ignored).
- If something is truly unreadable, write [unclear] in "read" for that bit, and do not give credit for it.
- Then mark what they wrote exactly as you would a typed answer. Do not correct their working for them.`;

const MARK_RULES = `You are now marking a student's answer like a fair but strict HKDSE examiner.
- Award a mark-scheme point only if the answer clearly conveys that point. Accept different wording with the same meaning; do not require the textbook's exact words.
- Do not award a point for vague, incomplete or contradictory statements, or for a point that is only implied.
- Do not award points from one part to another part.
- Never award more points in a part than its marks.
- Ignore spelling and grammar unless they change the scientific meaning. Voice-typed answers may have odd punctuation.
- Feedback must be specific to this answer: name the missing idea plainly so the student can learn it.
- If the question leaves a condition unstated and the student's answer is correct under a reasonable reading of it (for example
  they assumed a different variant of a product), give the credit and say in the feedback which reading you accepted.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// All three tools are offered in every call (same order), so the cached prefix is identical.
const TOOLS = [
  { name: 'save_questions', description: 'Save the questions you wrote.', input_schema: QUESTION_SCHEMA },
  { name: 'answer', description: 'Give your own answer to a question.', input_schema: BLIND_SCHEMA },
  { name: 'report', description: 'Report your judgement of a question and its answer key.', input_schema: VERIFY_SCHEMA },
  { name: 'mark', description: "Mark a student's answer against the mark scheme.", input_schema: MARK_SCHEMA },
  { name: 'save_notes', description: 'Save revision notes and flashcards for the section.', input_schema: NOTES_SCHEMA },
  { name: 'save_chapters', description: 'Save the chapter structure of a book.', input_schema: CHAPTERS_SCHEMA },
  { name: 'mark_essay', description: "Mark a student's writing against the rubric.", input_schema: MARK_ESSAY_SCHEMA },
];

function newUsage() { return { calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, usd: 0 }; }
function addUsage(acc, u, model) {
  if (!acc || !u) return;
  const p = PRICES[model];
  if (p) {
    // Haiku costs 5x more per token when a request's prompt is over 100k tokens.
    const prompt = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const k = model.includes('haiku') && prompt > 100000 ? 5 : 1;
    acc.usd += k * ((u.input_tokens || 0) * p.input + (u.cache_creation_input_tokens || 0) * p.cache_write +
      (u.cache_read_input_tokens || 0) * p.cache_read + (u.output_tokens || 0) * p.output) / 1e6;
  }
  acc.calls++;
  acc.input += u.input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.cache_write += u.cache_creation_input_tokens || 0;
  acc.cache_read += u.cache_read_input_tokens || 0;
}

// Images: a base64 JPEG string, or { data, label } to put a short text label before the image.
const imageBlocks = (images) => (images || []).flatMap((im) => {
  const data = typeof im === 'string' ? im : im.data;
  const block = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
  return typeof im === 'string' || !im.label ? [block] : [{ type: 'text', text: im.label }, block];
});

async function callTool({ system, sectionBlock, instruction, toolName, maxTokens = 8000, usage, step = 'write', images }) {
  const model = MODELS[step] || MODELS.write;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  const body = {
    model,
    max_tokens: maxTokens,
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: sectionBlock, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: [...imageBlocks(images), { type: 'text', text: `${system}\n\n${instruction}\n\nReturn your result by calling the ${toolName} tool.` }],
    }],
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await post(key, body);
    addUsage(usage, data.usage, model);
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === toolName);
    if (block) return block.input;
  }
  throw httpError(502, 'The AI did not return a structured answer.');
}

// A plain text reply (the tutor). Same tools and system prompt as every other call, so the cached chapter is reused.
async function callText({ messages, maxTokens = 1200, usage, step = 'tutor' }) {
  const model = MODELS[step] || MODELS.write;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  const data = await post(key, { model, max_tokens: maxTokens, tools: TOOLS, tool_choice: { type: 'none' }, system: messages.system, messages: messages.list });
  addUsage(usage, data.usage, model);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
// Voice chat: the reply is read aloud by the browser, so it must sound like talking, not look like a page.
function voiceNote(v) {
  if (v !== 'en' && v !== 'yue') return '';
  return `\n\nVOICE CHAT: the student is talking to you out loud, and your reply will be read aloud by a computer voice. These rules replace the formatting rules above.
- Talk like a friendly tutor sitting next to them: 1-3 short sentences, under about 60 words. One idea at a time.
- No bullet points, bold, headings, tables, emoji, LaTeX or symbols. Say formulas, numbers and units in words ("H two O", "five metres per second").
- When it helps, end with one short question back, to keep the conversation going.
- Their words came through speech recognition: expect no punctuation and some misheard words. Work out what they most likely meant; if you really can't tell, ask them to say it again.` +
    (v === 'yue' ? `\n- Reply in natural spoken Hong Kong Cantonese (口語, e.g. 係、唔、嘅、啲、咁), not written Chinese, because a Cantonese voice will read it. English subject terms are fine where HK students would say them in English.` : `\n- Reply in English.`);
}
// Streams a reply from Claude: onText(words) is called as they arrive, so speech can start before the reply is
// finished. The model may also call one tool (toolName); its input comes back as action. Returns { text, action }.
async function streamText({ body, usage, onText, toolName }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  let r;
  for (let attempt = 0; ; attempt++) {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (r.ok) break;
    const t = await r.text();
    if ([429, 500, 529].includes(r.status) && attempt < 1) { await sleep(2000); continue; }
    throw httpError(502, `Claude API error ${r.status}: ${t.slice(0, 300)}`);
  }
  const dec = new TextDecoder(); const u = {};
  let buf = '', text = '', json = '', inTool = false;
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let d; try { d = JSON.parse(line.slice(5)); } catch (e) { continue; }
      if (d.type === 'message_start') Object.assign(u, d.message && d.message.usage);
      else if (d.type === 'content_block_start') inTool = !!(d.content_block && d.content_block.type === 'tool_use' && d.content_block.name === toolName);
      else if (d.type === 'content_block_delta' && d.delta) {
        if (d.delta.type === 'text_delta') { text += d.delta.text; if (onText) onText(d.delta.text); }
        else if (d.delta.type === 'input_json_delta' && inTool) json += d.delta.partial_json;
      } else if (d.type === 'message_delta' && d.usage) Object.assign(u, d.usage);
      else if (d.type === 'error') throw httpError(502, `Claude API error: ${(d.error && d.error.message) || 'stream failed'}`);
    }
  }
  addUsage(usage, u, body.model);
  let action = null;
  if (json) { try { action = JSON.parse(json); } catch (e) {} }
  return { text: text.trim(), action };
}
// Sends a streamed reply to the browser as lines of JSON: {"d": words} … then {"done": true, …result}.
function ndjson(res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('x-accel-buffering', 'no');
  return (obj) => res.write(JSON.stringify(obj) + '\n');
}

// Like callText, but the model may also call one extra tool (e.g. the coach opening a screen in the app).
// Returns { text, action } where action is that tool's input, or null.
async function callTextWithAction({ messages, maxTokens = 1200, usage, step = 'tutor', tool }) {
  const model = MODELS[step] || MODELS.write;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  const data = await post(key, { model, max_tokens: maxTokens, tools: [tool], tool_choice: { type: 'auto' }, system: messages.system, messages: messages.list });
  addUsage(usage, data.usage, model);
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
  return { text, action: call ? call.input : null };
}
function systemBlocks(sectionBlock) { return [{ type: 'text', text: SYSTEM }, { type: 'text', text: sectionBlock, cache_control: { type: 'ephemeral' } }]; }

// Stores the chapter in the cache with a tiny call, so parallel calls that follow read it cheaply.
async function warmCache({ sectionBlock, usage, step = 'write' }) {
  const model = MODELS[step];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  const data = await post(key, {
    model, max_tokens: 16, tools: TOOLS, tool_choice: { type: 'none' },
    system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: sectionBlock, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Reply with OK.' }],
  });
  addUsage(usage, data.usage, model);
}

async function post(key, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    const text = await r.text();
    if ([429, 500, 529].includes(r.status) && attempt < 2) { await sleep(5000 * (attempt + 1)); continue; }
    throw httpError(502, `Claude API error ${r.status}: ${text.slice(0, 300)}`);
  }
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function sectionBlock(title, text) {
  return `<section title="${String(title || '').replace(/"/g, "'")}">\n${text}\n</section>`;
}

function questionForChecker(q, withKey) {
  const lines = [`Stated level: ${q.level} (${LEVELS[q.level]})`, `Type: ${q.type}`, ...(q.figure ? ['(The figure for this question is the attached image. The student sees it.)'] : []), '', q.stem || ''];
  if (q.type === 'mcq' || q.type === 'graph') {
    if (q.type === 'graph') {
      (q.graphs || []).forEach((g, i) => lines.push(`Graph ${'ABCD'[i]} (x: ${g.x_label}; y: ${g.y_label}): ${(g.points || []).map((p) => `(${p[0]}, ${p[1]})`).join(' ')}`));
    }
    (q.options || []).forEach((o, i) => lines.push(`${'ABCD'[i]}. ${o}`));
    if (withKey) lines.push(`\nANSWER KEY: ${q.correct_option}`);
  } else {
    for (const p of q.parts || []) {
      lines.push(`${p.label} ${p.prompt} (${p.marks} marks)`);
      if (withKey) lines.push('   KEY: ' + (p.mark_scheme || []).join(' | '));
    }
    if (q.type === 'essay' && withKey) (q.rubric || []).forEach((r) => lines.push(`RUBRIC ${r.criterion} (${r.marks}): ${r.descriptor}`));
  }
  return lines.join('\n');
}

// Mentions of textbook figures/tables/pages the student can't see ("Figure 7.2", "Table 3", "p. 45", 「圖 7.2」, 「第 45 頁」).
const REF = /\b(?:fig(?:ure)?s?\.?|tables?|diagrams?|photos?|images?|charts?|graphs?|pages?|pp?\.|examples?|activit(?:y|ies)|exercises?)\s*\d+[a-z]?(?:[.\-–]\d+)*\b|(?:圖|表|頁|例題|練習)\s*[0-9０-９一二三四五六七八九十]+(?:\s*[.\-．]\s*[0-9]+)*|第\s*[0-9０-９]+\s*頁/i;
function missingRef(q) {
  const texts = [q.stem, ...(q.options || []), ...(q.parts || []).map((p) => p && p.prompt)].filter(Boolean).map(String);
  for (const t of texts) {
    const m = t.match(REF);
    if (!m) continue;
    // "Table 1" is fine when the stem itself gives a table
    if (/^tables?\b/i.test(m[0]) && /\|.*\|/.test(q.stem || '')) continue;
    return m[0];
  }
  return '';
}

// Compare without any spaces, so Chinese text (where PDF spacing is unreliable) matches too.
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

function formatProblems(q, text) {
  const problems = [];
  if (q.type === 'mcq' || q.type === 'graph') {
    if (!Array.isArray(q.options) || q.options.length !== 4 || !'ABCD'.includes(q.correct_option || '?')) {
      problems.push('MCQ must have 4 options and a correct option A-D');
    }
    if (q.type === 'graph' && (!Array.isArray(q.graphs) || q.graphs.length !== 4 ||
        q.graphs.some((g) => !Array.isArray(g.points) || g.points.length < 3 || g.points.some((p) => !Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite))))) {
      problems.push('graph question needs 4 graphs with at least 3 numeric points each');
    }
  } else {
    if (!Array.isArray(q.parts) || !q.parts.length) problems.push('no parts');
    if (q.type === 'essay') {
      if (!Array.isArray(q.rubric) || q.rubric.length < 2 || q.rubric.some((r) => !r.criterion || !(r.marks > 0))) problems.push('essay needs a rubric');
    } else for (const p of q.parts || []) {
      if (!Array.isArray(p.mark_scheme) || p.mark_scheme.length < p.marks) problems.push(`part ${p.label}: fewer mark points than marks`);
    }
  }
  if (q.figure) {
    const b = q.figure.box;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) || b[2] - b[0] < 0.08 || b[3] - b[1] < 0.05) problems.push('figure box invalid');
  }
  const ref = missingRef(q);
  if (ref) problems.push(`refers to something the student cannot see: "${ref}"`);
  const quote = norm(q.source_quote);
  if (quote && !norm(text).includes(quote)) problems.push('source quote not found in the section');
  return problems;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Every request must carry the access code, so strangers cannot spend your API credit.
function checkAccess(req) {
  const expected = process.env.PREPBUDDY_ACCESS_CODE;
  if (!expected) return; // no code set in Vercel: open to anyone with the link
  const admin = process.env.ADMIN_PASSWORD;
  if (admin && (req.headers['x-admin-password'] || '') === admin) return; // the admin page can always use the AI
  const got = req.headers['x-access-code'] || '';
  if (got.trim().toLowerCase() !== expected.trim().toLowerCase()) throw httpError(401, 'Wrong access code.');
}

function handler(fn) {
  return async (req, res) => {
    res.setHeader('content-type', 'application/json');
    try {
      if (req.method !== 'POST') throw httpError(405, 'Use POST.');
      checkAccess(req);
      const body = await readJson(req);
      if (typeof body.text !== 'string' || body.text.length < 200) throw httpError(400, 'Not enough text in this chapter.');
      if (body.text.length > MAX_TEXT) body.text = body.text.slice(0, MAX_TEXT);
      const usage = newUsage();
      // body.stream: send the reply's words as they are written (fn gets an emit function to call with them)
      const write = body.stream ? ndjson(res) : null;
      const out = await fn(body, usage, write ? (t) => write({ d: t }) : null);
      if (write) return res.end(JSON.stringify({ done: true, ...out, usage }) + '\n');
      res.statusCode = 200;
      res.end(JSON.stringify({ ...out, usage }));
    } catch (e) {
      if (res.headersSent) return res.end(JSON.stringify({ error: e.message || 'Server error' }) + '\n');
      res.statusCode = e.status || 500;
      res.end(JSON.stringify({ error: e.message || 'Server error' }));
    }
  };
}

module.exports = {
  HAND_RULES, langNote, kindNote, KIND_RULES, MARK_KIND, ESSAY_RULES, MODELS, MARK_RULES, LEVELS, GEN_SYSTEM, VERIFY_SYSTEM, FIGURE_RULES, QUESTION_SCHEMA, BLIND_SCHEMA, VERIFY_SCHEMA,
  missingRef, TOOLS, callTool, callText, callTextWithAction, streamText, ndjson, systemBlocks, voiceNote, warmCache, sectionBlock, questionForChecker, formatProblems, handler, httpError, checkAccess, readJson, newUsage,
};
