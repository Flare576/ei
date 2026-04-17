import { useKeyboard } from "@opentui/solid";
import { For, createMemo, onMount, onCleanup } from "solid-js";
import type { RoomMessage, PersonaSummary } from "../../../src/core/types.js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboardNav } from "../context/keyboard.js";

export interface MAPScoreOverlayProps {
  roomId: string;
  roomName?: string;
  messages: RoomMessage[];
  activeNodeId: string;
  activeRoomPath: RoomMessage[];
  personas: PersonaSummary[];
  judgePersonaId: string;
  humanName: string;
  onDismiss: () => void;
}

interface ScoreRow {
  round: number | null; // null = initial seed message
  winnerId: string | null;
  winnerName: string;
  winnerScore: number; // total wins for winner at this round
  messagePreview: string;
  verdict: string;
  isInProgress: boolean;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function getMessageText(m: RoomMessage): string {
  return (m.verbal_response ?? m.content ?? m.silence_reason ?? "").replace(/\n+/g, " ");
}

export function MAPScoreOverlay(props: MAPScoreOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  let scrollRef: ScrollBoxRenderable | null = null;

  const personaMap = createMemo(() => {
    const m = new Map<string, string>();
    for (const p of props.personas) m.set(p.id, p.display_name);
    return m;
  });

  // Active path: walk parent_id chain from active_node_id to root, then reverse.
  // We can't use getRoomActivePath from state-manager here (TUI component), so we derive it.
  const activePath = createMemo<RoomMessage[]>(() => {
    const msgById = new Map<string, RoomMessage>();
    for (const m of props.messages) msgById.set(m.id, m);

    const chain: RoomMessage[] = [];
    let cur = msgById.get(props.activeNodeId);
    while (cur) {
      chain.push(cur);
      cur = cur.parent_id ? msgById.get(cur.parent_id) : undefined;
    }
    return chain.reverse();
  });

  const scoreRows = createMemo<ScoreRow[]>(() => {
    const path = activePath();
    const pMap = personaMap();
    const judgeId = props.judgePersonaId;

    if (path.length === 0) return [];

    const msgById = new Map<string, RoomMessage>();
    for (const m of props.messages) msgById.set(m.id, m);

    // Verdicts are siblings of winners — same parent_id as the winner.
    // They are NOT on the active path, so index all messages by parent_id.
    const verdictByParentId = new Map<string, RoomMessage>();
    for (const m of props.messages) {
      if (m.persona_id === judgeId && m.silence_reason && m.parent_id) {
        verdictByParentId.set(m.parent_id, m);
      }
    }

    const winCounts = new Map<string, number>();
    const rows: ScoreRow[] = [];
    let round = 0;

    const seed = path[0];
    if (!seed) return rows;

    rows.push({
      round: null,
      winnerId: null,
      winnerName: "—",
      winnerScore: 0,
      messagePreview: truncate(getMessageText(seed), 50),
      verdict: "(initial)",
      isInProgress: false,
    });

    // Active path: human → winner-1 → winner-2 → ...
    // Each non-judge persona message on the path is a round winner.
    for (const msg of path) {
      if (msg.role !== "persona" || msg.persona_id === judgeId) continue;

      round++;
      const winnerId = msg.persona_id ?? "";
      const prev = winCounts.get(winnerId) ?? 0;
      const newCount = prev + 1;
      winCounts.set(winnerId, newCount);
      const winnerName = pMap.get(winnerId) ?? winnerId.slice(0, 8);
      const verdictMsg = msg.parent_id ? verdictByParentId.get(msg.parent_id) : undefined;
      const verdict = verdictMsg ? truncate(verdictMsg.silence_reason ?? "", 50) : "";

      rows.push({
        round,
        winnerId,
        winnerName: `${winnerName} (${newCount})`,
        winnerScore: newCount,
        messagePreview: truncate(getMessageText(msg), 50),
        verdict,
        isInProgress: false,
      });
    }

    return rows;
  });

  const scoreSummary = createMemo<string>(() => {
    const path = activePath();
    const pMap = personaMap();
    const judgeId = props.judgePersonaId;

    const counts = new Map<string, number>();
    let humanWins = 0;

    for (const m of path) {
      if (m.role === "persona" && m.persona_id !== judgeId) {
        const id = m.persona_id ?? "";
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }

    const completedRounds = scoreRows().filter((r) => !r.isInProgress && r.round !== null).length;
    if (completedRounds === 0) return "No rounds completed yet.";

    const parts: string[] = [];
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, cnt] of sorted) {
      const name = pMap.get(id) ?? id.slice(0, 8);
      parts.push(`${name} ${cnt}`);
    }
    parts.push(`${props.humanName} ${humanWins}`);

    return "Score: " + parts.join(" — ");
  });

