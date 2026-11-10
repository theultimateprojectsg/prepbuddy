// POST /api/warm
// body: { title, text } — puts the chapter in the AI's short-term cache before parallel calls start.
const { warmCache, sectionBlock, handler } = require('../lib/claude');

module.exports = handler(async (body, usage) => {
  const block = sectionBlock(body.title, body.text);
  await Promise.all([warmCache({ sectionBlock: block, usage, step: 'write' }), warmCache({ sectionBlock: block, usage, step: 'check' })]);
  return { ok: true };
});
