import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
const allowed = new Set([
    "model", "providerID", "name", "port", "executable", "maxMemory", "maxContext",
    "maxOutputTokens", "idleRelease", "startupTimeoutMs", "offline", "vision",
    "reasoningEffort", "apiKeyEnv", "stateDirectory", "registerProvider",
]);
function invalid(message) {
    throw new Error(`[opencode-splash] Invalid configuration: ${message}`);
}
export function resolveOptions(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        invalid("options must be an object");
    const obj = value;
    for (const key of Object.keys(obj))
        if (!allowed.has(key))
            invalid(`unknown option '${key}'`);
    const string = (key, fallback) => {
        const entry = obj[key] ?? fallback;
        if (typeof entry !== "string" || !entry.trim() || /[\x00-\x1f\x7f]/.test(entry)) {
            invalid(`'${key}' must be a nonempty string without control characters`);
        }
        return entry;
    };
    const integer = (key, fallback, min, max) => {
        const entry = obj[key] ?? fallback;
        if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < min || entry > max) {
            invalid(`'${key}' must be an integer between ${min} and ${max}`);
        }
        return entry;
    };
    const boolean = (key, fallback) => {
        const entry = obj[key] ?? fallback;
        if (typeof entry !== "boolean")
            invalid(`'${key}' must be a boolean`);
        return entry;
    };
    const model = string("model");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/.test(model)) {
        invalid("'model' must be OWNER/REPO or OWNER/REPO:VARIANT");
    }
    const providerID = string("providerID", "splash");
    if (!/^[a-z][a-z0-9_-]*$/.test(providerID))
        invalid("'providerID' must be a lowercase provider identifier");
    const executable = string("executable", "splash");
    if (!isAbsolute(executable) && !/^[A-Za-z0-9_.-]+$/.test(executable)) {
        invalid("'executable' must be a command name on PATH or an absolute path");
    }
    const maxContext = integer("maxContext", 32768, 1024, 2097152);
    const maxOutputTokens = integer("maxOutputTokens", Math.min(4096, Math.floor(maxContext / 4)), 1, maxContext - 1);
    const idleRelease = string("idleRelease", "10m");
    if (!/^(off|[1-9][0-9]*(?:s|m|h))$/.test(idleRelease))
        invalid("'idleRelease' must be off or a duration such as 10m");
    const cache = process.platform === "darwin"
        ? join(homedir(), "Library", "Caches")
        : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    const stateDirectory = string("stateDirectory", join(cache, "opencode-splash"));
    if (!isAbsolute(stateDirectory))
        invalid("'stateDirectory' must be an absolute local filesystem path");
    const result = {
        model, providerID, executable, maxContext, maxOutputTokens, idleRelease, stateDirectory,
        name: string("name", `${model.split("/")[1]} (Splash)`),
        port: integer("port", 8000, 1024, 65535),
        startupTimeoutMs: integer("startupTimeoutMs", 300000, 1000, 3600000),
        offline: boolean("offline", true),
        vision: boolean("vision", false),
        registerProvider: boolean("registerProvider", true),
    };
    if (obj.maxMemory !== undefined) {
        const maxMemory = string("maxMemory");
        if (!/^[1-9][0-9]*[KMG]?$/.test(maxMemory)) {
            invalid("'maxMemory' must be bytes or a size with K, M or G, such as 24G");
        }
        result.maxMemory = maxMemory;
    }
    if (obj.reasoningEffort !== undefined) {
        const effort = string("reasoningEffort");
        if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort))
            invalid("unsupported 'reasoningEffort'");
        result.reasoningEffort = effort;
    }
    if (obj.apiKeyEnv !== undefined) {
        const variable = string("apiKeyEnv");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
            invalid("'apiKeyEnv' must be an environment variable name");
        result.apiKeyEnv = variable;
    }
    return result;
}
export function apiKey(options) {
    if (!options.apiKeyEnv)
        return undefined;
    const key = process.env[options.apiKeyEnv];
    if (!key || /[\r\n]/.test(key)) {
        throw new Error(`[opencode-splash] Set ${options.apiKeyEnv} in the OpenCode server environment before using this provider.`);
    }
    return key;
}
export function serveArguments(options) {
    const args = ["serve", "--model", options.model, "--host", "127.0.0.1", "--port", String(options.port),
        "--max-context", String(options.maxContext), "--idle-release", options.idleRelease];
    if (options.offline)
        args.push("--offline");
    if (options.maxMemory)
        args.push("--max-memory", options.maxMemory);
    return args;
}
//# sourceMappingURL=options.js.map