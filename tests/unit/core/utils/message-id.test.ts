import { describe, it, expect } from "vitest"
import {
  parseMessageId,
  isQualifiedMessageId,
  qualifyEiMessage,
  qualifyOpenCodeMessage,
  qualifyClaudeCodeMessage,
  qualifyCursorMessage,
  qualifyCodexMessage,
  qualifyDocumentMessage,
} from "../../../../src/core/utils/message-id.js"

describe("parseMessageId — ei", () => {
  it("parses a valid ei ID", () => {
    const r = parseMessageId("ei:abc-123")
    expect(r.integration).toBe("ei")
    expect(r.nativeId).toBe("abc-123")
    expect(r.raw).toBe("ei:abc-123")
    expect(r.machine).toBeUndefined()
    expect(r.session).toBeUndefined()
  })
})

describe("parseMessageId — opencode", () => {
  it("parses a valid opencode ID", () => {
    const r = parseMessageId("opencode:my-macbook:ses_38a7:msg_c75b")
    expect(r.integration).toBe("opencode")
    expect(r.machine).toBe("my-macbook")
    expect(r.session).toBe("ses_38a7")
    expect(r.nativeId).toBe("msg_c75b")
    expect(r.raw).toBe("opencode:my-macbook:ses_38a7:msg_c75b")
  })

  it("round-trips qualifyOpenCodeMessage → parseMessageId", () => {
    const fq = qualifyOpenCodeMessage("my-macbook", "ses_38a7", "msg_c75b")
    const r = parseMessageId(fq)
    expect(r.integration).toBe("opencode")
    expect(r.machine).toBe("my-macbook")
    expect(r.session).toBe("ses_38a7")
    expect(r.nativeId).toBe("msg_c75b")
  })
})

describe("parseMessageId — claudecode", () => {
  it("parses a valid claudecode ID", () => {
    const r = parseMessageId("claudecode:machine-x:session-abc:uuid-def")
    expect(r.integration).toBe("claudecode")
    expect(r.machine).toBe("machine-x")
    expect(r.session).toBe("session-abc")
    expect(r.nativeId).toBe("uuid-def")
  })

  it("round-trips qualifyClaudeCodeMessage → parseMessageId", () => {
    const fq = qualifyClaudeCodeMessage("machine-x", "session-abc", "uuid-def")
    const r = parseMessageId(fq)
    expect(r.integration).toBe("claudecode")
    expect(r.nativeId).toBe("uuid-def")
  })
})

describe("parseMessageId — cursor", () => {
  it("parses a valid cursor ID", () => {
    const r = parseMessageId("cursor:laptop:session-1:bubble-2")
    expect(r.integration).toBe("cursor")
    expect(r.machine).toBe("laptop")
    expect(r.session).toBe("session-1")
    expect(r.nativeId).toBe("bubble-2")
  })

  it("round-trips qualifyCursorMessage → parseMessageId", () => {
    const fq = qualifyCursorMessage("laptop", "session-1", "bubble-2")
    const r = parseMessageId(fq)
    expect(r.integration).toBe("cursor")
    expect(r.nativeId).toBe("bubble-2")
  })
})

describe("parseMessageId — codex", () => {
  it("parses a valid codex ID", () => {
    const r = parseMessageId("codex:laptop:thread-1:evt_42")
    expect(r.integration).toBe("codex")
    expect(r.machine).toBe("laptop")
    expect(r.session).toBe("thread-1")
    expect(r.nativeId).toBe("evt_42")
  })

  it("round-trips qualifyCodexMessage → parseMessageId", () => {
    const fq = qualifyCodexMessage("laptop", "thread-1", "evt_42")
    const r = parseMessageId(fq)
    expect(r.integration).toBe("codex")
    expect(r.nativeId).toBe("evt_42")
  })
})

describe("parseMessageId — import", () => {
  it("parses a valid import:document ID", () => {
    const r = parseMessageId("import:document:my-journal:0da9e1e8-abcd-1234-ef00-aabbccddeeff")
    expect(r.integration).toBe("import")
    expect(r.session).toBe("my-journal")
    expect(r.nativeId).toBe("0da9e1e8-abcd-1234-ef00-aabbccddeeff")
    expect(r.machine).toBeUndefined()
  })

  it("round-trips qualifyDocumentMessage → parseMessageId", () => {
    const fq = qualifyDocumentMessage("my-journal", "0da9e1e8-abcd-1234-ef00-aabbccddeeff")
    const r = parseMessageId(fq)
    expect(r.integration).toBe("import")
    expect(r.session).toBe("my-journal")
    expect(r.nativeId).toBe("0da9e1e8-abcd-1234-ef00-aabbccddeeff")
  })
})

