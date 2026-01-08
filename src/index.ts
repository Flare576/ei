import * as readline from "readline";
import { processEvent } from "./processor.js";
import { LLMAbortedError } from "./llm.js";
import { 
  loadHistory, 
  listPersonas, 
  findPersonaByNameOrAlias,
  personaExists,
} from "./storage.js";
import { createPersonaWithLLM, saveNewPersona } from "./persona-creator.js";

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
let isAwaitingInput = false;
let rl: readline.Interface;
let activePersona = "ei";

/*
 * =============================================================================
 * MESSAGE QUEUE CONCURRENCY MODEL
 * =============================================================================
 * 
 * This app uses a single-threaded async model with one key invariant:
 * 
 *   >>> Only ONE processQueue() execution runs at a time <<<
 * 
 * The flow works like this:
 * 
 * 1. User input arrives → queueMessage() adds to messageQueue
 * 
 * 2. If NOT currently processing:
 *    - Start processQueue() immediately (if message is "complete")
 *    - Or schedule via debounce timer (if message is short)
 * 
 * 3. If currently processing (isProcessing=true):
 *    - Signal abort to current operation
 *    - Add message to queue
 *    - Do NOT call processQueue() - let the running one finish
 * 
 * 4. When processQueue() finishes (success, abort, or error):
 *    - The finally block checks if queue has messages
 *    - If yes, immediately calls processQueue() again
 *    - This ensures queued messages are processed after abort
 * 
 * Why this matters:
 * - Calling processQueue() while one is running creates TWO concurrent executions
 * - Each creates its own AbortController, causing race conditions
 * - Messages can be processed twice or lost entirely
 * 
 * The abort flow:
 * - abortCurrentOperation() signals the AbortController
 * - The running LLM call throws LLMAbortedError
 * - processQueue() catches it, preserves the queue, exits via finally
 * - finally block sees queue has messages, calls processQueue() again
 * - New execution combines original + new messages
 * 
 * =============================================================================
 */

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
  const prefix = role === "human" ? "You" : activePersona === "ei" ? "EI" : activePersona;
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
  if (messageQueue.length > 0 || isAwaitingInput) {
    debugLog("Heartbeat skipped - awaiting input");
    resetHeartbeat();
    return;
  }

  debugLog("Heartbeat triggered");
  currentAbortController = new AbortController();
  isProcessing = true;

  try {
    const result = await processEvent(null, activePersona, DEBUG, currentAbortController.signal);

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

/**
 * Adds a message to the queue and triggers processing.
 * 
 * CONCURRENCY: If already processing, signals abort but does NOT call
 * processQueue() directly. The running processQueue()'s finally block
 * will check the queue and re-trigger if needed.
 */
function queueMessage(input: string): void {
  const trimmed = input.trim();
  if (!trimmed) return;

  messageQueue.push(trimmed);
  resetHeartbeat();

  if (isProcessing) {
    debugLog(`Message queued during processing (${messageQueue.length} total) - aborting current`);
    abortCurrentOperation();
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

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

/**
 * Processes all queued messages as a single combined message.
 * 
 * CONCURRENCY: Only one instance runs at a time. The finally block
 * re-triggers if messages accumulated during processing.
 * 
 * ATOMICITY: Messages are only removed from queue on SUCCESS.
 * On abort or error, they're preserved for the next attempt.
 */
async function processQueue(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (messageQueue.length === 0) return;

  const combinedMessage = messageQueue.join("\n");
  const messageCount = messageQueue.length;

  debugLog(`Processing ${messageCount} message(s): "${combinedMessage.substring(0, 50)}${combinedMessage.length > 50 ? "..." : ""}"`);

  currentAbortController = new AbortController();
  isProcessing = true;

  try {
    const result = await processEvent(combinedMessage, activePersona, DEBUG, currentAbortController.signal);

    if (result.aborted) {
      debugLog(`Processing aborted - ${messageCount} message(s) preserved for retry`);
    } else {
      messageQueue = [];
      if (result.response) {
        printMessage("system", result.response);
      } else {
        debugLog("No response");
      }
    }
  } catch (err) {
    if (err instanceof LLMAbortedError) {
      debugLog(`LLM call aborted - ${messageCount} message(s) preserved for retry`);
    } else {
      messageQueue = [];
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    isProcessing = false;
    currentAbortController = null;

    if (messageQueue.length > 0) {
      debugLog(`Queue has ${messageQueue.length} message(s) after processing - retriggering`);
      processQueue();
    } else {
      rl.prompt();
    }
  }
}

async function displayRecentHistory(): Promise<void> {
  const history = await loadHistory(activePersona);
  const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);

  if (recent.length === 0) return;

  console.log("--- Recent conversation ---");
  for (const msg of recent) {
    printMessage(msg.role, msg.content);
  }
  console.log("---------------------------");
  console.log("");
}

async function handlePersonaCommand(args: string): Promise<boolean> {
  const trimmed = args.trim();
  const lowerTrimmed = trimmed.toLowerCase();
  
  if (!trimmed) {
    const personas = await listPersonas();
    console.log("\nAvailable personas:");
    for (const p of personas) {
      const aliasStr = p.aliases.length > 0 ? ` (aliases: ${p.aliases.join(", ")})` : "";
      const marker = p.name === activePersona ? " [active]" : "";
      console.log(`  - ${p.name}${aliasStr}${marker}`);
    }
    console.log("\nUsage: /persona <name> to switch (creates new if not found)");
    console.log("");
    return true;
  }
  
  const foundPersona = await findPersonaByNameOrAlias(lowerTrimmed);
  
  if (foundPersona) {
    if (foundPersona !== activePersona) {
      if (isProcessing || messageQueue.length > 0) {
        abortCurrentOperation();
        const discarded = messageQueue.length;
        messageQueue = [];
        debugLog(`Persona switch: aborted processing, discarded ${discarded} queued message(s)`);
      }
    }
    activePersona = foundPersona;
    console.log(`\nSwitched to persona: ${activePersona}`);
    await displayRecentHistory();
    return true;
  }
  
  if (!personaExists(lowerTrimmed)) {
    if (isProcessing || messageQueue.length > 0) {
      abortCurrentOperation();
      const discarded = messageQueue.length;
      messageQueue = [];
      debugLog(`Persona creation: aborted processing, discarded ${discarded} queued message(s)`);
    }
    
    console.log(`\nPersona "${trimmed}" not found. Let's create it!`);
    console.log("Describe this persona (personality, expertise, style) or press Enter for defaults:");
    
    isAwaitingInput = true;
    return new Promise((resolve) => {
      rl.question("", async (description) => {
        isAwaitingInput = false;
        try {
          console.log("\nGenerating persona...");
          const conceptMap = await createPersonaWithLLM(lowerTrimmed, description);
          await saveNewPersona(lowerTrimmed, conceptMap);
          activePersona = lowerTrimmed;
          console.log(`\nCreated and switched to persona: ${activePersona}`);
          if (conceptMap.aliases && conceptMap.aliases.length > 0) {
            console.log(`Aliases: ${conceptMap.aliases.join(", ")}`);
          }
          console.log("");
        } catch (err) {
          console.log(`\nError creating persona: ${err instanceof Error ? err.message : String(err)}`);
          console.log("");
        }
        rl.prompt();
        resolve(true);
      });
    });
  }
  
  return true;
}

async function handleCommand(input: string): Promise<boolean> {
  if (!input.startsWith("/")) return false;
  
  resetHeartbeat();
  
  const spaceIdx = input.indexOf(" ");
  const command = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);
  
  switch (command.toLowerCase()) {
    case "persona":
    case "p":
      await handlePersonaCommand(args);
      rl.prompt();
      return true;
    case "help":
    case "h":
      console.log("\nCommands:");
      console.log("  /persona, /p         - List available personas");
      console.log("  /persona <name>      - Switch to persona");
      console.log("  /help, /h            - Show this help");
      console.log("");
      rl.prompt();
      return true;
    default:
      console.log(`Unknown command: /${command}. Type /help for available commands.`);
      rl.prompt();
      return true;
  }
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

  rl.on("line", async (input) => {
    if (await handleCommand(input)) return;
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
