import type { Command } from "./registry";
import { HelpOverlay } from "../components/HelpOverlay";

export const helpCommand: Command = {
  name: "help",
  aliases: ["h"],
  description: "Show help screen",
  usage: "/help or /h",
  execute: async (_args, ctx) => {
    ctx.showOverlay((hideOverlay) => <HelpOverlay onDismiss={hideOverlay} />);
  },
};
