// Tested by Beta — 2026-05-20
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAddNoteExecutor, createClearNoteExecutor, NOTES_MAX } from "../../../../src/core/tools/builtin/persona-notes.js";
import type { PersonaEntity } from "../../../../src/core/types.js";

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "TestPersona",
    entity: "system",
    aliases: [],
    short_description: "Test",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

describe("createAddNoteExecutor", () => {
  let getPersona: ReturnType<typeof vi.fn>;
  let updatePersona: ReturnType<typeof vi.fn>;
  let executor: ReturnType<typeof createAddNoteExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    getPersona = vi.fn();
    updatePersona = vi.fn().mockReturnValue(true);
    executor = createAddNoteExecutor(getPersona, updatePersona);
  });

  it("returns error when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({ text: "hello" }, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error when config is undefined", async () => {
    const result = JSON.parse(await executor.execute({ text: "hello" }, undefined));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error when text arg is missing", async () => {
    const result = JSON.parse(await executor.execute({}, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Missing required argument: text" });
  });

  it("returns error when text is empty string", async () => {
    const result = JSON.parse(await executor.execute({ text: "" }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Missing required argument: text" });
  });

  it("returns error when text is whitespace only", async () => {
    const result = JSON.parse(await executor.execute({ text: "   " }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Missing required argument: text" });
  });

  it("returns error when persona not found", async () => {
    getPersona.mockReturnValue(null);
    const result = JSON.parse(await executor.execute({ text: "hello" }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Persona not found" });
  });

  it("adds note to persona with existing notes", async () => {
    const persona = makePersona({ notes: ["existing note"] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ text: "new note" }, { persona_id: "persona-1" }));

    expect(result).toEqual({ added: true, index: 2, total: 2 });
    expect(updatePersona).toHaveBeenCalledWith("persona-1", { notes: ["existing note", "new note"] });
  });

  it("adds note to persona with no existing notes (notes undefined)", async () => {
    const persona = makePersona({ notes: undefined });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ text: "first note" }, { persona_id: "persona-1" }));

    expect(result).toEqual({ added: true, index: 1, total: 1 });
    expect(updatePersona).toHaveBeenCalledWith("persona-1", { notes: ["first note"] });
  });

  it("adds note to persona with empty notes array", async () => {
    const persona = makePersona({ notes: [] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ text: "first note" }, { persona_id: "persona-1" }));

    expect(result).toEqual({ added: true, index: 1, total: 1 });
  });

  it("shifts oldest note when at NOTES_MAX capacity", async () => {
    const notes = Array.from({ length: NOTES_MAX }, (_, i) => `note ${i + 1}`);
    const persona = makePersona({ notes });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ text: "overflow note" }, { persona_id: "persona-1" }));

    expect(result).toEqual({ added: true, index: NOTES_MAX, total: NOTES_MAX });
    const calledWith = updatePersona.mock.calls[0][1].notes as string[];
    expect(calledWith).toHaveLength(NOTES_MAX);
    expect(calledWith[0]).toBe("note 2");
    expect(calledWith[calledWith.length - 1]).toBe("overflow note");
  });

  it("total stays <= NOTES_MAX after overflow", async () => {
    const notes = Array.from({ length: NOTES_MAX }, (_, i) => `note ${i + 1}`);
    const persona = makePersona({ notes });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ text: "overflow" }, { persona_id: "persona-1" }));

    expect(result.total).toBe(NOTES_MAX);
  });

  it("trims whitespace from text before storing", async () => {
    const persona = makePersona({ notes: [] });
    getPersona.mockReturnValue(persona);

    await executor.execute({ text: "  trimmed  " }, { persona_id: "persona-1" });

    const calledWith = updatePersona.mock.calls[0][1].notes as string[];
    expect(calledWith[0]).toBe("trimmed");
  });

  it("does not mutate original persona notes array", async () => {
    const originalNotes = ["note 1"];
    const persona = makePersona({ notes: originalNotes });
    getPersona.mockReturnValue(persona);

    await executor.execute({ text: "new note" }, { persona_id: "persona-1" });

    expect(originalNotes).toHaveLength(1);
  });
});

