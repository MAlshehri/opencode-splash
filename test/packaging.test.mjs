import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

test('Git distribution ships compiled files without triggering npm preparation', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  // npm's GitFetcher checks these names even when installation scripts are disabled.
  // OpenCode's bundled npm cannot execute a nested npm CLI during Git preparation.
  assert.equal(manifest.workspaces, undefined);
  for (const name of ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall']) {
    assert.equal(manifest.scripts[name], undefined, `scripts.${name} triggers Git package preparation`);
  }
  assert.ok(manifest.files.includes('dist'));
  assert.ok(manifest.files.includes('index.ts'));
  await access(new URL('../dist/index.js', import.meta.url));
  await access(new URL('../dist/index.d.ts', import.meta.url));
});
