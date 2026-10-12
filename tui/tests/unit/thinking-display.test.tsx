import { afterEach, describe, expect, test } from "bun:test";
import {
  createEiStub,
  getAllCommands,
  makeMessage,
  makePersona,
  mountConversation,
  realWait,
  releaseStub,
  runCommand,
  settle,
  type EiStub,
  type Mounted,
} from "./tool-thinking-harness";
import { personaFromYAML, personaToYAML } from "../../src/util/yaml-serializers";
import type { Message, PersonaEntity } from "../../../src/core/types";

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.renderer.destroy();
  releaseStub();
  mounted = undefined;
});

const THOUGHT_1 = "weighing the first option carefully";
const THOUGHT_2 = "reconsidering the second option";

function persona(id: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return makePersona(id, {
    display_name: `Persona ${id.toUpperCase()}`,
    short_description: "A test persona",
    long_description: "A persona used for thinking display tests.",
    ...overrides,
  });
}

function thinkingMessages(first: string, second: string): Message[] {
  return [
    makeMessage("human", { content: "question one" }),
    makeMessage("system", { content: "answer one", thinking: first }),
    makeMessage("human", { content: "question two" }),
    makeMessage("system", { content: "answer two", thinking: second }),
  ];
}

async function mountSettled(stub: EiStub): Promise<{ m: Mounted; frame: string }> {
  const m = await mountConversation(stub);
  mounted = m;
  return { m, frame: await settle(m) };
}

function bubbleCount(frame: string): number {
  return frame.split("\n").filter(line => line.includes("💭")).length;
}

function expectThinkingVisible(frame: string): void {
  expect(frame).toContain(THOUGHT_1);
  expect(frame).toContain(THOUGHT_2);
  expect(frame).toContain("answer one");
  expect(frame).toContain("answer two");
  expect(bubbleCount(frame)).toBe(2);
}

function expectThinkingHidden(frame: string): void {
  expect(frame).not.toContain(THOUGHT_1);
  expect(frame).not.toContain(THOUGHT_2);
  expect(frame).toContain("answer one");
  expect(frame).toContain("answer two");
  expect(bubbleCount(frame)).toBe(2);
}

