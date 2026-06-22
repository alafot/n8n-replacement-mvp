// Self-contained local HTTP endpoint for exercising the HTTP Request step
// without depending on the public internet. Routes:
//   GET/POST /echo        -> JSON reflecting the received method/headers/body
//   GET      /json        -> a JSON payload
//   GET      /html        -> a text/html payload (non-JSON branch)
//   GET      /status/:n   -> responds with HTTP status n
//   GET      /delay/:ms   -> responds after ms milliseconds (to observe in-progress)
//
// Usage: node scripts/test-endpoint.mjs [port]   (default 4555)

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4555);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  // Collect body.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');

  if (path === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        receivedMethod: req.method,
        receivedHeaders: req.headers,
        receivedBody: body,
      }),
    );
    return;
  }

  if (path === '/json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'hello', value: 42, nested: { ok: true } }));
    return;
  }

  if (path === '/html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>Hello &amp; welcome</h1></body></html>');
    return;
  }

  const statusMatch = path.match(/^\/status\/(\d+)$/);
  if (statusMatch) {
    const code = Number(statusMatch[1]);
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestedStatus: code }));
    return;
  }

  // Returns a caller-chosen numeric value — lets a graph demo prove data flow
  // with an arbitrary (non-constant) value picked at trigger time.
  const valueMatch = path.match(/^\/value\/(\d+)$/);
  if (valueMatch) {
    const n = Number(valueMatch[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ value: n, label: `server-value-${n}` }));
    return;
  }

  const delayMatch = path.match(/^\/delay\/(\d+)$/);
  if (delayMatch) {
    const ms = Number(delayMatch[1]);
    await new Promise((r) => setTimeout(r, ms));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ delayedMs: ms, done: true }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[test-endpoint] listening on http://127.0.0.1:${port}`);
});
