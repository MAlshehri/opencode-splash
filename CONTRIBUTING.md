# Contributing

Use Node.js 22 or newer. Run `npm ci`, then `npm test` and `npm run check`. Add tests for changes affecting readiness, locking, process ownership or authentication. Keep unit/integration fixtures independent of real model downloads.

Rebuild and commit `dist/` with source changes. Tagged GitHub installs need the compiled entrypoint because OpenCode does not run package installation scripts.

`npm run test:opencode` requires an installed OpenCode V2 on Apple Silicon and verifies native plugin loading plus cold-start request ordering with a fake Splash process. Real inference and idle restore need a separate hardware acceptance run.

Keep one exact model per provider, a deterministic loopback endpoint, bounded startup, and explicit process ownership. Preserve existing user configuration. Avoid adding automatic cloud fallback, auto-installation, model eviction or stop-on-exit behavior without a separate design discussion.

Report reproducible issues with OpenCode/Splash versions, platform, sanitized options, and the relevant error. Remove prompts, API keys and personal paths from shared logs.
