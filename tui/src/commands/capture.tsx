import type { Command } from "./registry";

export const captureCommand: Command = {
  name: "capture",
  aliases: [],
  description: "Trigger extraction on current chat",
  usage: "/capture | /capture opencode | /capture person <name> | /capture topic <name>",

  async execute(args, ctx) {
    if (args.length === 0) {
      if (ctx.ei.activeRoomId()) {
        ctx.ei.captureRoom();
        ctx.showNotification("Extraction queued for room", "info");
      } else {
        ctx.ei.capturePersona();
        ctx.showNotification("Extraction queued", "info");
      }
      return;
    }

    const subcommand = args[0].toLowerCase();

    if (subcommand === "person" || subcommand === "people") {
      const searchTerm = args.slice(1).join(" ").trim();
      if (!searchTerm) {
        ctx.showNotification("Usage: /capture person <name>", "error");
        return;
      }
      const human = await ctx.ei.getHuman();
      const matches = (human.people ?? []).filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      if (matches.length === 0) {
        ctx.showNotification(`No person matching "${searchTerm}" found`, "warn");
        return;
      }
      if (matches.length > 1) {
        const names = matches.map(p => p.name).join(", ");
        ctx.showNotification(`Multiple matches: ${names} — be more specific`, "warn");
        return;
      }
      const person = matches[0];
      const queued = ctx.ei.captureTargetedPerson(person.id);
      if (queued === 0) {
        ctx.showNotification(`No messages to scan for "${person.name}"`, "warn");
      } else {
        ctx.showNotification(`Re-scan queued for "${person.name}" (${queued} chunk${queued !== 1 ? "s" : ""})`, "info");
      }
      return;
    }

    if (subcommand === "topic") {
      const searchTerm = args.slice(1).join(" ").trim();
      if (!searchTerm) {
        ctx.showNotification("Usage: /capture topic <name>", "error");
        return;
      }
      const human = await ctx.ei.getHuman();
      const matches = (human.topics ?? []).filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      if (matches.length === 0) {
        ctx.showNotification(`No topic matching "${searchTerm}" found`, "warn");
        return;
      }
      if (matches.length > 1) {
        const names = matches.map(t => t.name).join(", ");
        ctx.showNotification(`Multiple matches: ${names} — be more specific`, "warn");
        return;
      }
      const topic = matches[0];
      const queued = ctx.ei.captureTargetedTopic(topic.id);
      if (queued === 0) {
        ctx.showNotification(`No messages to scan for "${topic.name}"`, "warn");
      } else {
        ctx.showNotification(`Re-scan queued for "${topic.name}" (${queued} chunk${queued !== 1 ? "s" : ""})`, "info");
      }
      return;
    }

    const integrationMap: Record<string, "opencode" | "claudeCode" | "cursor"> = {
      opencode: "opencode",
      claudecode: "claudeCode",
      cursor: "cursor",
    };
    const integrationKey = integrationMap[subcommand];
    if (integrationKey) {
      const human = await ctx.ei.getHuman();
      const intSettings = human.settings?.[integrationKey];
      if (!intSettings?.integration) {
        ctx.showNotification(`${args[0]} integration not enabled. Enable in /settings.`, "warn");
        return;
      }
      await ctx.ei.updateHuman({
        settings: {
          ...human.settings,
          [integrationKey]: {
            ...intSettings,
            last_sync: new Date(0).toISOString(),
          },
        },
      });
      ctx.showNotification(`${args[0]} scan will start on next cycle`, "info");
      return;
    }

    ctx.showNotification("Usage: /capture | /capture person <name> | /capture topic <name> | /capture opencode|claudecode|cursor", "warn");
  },
};
