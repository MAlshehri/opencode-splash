#!/usr/bin/env node
// Deterministic stand-in for Splash's lifecycle, identity, auth and streaming API.
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const root = process.cwd();
let control = {};
try { control = JSON.parse(readFileSync(join(root, 'fake-control.json'), 'utf8')); } catch {}
appendFileSync(join(root, 'starts.jsonl'), JSON.stringify({ pid: process.pid, args }) + '\n');
if (control.exitEarly) process.exit(17);
const port = Number(option('--port'));
const model = control.model ?? option('--model');
const context = control.context ?? Number(option('--max-context'));
let ready = false;
setTimeout(() => { ready = !control.neverReady; }, control.readyDelayMs ?? 150);
const server = createServer(async (req, res) => {
  const path = req.url;
  if (process.env.SPLASH_API_KEY && !['/health', '/ready'].includes(path) && req.headers.authorization !== `Bearer ${process.env.SPLASH_API_KEY}`) {
    res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return;
  }
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (path === '/health') return json(200, { status: 'ok' });
  if (path === '/ready') return json(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
  if (path === '/status') return json(200, { ready, maximum_context_tokens: context, instance: { id: `fake-${process.pid}`, pid: process.pid, model } });
  if (path === '/v1/models') return json(200, { object: 'list', data: [{ id: model, owned_by: 'splash', object: 'model', max_model_len: context }] });
  if (path === '/v1/chat/completions') {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    appendFileSync(join(root, 'requests.jsonl'), JSON.stringify({ model: request.model, ready, path }) + '\n');
    if (!ready) return json(503, { error: { message: 'not ready' } });
    const common = { id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', model, created: Math.floor(Date.now() / 1000) };
    if (!request.stream) return json(200, { ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'HOOK_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const data of [
      { ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'HOOK_OK' }, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
    ]) res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.end('data: [DONE]\n\n'); return;
  }
  return json(404, { error: 'not found' });
});
if (control.bindDelayMs) await new Promise((resolve) => setTimeout(resolve, control.bindDelayMs));
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
