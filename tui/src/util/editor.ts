import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CliRenderer } from "@opentui/core";
import { RendererControlState } from "@opentui/core";
import { logger } from "./logger";

export interface EditorOptions {
  initialContent: string;
  filename: string;
  renderer: CliRenderer;
}

export interface EditorRawOptions {
  initialContent: string;
  filename: string;
}

export interface EditorResult {
  success: boolean;
  content: string | null;
  aborted: boolean;
}

export async function spawnEditorRaw(options: EditorRawOptions): Promise<EditorResult> {
  const { initialContent, filename } = options;
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const tmpDir = os.tmpdir();
  const safeName = filename.replace(/\s+/g, "-");
  const tmpFile = path.join(tmpDir, `ei-${Date.now()}-${safeName}`);
  
  logger.debug("[editor] spawnEditorRaw called", { filename, editor });
  
  fs.writeFileSync(tmpFile, initialContent, "utf-8");
  const originalContent = initialContent;
  
  return new Promise((resolve) => {
    logger.debug("[editor] spawning editor process (raw)");
    const child = spawn(editor, [tmpFile], {
      stdio: "inherit",
      shell: true,
    });
    
    child.on("error", () => {
      logger.error("[editor] editor process error (raw)");
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve({
        success: false,
        content: null,
        aborted: false,
      });
    });
    
    child.on("exit", (code) => {
      logger.debug("[editor] editor process exited (raw)", { code });
      
      if (code !== 0) {
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve({
          success: false,
          content: null,
          aborted: true,
        });
        return;
      }
      
      let editedContent: string;
      try {
        editedContent = fs.readFileSync(tmpFile, "utf-8");
      } catch {
        resolve({
          success: false,
          content: null,
          aborted: false,
        });
        return;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      
      if (editedContent === originalContent) {
        resolve({
          success: true,
          content: null,
          aborted: false,
        });
        return;
      }
      
      resolve({
        success: true,
        content: editedContent,
        aborted: false,
      });
    });
  });
}

export async function spawnEditor(options: EditorOptions): Promise<EditorResult> {
  const { initialContent, filename, renderer } = options;
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const tmpDir = os.tmpdir();
  const safeName = filename.replace(/\s+/g, "-");
  const tmpFile = path.join(tmpDir, `ei-${Date.now()}-${safeName}`);
  
  logger.debug("[editor] spawnEditor called - START", { filename, editor });
  
  // CRITICAL: 50ms delay to let SolidJS reactive updates settle before suspending
  // This prevents ghost frames when transitioning from overlays to editor
  await new Promise(resolve => setTimeout(resolve, 50));
  
  fs.writeFileSync(tmpFile, initialContent, "utf-8");
  const originalContent = initialContent;
  
  return new Promise((resolve) => {
    const wasAlreadySuspended = renderer.controlState === RendererControlState.EXPLICIT_SUSPENDED;
    logger.debug("[editor] renderer state", { controlState: renderer.controlState, wasAlreadySuspended });
    
    if (!wasAlreadySuspended) {
      renderer.suspend();
    }
    
    renderer.currentRenderBuffer.clear();
    const child = spawn(editor, [tmpFile], {
      stdio: "inherit",
      shell: true,
    });
    
    
    child.on("error", () => {
      logger.error("[editor] editor process error");
      renderer.currentRenderBuffer.clear();
      renderer.resume();
      renderer.requestRender();
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve({
        success: false,
        content: null,
        aborted: false,
      });
    });
    
    child.on("exit", (code) => {
      logger.debug("[editor] editor process exited", { code });
      renderer.currentRenderBuffer.clear();
      
      if (!wasAlreadySuspended) {
        logger.debug("[editor] calling renderer.resume()");
        renderer.resume();
      } else {
        logger.debug("[editor] already suspended before spawn, skipping resume");
      }
      
      renderer.requestRender();
      
      if (code !== 0) {
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve({
          success: false,
          content: null,
          aborted: true,
        });
        return;
      }
      
      let editedContent: string;
      try {
        editedContent = fs.readFileSync(tmpFile, "utf-8");
      } catch {
        resolve({
          success: false,
          content: null,
          aborted: false,
        });
        return;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      
      if (editedContent === originalContent) {
        resolve({
          success: true,
          content: null,
          aborted: false,
        });
        return;
      }
      
      resolve({
        success: true,
        content: editedContent,
        aborted: false,
      });
    });
  });
}
