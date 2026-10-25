import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeToolCalls } from "../../../src/core/tools/index.js";
import { clearTokenCache } from "../../../src/core/tools/builtin/spotify-auth.js";
import { clearLikedSongsCache } from "../../../src/core/tools/builtin/spotify-liked-songs.js";
import { getSlackAccessToken, clearSlackTokenCache } from "../../../src/core/tools/builtin/slack-auth.js";
import { ToolFailure } from "../../../src/core/tools/tool-error.js";
import type { ToolDefinition } from "../../../src/core/types.js";

function spotifyTool(name: string, config: Record<string, string>): ToolDefinition {
  return {
    id: `${name}-id`,
    provider_id: "spotify-provider",
    name,
    display_name: name,
    description: name,
    input_schema: { type: "object", properties: {} },
    runtime: "any",
    builtin: true,
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
    config,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

async function run(name: string, config: Record<string, string>) {
  const { results, exhaustedToolNames } = await executeToolCalls(
    [{ id: "c1", name, arguments: {} }],
    [spotifyTool(name, config)],
    new Map(),
    { count: 0 }
  );
  return { result: results[0], parsed: JSON.parse(results[0].result), exhaustedToolNames };
}

const TOOLS = ["get_currently_playing", "get_liked_songs"] as const;

describe.each(TOOLS)("%s failure reporting", (toolName) => {
  beforeEach(() => {
    clearTokenCache();
    clearLikedSongsCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("explains a dead refresh token and exhausts the tool", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(400, { error: "invalid_grant", error_description: "Refresh token revoked" })
    ));

    const { result, parsed, exhaustedToolNames } = await run(toolName, { spotify_refresh_token: "dead" });

    expect(result.error).toBe(true);
    expect(parsed.error).toBe("token_refresh_failed");
    expect(parsed.message).toContain("400");
    expect(parsed.message).toContain("invalid_grant");
    expect(parsed.remediation).toContain("/auth spotify");
    expect(parsed.remediation).toContain("Settings → Toolkits");
    expect(exhaustedToolNames.has(toolName)).toBe(true);
  });

  it("reports a missing refresh token as not_authenticated", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result, parsed, exhaustedToolNames } = await run(toolName, {});

    expect(result.error).toBe(true);
    expect(parsed.error).toBe("not_authenticated");
    expect(parsed.message).toBe("Spotify is not connected.");
    expect(parsed.remediation).toContain("/auth spotify");
    expect(exhaustedToolNames.has(toolName)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("maps API status %i to a reconnect instruction", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("accounts.spotify.com")
        ? jsonResponse(200, { access_token: "a", expires_in: 3600 })
        : jsonResponse(status, { error: { status } })
    ));

    const { result, parsed, exhaustedToolNames } = await run(toolName, { spotify_refresh_token: "ok" });

    expect(result.error).toBe(true);
    expect(parsed.message).toContain(String(status));
    expect(parsed.remediation).toContain("/auth spotify");
    expect(exhaustedToolNames.has(toolName)).toBe(true);
  });

  it.each([429, 503])("maps API status %i to a try-later explanation", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("accounts.spotify.com")
        ? jsonResponse(200, { access_token: "a", expires_in: 3600 })
        : jsonResponse(status, "")
    ));

    const { result, parsed } = await run(toolName, { spotify_refresh_token: "ok" });

    expect(result.error).toBe(true);
    expect(parsed.message).toContain(String(status));
    expect(parsed.remediation).toMatch(/later/i);
    expect(parsed.remediation).not.toContain("/auth spotify");
  });
});

describe("get_currently_playing success paths are unchanged", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns nothing_playing for 204 without error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("accounts.spotify.com")
        ? jsonResponse(200, { access_token: "a", expires_in: 3600 })
        : new Response(null, { status: 204 })
    ));

    const { result, parsed } = await run("get_currently_playing", { spotify_refresh_token: "ok" });

    expect(result.error).toBe(false);
    expect(parsed).toEqual({ nothing_playing: true });
  });
});

describe("getSlackAccessToken failures", () => {
  beforeEach(() => clearSlackTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  async function failureOf(promise: Promise<unknown>): Promise<ToolFailure> {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(ToolFailure);
      return err as ToolFailure;
    }
    throw new Error("expected rejection");
  }

  it("HTTP failure becomes token_refresh_failed with Slack reconnect steps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, "boom")));
    const failure = await failureOf(getSlackAccessToken("rt"));
    expect(failure.code).toBe("token_refresh_failed");
    expect(failure.message).toContain("500");
    expect(failure.remediation).toContain("/auth slack");
    expect(failure.remediation).toContain("My Data → External → Connect Slack");
  });

  it("ok:false body becomes token_refresh_failed carrying Slack's error code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: false, error: "invalid_refresh_token" })));
    const failure = await failureOf(getSlackAccessToken("rt"));
    expect(failure.code).toBe("token_refresh_failed");
    expect(failure.message).toContain("invalid_refresh_token");
    expect(failure.remediation).toContain("/auth slack");
  });
});
