// Verify a published Git package in an isolated OpenCode without model requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const target = process.argv[2] ?? 'github:MAlshehri/opencode-splash#v0.1.1';
const root = await mkdtemp(join(tmpdir(), 'opencode-splash-install-'));
const configDirectory = join(root, 'config', 'opencode');
await mkdir(configDirectory, { recursive: true });
const options = { model: 'incoai/Qwen3.8-27B-Splash', providerID: 'splash-install-check', maxContext: 65536, maxOutputTokens: 16384, stateDirectory: join(root, 'splash-state') };
await writeFile(join(configDirectory, 'opencode.json'), JSON.stringify({ plugins: [{ package: target, options }] }));
const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
const password = randomUUID();
const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
const env = { ...process.env, PWD: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_SERVER_PASSWORD: password };
for (const name of Object.keys(env)) if (name.endsWith('_API_KEY')) delete env[name];
const server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: 'ignore' });
let launchError;
const exited = new Promise((resolve) => {
  server.once('exit', resolve);
  server.once('error', (error) => { launchError = error; resolve(); });
});
let completed = false;
try {
  const url = new URL(`http://127.0.0.1:${port}/api/plugin`); url.searchParams.set('location[directory]', root);
  const deadline = Date.now() + 90000;
  let plugin;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (server.exitCode !== null) throw new Error('OpenCode exited during package installation');
    try {
      const result = await fetch(url, { headers, signal: AbortSignal.timeout(3000) }).then((response) => response.json());
      plugin = result.data?.find((entry) => entry.id === 'opencode-splash');
      if (plugin?.state.status === 'active') break;
    } catch {}
    await delay(500);
  }
  assert.equal(plugin?.state.status, 'active', `Plugin did not activate: ${JSON.stringify(plugin)}`);
  url.pathname = '/api/model';
  const models = await fetch(url, { headers, signal: AbortSignal.timeout(3000) }).then((response) => response.json());
  assert.ok(models.data?.some((model) => model.providerID === options.providerID && model.id === options.model));
  await assert.rejects(access(options.stateDirectory), /ENOENT/);
  console.log(JSON.stringify({ target, plugin: 'active', modelRegistered: true, modelRequests: 0, splashStarted: false }));
  completed = true;
} catch (error) {
  console.error(`Installation check failed; evidence: ${root}`);
  throw error;
} finally {
  if (server.exitCode === null) server.kill('SIGTERM');
  const forced = setTimeout(() => server.kill('SIGKILL'), 10000);
  await exited; clearTimeout(forced);
  // Retain failures for diagnosis, while successful read-only checks are disposable.
  if (completed) await rm(root, { recursive: true, force: true });
}