describe("/thinking", () => {
  test("is registered by PromptInput", async () => {
    const m = await mountConversation(createEiStub({ personas: [persona("a")], activePersonaId: "a" }));
    mounted = m;
    await m.renderOnce();
    expect(getAllCommands().map(command => command.name)).toContain("thinking");
  });

  for (const start of [undefined, true] as const) {
    test(`toggles from ${start === undefined ? "an absent show_thinking" : "an explicit true"}: off, then on, for every message`, async () => {
      const stub = createEiStub({
        personas: [persona("a", start === undefined ? {} : { show_thinking: start })],
        activePersonaId: "a",
        messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
      });
      const { m, frame } = await mountSettled(stub);
      expectThinkingVisible(frame);
      const lookupsBefore = stub.getPersonaCalls.length;

      const hidden = await runCommand(m, "/thinking");
      expect(stub.records.get("a")?.show_thinking).toBe(false);
      expectThinkingHidden(hidden);
      expect(stub.getPersonaCalls.length).toBeGreaterThan(lookupsBefore);

      const shown = await runCommand(m, "/thinking");
      expect(stub.records.get("a")?.show_thinking).toBe(true);
      expectThinkingVisible(shown);

      expect(stub.updatePersonaCalls).toEqual([
        { personaId: "a", updates: { show_thinking: false } },
        { personaId: "a", updates: { show_thinking: true } },
      ]);
    });
  }

  test("the toggled value reads back through the YAML editing convention, including an explicit false", async () => {
    const stub = createEiStub({
      personas: [persona("a")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
    });
    const { m } = await mountSettled(stub);

    await runCommand(m, "/thinking");
    const off = stub.records.get("a")!;
    expect(off.show_thinking).toBe(false);
    expect(personaFromYAML(personaToYAML(off), off).updates.show_thinking).toBe(false);

    await runCommand(m, "/thinking");
    const on = stub.records.get("a")!;
    expect(personaFromYAML(personaToYAML(on), on).updates.show_thinking).toBe(true);
  });

  test("toggling one Persona leaves the other Persona's setting and messages untouched", async () => {
    const stub = createEiStub({
      personas: [persona("a"), persona("b")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
    });
    const { m } = await mountSettled(stub);

    expectThinkingHidden(await runCommand(m, "/thinking"));
    expect(stub.records.get("b")?.show_thinking).toBeUndefined();
    expect(stub.updatePersonaCalls.map(call => call.personaId)).toEqual(["a"]);

    stub.setActivePersonaId("b");
    stub.setMessages(thinkingMessages(THOUGHT_1, THOUGHT_2));
    await realWait();
    expectThinkingVisible(await settle(m));

    stub.setActivePersonaId("a");
    stub.setMessages(thinkingMessages(THOUGHT_1, THOUGHT_2));
    await realWait();
    expectThinkingHidden(await settle(m));
    expect(stub.records.get("a")?.show_thinking).toBe(false);
    expect(stub.records.get("b")?.show_thinking).toBeUndefined();
  });

  test("does nothing while a Room is active, and toggles once it is not", async () => {
    const stub = createEiStub({
      personas: [persona("a")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
      activeRoomId: "room-1",
    });
    const { m } = await mountSettled(stub);

    await runCommand(m, "/thinking");
    expect(stub.updatePersonaCalls).toEqual([]);
    expect(stub.records.get("a")?.show_thinking).toBeUndefined();

    stub.setActiveRoomId(null);
    await runCommand(m, "/thinking");
    expect(stub.updatePersonaCalls).toHaveLength(1);
    expect(stub.records.get("a")?.show_thinking).toBe(false);
  });
});

describe("thinking rendering", () => {
  test("a pending lookup withholds the text but keeps the icon and the reply; stored false stays hidden after it resolves", async () => {
    const stub = createEiStub({
      personas: [persona("a", { show_thinking: false })],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
      deferLookups: true,
    });
    const { m, frame } = await mountSettled(stub);
    expect(stub.pendingLookups).toHaveLength(1);
    expectThinkingHidden(frame);

    stub.pendingLookups[0].resolve();
    await realWait();
    expectThinkingHidden(await settle(m));
  });

  test("a loaded record that lacks the field shows the text, but only after the lookup resolves", async () => {
    const stub = createEiStub({
      personas: [persona("a")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
      deferLookups: true,
    });
    const { m, frame } = await mountSettled(stub);
    expectThinkingHidden(frame);

    stub.pendingLookups[0].resolve();
    await realWait();
    expectThinkingVisible(await settle(m));
  });

  test("a late response for a Persona that is no longer active never decides the active Persona's visibility", async () => {
    const stub = createEiStub({
      personas: [persona("a"), persona("b", { show_thinking: false })],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
      deferLookups: true,
    });
    const { m } = await mountSettled(stub);
    const lookupA = stub.pendingLookups.find(lookup => lookup.personaId === "a")!;

    stub.setActivePersonaId("b");
    stub.setMessages(thinkingMessages(THOUGHT_1, THOUGHT_2));
    await realWait();
    await settle(m);
    const lookupB = stub.pendingLookups.find(lookup => lookup.personaId === "b")!;
    lookupB.resolve();
    await realWait();
    expectThinkingHidden(await settle(m));

    lookupA.resolve({ ...stub.records.get("a")!, show_thinking: true });
    await realWait();
    expectThinkingHidden(await settle(m));
  });

  test("an older lookup for the same Persona resolving late does not override the newer one", async () => {
    const stub = createEiStub({
      personas: [persona("a")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
      deferLookups: true,
    });
    const { m } = await mountSettled(stub);
    const olderLookup = stub.pendingLookups[0];

    await stub.value.updatePersona("a", { show_thinking: false });
    await realWait();
    await settle(m);
    expect(stub.pendingLookups).toHaveLength(2);
    stub.pendingLookups[1].resolve();
    await realWait();
    expectThinkingHidden(await settle(m));

    olderLookup.resolve({ ...persona("a"), show_thinking: true });
    await realWait();
    expectThinkingHidden(await settle(m));
  });

  test("an already-visible Persona re-emitted with a stored opt-out withholds thinking until the new lookup resolves", async () => {
    const stub = createEiStub({
      personas: [persona("a")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
    });
    const { m, frame } = await mountSettled(stub);
    expectThinkingVisible(frame);

    stub.deferLookups = true;
    await stub.value.updatePersona("a", { show_thinking: false });
    await realWait();
    expect(stub.pendingLookups.map(lookup => lookup.personaId)).toEqual(["a"]);
    expectThinkingHidden(await settle(m));

    stub.pendingLookups[0].resolve();
    await realWait();
    expectThinkingHidden(await settle(m));
  });

  test("switching A -> B (pending) -> A (pending, stored opt-out) never shows thinking, and a late B response cannot expose it", async () => {
    const stub = createEiStub({
      personas: [persona("a"), persona("b")],
      activePersonaId: "a",
      messages: thinkingMessages(THOUGHT_1, THOUGHT_2),
    });
    const { m, frame } = await mountSettled(stub);
    expectThinkingVisible(frame);

    stub.deferLookups = true;
    stub.setActivePersonaId("b");
    await realWait();
    await settle(m);
    const lookupB = stub.pendingLookups.find(lookup => lookup.personaId === "b")!;

    stub.records.set("a", { ...stub.records.get("a")!, show_thinking: false });
    stub.setActivePersonaId("a");
    await realWait();
    expectThinkingHidden(await settle(m));

    lookupB.resolve({ ...persona("b"), show_thinking: true });
    await realWait();
    expectThinkingHidden(await settle(m));

    stub.pendingLookups.find(lookup => lookup.personaId === "a")!.resolve();
    await realWait();
    expectThinkingHidden(await settle(m));
  });

  test("with the setting on, thinking is above the reply and the reply stays visible", async () => {
    const { frame } = await mountSettled(
      createEiStub({
        personas: [persona("a")],
        activePersonaId: "a",
        messages: [makeMessage("system", { content: "the visible reply", thinking: THOUGHT_1 })],
      }),
    );

    const lines = frame.split("\n");
    const thinkingRow = lines.findIndex(line => line.includes(THOUGHT_1));
    const replyRow = lines.findIndex(line => line.includes("the visible reply"));
    expect(thinkingRow).toBeGreaterThan(-1);
    expect(replyRow).toBeGreaterThan(thinkingRow);
  });
});
