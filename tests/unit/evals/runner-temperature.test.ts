import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Runs one case through the eval runner's real request path and returns the body it sent.
async function sentBody(model: string, provider?: string): Promise<Record<string, unknown>> {
  vi.resetModules();
  vi.stubEnv("EVAL_MODEL", model);
  vi.stubEnv("EVAL_PROVIDER", provider ?? "");
  if (provider) vi.stubEnv("ANTHROPIC_API_KEY", "not-a-real-key");
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  // Dynamic on purpose: the runner reads its provider and model from the environment when it loads.
  const { runEval } = await import("../../evals/runner.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-runner-temp-"));
  try {
    await runEval(
      [{ description: "temperature probe", observe: true, prompt: () => ({ system: "s", user: "u" }) }],
      path.join(dir, "out.json")
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
}

describe("eval runner temperature", () => {
  it.each(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"])("omits temperature for %s", async (model) => {
    expect("temperature" in (await sentBody(model, "anthropic"))).toBe(false);
  });

  it("still sends temperature to a model that accepts it", async () => {
    expect((await sentBody("claude-sonnet-4-6", "anthropic")).temperature).toBe(0.7);
  });

  it("still sends temperature to a local model", async () => {
    expect((await sentBody("some/local-model")).temperature).toBe(0.7);
  });
});
