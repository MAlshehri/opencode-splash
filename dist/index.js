import { Model, Plugin, Provider } from "@opencode/plugin";
import { SplashManager } from "./manager.js";
import { apiKey, resolveOptions } from "./options.js";
import { baseURL, SplashError } from "./probe.js";
export default Plugin.define({
    id: "opencode-splash",
    async setup(ctx) {
        const options = resolveOptions(ctx.options);
        const manager = new SplashManager(options);
        const endpoint = `${baseURL(options)}/v1`;
        if (options.registerProvider) {
            const providerID = Provider.ID.make(options.providerID);
            const id = Model.ID.make(options.model);
            const model = {
                ...Model.Info.default(providerID, id),
                name: options.name,
                capabilities: { tools: true, input: options.vision ? ["text", "image", "pdf"] : ["text"], output: ["text"] },
                compatibility: { reasoningField: "reasoning_content" },
                limit: { context: options.maxContext, input: options.maxContext - options.maxOutputTokens, output: options.maxOutputTokens },
                ...(options.reasoningEffort ? {
                    body: { reasoning_effort: options.reasoningEffort },
                    variants: ["none", "minimal", "low", "medium", "high", "xhigh", "max"].map((effort) => ({ id: Model.VariantID.make(effort), body: { reasoning_effort: effort } })),
                } : {}),
            };
            await ctx.provider.transform((editor) => {
                // Deliberately preserve a provider already defined in the user's config.
                if (!editor.get(options.providerID)) {
                    editor.add({
                        info: { ...Provider.Info.empty(providerID), name: "Splash (local)", activation: "enabled",
                            package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: endpoint } },
                        models: [model],
                    });
                }
            });
        }
        await ctx.model.transform((editor) => {
            const configured = editor.get(options.providerID, options.model);
            if (!configured)
                return;
            // Existing metadata may promise more context/output than this managed server.
            // Clamp runtime budgets; never rewrite the user's files or inflate a limit.
            editor.update(options.providerID, options.model, (model) => {
                const context = Math.min(model.limit.context, options.maxContext);
                const output = Math.min(model.limit.output, options.maxOutputTokens, context - 1);
                model.limit = { context, output, input: Math.min(model.limit.input ?? context - output, context - output) };
            });
        });
        await ctx.session.hook("model.request", async (event) => {
            // A fixed endpoint never swaps a different selected model behind the user's back.
            if (event.model.id !== options.model) {
                throw new SplashError("MODEL_SELECTION", `Provider '${options.providerID}' manages '${options.model}', but '${event.model.id}' was selected. Use another provider and port for that model.`);
            }
            if (event.baseURL && event.baseURL.replace(/\/$/, "") !== endpoint) {
                throw new SplashError("ENDPOINT_CONFLICT", `Provider '${options.providerID}' must use ${endpoint}. Correct its baseURL or choose another providerID.`);
            }
            await manager.ensureReady();
            event.baseURL = endpoint;
            const key = apiKey(options);
            if (key)
                event.headers.authorization = `Bearer ${key}`;
        }, { providerID: options.providerID });
        return () => manager.close();
    },
});
//# sourceMappingURL=index.js.map