import type { Command } from "./registry";

export const modelCommand: Command = {
  name: "model",
  aliases: [],
  description: "Set the LLM model for the current persona",
  usage: "/model <provider:model> - e.g., /model openai:gpt-4o",
  execute: async (args, ctx) => {
    const personaName = ctx.ei.activePersona();
    if (!personaName) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    if (args.length === 0) {
      ctx.showNotification("Usage: /model <provider:model> (e.g., openai:gpt-4o)", "info");
      return;
    }

    const modelSpec = args[0];
    if (!modelSpec.includes(":")) {
      ctx.showNotification("Invalid model format. Use provider:model (e.g., openai:gpt-4o)", "error");
      return;
    }

    await ctx.ei.updatePersona(personaName, { model: modelSpec });
    ctx.showNotification(`Model set to ${modelSpec}`, "info");
  },
};
