# opencode-splash

Start Splash when OpenCode needs your local model. Reuse the server across requests, sessions and terminals.

**Preview release:** install from [GitHub](https://github.com/MAlshehri/opencode-splash/releases/tag/v0.1.0). This release targets OpenCode V2 and is not available on npm yet. See the [validation record](docs/validation.md) for completed checks and remaining real-model acceptance scenarios.

Requires OpenCode **V2 2.0.26 or newer**, Splash **1.3.0 or newer**, and macOS on Apple Silicon for automatic startup. Model compatibility and hardware requirements come from Splash. This is an independent plugin, not an official OpenCode or Splash integration.

## How it works

The plugin registers a local provider without loading the model. Before a request to that provider, it checks Splash's instance identity, loaded model, readiness and model catalog. If the endpoint is free, it starts `splash serve` and waits for readiness. The hook covers normal inference, tool continuations, titles, compaction and transient generation.

Concurrent requests share startup. Separate processes coordinate through a lock keyed by the loopback port, while Splash's own per-port lock provides another safeguard. An existing compatible Splash server is reused; a different model or another service produces an actionable error.

The server stays running after OpenCode closes. Splash's default ten-minute idle release frees model weights; the next inference request restores them. The plugin does not generate keepalive requests. OpenCode's optional `warming` feature can keep the model active if you enable it. [Splash server configuration](https://github.com/incoai/splash/blob/main/DEVELOPMENT.md#server-configuration)

## Prepare Splash once

Install Splash using its [official installation instructions](https://github.com/incoai/splash), then install and verify your chosen model using Splash before enabling the plugin. A first manual start also verifies that the model fits in memory:

```sh
splash serve --model incoai/Qwen3.8-27B-Splash --max-context 65536
```

After `Ready`, stop that manual server with Ctrl+C or leave it running for the plugin to reuse.

The plugin defaults to `offline: true`: it uses Splash's existing installation and cache. An LM Studio download alone is not necessarily registered in Splash's cache; follow Splash's supported model preparation workflow first. This plugin does not move, duplicate or convert model files. Set `offline: false` explicitly if you want Splash to contact Hugging Face and prepare missing artifacts during startup; allow a longer startup timeout for large downloads.

## Configure

Add this entry to your global `~/.config/opencode/opencode.json(c)` or a project's `opencode.json(c)`. Merge it with existing settings. OpenCode installs the tagged GitHub package and its dependencies automatically; the repository includes compiled entrypoints, so installation needs no build script.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:MAlshehri/opencode-splash#v0.1.0",
      "options": {
        "model": "incoai/Qwen3.8-27B-Splash",
        "maxContext": 65536,
        "maxOutputTokens": 16384,
        "vision": true,
        "reasoningEffort": "medium"
      }
    }
  ]
}
```

Choose **Qwen3.8-27B-Splash (Splash)** in OpenCode's model picker, or run:

```sh
opencode run --model splash/incoai/Qwen3.8-27B-Splash "Explain this project"
```

Your current default model is preserved. Only requests to the configured Splash provider invoke this hook. Provider registration uses OpenCode's native OpenAI-compatible transport. [OpenCode plugin configuration](https://opencode.ai/v2/docs/plugins), [request hooks](https://opencode.ai/v2/docs/build/plugins#model-request)

For a local checkout, build it first and replace the package name with the checkout's **absolute directory path**:

```sh
npm ci
npm run build
```

```json
{
  "plugins": [
    {
      "package": "/absolute/path/opencode-splash",
      "options": {
        "model": "incoai/Qwen3.8-27B-Splash",
        "maxContext": 65536,
        "maxOutputTokens": 16384,
        "maxMemory": "24G",
        "vision": true,
        "reasoningEffort": "medium"
      }
    }
  ]
}
```

`24G` is an example budget for a suitable machine, not a universal recommendation. Omit `maxMemory` to use Splash's automatic budget. Splash may reduce usable context to fit the model and memory; the plugin rejects a server whose effective context is smaller than the configured limit.

If you already configure a `splash` provider, the plugin preserves that definition. Its base URL must be `http://127.0.0.1:8000/v1`, its model ID must match `options.model`, and its transport must be `@opencode/ai/providers/openai-compatible`. The selected model's runtime context/output budgets are capped by the plugin options, so an old definition cannot advertise more than the managed server supports. User config files are not rewritten. Use `registerProvider: false` when you want to manage provider metadata yourself.

OpenCode runs the plugin in its **server process**. If you connect a CLI to another machine, the executable, model cache, environment and loopback endpoint are on that server machine.

## Options

