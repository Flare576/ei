import * as readline from "readline";
import { processEvent } from "./processor.js";
import { LLMAbortedError } from "./llm.js";
import { loadHistory } from "./storage.js";

const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = DEBUG ? 300 * 1000 : THIRTY_MINUTES_MS;
const COMPLETE_THOUGHT_LENGTH = 30;
const DEBOUNCE_MS = 2000;
const STARTUP_HISTORY_COUNT = 4;

let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentAbortController: AbortController | null = null;
let messageQueue: string[] = [];
let isProcessing = false;
let rl: readline.Interface;

function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
}

function debugLog(message: string): void {
  if (DEBUG) {
    log(`[Debug] ${message}`);
  }
}

function printMessage(role: "human" | "system", content: string): void {
  const prefix = role === "human" ? "You" : "EI";
  console.log(`${prefix}: ${content}`);
}

function abortCurrentOperation(): void {
  if (currentAbortController) {
    debugLog("Aborting current operation");
    currentAbortController.abort();
    currentAbortController = null;
  }
}

function resetHeartbeat(): void {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
  }
  heartbeatTimer = setTimeout(handleHeartbeat, HEARTBEAT_INTERVAL_MS);
  debugLog(`Heartbeat scheduled in ${HEARTBEAT_INTERVAL_MS / 1000}s`);
}

async function handleHeartbeat(): Promise<void> {
  if (messageQueue.length > 0) {
    debugLog("Heartbeat skipped - messages queued");
    resetHeartbeat();
    return;
  }

  debugLog("Heartbeat triggered");
  currentAbortController = new AbortController();
  isProcessing = true;

  try {
    const result = await processEvent(null, DEBUG, currentAbortController.signal);

    if (result.aborted) {
      debugLog("Heartbeat was aborted");
    } else if (result.response) {
      printMessage("system", result.response);
      rl.prompt();
    } else {
      debugLog("No message warranted");
    }
  } catch (err) {
    if (err instanceof LLMAbortedError) {
      debugLog("Heartbeat LLM call aborted");
    } else {
      log(`Heartbeat error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    isProcessing = false;
    currentAbortController = null;
    resetHeartbeat();
  }
}

function queueMessage(input: string): void {
  const trimmed = input.trim();
  if (!trimmed) return;

  if (isProcessing) {
    abortCurrentOperation();
  }

  messageQueue.push(trimmed);
  resetHeartbeat();

  const totalLength = messageQueue.join(" ").length;

  if (totalLength >= COMPLETE_THOUGHT_LENGTH) {
    debugLog(`Message length ${totalLength} >= ${COMPLETE_THOUGHT_LENGTH}, processing immediately`);
    processQueue();
  } else {
    debugLog(`Message length ${totalLength} < ${COMPLETE_THOUGHT_LENGTH}, waiting for more input`);
    scheduleDebounce();
  }
}

function scheduleDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debugLog("Debounce timer fired");
    processQueue();
  }, DEBOUNCE_MS);
}

async function processQueue(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (messageQueue.length === 0) return;

  const combinedMessage = messageQueue.join("\n");
  messageQueue = [];

  debugLog(`Processing combined message: "${combinedMessage.substring(0, 50)}${combinedMessage.length > 50 ? "..." : ""}"`);

  currentAbortController = new AbortController();
  isProcessing = true;

  try {
    const result = await processEvent(combinedMessage, DEBUG, currentAbortController.signal);

    if (result.aborted) {
      debugLog("Processing was aborted - will retry with new queue");
    } else if (result.response) {
      printMessage("system", result.response);
    } else {
      debugLog("No response");
    }
  } catch (err) {
    if (err instanceof LLMAbortedError) {
      debugLog("LLM call aborted - will retry with new queue");
    } else {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    isProcessing = false;
    currentAbortController = null;
    rl.prompt();
  }
}

async function displayRecentHistory(): Promise<void> {
  const history = await loadHistory();
  const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);

  if (recent.length === 0) return;

  console.log("--- Recent conversation ---");
  for (const msg of recent) {
    printMessage(msg.role, msg.content);
  }
  console.log("---------------------------");
  console.log("");
}

async function main(): Promise<void> {
  console.log("EI is listening. Type a message, or Ctrl+C to exit.");
  if (DEBUG) {
    console.log("[Debug mode enabled]");
    console.log(`[Complete thought threshold: ${COMPLETE_THOUGHT_LENGTH} chars]`);
    console.log(`[Debounce: ${DEBOUNCE_MS}ms]`);
  }
  console.log("");

  await displayRecentHistory();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  resetHeartbeat();
  rl.prompt();

  rl.on("line", (input) => {
    queueMessage(input);
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye.");
    abortCurrentOperation();
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    process.exit(0);
  });
}

main();