  useKeyboard((event) => {
    event.preventDefault();
    const key = event.name;

    if (key === "q" || key === "escape") {
      props.onDismiss();
      return;
    }

    if (key === "up" || key === "k") {
      scrollRef?.scrollBy(-1);
      return;
    }

    if (key === "down" || key === "j") {
      scrollRef?.scrollBy(1);
      return;
    }

    if (key === "pageup") {
      if (scrollRef) {
        scrollRef.scrollBy(-Math.max(1, Math.floor(scrollRef.height / 2)));
      }
      return;
    }

    if (key === "pagedown") {
      if (scrollRef) {
        scrollRef.scrollBy(Math.max(1, Math.floor(scrollRef.height / 2)));
      }
      return;
    }
  });

  const COL_ROUND = 6;
  const COL_WINNER = 16;
  const COL_MSG = 36;
  const COL_VERDICT = 36;
  const SEP = " │ ";

  const headerLine = createMemo(() => {
    return (
      "Round".padEnd(COL_ROUND) +
      SEP +
      "Winner".padEnd(COL_WINNER) +
      SEP +
      "Message".padEnd(COL_MSG) +
      SEP +
      "Verdict"
    );
  });

  const dividerLine = createMemo(() => {
    return (
      "─".repeat(COL_ROUND) +
      "─┼─" +
      "─".repeat(COL_WINNER) +
      "─┼─" +
      "─".repeat(COL_MSG) +
      "─┼─" +
      "─".repeat(COL_VERDICT)
    );
  });

  function formatRow(row: ScoreRow): string {
    const roundStr =
      row.round === null ? "  —   " : String(row.round).padStart(3).padEnd(COL_ROUND);
    const winner = row.winnerName.padEnd(COL_WINNER).slice(0, COL_WINNER);
    const msg = row.messagePreview.padEnd(COL_MSG).slice(0, COL_MSG);
    const verdict = row.verdict.padEnd(COL_VERDICT).slice(0, COL_VERDICT);
    return roundStr + SEP + winner + SEP + msg + SEP + verdict;
  }

  function rowFg(row: ScoreRow): string {
    if (row.isInProgress) return "#6272a4";
    if (row.round === null) return "#586e75";
    return "#93a1a1";
  }

  const roomTitle = createMemo(
    () => `MAP Scoreboard — "${props.roomName ?? props.roomId}"`
  );

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
        width="95%"
        height="95%"
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        flexDirection="column"
      >
        <box paddingLeft={1} paddingRight={1} paddingTop={1}>
          <text fg="#eee8d5">{roomTitle()}</text>
        </box>

        <box paddingLeft={1} paddingRight={1} marginTop={1} height={1}>
          <text fg="#6272a4">{headerLine()}</text>
        </box>
        <box paddingLeft={1} paddingRight={1} height={1}>
          <text fg="#44475a">{dividerLine()}</text>
        </box>

        <scrollbox
          flexGrow={1}
          ref={(el: ScrollBoxRenderable) => { scrollRef = el; }}
        >
          <For each={scoreRows()}>
            {(row) => (
              <box
                visible={true}
                paddingLeft={1}
              >
                <text fg={rowFg(row)}>{formatRow(row)}</text>
              </box>
            )}
          </For>
        </scrollbox>

        <box paddingLeft={1} paddingRight={1} height={1}>
          <text fg="#586e75">{"─".repeat(COL_ROUND + COL_WINNER + COL_MSG + COL_VERDICT + 9)}</text>
        </box>
        <box paddingLeft={1} paddingRight={1} height={1}>
          <text fg="#b58900">{scoreSummary()}</text>
        </box>
        <box paddingLeft={1} paddingRight={1} height={1} marginBottom={1}>
          <text fg="#586e75">{"[q] close  [j/k] scroll  [PgUp/PgDn] page"}</text>
        </box>
      </box>
    </box>
  );
}
