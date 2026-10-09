// Opt-in: runs an installed OpenCode, private config/data, and the fake Splash only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This cold-start smoke requires macOS on Apple Silicon.');
const root = await mkdtemp(join(tmpdir(), 'opencode-splash-smoke-'));
const existingModel = process.env.SPLASH_SMOKE_EXISTING_MODEL;
let originalInstance;
const fake = resolve('test/fake-splash.mjs'); await chmod(fake, 0o755);
const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
let port = reserve.address().port; await new Promise((r) => reserve.close(r));
if (existingModel) {
  port = Number(process.env.SPLASH_SMOKE_PORT ?? 8000);
  const before = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
  assert.ok(before.ready && before.instance?.model === existingModel, 'Existing real server must already be ready with the requested model.');
  originalInstance = before.instance;
}
const state = join(root, 'state'); await mkdir(state);
await writeFile(join(state, 'fake-control.json'), '{"readyDelayMs":750}');
const options = { model: existingModel ?? 'incoai/Test-Splash', providerID: 'splash-smoke', executable: existingModel ? 'splash' : fake, port, stateDirectory: state, startupTimeoutMs: 15000,
  ...(existingModel ? { maxContext: 65536, maxOutputTokens: 1024, reasoningEffort: 'none' } : {}) };
const config = {
  plugins: [{ package: process.env.SPLASH_SMOKE_PACKAGE ?? resolve('.'), options }],
  model: `splash-smoke/${options.model}`,
  mcp: { servers: {} }, snapshots: false, warming: false,
};
await mkdir(join(root, 'config', 'opencode'), { recursive: true });
await writeFile(join(root, 'config', 'opencode', 'opencode.json'), JSON.stringify(config));
await writeFile(join(root, 'opencode.json'), JSON.stringify(config));
const env = { ...process.env, PWD: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'xdg-state') };
env.OPENCODE_SERVER_PASSWORD = randomUUID();
env.OPENCODE_SERVER_USERNAME = 'opencode';
const authorization = `Basic ${Buffer.from(`opencode:${env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
for (const name of Object.keys(env)) if (name.endsWith('_API_KEY')) delete env[name];
let result;
let server;
try {
  const reserveServer = createServer().listen(0, '127.0.0.1'); await once(reserveServer, 'listening');
  const serverPort = reserveServer.address().port; await new Promise((r) => reserveServer.close(r));
  const serverURL = `http://127.0.0.1:${serverPort}`;
  server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(serverPort)], { cwd: root, env, stdio: 'ignore' });
  const modelURL = new URL('/api/model', serverURL); modelURL.searchParams.set('location[directory]', root);
  const deadline = Date.now() + 20000; let catalog;
  while (Date.now() < deadline) {
    try {
      catalog = await fetch(modelURL, { headers: { authorization }, signal: AbortSignal.timeout(1000) }).then((r) => r.json());
      if (catalog.data?.some((m) => m.providerID === options.providerID && m.id === options.model)) break;
    } catch {}
    await delay(250);
  }
  if (!catalog?.data?.some((m) => m.providerID === options.providerID && m.id === options.model)) {
    const pluginURL = new URL('/api/plugin', serverURL); pluginURL.searchParams.set('location[directory]', root);
    const plugins = await fetch(pluginURL, { headers: { authorization } }).then((r) => r.json());
    const configURL = new URL('/api/config', serverURL); configURL.searchParams.set('location[directory]', root);
    const sources = await fetch(configURL, { headers: { authorization } }).then((r) => r.json());
    throw new Error(`Plugin model was not registered; custom plugins: ${JSON.stringify(plugins.data?.filter((p) => p.source.type !== 'builtin'))}; config: ${JSON.stringify(sources)}`);
  }
  // Listing models must not start Splash.
  await assert.rejects(readFile(join(state, 'starts.jsonl')), /ENOENT/);
  const command = spawn('opencode', ['run', '--server', serverURL, '--model', `splash-smoke/${options.model}`, '--format', 'json', '--title', 'Splash plugin isolated smoke', 'Reply with exactly HOOK_OK. Do not use tools.'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; command.stdout.on('data', (b) => { output += b; }); command.stderr.on('data', (b) => { output += b; });
  const timer = setTimeout(() => command.kill('SIGTERM'), 60000);
  const [code] = await once(command, 'exit'); clearTimeout(timer);
  result = { code, output };
  assert.equal(code, 0, output); assert.match(output, /HOOK_OK/);
  if (existingModel) {
    const after = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
    assert.equal(after.instance.id, originalInstance.id); assert.equal(after.instance.pid, originalInstance.pid);
    await assert.rejects(readFile(join(state, `127.0.0.1-${port}.log`)), /ENOENT/);
    console.log(JSON.stringify({ opencode: 'native V2', realServerReuse: 'passed', model: options.model, originalPIDPreserved: true, newServerLaunches: 0, reply: 'HOOK_OK' }));
  } else {
    const starts = (await readFile(join(state, 'starts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const requests = (await readFile(join(state, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(starts.length, 1); assert.ok(requests.length >= 1); assert.ok(requests.every((r) => r.ready && r.model === options.model));
    console.log(JSON.stringify({ opencode: 'native V2', coldStart: 'passed', launches: starts.length, requests: requests.length, everyRequestReady: true, reply: 'HOOK_OK' }));
  }
} catch (error) {
  console.error(result?.output ?? error.message);
  console.error(`Smoke evidence retained: ${root}`);
  process.exitCode = 1;
} finally {
  if (server) { server.kill('SIGTERM'); await once(server, 'exit'); }
  if (!existingModel) {
    try {
      for (const entry of (await readFile(join(state, 'starts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)) {
        try { process.kill(entry.pid, 'SIGTERM'); } catch {}
      }
    } catch {}
  }
  await delay(100);
  if (!process.exitCode) await rm(root, { recursive: true, force: true });
}
