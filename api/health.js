// GET /api/health — shows whether the server settings are in place (never shows their values).
module.exports = (req, res) => {
  const { MODELS } = require('../lib/claude');
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    api_key_set: key.length > 0,
    api_key_looks_valid: /^sk-ant-/.test(key.trim()),
    api_key_has_spaces: key !== key.trim(),
    access_code_set: !!process.env.PREPBUDDY_ACCESS_CODE,
    models: MODELS,
  }));
};
