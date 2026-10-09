import { createConnection } from "node:net";
import { apiKey } from "./options.js";
export class SplashError extends Error {
    code;
    constructor(code, message) {
        super(`[opencode-splash] ${message}`);
        this.code = code;
        this.name = "SplashError";
    }
}
export const baseURL = (options) => `http://127.0.0.1:${options.port}`;
async function listening(port, signal, timeout) {
    return new Promise((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        const finish = (error, result) => {
            socket.removeAllListeners();
            socket.destroy();
            signal.removeEventListener("abort", abort);
            if (error)
                reject(error);
            else
                resolve(result ?? false);
        };
        const abort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
        socket.once("connect", () => finish(undefined, true));
        socket.once("error", (error) => {
            if (error.code === "ECONNREFUSED")
                finish(undefined, false);
            else
                finish(error);
        });
        socket.setTimeout(timeout, () => finish(new SplashError("UNRESPONSIVE", `Port ${port} is unresponsive; no replacement server was started.`)));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted)
            abort();
    });
}
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
async function get(options, path, signal, timeout, authenticated) {
    const headers = {};
    if (authenticated) {
        const key = apiKey(options);
        if (key)
            headers.authorization = `Bearer ${key}`;
    }
    let response;
    try {
        response = await fetch(`${baseURL(options)}${path}`, {
            headers, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
        });
    }
    catch {
        signal.throwIfAborted();
        throw new SplashError("UNRESPONSIVE", `A listener on port ${options.port} did not answer ${path}; no replacement server was started.`);
    }
    if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new SplashError("AUTH", `Splash rejected authentication on port ${options.port}. Check apiKeyEnv and the running server's API key.`);
    }
    let value;
    try {
        value = await response.json();
    }
    catch {
        throw new SplashError("PORT_CONFLICT", `Port ${options.port} did not return Splash JSON for ${path}. Choose another port or stop that service yourself.`);
    }
    return { status: response.status, value: record(value) };
}
/** Never equate an open port or a generic OpenAI /models response with Splash. */
export async function probe(options, signal, timeout = 1500) {
    signal.throwIfAborted();
    apiKey(options);
    if (!(await listening(options.port, signal, timeout)))
        return { state: "absent" };
    const health = await get(options, "/health", signal, timeout, false);
    if (health.status !== 200 || health.value.status !== "ok") {
        throw new SplashError("PORT_CONFLICT", `Port ${options.port} is occupied by a service that is not Splash.`);
    }
    const status = await get(options, "/status", signal, timeout, true);
    const instance = record(status.value.instance);
    if (status.status !== 200 || typeof instance.id !== "string" || typeof instance.pid !== "number" || typeof instance.model !== "string") {
        throw new SplashError("PORT_CONFLICT", `Port ${options.port} has no Splash instance identity. Splash 1.3.0 or newer is required.`);
    }
    if (instance.model !== options.model) {
        throw new SplashError("MODEL_CONFLICT", `Splash on port ${options.port} is serving '${instance.model}', but this provider needs '${options.model}'. Use a separate port or stop it yourself.`);
    }
    const ready = await get(options, "/ready", signal, timeout, false);
    if (ready.status === 503 && ready.value.status === "unavailable")
        return { state: "warming" };
    if (ready.status !== 200 || ready.value.status !== "ready" || status.value.ready !== true) {
        throw new SplashError("UNRESPONSIVE", `Splash on port ${options.port} returned an unexpected readiness response.`);
    }
    const models = await get(options, "/v1/models", signal, timeout, true);
    const model = Array.isArray(models.value.data)
        ? models.value.data.map(record).find((item) => item.id === options.model && item.owned_by === "splash") : undefined;
    if (models.status !== 200 || !model) {
        throw new SplashError("MODEL_CONFLICT", `Splash's model catalog on port ${options.port} does not advertise '${options.model}'.`);
    }
    if (typeof status.value.maximum_context_tokens !== "number" || status.value.maximum_context_tokens < options.maxContext) {
        throw new SplashError("CONTEXT_CONFLICT", `The running Splash server has a smaller context limit than maxContext=${options.maxContext}. Lower the plugin limit or restart Splash yourself with a larger limit.`);
    }
    return { state: "ready", pid: instance.pid, instanceID: instance.id };
}
//# sourceMappingURL=probe.js.map