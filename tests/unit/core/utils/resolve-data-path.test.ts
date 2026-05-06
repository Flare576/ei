import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { resolveDataPath } from "../../../../src/core/utils/resolve-data-path.js"

const ENV_KEYS = ["EI_DATA_PATH", "XDG_DATA_HOME", "HOME"] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe("resolveDataPath", () => {
  it("returns EI_DATA_PATH when set", () => {
    process.env.EI_DATA_PATH = "/custom/path"
    expect(resolveDataPath()).toBe("/custom/path")
  })

  it("strips trailing slashes from EI_DATA_PATH", () => {
    process.env.EI_DATA_PATH = "/custom/path///"
    expect(resolveDataPath()).toBe("/custom/path")
  })

  it("falls back to XDG_DATA_HOME/ei when EI_DATA_PATH is unset", () => {
    process.env.XDG_DATA_HOME = "/xdg/data"
    expect(resolveDataPath()).toBe("/xdg/data/ei")
  })

  it("falls back to HOME/.local/share/ei when neither EI_DATA_PATH nor XDG_DATA_HOME is set", () => {
    process.env.HOME = "/home/testuser"
    expect(resolveDataPath()).toBe("/home/testuser/.local/share/ei")
  })

  it("returns null when no env vars are available", () => {
    expect(resolveDataPath()).toBeNull()
  })

  it("prefers EI_DATA_PATH over XDG_DATA_HOME", () => {
    process.env.EI_DATA_PATH = "/explicit"
    process.env.XDG_DATA_HOME = "/xdg/data"
    expect(resolveDataPath()).toBe("/explicit")
  })

  it("prefers XDG_DATA_HOME over HOME fallback", () => {
    process.env.XDG_DATA_HOME = "/xdg/data"
    process.env.HOME = "/home/testuser"
    expect(resolveDataPath()).toBe("/xdg/data/ei")
  })
})
