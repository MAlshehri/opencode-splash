import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, chmod, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { SplashManager } from '../dist/manager.js';
import { resolveOptions, serveArguments } from '../dist/options.js';
import { probe } from '../dist/probe.js';
import plugin from '../dist/index.js';

const fake = resolve('test/fake-splash.mjs');
await chmod(fake, 0o755);
const runtime = { platform: 'darwin', arch: 'arm64', spawn };
const model = 'incoai/Test-Splash';
async function unusedPort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise((r) => server.close(r)); return port;
}
async function fixture(t, extra = {}, control = {}) {
  const root = await mkdtemp(join(tmpdir(), 'opencode-splash-test-'));
  await writeFile(join(root, 'fake-control.json'), JSON.stringify(control));
  const options = resolveOptions({ model, port: await unusedPort(), executable: fake, stateDirectory: root, startupTimeoutMs: 5000, ...extra });
  const manager = new SplashManager(options, runtime);
  t.after(async () => {
    await manager.close();
    let starts = []; try { starts = (await readFile(join(root, 'starts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
    for (const start of starts) { try { process.kill(start.pid, 'SIGTERM'); } catch {} }
    await delay(100); await rm(root, { recursive: true, force: true });
  });
  return { root, options, manager, starts: async () => (await readFile(join(root, 'starts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) };
}

test('strict options reject typos and unsupported launcher syntax', () => {
  for (const config of [{ model, typo: true }, { model, port: '8000' }, { model, maxMemory: '70%' }, { model, maxContext: 8192, maxOutputTokens: 8192 }, { model: '--help' }, { model, executable: './splash' }, { model, offline: 'true' }]) {
    assert.throws(() => resolveOptions(config), /Invalid configuration/);
  }
  const options = resolveOptions({ model, executable: '/path with spaces/splash', maxMemory: '24G' });
  assert.deepEqual(serveArguments(options), ['serve', '--model', model, '--host', '127.0.0.1', '--port', '8000', '--max-context', '32768', '--idle-release', '10m', '--offline', '--max-memory', '24G']);
});

test('20 concurrent requests launch once and wait for real readiness', async (t) => {
  const f = await fixture(t, {}, { readyDelayMs: 600 });
  await Promise.all(Array.from({ length: 20 }, () => f.manager.ensureReady()));
  assert.equal((await f.starts()).length, 1);
  assert.equal((await probe(f.options, new AbortController().signal)).state, 'ready');
  await f.manager.ensureReady(); assert.equal((await f.starts()).length, 1);
});

test('six independent Node processes coordinate one launch', async (t) => {
  const f = await fixture(t, {}, { readyDelayMs: 700, bindDelayMs: 200 });
  const results = await Promise.all(Array.from({ length: 6 }, async () => {
    const worker = spawn(process.execPath, [resolve('test/worker.mjs'), JSON.stringify(f.options)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; worker.stdout.on('data', (b) => { output += b; }); worker.stderr.on('data', (b) => { output += b; });
    const [code] = await once(worker, 'exit'); return { code, output };
  }));
  for (const result of results) assert.equal(result.code, 0, result.output);
  assert.equal((await f.starts()).length, 1);
});

test('reuses an external server, including while it is warming, and leaves it alive on close', async (t) => {
  const f = await fixture(t, {}, { readyDelayMs: 600 });
  const external = spawn(fake, serveArguments(f.options), { cwd: f.root, stdio: 'ignore' });
  await delay(200);
  await f.manager.ensureReady(); await f.manager.close();
  assert.equal((await f.starts()).length, 1);
  assert.equal(external.exitCode, null);
  assert.equal((await probe(f.options, new AbortController().signal)).state, 'ready');
});

test('wrong model on an occupied port fails without replacing it', async (t) => {
  const f = await fixture(t, {}, { model: 'another/Wrong-Model' });
  const external = spawn(fake, serveArguments(f.options), { cwd: f.root, stdio: 'ignore' });
  await delay(250);
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'MODEL_CONFLICT');
  assert.equal(external.exitCode, null); assert.equal((await f.starts()).length, 1);
});

test('generic healthy HTTP service is never mistaken for Splash', async (t) => {
  const f = await fixture(t);
  const server = httpServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"status":"ok"}'); });
  server.listen(f.options.port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'PORT_CONFLICT');
  await assert.rejects(readFile(join(f.root, 'starts.jsonl')), /ENOENT/);
});

test('authentication stays in environment and unrelated cloud credentials are not inherited', async (t) => {
  process.env.SPLASH_TEST_KEY = 'private-test-key'; process.env.OPENROUTER_API_KEY = 'must-not-be-inherited';
  t.after(() => { delete process.env.SPLASH_TEST_KEY; delete process.env.OPENROUTER_API_KEY; });
  let childEnv;
  const f = await fixture(t, { apiKeyEnv: 'SPLASH_TEST_KEY' });
  const manager = new SplashManager(f.options, { ...runtime, spawn: (...args) => { childEnv = args[2].env; return spawn(...args); } });
  t.after(() => manager.close());
  await manager.ensureReady();
  assert.equal(childEnv.SPLASH_API_KEY, 'private-test-key'); assert.equal(childEnv.OPENROUTER_API_KEY, undefined);
  assert.ok(!(await readFile(join(f.root, 'starts.jsonl'), 'utf8')).includes('private-test-key'));
  process.env.SPLASH_TEST_KEY = 'wrong-key';
  await assert.rejects(manager.ensureReady(), (e) => e.code === 'AUTH');
  assert.equal((await f.starts()).length, 1);
});

test('early exit produces an actionable failure and cross-instance cooldown prevents a launch storm', async (t) => {
  const f = await fixture(t, {}, { exitEarly: true });
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'PROCESS_EXIT' && e.message.includes('offline'));
  const second = new SplashManager(f.options, runtime); t.after(() => second.close());
  await assert.rejects(second.ensureReady(), (e) => e.code === 'COOLDOWN');
  assert.equal((await f.starts()).length, 1);
  await writeFile(join(f.root, 'fake-control.json'), '{}');
  await writeFile(join(f.root, `127.0.0.1-${f.options.port}.failure.json`), '{"time":0}');
  await second.ensureReady(); assert.equal((await f.starts()).length, 2);
});

test('startup timeout terminates only its own unready process', async (t) => {
  const f = await fixture(t, { startupTimeoutMs: 1000 }, { neverReady: true });
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'STARTUP_TIMEOUT');
  assert.equal((await probe(f.options, new AbortController().signal)).state, 'absent');
});

test('missing executable fails promptly with an installation hint', async (t) => {
  const f = await fixture(t, { executable: '/nonexistent/opencode-splash-test-executable' });
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'SPAWN_FAILED' && e.message.includes('Install Splash'));
  assert.equal((await probe(f.options, new AbortController().signal)).state, 'absent');
});

test('an unresponsive occupied port is not replaced', async (t) => {
  const f = await fixture(t, { startupTimeoutMs: 2500 });
  const sockets = new Set();
  const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(f.options.port, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise((r) => server.close(r)); });
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'UNRESPONSIVE');
  await assert.rejects(readFile(join(f.root, 'starts.jsonl')), /ENOENT/);
});

test('timeout while waiting for an external server leaves that server running', async (t) => {
  const f = await fixture(t, { startupTimeoutMs: 1000 }, { neverReady: true });
  const external = spawn(fake, serveArguments(f.options), { cwd: f.root, stdio: 'ignore' }); await delay(200);
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'STARTUP_TIMEOUT');
  assert.equal(external.exitCode, null); assert.equal((await f.starts()).length, 1);
});

test('unload cancels its in-progress launch', async (t) => {
  const f = await fixture(t, {}, { neverReady: true });
  const pending = f.manager.ensureReady(); const rejection = assert.rejects(pending, (e) => e.code === 'UNLOADED');
  await delay(350); await f.manager.close(); await rejection;
  assert.equal((await probe(f.options, new AbortController().signal)).state, 'absent');
});

test('next request recovers after the ready server crashes', async (t) => {
  const f = await fixture(t); await f.manager.ensureReady();
  process.kill((await f.starts())[0].pid, 'SIGTERM'); await delay(200);
  await f.manager.ensureReady(); assert.equal((await f.starts()).length, 2);
});

test('stale startup lock is recovered and old logs rotate', async (t) => {
  const f = await fixture(t);
  const lock = join(f.root, `127.0.0.1-${f.options.port}.startup.lock`);
  await mkdir(lock); await utimes(lock, new Date(0), new Date(0));
  await writeFile(f.manager.logPath, 'x'.repeat(5 * 1024 * 1024));
  await f.manager.ensureReady();
  assert.equal((await stat(`${f.manager.logPath}.1`)).size, 5 * 1024 * 1024);
  assert.equal((await stat(f.manager.logPath)).mode & 0o777, 0o600);
});

test('insufficient context capacity fails instead of advertising an unusable limit', async (t) => {
  const f = await fixture(t, {}, { context: 8192 });
  const external = spawn(fake, serveArguments(f.options), { cwd: f.root, stdio: 'ignore' }); await delay(250);
  await assert.rejects(f.manager.ensureReady(), (e) => e.code === 'CONTEXT_CONFLICT'); assert.equal(external.exitCode, null);
});

test('plugin setup is lazy, preserves existing provider, and scopes all request kinds', async (t) => {
  const f = await fixture(t); let registered; let added; let budgetTransform;
  const ctx = {
    options: f.options,
    provider: { transform: async (cb) => { cb({ get: () => undefined, add: (entry) => { added = entry; } }); return { dispose: async () => {} }; } },
    model: { transform: async (cb) => { budgetTransform = cb; return { dispose: async () => {} }; } },
    session: { hook: async (name, callback, scope) => { registered = { name, callback, scope }; return { dispose: async () => {} }; } },
  };
  const cleanup = await plugin.setup(ctx); t.after(cleanup);
  assert.equal(added.models[0].limit.context, 32768); assert.equal(added.info.settings.baseURL, `http://127.0.0.1:${f.options.port}/v1`);
  assert.equal(registered.name, 'model.request'); assert.deepEqual(registered.scope, { providerID: 'splash' });
  const existing = { limit: { context: 131072, input: 114688, output: 16384 } };
  budgetTransform({ get: () => existing, update: (provider, selected, callback) => callback(existing) });
  assert.deepEqual(existing.limit, { context: 32768, input: 28672, output: 4096 });
  await assert.rejects(readFile(join(f.root, 'starts.jsonl')), /ENOENT/);
  // Attach the real plugin to an externally-started fake on CI, as launch is macOS-only.
  spawn(fake, serveArguments(f.options), { cwd: f.root, stdio: 'ignore' }); await delay(250);
  for (const kind of ['primary', 'title', 'compaction', 'generate']) {
    const event = { kind, model: { providerID: 'splash', id: model }, headers: {} };
    await registered.callback(event); assert.equal(event.baseURL, added.info.settings.baseURL);
  }
  await assert.rejects(registered.callback({ kind: 'primary', model: { id: 'other/Model' }, headers: {} }), (e) => e.code === 'MODEL_SELECTION');
  await assert.rejects(registered.callback({ model: { id: model }, baseURL: 'https://example.com/v1', headers: {} }), (e) => e.code === 'ENDPOINT_CONFLICT');
  const existingCtx = { ...ctx, provider: { transform: async (cb) => { cb({ get: () => ({ provider: {} }), add: () => { assert.fail('existing provider overwritten'); } }); } } };
  const cleanup2 = await plugin.setup(existingCtx); await cleanup2();
});
