import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callLLMRaw: vi.fn(),
}));

import { createTurnFixture, stopRound, submitRound, type LLMRound, type TurnFixture } from "../../helpers/turn-capture-fixture.js";
import type { Message, RoomMessage } from "../../../src/core/types.js";

const expectedThinking = "reasoning0123456789".repeat(526) + "think!";

interface Writer {
  label: string;
  send: (fx: TurnFixture) => void;
  finish: (fx: TurnFixture) => LLMRound;
  rows: (fx: TurnFixture) => Array<Message | RoomMessage>;
}

const writers: Writer[] = [
  {
    label: "1:1",
    send: (fx) => fx.sendPersonaTurn(),
    finish: () => stopRound("ordinary reply", expectedThinking),
    rows: (fx) => fx.messages(),
  },
  {
    label: "room",
    send: (fx) => fx.sendRoomTurn(),
    finish: () => stopRound("ordinary room reply", expectedThinking),
    rows: (fx) => fx.roomMessages(),
  },
  {
    label: "heartbeat check",
    send: (fx) => fx.sendHeartbeatCheck(),
    finish: () => submitRound("submit_heartbeat_check", { should_respond: true, topic: "hello", message: "checking in" }, { thinking: expectedThinking }),
    rows: (fx) => fx.messages(),
  },
  {
    label: "Ei heartbeat",
    send: (fx) => fx.sendEiHeartbeat({ offeredId: fx.personaId }),
    finish: (fx) => submitRound("submit_ei_heartbeat", { should_respond: true, id: fx.personaId, my_response: "checking in" }, { thinking: expectedThinking }),
    rows: (fx) => fx.eiMessages(),
  },
];

describe.each(writers)("complete provider thinking — $label", (writer) => {
  let fx: TurnFixture;
  afterEach(async () => {
    if (fx) await fx.stop();
  });

  it("persists all 10,000 code units on its final message", async () => {
    fx = await createTurnFixture();
    expect(expectedThinking.length).toBe(10_000);
    const before = writer.rows(fx).length;
    fx.script([writer.finish(fx)]);
    writer.send(fx);
    await fx.settle();

    const messages = writer.rows(fx);
    expect(messages).toHaveLength(before + (writer.label === "1:1" ? 2 : 1));
    expect(messages.at(-1)?.thinking).toBe(expectedThinking);
    expect(messages.at(-1)?.thinking).toHaveLength(10_000);
    expect("tool_calls" in (messages.at(-1) as Message | RoomMessage)).toBe(false);
  });
});
