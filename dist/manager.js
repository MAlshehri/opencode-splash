import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { apiKey, serveArguments } from "./options.js";
import { probe, SplashError } from "./probe.js";
const LOCK_STALE_MS = 15000;
const FAILURE_COOLDOWN_MS = 10000;
const POLL_MS = 250;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
export class SplashManager {
    options;
    runtime;
    logPath;
    lockPath;
    failurePath;
    lifetime = new AbortController();
    flight;
    constructor(options, runtime = { platform: process.platform, arch: process.arch, spawn }) {
        this.options = options;
        this.runtime = runtime;
        const prefix = join(options.stateDirectory, `127.0.0.1-${options.port}`);
        this.lockPath = `${prefix}.startup`;
        this.logPath = `${prefix}.log`;
        this.failurePath = `${prefix}.failure.json`;
    }
    /** Concurrent requests in this instance share exactly one readiness operation. */
    ensureReady() {
        if (!this.flight) {
            this.flight = this.ensure().finally(() => { this.flight = undefined; });
        }
        return this.flight;
    }
    /** Unload cancels pending startup, but never stops an already-ready shared server. */
    async close() {
        this.lifetime.abort(new SplashError("UNLOADED", "Plugin unloaded while waiting for Splash."));
        await this.flight?.catch(() => undefined);
    }
    async ensure() {
        const deadline = Date.now() + this.options.startupTimeoutMs;
        const timeout = AbortSignal.timeout(this.options.startupTimeoutMs);
        const signal = AbortSignal.any([this.lifetime.signal, timeout]);
        try {
            let current = await this.inspect(signal, deadline);
            if (current.state === "ready")
                return;
            await mkdir(this.options.stateDirectory, { recursive: true, mode: 0o700 });
            // The endpoint, rather than the project or model name, is the lock key.
            while (true) {
                signal.throwIfAborted();
                let compromised;
                let release;
                try {
                    release = await lockfile.lock(this.lockPath, {
                        realpath: false, stale: LOCK_STALE_MS, update: 2000, retries: 0,
                        onCompromised: (error) => { compromised = error; },
                    });
                }
                catch (error) {
                    if (error.code !== "ELOCKED")
                        throw error;
                    await delay(POLL_MS, undefined, { signal });
                    current = await this.inspect(signal, deadline);
                    if (current.state === "ready")
                        return;
                    continue;
                }
                try {
                    // Another terminal may have completed startup while we acquired the lock.
                    current = await this.inspect(signal, deadline);
                    if (current.state === "ready")
                        return;
                    await this.checkCooldown();
                    await this.startOrWait(current, signal, deadline, () => {
                        if (compromised)
                            throw new SplashError("LOCK_LOST", "Startup coordination was lost. Retry after checking the Splash log.");
                    });
                    await rm(this.failurePath, { force: true });
                    return;
                }
                finally {
                    await release().catch(() => undefined);
                }
            }
        }
        catch (error) {
            if (this.lifetime.signal.aborted)
                throw this.lifetime.signal.reason;
            if (timeout.aborted && !this.lifetime.signal.aborted) {
                throw new SplashError("STARTUP_TIMEOUT", `Splash was not ready within ${this.options.startupTimeoutMs / 1000}s. Check ${this.logPath}; increase startupTimeoutMs if this model needs a longer warmup.`);
            }
            throw error;
        }
    }
    inspect(signal, deadline) {
        return probe(this.options, signal, Math.max(1, Math.min(1500, deadline - Date.now())));
    }
    async checkCooldown() {
        let last;
        try {
            last = JSON.parse(await readFile(this.failurePath, "utf8"));
        }
        catch {
            return;
        }
        const time = last?.time;
        if (typeof time === "number" && Date.now() - time < FAILURE_COOLDOWN_MS) {
            throw new SplashError("COOLDOWN", `A recent Splash startup failed. Retry in ${Math.ceil((FAILURE_COOLDOWN_MS - (Date.now() - time)) / 1000)}s. Check ${this.logPath}.`);
        }
    }
    async startOrWait(initial, signal, deadline, checkLock) {
        let child;
        let launchError;
        let ready = false;
        try {
            if (initial.state === "absent") {
                if (this.runtime.platform !== "darwin" || this.runtime.arch !== "arm64") {
                    throw new SplashError("PLATFORM", "Starting Splash requires macOS on Apple Silicon. An already-running compatible server can still be reused.");
                }
                checkLock();
                try {
                    const info = await stat(this.logPath);
                    if (info.size >= MAX_LOG_BYTES)
                        await rename(this.logPath, `${this.logPath}.1`);
                }
                catch (error) {
                    if (error.code !== "ENOENT")
                        throw error;
                }
                const log = await open(this.logPath, "a", 0o600);
                try {
                    const env = this.childEnvironment();
                    child = this.runtime.spawn(this.options.executable, serveArguments(this.options), {
                        cwd: this.options.stateDirectory, env, detached: true, shell: false,
                        stdio: ["ignore", log.fd, log.fd],
                    });
                    child.on("error", (error) => { launchError = error; });
                    child.unref();
                }
                finally {
                    await log.close();
                }
            }
            while (true) {
                signal.throwIfAborted();
                checkLock();
                if (launchError) {
                    const hint = launchError.code === "ENOENT" ? "Install Splash or set executable to its absolute path." : "Check the executable and filesystem permissions.";
                    throw new SplashError("SPAWN_FAILED", `Could not launch Splash (${launchError.code ?? "spawn error"}). ${hint} Log: ${this.logPath}`);
                }
                const current = await this.inspect(signal, deadline);
                if (current.state === "ready") {
                    ready = true;
                    return;
                }
                if (child && (child.exitCode !== null || child.signalCode !== null) && current.state === "absent") {
                    throw new SplashError("PROCESS_EXIT", `Splash exited before becoming ready (exit ${child.exitCode ?? child.signalCode}). Ensure '${this.options.model}' is installed${this.options.offline ? " for offline use" : ""}. Check ${this.logPath}.`);
                }
                await delay(POLL_MS, undefined, { signal });
            }
        }
        catch (error) {
            // An external warming server is never owned or stopped by this plugin.
            if (child && !ready) {
                // An unload/timeout can race with readiness observed by another terminal.
                // Preserve the now-ready server in that case; it has become shared.
                const becameReady = signal.aborted && await probe(this.options, AbortSignal.timeout(500), 500)
                    .then((result) => result.state === "ready", () => false);
                if (!becameReady)
                    await this.stopOwned(child);
            }
            if (!this.lifetime.signal.aborted) {
                await writeFile(this.failurePath, JSON.stringify({ time: Date.now() }), { mode: 0o600 }).catch(() => undefined);
            }
            throw error;
        }
    }
    childEnvironment() {
        const environment = {};
        // Do not leak unrelated provider credentials into a long-lived model server.
        for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "HF_HOME", "HF_HUB_CACHE", "XDG_CACHE_HOME"]) {
            if (process.env[key] !== undefined)
                environment[key] = process.env[key];
        }
        if (!this.options.offline && process.env.HF_TOKEN)
            environment.HF_TOKEN = process.env.HF_TOKEN;
        const key = apiKey(this.options);
        if (key)
            environment.SPLASH_API_KEY = key;
        if (this.options.offline)
            environment.HF_HUB_OFFLINE = "1";
        return environment;
    }
    async stopOwned(child) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
            return;
        const terminate = (signal) => {
            try {
                process.kill(-child.pid, signal);
            }
            catch (error) {
                if (error.code !== "ESRCH")
                    throw error;
            }
        };
        terminate("SIGTERM");
        const until = Date.now() + 3000;
        while (child.exitCode === null && child.signalCode === null && Date.now() < until)
            await delay(50);
        if (child.exitCode === null && child.signalCode === null)
            terminate("SIGKILL");
    }
}
//# sourceMappingURL=manager.js.map