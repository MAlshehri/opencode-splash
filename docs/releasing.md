# Release guide

Version `0.1.1` is distributed as a GitHub preview at `MAlshehri/opencode-splash`, installable through `github:MAlshehri/opencode-splash#v0.1.1`. It is not published on npm. The package name was absent from npm when checked on 2026-10-09; that is not a reservation.

1. Confirm the intended version and distribution channel. For npm, authenticate an account and confirm publishing rights/name availability. Package metadata points to the public GitHub repository.
2. Run `npm ci`, `npm test`, `npm run check` and `npm run test:opencode` on supported hardware. The CI workflow covers portable fake-server tests; it does not validate real Apple GPU/ANE inference.
3. Complete real acceptance: cold startup from the installed cache; correct provider/model selection; reasoning and a real tool call; two terminals sharing one server; interrupt/unload during warmup; memory release after the configured idle interval and successful restore. Record actual OpenCode/Splash versions and hardware. Avoid stopping somebody else's live server to perform acceptance.
4. Run `npm pack --dry-run` and inspect the actual tarball. It must contain compiled entrypoints, declarations, license and user documentation, and no model files, logs, private paths, credentials or test fixtures.
5. Update `CHANGELOG.md` and version metadata, rebuild and commit `dist/`, rerun the relevant checks, and tag the reviewed candidate. OpenCode disables installation lifecycle scripts, so GitHub releases must include their compiled files in the tagged commit. Use an exact plugin version/tag in the installation example.
   Keep npm's Git preparation trigger scripts absent from the manifest (`build`, `prepare`, `prepack`, `preinstall`, `install`, `postinstall`); use `compile` for development. Run `npm run test:install -- github:MAlshehri/opencode-splash#<commit>` to verify the published candidate without inference before creating its release tag.
6. Publish the GitHub repository/release and npm package under the chosen account. For a prerelease, use an appropriate version and npm dist-tag; use `latest` only after real acceptance. Prefer npm trusted publishing once configured. The repository intentionally includes no automatic publish-on-push workflow.
7. Verify installation from the published package in a clean OpenCode config. Check that its provider and plugin are registered without starting a model server; run inference acceptance separately. Update the README's preview notice only after real acceptance.

The model and Splash are installed separately under their upstream licenses. Do not bundle runtime binaries, model weights or personal cache mappings into this package.
