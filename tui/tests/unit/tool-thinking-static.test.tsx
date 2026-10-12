import { afterEach, expect, jest, test } from "bun:test";
import { onCleanup, onMount, createSignal } from "solid-js";
import { testRender } from "@opentui/solid";
import {
  createEiStub,
  dispatchCommand,
  makeMessage,
  makePersona,
  makeToolCall,
  OverlayOutlet,
  overlayContentLines,
  realWait,
  releaseStub,
  settle,
  useStub,
  type Mounted,
} from "./tool-thinking-harness";

// Static imports would bind the real contexts before the harness installs its mocks.
const { MessageList } = await import("../../src/components/MessageList");
const { PromptInput } = await import("../../src/components/PromptInput");
const { OverlayProvider } = await import("../../src/context/overlay");
const { registerCommand } = await import("../../src/commands/registry");
const { toolCallsCommand } = await import("../../src/commands/toolcalls");

interface SchedulerGlobals {
  requestAnimationFrame: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  MessageChannel: typeof MessageChannel;
}

const scheduler = globalThis as unknown as SchedulerGlobals;

type Mechanism = "static" | "setTimeout" | "setInterval" | "requestAnimationFrame" | "setImmediate" | "MessageChannel";
const THINKING = "COMPLETE_THINKING_SENTINEL";
const ARGUMENT = "COMPLETE_TOOL_ARGUMENT_SENTINEL";
const RESULT = "COMPLETE_TOOL_RESULT_SENTINEL";
const MORE = "LATE_OVERLAY_SUFFIX";
let mounted: Mounted | undefined;
const originalAnimationFrame = scheduler.requestAnimationFrame;
const originalMessageChannel = scheduler.MessageChannel;

afterEach(() => {
  mounted?.renderer.destroy();
  mounted = undefined;
  registerCommand(toolCallsCommand);
  scheduler.requestAnimationFrame = originalAnimationFrame;
  scheduler.MessageChannel = originalMessageChannel;
  jest.useRealTimers();
  releaseStub();
});

function StaticOverlay(props: { mechanism: Mechanism }) {
  const [suffix, setSuffix] = createSignal(props.mechanism === "static");
  onMount(() => {
    if (props.mechanism === "static") return;
    const finish = () => setSuffix(true);
    if (props.mechanism === "setTimeout") {
      const timer = setTimeout(finish, 10);
      onCleanup(() => clearTimeout(timer));
    } else if (props.mechanism === "setInterval") {
      const timer = setInterval(finish, 10);
      onCleanup(() => clearInterval(timer));
    } else if (props.mechanism === "requestAnimationFrame") {
      const frame = scheduler.requestAnimationFrame(finish);
      onCleanup(() => scheduler.cancelAnimationFrame(frame));
    } else if (props.mechanism === "setImmediate") {
      const timer = setImmediate(finish);
      onCleanup(() => clearImmediate(timer));
    } else {
      const channel = new MessageChannel();
      channel.port1.onmessage = finish;
      channel.port2.postMessage("reveal");
      onCleanup(() => {
        channel.port1.close();
        channel.port2.close();
      });
    }
  });
  // Same scrollbox geometry as the real overlay so ordinary layout scheduling
  // cannot masquerade as a delayed reveal.
  return (
    <box position="absolute" width="100%" height="100%" left={0} top={0} backgroundColor="#000000" alignItems="center" justifyContent="center">
      <box width="90%" height="90%" backgroundColor="#1a1a2e" borderStyle="single" padding={1} flexDirection="column">
        <text marginBottom={1}>Tool calls - message [1]</text>
        <scrollbox flexGrow={1}>
          <box flexDirection="column" marginBottom={1}>
            <text>[1/1] find_memory</text>
            <text>error: false</text>
            <text>arguments:</text>
            <text>{`  query: ${ARGUMENT}`}</text>
            <text>result:</text>
            <text content={`${RESULT}${suffix() ? ` ${MORE}` : ""}`} />
          </box>
        </scrollbox>
        <text marginTop={1}>j/k: scroll | PgUp/PgDn: page | Esc/q: close</text>
      </box>
    </box>
  );
}

