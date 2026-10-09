# Candidate validation

Recorded on 2026-10-09. These results describe this local candidate, not a published package or universal hardware benchmark.

| Check | Result |
| --- | --- |
| TypeScript strict build/type check | Passed |
| Lifecycle tests | 17 passed |
| In-process concurrency | Twenty callers shared one launch |
| Cross-process coordination | Six independent Node processes shared one launch |
| Real OpenCode V2, fake cold server | Model catalog did not start the server; first request launched once, waited for readiness, returned `HOOK_OK` |
| Real OpenCode V2, existing Qwen Splash server | Returned `HOOK_OK`; original instance/PID preserved; zero new launches |
| Public artifact path/secret check | No personal home paths, keys, model artifacts or test fixtures in shipped code/docs |
| Packaged distribution | Clean tarball installation added five packages, with no SDK installed; native OpenCode supplied its SDK and the cold-start smoke passed |

Environment: OpenCode 2.0.26, Splash 1.3.0, Node 24.21.0, macOS 27.0.1, Apple M3 Max with 36 GiB unified memory. Real model: `incoai/Qwen3.8-27B-Splash`, existing server context 65536, configured memory budget 24 GiB.

The real model was already loaded before the smoke. The native cold-start check used a fake process to exercise lifecycle without restarting the user's real server. A plugin-driven **real cold start**, a real tool round trip, and idle weight release/restore remain explicit stable-release acceptance items. Existing server preservation was verified live; these remaining scenarios are not claimed as completed.
