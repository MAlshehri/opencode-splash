import { type ResolvedOptions } from "./options.js";
export declare class SplashError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export type Probe = {
    state: "absent";
} | {
    state: "warming";
} | {
    state: "ready";
    pid: number;
    instanceID: string;
};
export declare const baseURL: (options: ResolvedOptions) => string;
/** Never equate an open port or a generic OpenAI /models response with Splash. */
export declare function probe(options: ResolvedOptions, signal: AbortSignal, timeout?: number): Promise<Probe>;
