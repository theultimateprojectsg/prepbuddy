// Shared helpers for the server functions: Claude API calls, prompts and checks.
// The API key lives only in Vercel's environment variables (ANTHROPIC_API_KEY).

const MODEL = process.env.PREPBUDDY_MODEL || 'claude-sonnet-5-5';
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
const SYSTEM = `You help secondary-school students prepare for exams (default style: Hong Kong HKDSE), in English.
In each request you either WRITE practice questions or CHECK one as a strict examiner, as the request says.
Use ONLY the textbook section below as the source of truth.`;

const GEN_SYSTEM = `Rules for writing questions:
- Base every question ONLY on the textbook section provided. Do not test facts that are not in it.
- Use exam style: clear command words (state, name, explain, describe, suggest, compare, evaluate),
  marks shown per part, MCQs with exactly 4 options and one unambiguously correct answer.
- MCQ distractors must be plausible misconceptions, not obviously wrong. Vary which letter is correct.
- Mark schemes list separate creditable points, one mark each; the number of points must be at least the marks for that part.
- Write questions in your own words. Never copy the textbook's own end-of-chapter questions.
- source_quote must be copied exactly from the section and be at most 25 words.
- Keep it at secondary-school depth even if the textbook goes deeper.
- A structured question's stem is ONE coherent scenario, and every part relates to it.
- Each question must test a different idea from the questions already written (listed if any).
- If the section has no teachable content (e.g. a contents page, index or acknowledgements), return an empty list.`;

const VERIFY_SYSTEM = `You are now a strict exam examiner checking a practice question before students see it.`;

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['mcq', 'short', 'structured'] },
          level: { type: 'integer', minimum: 1, maximum: 4 },
          stem: { type: 'string', description: 'The question (MCQ) or the context/data given before the parts. Tables as pipe rows.' },
          options: { type: 'array', items: { type: 'string' }, description: 'MCQ only: exactly 4 options, without A-D labels.' },
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
  },
  required: ['answer', 'option'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    key_correct: { type: 'boolean', description: 'Is the answer key correct and supported by the section?' },
    unambiguous: { type: 'boolean', description: 'Exactly one defensible answer (MCQ) / clear what is being asked?' },
    level_ok: { type: 'boolean', description: 'Does the question actually demand the stated thinking level?' },
    problems: { type: 'string', description: 'What is wrong. Leave empty if nothing is wrong.' },
  },
  required: ['key_correct', 'unambiguous', 'level_ok', 'problems'],
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

const MARK_RULES = `You are now marking a student's answer like a fair but strict HKDSE examiner.
- Award a mark-scheme point only if the answer clearly conveys that point. Accept different wording with the same meaning; do not require the textbook's exact words.
- Do not award a point for vague, incomplete or contradictory statements, or for a point that is only implied.
- Do not award points from one part to another part.
- Never award more points in a part than its marks.
- Ignore spelling and grammar unless they change the scientific meaning. Voice-typed answers may have odd punctuation.
- Feedback must be specific to this answer: name the missing idea plainly so the student can learn it.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// All three tools are offered in every call (same order), so the cached prefix is identical.
const TOOLS = [
  { name: 'save_questions', description: 'Save the questions you wrote.', input_schema: QUESTION_SCHEMA },
  { name: 'answer', description: 'Give your own answer to a question.', input_schema: BLIND_SCHEMA },
  { name: 'report', description: 'Report your judgement of a question and its answer key.', input_schema: VERIFY_SCHEMA },
  { name: 'mark', description: "Mark a student's answer against the mark scheme.", input_schema: MARK_SCHEMA },
];

function newUsage() { return { calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0 }; }
function addUsage(acc, u) {
  if (!acc || !u) return;
  acc.calls++;
  acc.input += u.input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.cache_write += u.cache_creation_input_tokens || 0;
  acc.cache_read += u.cache_read_input_tokens || 0;
}

async function callTool({ system, sectionBlock, instruction, toolName, maxTokens = 8000, usage }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: sectionBlock, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: `${system}\n\n${instruction}\n\nReturn your result by calling the ${toolName} tool.`,
    }],
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await post(key, body);
    addUsage(usage, data.usage);
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === toolName);
    if (block) return block.input;
  }
  throw httpError(502, 'The AI did not return a structured answer.');
}

// Stores the chapter in the cache with a tiny call, so parallel calls that follow read it cheaply.
async function warmCache({ sectionBlock, usage }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'The server has no ANTHROPIC_API_KEY set in Vercel.');
  const data = await post(key, {
    model: MODEL, max_tokens: 16, tools: TOOLS, tool_choice: { type: 'none' },
    system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: sectionBlock, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Reply with OK.' }],
  });
  addUsage(usage, data.usage);
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
  const lines = [`Stated level: ${q.level} (${LEVELS[q.level]})`, `Type: ${q.type}`, '', q.stem || ''];
  if (q.type === 'mcq') {
    (q.options || []).forEach((o, i) => lines.push(`${'ABCD'[i]}. ${o}`));
    if (withKey) lines.push(`\nANSWER KEY: ${q.correct_option}`);
  } else {
    for (const p of q.parts || []) {
      lines.push(`${p.label} ${p.prompt} (${p.marks} marks)`);
      if (withKey) lines.push('   KEY: ' + (p.mark_scheme || []).join(' | '));
    }
  }
  return lines.join('\n');
}

const norm = (s) => String(s || '').split(/\s+/).join(' ').toLowerCase();

function formatProblems(q, text) {
  const problems = [];
  if (q.type === 'mcq') {
    if (!Array.isArray(q.options) || q.options.length !== 4 || !'ABCD'.includes(q.correct_option || '?')) {
      problems.push('MCQ must have 4 options and a correct option A-D');
    }
  } else {
    if (!Array.isArray(q.parts) || !q.parts.length) problems.push('no parts');
    for (const p of q.parts || []) {
      if (!Array.isArray(p.mark_scheme) || p.mark_scheme.length < p.marks) problems.push(`part ${p.label}: fewer mark points than marks`);
    }
  }
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
      const out = await fn(body, usage);
      res.statusCode = 200;
      res.end(JSON.stringify({ ...out, usage }));
    } catch (e) {
      res.statusCode = e.status || 500;
      res.end(JSON.stringify({ error: e.message || 'Server error' }));
    }
  };
}

module.exports = {
  MARK_RULES, LEVELS, GEN_SYSTEM, VERIFY_SYSTEM, QUESTION_SCHEMA, BLIND_SCHEMA, VERIFY_SCHEMA,
  callTool, warmCache, sectionBlock, questionForChecker, formatProblems, handler, httpError,
};
