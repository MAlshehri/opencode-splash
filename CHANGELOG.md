# Changelog

## 0.1.1 — 2026-10-09 (preview)

- Fix installation through OpenCode's Git package loader by removing npm Git preparation triggers (`build` and `prepack`); use `npm run compile` for development.
- Add a package contract test and a read-only native OpenCode installation check that sends no model requests.

## 0.1.0 — 2026-10-09 (preview)

- Native OpenCode V2 provider-scoped lazy Splash startup.
- Optional provider/model registration, explicit memory/context limits, offline cache reuse and reasoning variants.
- Cross-process startup coordination, identity/readiness checks and external server reuse.
- Bounded startup, failure cooldown, crash recovery and ownership-aware cleanup.
- Environment-based authentication, restricted child environment and startup log rotation.
- Lifecycle tests, native OpenCode smoke, architecture and release documentation.
- GitHub installation with compiled entrypoints; npm distribution is not yet published.
