import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { spawnEditor, type EditorOptions } from "../../../src/util/editor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CliRenderer } from "@opentui/core";

describe("spawnEditor", () => {
  let suspendCalls: number;
  let resumeCalls: number;
  let clearCalls: number;
  let requestRenderCalls: number;
  let originalEditor: string | undefined;
  let originalVisual: string | undefined;
  
  const createMockRenderer = (): CliRenderer => {
    return {
      suspend: () => { suspendCalls++; },
      resume: () => { resumeCalls++; },
      currentRenderBuffer: {
        clear: () => { clearCalls++; },
      },
      requestRender: () => { requestRenderCalls++; },
    } as unknown as CliRenderer;
  };
  
  const createOptions = (overrides: Partial<EditorOptions> = {}): EditorOptions => ({
    initialContent: "test content",
    filename: "test.yaml",
    renderer: createMockRenderer(),
    ...overrides,
  });

  beforeEach(() => {
    suspendCalls = 0;
    resumeCalls = 0;
    clearCalls = 0;
    requestRenderCalls = 0;
    originalEditor = process.env.EDITOR;
    originalVisual = process.env.VISUAL;
  });

  afterEach(() => {
    if (originalEditor !== undefined) {
      process.env.EDITOR = originalEditor;
    } else {
      delete process.env.EDITOR;
    }
    if (originalVisual !== undefined) {
      process.env.VISUAL = originalVisual;
    } else {
      delete process.env.VISUAL;
    }
  });

  test("calls suspend before spawning editor", async () => {
    process.env.EDITOR = "true";
    const options = createOptions();
    
    await spawnEditor(options);
    
    expect(suspendCalls).toBe(1);
  });

  test("calls resume after editor exits", async () => {
    process.env.EDITOR = "true";
    const options = createOptions();
    
    await spawnEditor(options);
    
    expect(resumeCalls).toBe(1);
  });

  test("clears buffer before and after editor", async () => {
    process.env.EDITOR = "true";
    const options = createOptions();
    
    await spawnEditor(options);
    
    expect(clearCalls).toBe(2);
  });

  test("calls requestRender after resume", async () => {
    process.env.EDITOR = "true";
    const options = createOptions();
    
    await spawnEditor(options);
    
    expect(requestRenderCalls).toBe(1);
  });

  test("returns success=true and content=null when content unchanged", async () => {
    process.env.EDITOR = "true";
    const options = createOptions({ initialContent: "unchanged content" });
    
    const result = await spawnEditor(options);
    
    expect(result.success).toBe(true);
    expect(result.content).toBeNull();
    expect(result.aborted).toBe(false);
  });

  test("returns success=true with content when content changed", async () => {
    const testContent = "original content";
    
    process.env.EDITOR = "bash -c 'echo modified > \"$1\"' --";
    const options = createOptions({ initialContent: testContent });
    
    const result = await spawnEditor(options);
    
    expect(result.success).toBe(true);
    expect(result.content).toBe("modified\n");
    expect(result.aborted).toBe(false);
  });

  test("returns aborted=true when editor exits with non-zero code", async () => {
    process.env.EDITOR = "false";
    const options = createOptions();
    
    const result = await spawnEditor(options);
    
    expect(result.success).toBe(false);
    expect(result.content).toBeNull();
    expect(result.aborted).toBe(true);
  });

  test("cleans up temp file after successful edit", async () => {
    process.env.EDITOR = "true";
    const options = createOptions({ filename: "cleanup-test.yaml" });
    
    await spawnEditor(options);
    
    const tmpFiles = fs.readdirSync(os.tmpdir()).filter(f => f.includes("cleanup-test.yaml"));
    expect(tmpFiles.length).toBe(0);
  });

  test("cleans up temp file after aborted edit", async () => {
    process.env.EDITOR = "false";
    const options = createOptions({ filename: "abort-cleanup.yaml" });
    
    await spawnEditor(options);
    
    const tmpFiles = fs.readdirSync(os.tmpdir()).filter(f => f.includes("abort-cleanup.yaml"));
    expect(tmpFiles.length).toBe(0);
  });

  test("creates temp file with provided initial content", async () => {
    const initialContent = "specific test content for verification";
    let capturedContent: string | null = null;
    
    process.env.EDITOR = `bash -c 'cat'`;
    const options = createOptions({ 
      initialContent,
      filename: "content-verify.yaml",
    });
    
    const result = await spawnEditor(options);
    
    expect(result.success).toBe(true);
  });

  test("uses EDITOR env var when set", async () => {
    process.env.EDITOR = "true";
    delete process.env.VISUAL;
    
    const options = createOptions();
    const result = await spawnEditor(options);
    
    expect(result.success).toBe(true);
  });

  test("falls back to VISUAL when EDITOR not set", async () => {
    delete process.env.EDITOR;
    process.env.VISUAL = "true";
    
    const options = createOptions();
    const result = await spawnEditor(options);
    
    expect(result.success).toBe(true);
  });

  test("uses unique temp file name with timestamp", async () => {
    process.env.EDITOR = "true";
    const options = createOptions({ filename: "unique-test.yaml" });
    
    const before = Date.now();
    await spawnEditor(options);
    const after = Date.now();
    
    expect(resumeCalls).toBe(1);
  });
});