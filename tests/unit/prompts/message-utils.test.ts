import { describe, it, expect } from "vitest"
import { hydratePromptPlaceholders, formatMessageAsPlaceholder } from "../../../src/prompts/message-utils.js"
import type { Message } from "../../../src/core/types.js"

function makeMessage(overrides: Partial<Message> & { id: string }): Message {
  return {
    role: "human",
    content: "test content",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("formatMessageAsPlaceholder", () => {
  it("produces [mid:id:role] for a short legacy id", () => {
    const msg = makeMessage({ id: "abc-123", role: "human" })
    expect(formatMessageAsPlaceholder(msg, "Ei")).toBe("[mid:abc-123:human]")
  })

  it("uses speaker_name for non-human messages", () => {
    const msg = makeMessage({ id: "abc-123", role: "system", speaker_name: "Ei" })
    expect(formatMessageAsPlaceholder(msg, "Ei")).toBe("[mid:abc-123:Ei]")
  })

  it("falls back to personaName when speaker_name is absent", () => {
    const msg = makeMessage({ id: "abc-123", role: "system" })
    expect(formatMessageAsPlaceholder(msg, "Sage")).toBe("[mid:abc-123:Sage]")
  })

  it("produces correct placeholder for a fully-qualified OpenCode id", () => {
    const id = "mymachine:ses_34fc3f32:msg_cb03c0cd:human"
    const msg = makeMessage({ id, role: "human" })
    expect(formatMessageAsPlaceholder(msg, "Ei")).toBe(`[mid:${id}:human]`)
  })
})

describe("hydratePromptPlaceholders", () => {
  it("replaces a short legacy id placeholder with message content", () => {
    const msg = makeMessage({ id: "abc-123", role: "human", content: "Hello world" })
    const map = new Map([["abc-123", msg]])
    const result = hydratePromptPlaceholders("[mid:abc-123:human]", map)
    expect(result).toBe("[human]: Hello world")
  })

  it("replaces a fully-qualified id placeholder with message content", () => {
    const id = "mymachine:ses_34fc3f32fffeh7vnszv5:msg_cb03c0cd6001ap"
    const msg = makeMessage({ id, role: "human", content: "Hello from FQ" })
    const map = new Map([[id, msg]])
    const result = hydratePromptPlaceholders(`[mid:${id}:human]`, map)
    expect(result).toBe("[human]: Hello from FQ")
  })

  it("renders [message not found] when id is missing from map", () => {
    const map = new Map<string, Message>()
    const result = hydratePromptPlaceholders("[mid:missing-id:human]", map)
    expect(result).toBe("[human]: [message not found]")
  })

  it("hydrates multiple placeholders in the same string", () => {
    const msg1 = makeMessage({ id: "id-1", role: "human", content: "First" })
    const msg2 = makeMessage({ id: "id-2", role: "system", speaker_name: "Ei", content: "Second" })
    const map = new Map([["id-1", msg1], ["id-2", msg2]])
    const result = hydratePromptPlaceholders("[mid:id-1:human]\n\n[mid:id-2:Ei]", map)
    expect(result).toBe("[human]: First\n\n[Ei]: Second")
  })

  it("hydrates FQ and legacy ids in the same string", () => {
    const fqId = "machine1:ses_abc:msg_xyz"
    const msg1 = makeMessage({ id: fqId, role: "human", content: "FQ message" })
    const msg2 = makeMessage({ id: "legacy-id", role: "system", speaker_name: "Build", content: "Legacy message" })
    const map = new Map([[fqId, msg1], ["legacy-id", msg2]])
    const prompt = `[mid:${fqId}:human]\n\n[mid:legacy-id:Build]`
    const result = hydratePromptPlaceholders(prompt, map)
    expect(result).toBe("[human]: FQ message\n\n[Build]: Legacy message")
  })
})
