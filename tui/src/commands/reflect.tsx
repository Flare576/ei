import { useKeyboard } from "@opentui/solid";
import { onMount, onCleanup } from "solid-js";
import * as fs from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command, CommandContext } from "./registry";
import type { PersonaEntity } from "../../../src/core/types.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";
import {
  personaPreviewToYAML,
  personaPreviewFromYAML,
} from "../util/yaml-serializers.js";
import { useKeyboardNav } from "../context/keyboard.js";

function wrapComment(text: string, width = 78): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > width) {
      lines.push(`# ${current}`);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(`# ${current}`);
  return lines.join("\n");
}

function getDataPath(): string {
  const raw = process.env.EI_DATA_PATH ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "ei");
  return raw.replace(/\/+$/, "");
}

function getReflectFolder(persona: PersonaEntity): string {
  const datePrefix = persona.pending_update!.created_at.slice(0, 10);
  const safeName = persona.display_name.replace(/\s+/g, "_");
  return join(getDataPath(), "reflect", `${datePrefix}_${safeName}`);
}

async function resolveReflectionPersona(
  args: string[],
  ctx: CommandContext
): Promise<{ personaId: string; persona: PersonaEntity } | null> {
  const SUBCOMMANDS = new Set(["generate", "update", "apply", "dismiss"]);
  const nameArgs = SUBCOMMANDS.has(args[0]?.toLowerCase() ?? "") ? args.slice(1) : args;
  const name = nameArgs.join(" ").trim();

  let personaId: string | null;
  if (name) {
    personaId = await ctx.ei.resolvePersonaName(name);
    if (!personaId) {
      ctx.showNotification(`No persona named "${name}"`, "error");
      return null;
    }
  } else {
    personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No active persona", "error");
      return null;
    }
  }

  const persona = await ctx.ei.getPersona(personaId);
  if (!persona) {
    ctx.showNotification("Could not load persona", "error");
    return null;
  }

  if (!persona.pending_update) {
    ctx.showNotification(`No pending reflection for ${persona.display_name}`, "error");
    return null;
  }

  return { personaId, persona };
}