Unknown options and invalid values fail during plugin setup.

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | Required | Splash selection: `OWNER/REPO` or `OWNER/REPO:VARIANT`. One fixed model per provider. |
| `providerID` | `splash` | Provider receiving the hook. |
| `name` | Repository name + `(Splash)` | Name shown for the generated model. |
| `port` | `8000` | Loopback port, 1024–65535. |
| `executable` | `splash` on `PATH` | Command name or absolute executable path, including paths with spaces. |
| `maxContext` | `32768` | Advertised context tokens and Splash startup limit. |
| `maxOutputTokens` | `4096`, reduced for small contexts | Output budget; input budget reserves this amount from context. |
| `maxMemory` | Splash automatic budget | Positive byte count or integer with `K`, `M` or `G`, for example `24G`. |
| `idleRelease` | `10m` | Splash idle weight release: `30s`, `10m`, `1h` or `off`. |
| `startupTimeoutMs` | `300000` | Deadline for coordination, startup and readiness; 1000–3600000 ms. |
| `offline` | `true` | Start using installed artifacts without contacting Hugging Face. |
| `vision` | `false` | Advertise image/PDF input for a model that supports it. Does not change model preparation. |
| `reasoningEffort` | Omitted | Optional `reasoning_effort` body field and matching variants; enable only for compatible model templates. |
| `apiKeyEnv` | Omitted | Environment variable holding the Splash API key in the OpenCode server process. |
| `stateDirectory` | OS user cache directory + `opencode-splash` | Absolute path on a local filesystem; all terminals using the same port must share it. |
| `registerProvider` | `true` | Add provider/model metadata if that provider is absent. |

Model variants change reasoning effort, not the loaded weights. Switching to another model requires another provider/port configuration or a deliberate manual server restart; the plugin never swaps a busy model automatically. Version 0.1 supports one configured plugin entry.

## Optional authentication

Set `apiKeyEnv` to a variable name such as `LOCAL_SPLASH_KEY`, and make its value available to the **OpenCode server** when it starts. The plugin uses it for protected readiness/identity probes, inference headers and the child's `SPLASH_API_KEY` environment. It never places the value in command arguments or its state files.

If an existing Splash server requires a key, configure the same key. If `apiKeyEnv` is omitted, the plugin launches Splash without a key on `127.0.0.1`. Child environments include a small allowlist of OS/cache settings; unrelated cloud provider keys are not inherited. `HF_TOKEN` is inherited only when downloads are explicitly enabled.

## Logs and troubleshooting

On macOS, startup/server output is written to:

```text
~/Library/Caches/opencode-splash/127.0.0.1-8000.log
```

The state directory is created with mode `0700` and log files with `0600`. A log at least 5 MiB is rotated to `.log.1` before the next startup. Logs can grow while a server remains running; normal requests do not rotate another process's open log.

| Error | Action |
| --- | --- |
| Executable not found | Install Splash or set `executable` to its absolute path; the background service may have a different `PATH`. |
| Model unavailable offline / process exited | Start that model manually with Splash to prepare and verify its artifacts, then retry. |
| Startup timeout | Inspect the log; raise `startupTimeoutMs` for a long initial warmup or an explicitly enabled download. |
| Port or model conflict | Pick a free port or deliberately stop the existing service. The plugin does not kill it or choose a random replacement port. |
| Context conflict | Lower `maxContext`, or manually restart Splash with sufficient context/memory. |
| Authentication failure | Check `apiKeyEnv` in the OpenCode server and the running Splash server's key. |
| Recent failure cooldown | Wait up to ten seconds after a failed startup before retrying. A newly ready external server is reused immediately. |

A failed readiness hook fails the local request with an error. There is no automatic cloud fallback. Removing the plugin or closing OpenCode leaves a ready Splash server running; stop it through the mechanism that launched it after confirming it has no users. The plugin does not trust a persisted PID file as permission to kill a process.

OpenCode 2.0.26's request hook does not expose a cancellation signal. Interrupting a prompt can therefore leave an already-admitted startup running until readiness or the bounded deadline; plugin unload cancels its pending wait and cleans up only a process it started that is still unready. Startup waiting itself sends no inference traffic.

## Development

```sh
npm ci
npm test
npm run check
npm run test:opencode
npm pack --dry-run
```

The test suite uses lightweight fake servers and covers concurrency within and across processes, external server ownership, crash recovery, authentication, startup failures/deadlines, stale locks and log rotation. `test:opencode` is an opt-in smoke with an installed OpenCode on Apple Silicon; it uses private config/data directories, a random port and a fake Splash executable. It does not load real model weights or alter your normal OpenCode configuration.

To explicitly test reuse of an **already-ready, unauthenticated** real server without stopping it:

```sh
SPLASH_SMOKE_EXISTING_MODEL=incoai/Qwen3.8-27B-Splash npm run test:opencode
```

The test verifies that the original server instance survives and no new process is launched. It sends one real inference request. Use `SPLASH_SMOKE_PORT` for a port other than 8000. The SDK is an optional peer supplied by OpenCode's host; production installation needs only the lock utility and its small dependency tree.

Real model acceptance is separate: a manual cold start on supported hardware, a tool call, idle weight release and restore, and a live request through the plugin are required before a stable release. See [architecture](docs/architecture.md), [release guide](docs/releasing.md) and [contributing](CONTRIBUTING.md).

MIT licensed. OpenCode, Splash and model artifacts retain their own licenses; this package contains no model weights or Splash binaries.
