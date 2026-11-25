// One serverless function for the newer study tools, to stay within Vercel's function limit.
// /api/homework, /api/writing and /api/snippets and /api/speaking are rewritten here (vercel.json) with ?fn=<name>.
const FNS = { homework: require('../lib/fns/homework'), writing: require('../lib/fns/writing'), snippets: require('../lib/fns/snippets'), speaking: require('../lib/fns/speaking'), bookinfo: require('../lib/fns/bookinfo'), pilot: require('../lib/fns/pilot'), tts: require('../lib/fns/tts'), uitr: require('../lib/fns/uitr'), insights: require('../lib/fns/insights') };
module.exports = (req, res) => {
  let fn = req.query && req.query.fn;
  if (!fn) { const m = String(req.url || '').match(/\/api\/(\w+)/); fn = m && m[1]; }
  const h = FNS[fn];
  if (!h) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: 'Unknown tool.' })); }
  return h(req, res);
};