function messageFeatures(frame: string): string[] {
  const lines = frame.split("\n");
  const start = lines.findIndex(line => line.includes("[✂️  1]"));
  const end = lines.findIndex((line, index) => index > start && line.includes("complete reply"));
  if (start < 0 || end < 0 || !lines.slice(start, end + 1).some(line => line.includes(THINKING))) {
    throw new Error(`Missing complete message features:\n${frame}`);
  }
  return lines.slice(start, end + 1);
}

function full(conversation: string, overlay: string, isControl: boolean): void {
  expect(conversation).toContain(THINKING);
  expect(conversation).toContain("💭");
  expect(conversation).toContain("🧧");
  const content = overlayContentLines(overlay).join("\n");
  expect(content).toContain("Tool calls - message [1]");
  expect(content).toContain(`query: ${ARGUMENT}`);
  expect(content).toContain(RESULT);
  if (isControl) {
    expect(content).toContain("[1/1] find_memory");
    expect(content).toContain("error: false");
    expect(content).toContain(MORE);
  } else {
    for (const detail of ["[1/2] find_memory", "[2/2] edit_topic (update)", "error: false",
      "error: true", "scope: SECOND_ARG_VALUE", "action: update", "topic: SECOND_CALL_ARGUMENT",
      "arguments:", "result:"]) {
      expect(content).toContain(detail);
    }
  }
}

interface Reading {
  mountTimers: number;
  mountFrames: number;
  openTimers: number;
  openFrames: number;
  openChannels: number;
  conversation: string;
  frame: string;
  advanced: string;
  realWaitFrame: string;
  advancedConversation?: string;
  realConversation?: string;
}

function assertStaticReveal(reading: Reading, baseline: Reading): void {
  expect(reading.openTimers).toBe(baseline.openTimers);
  expect(reading.openFrames).toBe(baseline.openFrames);
  expect(reading.openChannels).toBe(baseline.openChannels);
  expect(reading.frame).toContain(MORE);
  expect(overlayContentLines(reading.advanced)).toEqual(overlayContentLines(reading.frame));
  expect(overlayContentLines(reading.realWaitFrame)).toEqual(overlayContentLines(reading.frame));
}

async function measure(kind: "bare" | "real" | Mechanism): Promise<Reading> {
  const stub = createEiStub({
    personas: [makePersona("p", { show_thinking: true })],
    activePersonaId: "p",
    messages: [makeMessage("system", {
      content: "complete reply",
      thinking: THINKING,
      tool_calls: [
        makeToolCall({ arguments: { query: ARGUMENT, scope: "SECOND_ARG_VALUE" }, result: RESULT }),
        makeToolCall({ name: "edit_topic", arguments: { action: "update", topic: "SECOND_CALL_ARGUMENT" },
          result: "SECOND_CALL_RESULT", error: true, kind: "write" }),
      ],
    })],
  });
  useStub(stub);

  // Install the RAF counter inside the render callback: the renderer's
  // constructor has installed its own RAF by the time this code runs.
  let frames = 0;
  let channels = 0;
  const before = jest.getTimerCount();
  const renderer = await testRender(() => {
    const previous = scheduler.requestAnimationFrame;
    scheduler.requestAnimationFrame = callback => {
      frames++;
      return previous(callback);
    };
    scheduler.MessageChannel = class extends originalMessageChannel {
      constructor() {
        super();
        channels++;
      }
    };
    return (
      <OverlayProvider>
        <box flexDirection="column" width="100%" height="100%">
          <box flexGrow={1}>{kind === "bare" ? <box /> : <MessageList />}</box>
          <PromptInput />
          <OverlayOutlet />
        </box>
      </OverlayProvider>
    );
  }, { width: 100, height: 40 });
  mounted = renderer;
  const mountTimers = jest.getTimerCount() - before;
  const mountFrames = frames;
  const conversation = await settle(renderer);
  if (kind !== "bare" && kind !== "real") {
    registerCommand({
      ...toolCallsCommand,
      execute: async (_args, ctx) => {
        ctx.showOverlay(() => <StaticOverlay mechanism={kind} />, ctx.renderer);
      },
    });
  } else registerCommand(toolCallsCommand);
  const startTimers = jest.getTimerCount();
  const startFrames = frames;
  await dispatchCommand(renderer, "/toolcalls 1");
  await renderer.renderOnce();
  await renderer.renderOnce();
  const openTimers = jest.getTimerCount() - startTimers;
  const openFrames = frames - startFrames;
  const openChannels = channels;
  const frame = await settle(renderer);
  if (kind === "real" || kind === "static") full(conversation, frame, kind === "static");
  jest.advanceTimersByTime(100);
  const advanced = await settle(renderer);
  let advancedConversation: string | undefined;
  if (kind === "real") {
    renderer.mockInput.pressKey("q");
    advancedConversation = await settle(renderer);
    await dispatchCommand(renderer, "/toolcalls 1");
    await renderer.renderOnce();
    await renderer.renderOnce();
    expect(overlayContentLines(await settle(renderer))).toEqual(overlayContentLines(frame));
  }
  jest.useRealTimers();
  await realWait();
  const realWaitFrame = await settle(renderer);
  let realConversation: string | undefined;
  if (kind === "real") {
    renderer.mockInput.pressKey("q");
    realConversation = await settle(renderer);
  }
  renderer.renderer.destroy();
  mounted = undefined;
  scheduler.requestAnimationFrame = originalAnimationFrame;
  scheduler.MessageChannel = originalMessageChannel;
  releaseStub();
  return { mountTimers, mountFrames, openTimers, openFrames, openChannels, conversation, frame, advanced, realWaitFrame, advancedConversation, realConversation };
}

