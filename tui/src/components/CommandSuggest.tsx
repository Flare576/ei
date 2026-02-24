import { createMemo, For } from "solid-js";
import { getAllCommands } from "../commands/registry";

interface CommandSuggestProps {
  input: () => string;
  highlightIndex: () => number;
}

export function CommandSuggest(props: CommandSuggestProps) {
  const matches = createMemo(() => {
    const raw = props.input().trim();
    if (!raw.startsWith("/")) return [];
    const query = raw.slice(1).split(/\s/)[0].replace(/!$/, "").toLowerCase();
    return getAllCommands().filter(
      (cmd) =>
        cmd.name.startsWith(query) ||
        cmd.aliases.some((a) => a.startsWith(query))
    );
  });

  return (
    <box
      flexDirection="column"
      visible={matches().length > 0}
      borderStyle="single"
      border={true}
      borderColor="#586e75"
      backgroundColor="#1a1a2e"
      flexShrink={0}
    >
      <For each={matches()}>
        {(cmd, i) => {
          const isHighlighted = () => i() === props.highlightIndex();
          const aliases =
            cmd.aliases.length > 0 ? ` (/${cmd.aliases.join(", /")})` : "";
          return (
            <box
              paddingX={1}
              backgroundColor={isHighlighted() ? "#2d3748" : "transparent"}
            >
              <text fg={isHighlighted() ? "#eee8d5" : "#839496"} truncate>
                {`/${cmd.name}${aliases}  ${cmd.description}`}
              </text>
            </box>
          );
        }}
      </For>
    </box>
  );
}
