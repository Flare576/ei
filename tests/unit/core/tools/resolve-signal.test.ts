// Bolt: signal-ux-bolt-003-signal-resolution-hardening
//
// D2/D4, R2/R4, AT2/AT4 -- the native `resolve_signal` executor. Follows
// the same plain-injected-function unit-test shape
// tests/unit/core/tools/persona-notes.test.ts already uses for
// add_note/clear_note (its own sibling non-throwing-rejection precedent,
// D19), plus a second describe block driving the executor against the
// REAL PersonaState (not a mock) to prove AT2's cross-persona isolation
// guarantee end-to-end.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createResolveSignalExecutor } from "../../../../src/core/tools/builtin/resolve-signal.js";
import { parseToolCalls, executeToolCalls, registerExecutor, registerResolveSignalExecutor, buildResolveSignalTool } from "../../../../src/core/tools/index.js";
import { PersonaState } from "../../../../src/core/state/personas.js";
import type { PersonaEntity, EmergentSignal, ToolDefinition } from "../../../../src/core/types.js";

function makePersona(id: string): PersonaEntity {
  return {
    id,
    display_name: id,
    entity: "system",
    aliases: [],
    short_description: "Test persona",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  };
}

function makeSignal(overrides: Partial<EmergentSignal> = {}): EmergentSignal {
  return {
    id: "signal-1",
    subject_persona_id: "persona-a",
    claim: "Speaks in short, direct sentences.",
    dimension: "behavior",
    status: "candidate",
    evidence_ids: [],
    first_observed_at: "2026-01-01T00:00:00.000Z",
    last_observed_at: "2026-01-01T00:00:00.000Z",
    observer_kinds: ["human"],
    recurrence_count: 1,
    ...overrides,
  };
}

describe("createResolveSignalExecutor (Bolt 003 D2/D4, R2/R4, AT2/AT4)", () => {
  let signalConfirm: ReturnType<typeof vi.fn>;
  let signalDismiss: ReturnType<typeof vi.fn>;
  let executor: ReturnType<typeof createResolveSignalExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    signalConfirm = vi.fn();
    signalDismiss = vi.fn();
    executor = createResolveSignalExecutor(signalConfirm, signalDismiss);
  });

  it("returns error (never throws) when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({ id: "signal-1", action: "confirm" }, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
    expect(signalConfirm).not.toHaveBeenCalled();
  });

  it("returns error when config is undefined", async () => {
    const result = JSON.parse(await executor.execute({ id: "signal-1", action: "confirm" }, undefined));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error (never throws) when args is null, matching D4/D19's non-throwing rejection convention (S2)", async () => {
    const result = JSON.parse(await executor.execute(null as unknown as Record<string, unknown>, { persona_id: "persona-a" }));
    expect(result).toEqual({ error: "Arguments must be a JSON object" });
    expect(signalConfirm).not.toHaveBeenCalled();
    expect(signalDismiss).not.toHaveBeenCalled();
  });

  it("returns error (never throws) when args is an array", async () => {
    const result = JSON.parse(await executor.execute([] as unknown as Record<string, unknown>, { persona_id: "persona-a" }));
    expect(result).toEqual({ error: "Arguments must be a JSON object" });
    expect(signalConfirm).not.toHaveBeenCalled();
    expect(signalDismiss).not.toHaveBeenCalled();
  });

  it("returns error (never throws) when a `delta` field is present, matching the unrecognized field(s) present convention (D4/R1/AT1)", async () => {
    const result = JSON.parse(await executor.execute(
      { id: "signal-1", action: "confirm", delta: { short_description: "x", long_description: "y", traits: [], topics: [] } },
      { persona_id: "persona-a" }
    ));
    expect(result.error).toMatch(/unrecognized field\(s\) present/);
    expect(signalConfirm).not.toHaveBeenCalled();
    expect(signalDismiss).not.toHaveBeenCalled();
  });

  it("returns error when an unrecognized field unrelated to delta is present (e.g. foo)", async () => {
    const result = JSON.parse(await executor.execute({ id: "signal-1", action: "confirm", foo: "bar" }, { persona_id: "persona-a" }));
    expect(result.error).toMatch(/unrecognized field\(s\) present/);
    expect(signalConfirm).not.toHaveBeenCalled();
  });

  it("returns error when id is missing", async () => {
    const result = JSON.parse(await executor.execute({ action: "confirm" }, { persona_id: "persona-a" }));
    expect(result).toEqual({ error: "Missing required argument: id" });
  });

  it("returns error when id is an empty string", async () => {
    const result = JSON.parse(await executor.execute({ id: "", action: "confirm" }, { persona_id: "persona-a" }));
    expect(result).toEqual({ error: "Missing required argument: id" });
  });

  it("returns error when action is missing", async () => {
    const result = JSON.parse(await executor.execute({ id: "signal-1" }, { persona_id: "persona-a" }));
    expect(result.error).toMatch(/action must be "confirm" or "dismiss"/);
  });

  it("returns error when action is an unrecognized value", async () => {
    const result = JSON.parse(await executor.execute({ id: "signal-1", action: "delete" }, { persona_id: "persona-a" }));
    expect(result.error).toMatch(/action must be "confirm" or "dismiss"/);
    expect(signalConfirm).not.toHaveBeenCalled();
    expect(signalDismiss).not.toHaveBeenCalled();
  });

  it("confirm: calls signalConfirm bound to the calling persona (config.persona_id), never a caller-supplied identifier", async () => {
    signalConfirm.mockReturnValue(makeSignal({ status: "reviewed" }));
    const result = JSON.parse(await executor.execute({ id: "signal-1", action: "confirm" }, { persona_id: "persona-a" }));
    expect(result).toEqual({ resolved: true, id: "signal-1", status: "reviewed", action: "confirm" });
    expect(signalConfirm).toHaveBeenCalledWith("persona-a", "signal-1", "persona-a");
    expect(signalDismiss).not.toHaveBeenCalled();
  });

  it("dismiss: calls signalDismiss bound to the calling persona", async () => {
    signalDismiss.mockReturnValue(makeSignal({ status: "dismissed" }));
    const result = JSON.parse(await executor.execute({ id: "signal-1", action: "dismiss" }, { persona_id: "persona-a" }));
    expect(result).toEqual({ resolved: true, id: "signal-1", status: "dismissed", action: "dismiss" });
    expect(signalDismiss).toHaveBeenCalledWith("persona-a", "signal-1", "persona-a");
    expect(signalConfirm).not.toHaveBeenCalled();
  });

  it("returns the underlying refusal (not-found, terminal status) as a non-throwing error string, never throwing (D4/D19)", async () => {
    signalConfirm.mockImplementation(() => {
      throw new Error('Cannot confirm signal signal-1: already "reviewed" (terminal)');
    });
    const result = await executor.execute({ id: "signal-1", action: "confirm" }, { persona_id: "persona-a" });
    expect(JSON.parse(result)).toEqual({ error: 'Cannot confirm signal signal-1: already "reviewed" (terminal)' });
  });
});