export const reflectCommand: Command = {
  name: "reflect",
  aliases: ["rf"],
  description:
    "Review a persona's pending reflection — compare current vs proposed identity while chatting",
  usage: "/reflect [generate|update|apply|dismiss]",

  async execute(args, ctx) {
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || !["generate", "update", "apply", "dismiss"].includes(subcommand)) {
      const activeId = ctx.ei.activePersonaId();
      const activePersona = activeId ? ctx.ei.personas().find(p => p.id === activeId) : null;
      const hasPending = activePersona?.has_pending_update ?? false;
      const pendingPersonas = hasPending
        ? []
        : ctx.ei.personas().filter(p => p.has_pending_update);

      if (!hasPending && pendingPersonas.length === 0) {
        ctx.showNotification("No pending reflections.", "info");
        return;
      }

      const headerName = hasPending ? activePersona!.display_name : undefined;
      const pendingNames = pendingPersonas.map(p => p.display_name);
      const dataPath = getDataPath();

      ctx.showOverlay((hideOverlay, _hideForEditor) => {
        const { setOverlayActive } = useKeyboardNav();
        onMount(() => setOverlayActive(true));
        onCleanup(() => setOverlayActive(false));
        useKeyboard((event) => {
          event.preventDefault();
          hideOverlay();
        });

        const header = headerName
          ? `✦ Persona Reflection: ${headerName}`
          : `✦ Persona Reflection — pending: ${pendingNames.join(", ")}`;

        return (
          <box
            position="absolute"
            width="100%"
            height="100%"
            left={0}
            top={0}
            backgroundColor="#000000"
            alignItems="center"
            justifyContent="center"
          >
            <box
              width={64}
              backgroundColor="#1a1a2e"
              borderStyle="single"
              borderColor="#586e75"
              padding={2}
              flexDirection="column"
            >
              <text fg="#eee8d5">{header}</text>
              <text> </text>
              <text fg="#839496">{"Personas grow through conversation. Reflection is a chance"}</text>
              <text fg="#839496">{"to review proposed changes to their Identity with them."}</text>
              <text fg="#839496">{"Open the generated files in your editor while you chat."}</text>
              <text> </text>
              <text fg="#268bd2">{"  /reflect generate   Write current + proposed YAML files"}</text>
              <text fg="#268bd2">{"  /reflect update     Read proposed.yaml back into Ei"}</text>
              <text fg="#268bd2">{"                      (Persona sees updated data)"}</text>
              <text fg="#268bd2">{"  /reflect apply      Write proposed.yaml to your Persona"}</text>
              <text fg="#268bd2">{"  /reflect dismiss    Discard without changing anything"}</text>
              <text> </text>
              <text fg="#839496">{dataPath.replace(homedir(), "~") + "/reflect/YYYY-MM-DD_Name/"}</text>
              <text fg="#839496">{"  ├── current.yaml   # Read-Only Reference"}</text>
              <text fg="#839496">{"  └── proposed.yaml  # Edit while Chatting"}</text>
              <text> </text>
              <text fg="#586e75">{"[Press any key to close]"}</text>
            </box>
          </box>
        );
      }, ctx.renderer);
      return;
    }

    if (subcommand === "generate") {
      const result = await resolveReflectionPersona(args, ctx);
      if (!result) return;
      const { persona } = result;

      const folderPath = getReflectFolder(persona);

      if (fs.existsSync(folderPath)) {
        const date = persona.pending_update!.created_at.slice(0, 10);
        ctx.showNotification(`Found existing reflection from ${date}, regenerating...`, "info");
        fs.rmSync(folderPath, { recursive: true, force: true });
      }
      fs.mkdirSync(folderPath, { recursive: true });

      const now = new Date().toISOString();
      const critique = wrapComment(persona.pending_update!.critique);

      const currentHeader = [
        `# Current Identity: ${persona.display_name}`,
        `# This is the CURRENT identity — for reference only. Do not edit this file.`,
        `# Generated: ${now}`,
        `#`,
        `# Critique from reflection analysis:`,
        critique,
        ``,
      ].join("\n");

      const currentYAML = personaPreviewToYAML(
        {
          long_description: persona.long_description ?? "",
          short_description: persona.short_description ?? "",
          traits: (persona.traits ?? []).map(t => ({
            name: t.name,
            description: t.description,
            strength: t.strength ?? 0.5,
            sentiment: t.sentiment ?? 0,
          })),
          topics: (persona.topics ?? []).map(t => ({
            name: t.name,
            perspective: t.perspective,
            approach: t.approach,
            personal_stake: t.personal_stake,
            sentiment: t.sentiment ?? 0,
            exposure_current: t.exposure_current ?? 0.5,
            exposure_desired: t.exposure_desired ?? 0.5,
          })),
        },
        persona.display_name
      );

      fs.writeFileSync(join(folderPath, "current.yaml"), currentHeader + currentYAML, "utf-8");

      const proposedHeader = [
        `# Proposed Identity: ${persona.display_name}`,
        `# Edit this file freely. Use /reflect update to sync changes into the system.`,
        `# Use /reflect apply when done, or /reflect dismiss to discard.`,
        ``,
      ].join("\n");

      const proposedYAML = personaPreviewToYAML(
        {
          long_description: persona.pending_update!.long_description,
          short_description: persona.pending_update!.short_description ?? "",
          traits: (persona.pending_update!.traits ?? []).map(t => ({
            name: t.name,
            description: t.description,
            strength: t.strength ?? 0.5,
            sentiment: t.sentiment ?? 0,
          })),
          topics: (persona.pending_update!.topics ?? []).map(t => ({
            name: t.name,
            perspective: t.perspective,
            approach: t.approach,
            personal_stake: t.personal_stake,
            sentiment: t.sentiment ?? 0,
            exposure_current: t.exposure_current ?? 0.5,
            exposure_desired: t.exposure_desired ?? 0.5,
          })),
        },
        persona.display_name
      );

      fs.writeFileSync(join(folderPath, "proposed.yaml"), proposedHeader + proposedYAML, "utf-8");

      ctx.showNotification(
        `Reflection files written to ${folderPath} — open proposed.yaml in your editor alongside this chat`,
        "info"
      );
      return;
    }

    if (subcommand === "update") {
      const result = await resolveReflectionPersona(args, ctx);
      if (!result) return;
      const { personaId, persona } = result;

      const folderPath = getReflectFolder(persona);
      if (!fs.existsSync(folderPath)) {
        ctx.showNotification(
          `No reflection folder found — run /reflect generate first`,
          "error"
        );
        return;
      }

      const proposedContent = fs.readFileSync(join(folderPath, "proposed.yaml"), "utf-8");

      let parsed: ReturnType<typeof personaPreviewFromYAML>;
      try {
        parsed = personaPreviewFromYAML(proposedContent);
      } catch (e) {
        ctx.showNotification(
          `Parse error: ${e instanceof Error ? e.message : String(e)}`,
          "error"
        );
        return;
      }

      await ctx.ei.updatePersona(personaId, {
        pending_update: {
          critique: persona.pending_update!.critique,
          created_at: persona.pending_update!.created_at,
          long_description: parsed.long_description,
          short_description: parsed.short_description ?? persona.pending_update!.short_description,
          traits: parsed.traits,
          topics: parsed.topics,
        },
      });

      ctx.showNotification(
        `Updated — ${persona.display_name} will see your changes in the next message`,
        "info"
      );
      return;
    }

    if (subcommand === "apply") {
      const result = await resolveReflectionPersona(args, ctx);
      if (!result) return;
      const { personaId, persona } = result;

      const folderPath = getReflectFolder(persona);

      let finalParsed: ReturnType<typeof personaPreviewFromYAML> | null = null;
      if (fs.existsSync(folderPath)) {
        const proposedPath = join(folderPath, "proposed.yaml");
        if (fs.existsSync(proposedPath)) {
          const proposedContent = fs.readFileSync(proposedPath, "utf-8");
          try {
            finalParsed = personaPreviewFromYAML(proposedContent);
          } catch (e) {
            ctx.showNotification(
              `Parse error in proposed.yaml: ${e instanceof Error ? e.message : String(e)}`,
              "error"
            );
            return;
          }
        }
      }

      const source = finalParsed ?? {
        long_description: persona.pending_update!.long_description,
        short_description: persona.pending_update!.short_description as string | undefined,
        traits: persona.pending_update!.traits,
        topics: persona.pending_update!.topics,
      };

      await ctx.ei.updatePersona(personaId, {
        long_description: source.long_description,
        short_description: source.short_description,
        traits: source.traits,
        topics: source.topics,
        pending_update: undefined,
      });

      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
      }

      ctx.showNotification(`Applied reflection for ${persona.display_name}`, "info");
      return;
    }

    if (subcommand === "dismiss") {
      const result = await resolveReflectionPersona(args, ctx);
      if (!result) return;
      const { personaId, persona } = result;

      const confirmed = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay, _hideForEditor) => (
          <ConfirmOverlay
            message={`Discard this reflection for ${persona.display_name}? The proposed identity will be lost.`}
            onConfirm={() => { hideOverlay(); resolve(true); }}
            onCancel={() => { hideOverlay(); resolve(false); }}
          />
        ), ctx.renderer);
      });

      if (!confirmed) {
        ctx.showNotification("Cancelled", "info");
        return;
      }

      await ctx.ei.updatePersona(personaId, { pending_update: undefined });
      const folderPath = getReflectFolder(persona);
      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
      }
      ctx.showNotification(`Dismissed reflection for ${persona.display_name}`, "info");
      return;
    }
  },
};
