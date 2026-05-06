import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { resolveDataPath } from "../../../src/util/resolve-data-path"

const ENV_KEYS = ["EI_DATA_PATH", "XDG_DATA_HOME", "HOME"] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = Bun.env[key]
  for (const key of ENV_KEYS) delete Bun.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete Bun.env[key]
    else Bun.env[key] = saved[key]
  }
})

describe("resolveDataPath", () => {
  test("returns EI_DATA_PATH when set", () => {
    Bun.env.EI_DATA_PATH = "/custom/path"
    expect(resolveDataPath()).toBe("/custom/path")
  })

  test("strips trailing slashes from EI_DATA_PATH", () => {
    Bun.env.EI_DATA_PATH = "/custom/path///"
    expect(resolveDataPath()).toBe("/custom/path")
  })

  test("accepts an explicit override, stripping trailing slashes", () => {
    Bun.env.EI_DATA_PATH = "/env/path"
    expect(resolveDataPath("/override//")).toBe("/override")
  })

  test("falls back to XDG_DATA_HOME/ei when EI_DATA_PATH is unset", () => {
    Bun.env.XDG_DATA_HOME = "/xdg/data"
    expect(resolveDataPath()).toBe("/xdg/data/ei")
  })

  test("falls back to HOME/.local/share/ei when neither EI_DATA_PATH nor XDG_DATA_HOME is set", () => {
    Bun.env.HOME = "/home/testuser"
    expect(resolveDataPath()).toBe("/home/testuser/.local/share/ei")
  })

  test("prefers EI_DATA_PATH over XDG_DATA_HOME", () => {
    Bun.env.EI_DATA_PATH = "/explicit"
    Bun.env.XDG_DATA_HOME = "/xdg/data"
    expect(resolveDataPath()).toBe("/explicit")
  })

  test("prefers XDG_DATA_HOME over HOME fallback", () => {
    Bun.env.XDG_DATA_HOME = "/xdg/data"
    Bun.env.HOME = "/home/testuser"
    expect(resolveDataPath()).toBe("/xdg/data/ei")
  })
})
