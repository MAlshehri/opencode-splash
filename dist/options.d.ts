/** One provider manages one fixed model on one loopback endpoint. */
export interface SplashOptions {
    model: string;
    providerID?: string;
    name?: string;
    port?: number;
    executable?: string;
    maxMemory?: string;
    maxContext?: number;
    maxOutputTokens?: number;
    idleRelease?: string;
    startupTimeoutMs?: number;
    offline?: boolean;
    vision?: boolean;
    reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    apiKeyEnv?: string;
    stateDirectory?: string;
    /** false attaches the hook to a provider configured separately by the user. */
    registerProvider?: boolean;
}
export interface ResolvedOptions {
    model: string;
    providerID: string;
    name: string;
    port: number;
    executable: string;
    maxMemory?: string;
    maxContext: number;
    maxOutputTokens: number;
    idleRelease: string;
    startupTimeoutMs: number;
    offline: boolean;
    vision: boolean;
    reasoningEffort?: NonNullable<SplashOptions["reasoningEffort"]>;
    apiKeyEnv?: string;
    stateDirectory: string;
    registerProvider: boolean;
}
export declare function resolveOptions(value: unknown): ResolvedOptions;
export declare function apiKey(options: ResolvedOptions): string | undefined;
export declare function serveArguments(options: ResolvedOptions): string[];