describe("createClearNoteExecutor", () => {
  let getPersona: ReturnType<typeof vi.fn>;
  let updatePersona: ReturnType<typeof vi.fn>;
  let executor: ReturnType<typeof createClearNoteExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    getPersona = vi.fn();
    updatePersona = vi.fn().mockReturnValue(true);
    executor = createClearNoteExecutor(getPersona, updatePersona);
  });

  it("returns error when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({ index: 1 }, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error when config is undefined", async () => {
    const result = JSON.parse(await executor.execute({ index: 1 }, undefined));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error when index is not a number", async () => {
    const result = JSON.parse(await executor.execute({ index: "1" }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "index must be an integer >= 1" });
  });

  it("returns error when index is a float", async () => {
    const result = JSON.parse(await executor.execute({ index: 1.5 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "index must be an integer >= 1" });
  });

  it("returns error when index is 0", async () => {
    const result = JSON.parse(await executor.execute({ index: 0 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "index must be an integer >= 1" });
  });

  it("returns error when index is negative", async () => {
    const result = JSON.parse(await executor.execute({ index: -1 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "index must be an integer >= 1" });
  });

  it("returns error when index is missing", async () => {
    const result = JSON.parse(await executor.execute({}, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "index must be an integer >= 1" });
  });

  it("returns error when persona not found", async () => {
    getPersona.mockReturnValue(null);
    const result = JSON.parse(await executor.execute({ index: 1 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Persona not found" });
  });

  it("returns error when index is out of bounds", async () => {
    const persona = makePersona({ notes: ["note 1", "note 2"] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 3 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "No note at index 3 (total: 2)" });
  });

  it("returns error when notes is empty and index is 1", async () => {
    const persona = makePersona({ notes: [] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 1 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "No note at index 1 (total: 0)" });
  });

  it("clears note at 1-based index 1", async () => {
    const persona = makePersona({ notes: ["first", "second", "third"] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 1 }, { persona_id: "persona-1" }));

    expect(result).toEqual({ cleared: true, index: 1, remaining: 2 });
    expect(updatePersona).toHaveBeenCalledWith("persona-1", { notes: ["second", "third"] });
  });

  it("clears note at 1-based index in the middle", async () => {
    const persona = makePersona({ notes: ["first", "second", "third"] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 2 }, { persona_id: "persona-1" }));

    expect(result).toEqual({ cleared: true, index: 2, remaining: 2 });
    expect(updatePersona).toHaveBeenCalledWith("persona-1", { notes: ["first", "third"] });
  });

  it("clears note at last index", async () => {
    const persona = makePersona({ notes: ["first", "second", "third"] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 3 }, { persona_id: "persona-1" }));

    expect(result).toEqual({ cleared: true, index: 3, remaining: 2 });
    expect(updatePersona).toHaveBeenCalledWith("persona-1", { notes: ["first", "second"] });
  });

  it("clears the only note leaving empty array", async () => {
    const persona = makePersona({ notes: ["only note"] });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 1 }, { persona_id: "persona-1" }));

    expect(result).toEqual({ cleared: true, index: 1, remaining: 0 });
    expect(updatePersona).toHaveBeenCalledWith("persona-1", { notes: [] });
  });

  it("does not mutate original persona notes array", async () => {
    const originalNotes = ["note 1", "note 2"];
    const persona = makePersona({ notes: originalNotes });
    getPersona.mockReturnValue(persona);

    await executor.execute({ index: 1 }, { persona_id: "persona-1" });

    expect(originalNotes).toHaveLength(2);
  });

  it("handles persona with notes undefined (treats as empty)", async () => {
    const persona = makePersona({ notes: undefined });
    getPersona.mockReturnValue(persona);

    const result = JSON.parse(await executor.execute({ index: 1 }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "No note at index 1 (total: 0)" });
  });
});