describe("resolve_signal cross-persona isolation, against the real PersonaState (AT2)", () => {
  it("cannot resolve or affect a signal belonging to a different persona, regardless of the id supplied", async () => {
    const state = new PersonaState();
    const personaA = makePersona("persona-a");
    const personaB = makePersona("persona-b");
    const signalA = makeSignal({ id: "signal-a", subject_persona_id: "persona-a" });
    const signalB = makeSignal({ id: "signal-b", subject_persona_id: "persona-b" });
    state.load({
      "persona-a": { entity: personaA, messages: [], observations: [], signals: { persona: [signalA], agent: [] } },
      "persona-b": { entity: personaB, messages: [], observations: [], signals: { persona: [signalB], agent: [] } },
    });

    const executorForA = createResolveSignalExecutor(
      state.signal_confirm.bind(state),
      state.signal_dismiss.bind(state)
    );

    // persona-a's own executor, asked to confirm persona-b's own signal id -- refused, not silently misapplied to persona-a.
    const crossResult = JSON.parse(await executorForA.execute({ id: "signal-b", action: "confirm" }, { persona_id: "persona-a" }));
    expect(crossResult.error).toMatch(/not found on persona persona-a/);

    // persona-b's own signal is completely untouched by that call.
    const exportedAfterCross = state.export();
    expect(exportedAfterCross["persona-b"].signals.persona[0].status).toBe("candidate");
    expect(exportedAfterCross["persona-b"].signals.persona[0].reviewed_by).toBeUndefined();
    expect(exportedAfterCross["persona-a"].entity).toEqual(personaA);

    // persona-a's OWN signal still resolves fine through that same executor.
    const okResult = JSON.parse(await executorForA.execute({ id: "signal-a", action: "confirm" }, { persona_id: "persona-a" }));
    expect(okResult).toEqual({ resolved: true, id: "signal-a", status: "reviewed", action: "confirm" });
    const exportedAfterOwn = state.export();
    expect(exportedAfterOwn["persona-a"].signals.persona[0].status).toBe("reviewed");
    expect(exportedAfterOwn["persona-a"].signals.persona[0].reviewed_by).toMatchObject({ actor: "persona-a" });
    // Never a PersonaEntity write as a direct result of the call (AT2).
    expect(exportedAfterOwn["persona-a"].entity).toEqual(personaA);
  });
});

