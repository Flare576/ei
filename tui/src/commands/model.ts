import type { Command } from "./registry";

export const modelCommand: Command = {
  name: "model",
  aliases: [],
  description: "Set the LLM model for the current persona",
  usage: "/model <model> or /model <provider:model>",
  execute: async (args, ctx) => {
    const personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    if (args.length === 0) {
      ctx.showNotification("Usage: /model <model> (e.g., sonnet-latest or openai:gpt-4o)", "info");
      return;
    }

    const modelSpec = args[0];

    if (modelSpec.includes(":")) {
      // Explicit provider:model — use as-is
      await ctx.ei.updatePersona(personaId, { model: modelSpec });
      ctx.showNotification(`Model set to ${modelSpec}`, "info");
      return;
    }

    // No provider specified — infer from persona's current model
    const persona = await ctx.ei.getPersona(personaId);
    const currentModel = persona?.model;

    if (currentModel) {
      const provider = currentModel.includes(":")
        ? currentModel.split(":")[0]
        : currentModel;
      const newModel = `${provider}:${modelSpec}`;
      await ctx.ei.updatePersona(personaId, { model: newModel });
      ctx.showNotification(`Model set to ${newModel}`, "info");
    } else {
      ctx.showNotification(
        "No provider set. Use /provider first, or specify provider:model (e.g., openai:gpt-4o)",
        "error"
      );
    }
  },
};
