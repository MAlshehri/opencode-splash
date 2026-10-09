import { spawn } from 'node:child_process';
import { SplashManager } from '../dist/manager.js';
import { resolveOptions } from '../dist/options.js';
const manager = new SplashManager(resolveOptions(JSON.parse(process.argv[2])), { platform: 'darwin', arch: 'arm64', spawn });
try {
  await manager.ensureReady();
  console.log('READY');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await manager.close(); }