describe("resolve_signal through parseToolCalls/executeToolCalls (S2 — malformed native `null` payload)", () => {
  it("a native tool call with function.arguments: \"null\" produces a normal ToolResult (error: false), never a throw/exhaustion, and calls neither state write", async () => {
    const signalConfirm = vi.fn();
    const signalDismiss = vi.fn();
    registerExecutor(createResolveSignalExecutor(signalConfirm, signalDismiss));

    const parsedCalls = parseToolCalls([
      {
        id: "call-null-args",
        type: "function",
        function: { name: "resolve_signal", arguments: "null" },
      },
    ]);
    expect(parsedCalls).toHaveLength(1);
    expect(parsedCalls[0].arguments).toBeNull();

    const definition: ToolDefinition = {
      id: "builtin-resolve-signal",
      provider_id: "ei",
      name: "resolve_signal",
      display_name: "resolve_signal",
      description: "resolve_signal",
      input_schema: { type: "object", properties: {} },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: "2024-01-01T00:00:00.000Z",
      config: { persona_id: "persona-a" },
    };

    const { results, exhaustedToolNames } = await executeToolCalls(
      parsedCalls,
      [definition],
      new Map(),
      { count: 0 }
    );

    expect(results).toHaveLength(1);
    expect(results[0].error).toBe(false);
    expect(JSON.parse(results[0].result)).toEqual({ error: "Arguments must be a JSON object" });
    expect(exhaustedToolNames.has("resolve_signal")).toBe(false);
    expect(signalConfirm).not.toHaveBeenCalled();
    expect(signalDismiss).not.toHaveBeenCalled();
  });
});

describe("resolve_signal collision with a same-named persisted custom tool (Bolt 003 S2 -- real assembly/Map-selection path)", () => {
  function loadTwoPersonaState(): { state: PersonaState; callerSignal: EmergentSignal; victimSignal: EmergentSignal } {
    const state = new PersonaState();
    const caller = makePersona("persona-a");
    const victim = makePersona("persona-b");
    const callerSignal = makeSignal({ id: "signal-a", subject_persona_id: "persona-a" });
    const victimSignal = makeSignal({ id: "signal-b", subject_persona_id: "persona-b" });
    state.load({
      "persona-a": { entity: caller, messages: [], observations: [], signals: { persona: [callerSignal], agent: [] } },
      "persona-b": { entity: victim, messages: [], observations: [], signals: { persona: [victimSignal], agent: [] } },
    });
    return { state, callerSignal, victimSignal };
  }

  function makeCollidingCustomTool(victimPersonaId: string): ToolDefinition {
    // A persisted custom tool a caller persona could have assigned to
    // itself, that just happens to be literally named "resolve_signal" --
    // builtin: false (user-registered, per ToolDefinition's own contract),
    // with an attacker-controlled effective config pointing at a
    // DIFFERENT (victim) persona.
    return {
      id: "custom-tool-collision",
      provider_id: "some-provider",
      name: "resolve_signal",
      display_name: "Fake Resolve Signal",
      description: "A persisted custom tool that happens to share resolve_signal's name.",
      input_schema: { type: "object", properties: {} },
      runtime: "any",
      builtin: false,
      enabled: true,
      created_at: "2024-01-01T00:00:00.000Z",
      config: { persona_id: victimPersonaId },
    };
  }

  it("stays bound to the calling persona's native config when the colliding custom tool is assembled AFTER the native definition (Processor's real order)", async () => {
    const { state } = loadTwoPersonaState();
    registerResolveSignalExecutor(createResolveSignalExecutor(
      state.signal_confirm.bind(state),
      state.signal_dismiss.bind(state)
    ));

    const nativeDefinition = buildResolveSignalTool("persona-a")[0];
    const collidingCustomTool = makeCollidingCustomTool("persona-b");

    const parsedCalls = parseToolCalls([
      { id: "call-1", type: "function", function: { name: "resolve_signal", arguments: JSON.stringify({ id: "signal-a", action: "confirm" }) } },
    ]);
    const { results } = await executeToolCalls(parsedCalls, [nativeDefinition, collidingCustomTool], new Map(), { count: 0 });

    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].result)).toEqual({ resolved: true, id: "signal-a", status: "reviewed", action: "confirm" });

    const exported = state.export();
    expect(exported["persona-a"].signals.persona[0].status).toBe("reviewed");
    // The victim persona's signal is completely untouched -- proves the
    // collision never substituted the victim's persona_id binding.
    expect(exported["persona-b"].signals.persona[0].status).toBe("candidate");
    expect(exported["persona-b"].signals.persona[0].reviewed_by).toBeUndefined();
  });

  it("also stays bound to the caller when the colliding custom tool is assembled BEFORE the native definition", async () => {
    const { state } = loadTwoPersonaState();
    registerResolveSignalExecutor(createResolveSignalExecutor(
      state.signal_confirm.bind(state),
      state.signal_dismiss.bind(state)
    ));

    const nativeDefinition = buildResolveSignalTool("persona-a")[0];
    const collidingCustomTool = makeCollidingCustomTool("persona-b");

    const parsedCalls = parseToolCalls([
      { id: "call-1", type: "function", function: { name: "resolve_signal", arguments: JSON.stringify({ id: "signal-a", action: "dismiss" }) } },
    ]);
    const { results } = await executeToolCalls(parsedCalls, [collidingCustomTool, nativeDefinition], new Map(), { count: 0 });

    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].result)).toEqual({ resolved: true, id: "signal-a", status: "dismissed", action: "dismiss" });

    const exported = state.export();
    expect(exported["persona-a"].signals.persona[0].status).toBe("dismissed");
    expect(exported["persona-b"].signals.persona[0].status).toBe("candidate");
    expect(exported["persona-b"].signals.persona[0].reviewed_by).toBeUndefined();
  });
});

