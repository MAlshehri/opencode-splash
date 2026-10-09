import { spawn } from "node:child_process";
import { type ResolvedOptions } from "./options.js";
/** Dependency injection is internal; production always uses the native process API. */
export interface Runtime {
    platform: NodeJS.Platform;
    arch: string;
    spawn: typeof spawn;
}
export declare class SplashManager {
    readonly options: ResolvedOptions;
    private readonly runtime;
    readonly logPath: string;
    private readonly lockPath;
    private readonly failurePath;
    private readonly lifetime;
    private flight;
    constructor(options: ResolvedOptions, runtime?: Runtime);
    /** Concurrent requests in this instance share exactly one readiness operation. */
    ensureReady(): Promise<void>;
    /** Unload cancels pending startup, but never stops an already-ready shared server. */
    close(): Promise<void>;
    private ensure;
    private inspect;
    private checkCooldown;
    private startOrWait;
    private childEnvironment;
    private stopOwned;
}
