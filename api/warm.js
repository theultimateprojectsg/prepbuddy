// POST /api/warm
// body: { title, text } — puts the chapter in the AI's short-term cache before parallel calls start.
const { warmCache, sectionBlock, handler } = require('../lib/claude');

module.exports = handler(async (body, usage) => {
  await warmCache({ sectionBlock: sectionBlock(body.title, body.text), usage });
  return { ok: true };
});