describe("parseMessageId — slack", () => {
  it("parses a valid slack ID", () => {
    const r = parseMessageId("slack:T01WORKSPACE:C01CHANNEL:1234567890.123456")
    expect(r.integration).toBe("slack")
    expect(r.machine).toBe("T01WORKSPACE")
    expect(r.session).toBe("C01CHANNEL")
    expect(r.nativeId).toBe("1234567890.123456")
  })
})

describe("parseMessageId — unknown / malformed", () => {
  it("returns unknown for a bare UUID", () => {
    const r = parseMessageId("0da9e1e8-abcd-1234-ef00-aabbccddeeff")
    expect(r.integration).toBe("unknown")
    expect(r.nativeId).toBe("0da9e1e8-abcd-1234-ef00-aabbccddeeff")
    expect(r.raw).toBe("0da9e1e8-abcd-1234-ef00-aabbccddeeff")
  })

  it("returns unknown for a bare OpenCode-style msg ID", () => {
    const r = parseMessageId("msg_c75b1234abcd")
    expect(r.integration).toBe("unknown")
    expect(r.nativeId).toBe("msg_c75b1234abcd")
  })

  it("returns unknown for ei with too many segments", () => {
    const r = parseMessageId("ei:abc:extra")
    expect(r.integration).toBe("unknown")
  })

  it("returns unknown for opencode with fewer than 4 segments", () => {
    const r = parseMessageId("opencode:machine:session")
    expect(r.integration).toBe("unknown")
  })

  it("returns unknown for import without document keyword", () => {
    const r = parseMessageId("import:other:slug:uuid")
    expect(r.integration).toBe("unknown")
  })

  it("returns unknown for empty string", () => {
    const r = parseMessageId("")
    expect(r.integration).toBe("unknown")
    expect(r.nativeId).toBe("")
  })

  it("returns unknown for null-ish values (coerced)", () => {
    const r = parseMessageId(null as any)
    expect(r.integration).toBe("unknown")
  })

  it("returns unknown for undefined (coerced)", () => {
    const r = parseMessageId(undefined as any)
    expect(r.integration).toBe("unknown")
  })
})

describe("isQualifiedMessageId", () => {
  it("returns true when ID contains a colon", () => {
    expect(isQualifiedMessageId("ei:abc")).toBe(true)
    expect(isQualifiedMessageId("opencode:m:s:n")).toBe(true)
  })

  it("returns false for bare IDs", () => {
    expect(isQualifiedMessageId("msg_c75b1234abcd")).toBe(false)
    expect(isQualifiedMessageId("0da9e1e8-abcd-1234-ef00-aabbccddeeff")).toBe(false)
  })
})

describe("qualify helpers — ei", () => {
  it("qualifyEiMessage produces ei:uuid", () => {
    expect(qualifyEiMessage("abc-123")).toBe("ei:abc-123")
  })
})

describe("qualify helpers — round-trips", () => {
  it("qualifyOpenCodeMessage round-trips", () => {
    const fq = qualifyOpenCodeMessage("m", "s", "n")
    expect(fq).toBe("opencode:m:s:n")
    const r = parseMessageId(fq)
    expect(r).toMatchObject({ integration: "opencode", machine: "m", session: "s", nativeId: "n" })
  })

  it("qualifyClaudeCodeMessage round-trips", () => {
    const fq = qualifyClaudeCodeMessage("m", "s", "n")
    expect(fq).toBe("claudecode:m:s:n")
    const r = parseMessageId(fq)
    expect(r).toMatchObject({ integration: "claudecode", machine: "m", session: "s", nativeId: "n" })
  })

  it("qualifyCursorMessage round-trips", () => {
    const fq = qualifyCursorMessage("m", "s", "n")
    expect(fq).toBe("cursor:m:s:n")
    const r = parseMessageId(fq)
    expect(r).toMatchObject({ integration: "cursor", machine: "m", session: "s", nativeId: "n" })
  })

  it("qualifyCodexMessage round-trips", () => {
    const fq = qualifyCodexMessage("m", "s", "n")
    expect(fq).toBe("codex:m:s:n")
    const r = parseMessageId(fq)
    expect(r).toMatchObject({ integration: "codex", machine: "m", session: "s", nativeId: "n" })
  })

  it("qualifyDocumentMessage round-trips", () => {
    const fq = qualifyDocumentMessage("slug", "uuid")
    expect(fq).toBe("import:document:slug:uuid")
    const r = parseMessageId(fq)
    expect(r).toMatchObject({ integration: "import", session: "slug", nativeId: "uuid" })
  })
})