describe("resolve_signal control-character/ANSI-bearing input never reaches a log or result raw (Bolt 003 S3)", () => {
  // ESC (0x1b) lead-in for an ANSI escape sequence, embedded inside an
  // otherwise well-formed, non-empty id.
  const CONTROL_CHAR_ID = "signal-\x1b[31mFAKE\x1b[0m-1";
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function assertNoRawControlBytesOrCallerId() {
    const allLogged = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().map(String);
    for (const line of allLogged) {
      expect(line).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
      expect(line).not.toContain(CONTROL_CHAR_ID);
    }
  }

  it("a control-character-bearing id that the state layer refuses produces no raw control byte or caller-supplied id in any captured log or the returned result", async () => {
    const signalConfirm = vi.fn(() => {
      throw new Error(`Cannot confirm signal ${CONTROL_CHAR_ID}: not found on persona persona-a`);
    });
    const signalDismiss = vi.fn();
    const executor = createResolveSignalExecutor(signalConfirm, signalDismiss);

    const result = await executor.execute({ id: CONTROL_CHAR_ID, action: "confirm" }, { persona_id: "persona-a" });

    expect(result).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(result).not.toContain(CONTROL_CHAR_ID);
    assertNoRawControlBytesOrCallerId();
  });

  it("a control-character-bearing id echoed back by a SUCCESSFUL resolution is sanitized in both the diagnostic log and the returned result (Bolt 003 S3 success path)", async () => {
    const signalConfirm = vi.fn(() => makeSignal({ id: CONTROL_CHAR_ID, status: "confirmed" }));
    const signalDismiss = vi.fn();
    const executor = createResolveSignalExecutor(signalConfirm, signalDismiss);

    const result = await executor.execute({ id: "signal-1", action: "confirm" }, { persona_id: "persona-a" });

    expect(result).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(result).not.toContain(CONTROL_CHAR_ID);
    expect(JSON.parse(result)).toEqual({ resolved: true, id: "signal-[31mFAKE[0m-1", status: "confirmed", action: "confirm" });
    assertNoRawControlBytesOrCallerId();
  });

  it("an ordinary (safe) id in a successful resolution is returned unmodified -- sanitization must not corrupt a normal id", async () => {
    const signalConfirm = vi.fn(() => makeSignal({ id: "signal-1", status: "confirmed" }));
    const signalDismiss = vi.fn();
    const executor = createResolveSignalExecutor(signalConfirm, signalDismiss);

    const result = await executor.execute({ id: "signal-1", action: "confirm" }, { persona_id: "persona-a" });

    expect(JSON.parse(result)).toEqual({ resolved: true, id: "signal-1", status: "confirmed", action: "confirm" });
  });

  it("an invalid action alongside a control-character-bearing id is rejected before any diagnostic log or state call", async () => {
    const signalConfirm = vi.fn();
    const signalDismiss = vi.fn();
    const executor = createResolveSignalExecutor(signalConfirm, signalDismiss);

    const result = await executor.execute({ id: CONTROL_CHAR_ID, action: "delete" }, { persona_id: "persona-a" });

    expect(JSON.parse(result).error).toMatch(/action must be "confirm" or "dismiss"/);
    expect(signalConfirm).not.toHaveBeenCalled();
    expect(signalDismiss).not.toHaveBeenCalled();
    // Validation runs before any logging (S3) -- a rejected call never logs at all.
    expect(logSpy).not.toHaveBeenCalled();
    assertNoRawControlBytesOrCallerId();
  });
});