test("persisted thinking and tool details appear complete at first settled frame without scheduled reveals", async () => {
  jest.useFakeTimers();
  const bare = await measure("bare");
  jest.useFakeTimers();
  const staticControl = await measure("static");
  jest.useFakeTimers();
  const real = await measure("real");
  expect(real.mountTimers).toBe(bare.mountTimers);
  expect(real.mountFrames).toBe(bare.mountFrames);
  expect(real.openTimers).toBe(staticControl.openTimers);
  expect(real.openFrames).toBe(staticControl.openFrames);
  expect(real.openChannels).toBe(staticControl.openChannels);
  expect(overlayContentLines(real.advanced)).toEqual(overlayContentLines(real.frame));
  expect(overlayContentLines(real.realWaitFrame)).toEqual(overlayContentLines(real.frame));
  expect(messageFeatures(real.advancedConversation!)).toEqual(messageFeatures(real.conversation));
  expect(messageFeatures(real.realConversation!)).toEqual(messageFeatures(real.conversation));
  expect(overlayContentLines(staticControl.advanced)).toEqual(overlayContentLines(staticControl.frame));
  expect(overlayContentLines(staticControl.realWaitFrame)).toEqual(overlayContentLines(staticControl.frame));
});

for (const mechanism of ["setTimeout", "setInterval", "requestAnimationFrame", "setImmediate", "MessageChannel"] as const) {
  test(`${mechanism} deferred suffix fails the static scheduling/completeness oracle`, async () => {
    jest.useFakeTimers();
    const staticControl = await measure("static");
    assertStaticReveal(staticControl, staticControl);
    jest.useFakeTimers();
    const delayed = await measure(mechanism);
    expect(delayed.realWaitFrame).toContain(MORE);
    if (mechanism === "setTimeout" || mechanism === "setInterval") {
      expect(delayed.openTimers, `${mechanism} must add a fake-clock timer`).toBeGreaterThan(staticControl.openTimers);
      expect(delayed.frame).not.toContain(MORE);
      expect(delayed.advanced).toContain(MORE);
    }
    if (mechanism === "setImmediate") {
      expect(delayed.frame).not.toContain(MORE);
      expect(delayed.realWaitFrame).toContain(MORE);
    }
    if (mechanism === "requestAnimationFrame") {
      expect(delayed.openFrames, `${mechanism} must request an animation frame`).toBeGreaterThan(staticControl.openFrames);
    }
    if (mechanism === "MessageChannel") {
      expect(delayed.openChannels, `${mechanism} must allocate a channel`).toBeGreaterThan(staticControl.openChannels);
    }
    expect(() => assertStaticReveal(delayed, staticControl)).toThrow();
  });
}
