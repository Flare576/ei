/**
 * ConceptQueue - Background processor for asynchronous concept map updates.
 *
 * This singleton manages a priority-based queue of concept update tasks,
 * processing them in the background without blocking the main conversation loop.
 *
 * @module concept-queue
 */

import { Message, Concept, ConceptMap } from "./types.js";
import { callLLMForJSON, LLMAbortedError } from "./llm.js";
import {
  loadConceptMap,
  saveConceptMap,
  markMessagesConceptProcessed,
  appendDebugLog,
} from "./storage.js";
import {
  buildConceptUpdateSystemPrompt,
  buildConceptUpdateUserPrompt,
} from "./prompts.js";
import { validateSystemConcepts, mergeWithOriginalStatics } from "./validate.js";
import { generatePersonaDescriptions } from "./persona-creator.js";
import { reconcileConceptGroups } from "./concept-reconciliation.js";

/**
 * Represents a task in the concept update queue.
 */
export interface ConceptUpdateTask {
  /** Unique identifier for the task */
  id: string;
  /** The persona this update is for */
  persona: string;
  /** Whether to update system or human concept map */
  target: "system" | "human";
  /** Messages to process for concept extraction */
  messages: Message[];
  /** ISO timestamp of when task was created */
  created_at: string;
  /** Priority level - high priority tasks are processed first */
  priority: "high" | "normal";
}

/**
 * Result of processing a concept update task.
 */
export interface ConceptUpdateResult {
  /** The task that was processed */
  task: ConceptUpdateTask;
  /** Whether the update was successful */
  success: boolean;
  /** Whether concepts were actually changed */
  conceptsChanged: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Callback function type for task completion events.
 */
export type TaskCompletionCallback = (result: ConceptUpdateResult) => void;

/**
 * Checks if concepts have changed between old and new arrays.
 * Used to determine if persona descriptions need regeneration.
 */
function conceptsChanged(oldConcepts: Concept[], newConcepts: Concept[]): boolean {
  if (oldConcepts.length !== newConcepts.length) return true;

  const oldNames = new Set(oldConcepts.map((c) => c.name));
  const newNames = new Set(newConcepts.map((c) => c.name));

  for (const name of oldNames) {
    if (!newNames.has(name)) return true;
  }
  for (const name of newNames) {
    if (!oldNames.has(name)) return true;
  }

  for (const newConcept of newConcepts) {
    const oldConcept = oldConcepts.find((c) => c.name === newConcept.name);
    if (oldConcept && oldConcept.description !== newConcept.description) {
      return true;
    }
  }

  return false;
}

/**
 * Generates a unique task ID.
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Singleton class that manages asynchronous concept map updates.
 *
 * The queue processes tasks in priority order (high before normal),
 * with FIFO ordering within the same priority level.
 *
 * @example
 * ```typescript
 * const queue = ConceptQueue.getInstance();
 *
 * queue.enqueue({
 *   persona: "ei",
 *   target: "system",
 *   messages: unprocessedMessages,
 *   priority: "normal"
 * });
 *
 * // Processing happens automatically in the background
 * ```
 */
export class ConceptQueue {
  private static instance: ConceptQueue;
  private queue: ConceptUpdateTask[] = [];
  private processing = false;
  private shuttingDown = false;
  private abortController: AbortController | null = null;
  private onTaskComplete: TaskCompletionCallback | null = null;

  private constructor() {}


  /**
   * Gets the singleton instance of ConceptQueue.
   * @returns The ConceptQueue singleton instance
   */
  static getInstance(): ConceptQueue {
    if (!ConceptQueue.instance) {
      ConceptQueue.instance = new ConceptQueue();
    }
    return ConceptQueue.instance;
  }

  /**
   * Resets the singleton instance. Only for testing purposes.
   * @internal
   */
  static resetInstance(): void {
    if (ConceptQueue.instance) {
      ConceptQueue.instance.queue = [];
      ConceptQueue.instance.processing = false;
      ConceptQueue.instance.shuttingDown = false;
      ConceptQueue.instance.abortController = null;
      ConceptQueue.instance.onTaskComplete = null;
    }
    ConceptQueue.instance = undefined as unknown as ConceptQueue;
  }

  /**
   * Sets a callback to be called when a task completes.
   * @param callback - Function to call with the result of each completed task
   */
  setTaskCompletionCallback(callback: TaskCompletionCallback | null): void {
    this.onTaskComplete = callback;
  }

  /**
   * Adds a task to the queue for processing.
   *
   * @param task - The task to enqueue (id and created_at will be auto-generated)
   * @returns The generated task ID
   *
   * @example
   * ```typescript
   * const taskId = queue.enqueue({
   *   persona: "ei",
   *   target: "system",
   *   messages: unprocessedMessages,
   *   priority: "normal"
   * });
   * ```
   */
  enqueue(task: Omit<ConceptUpdateTask, "id" | "created_at">): string {
    if (this.shuttingDown) {
      appendDebugLog("[ConceptQueue] Cannot enqueue - queue is shutting down");
      return "";
    }

    const fullTask: ConceptUpdateTask = {
      ...task,
      id: generateTaskId(),
      created_at: new Date().toISOString(),
    };

    this.queue.push(fullTask);
    appendDebugLog(
      `[ConceptQueue] Enqueued task ${fullTask.id} for ${task.persona}/${task.target} (priority: ${task.priority}, queue length: ${this.queue.length})`
    );

    if (!this.processing) {
      setImmediate(() => this.processNext());
    }

    return fullTask.id;
  }

  /**
   * Processes the next task in the queue.
   *
   * Tasks are processed in priority order (high before normal),
   * with FIFO ordering within the same priority level.
   */
  async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0 || this.shuttingDown) {
      return;
    }

    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === "high" ? -1 : 1;
      }
      return a.created_at.localeCompare(b.created_at);
    });

    const task = this.queue.shift()!;
    this.processing = true;
    this.abortController = new AbortController();

    appendDebugLog(
      `[ConceptQueue] Processing task ${task.id} for ${task.persona}/${task.target}`
    );

    let result: ConceptUpdateResult;

    try {
      const changed = await this.processTask(task, this.abortController.signal);
      result = {
        task,
        success: true,
        conceptsChanged: changed,
      };
      appendDebugLog(
        `[ConceptQueue] Task ${task.id} completed successfully (concepts changed: ${changed})`
      );
    } catch (err) {
      if (err instanceof LLMAbortedError) {
        result = {
          task,
          success: false,
          conceptsChanged: false,
          error: "Task was aborted",
        };
        appendDebugLog(`[ConceptQueue] Task ${task.id} was aborted`);
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        result = {
          task,
          success: false,
          conceptsChanged: false,
          error: errorMessage,
        };
        appendDebugLog(`[ConceptQueue] Task ${task.id} failed: ${errorMessage}`);
      }
    } finally {
      this.processing = false;
      this.abortController = null;

      if (this.onTaskComplete) {
        try {
          this.onTaskComplete(result!);
        } catch (callbackErr) {
          appendDebugLog(
            `[ConceptQueue] Task completion callback error: ${callbackErr}`
          );
        }
      }

      if (task.messages.length > 0) {
        try {
          await markMessagesConceptProcessed(
            task.messages.map((m) => m.timestamp),
            task.persona
          );
        } catch (markErr) {
          appendDebugLog(
            `[ConceptQueue] Failed to mark messages as processed: ${markErr}`
          );
        }
      }

      if (this.queue.length > 0 && !this.shuttingDown) {
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * Processes a single concept update task.
   *
   * @param task - The task to process
   * @param signal - AbortSignal for cancellation
   * @returns Whether concepts were changed
   */
  private async processTask(
    task: ConceptUpdateTask,
    signal: AbortSignal
  ): Promise<boolean> {
    const humanMessages = task.messages
      .filter((m) => m.role === "human")
      .map((m) => m.content);
    const systemMessages = task.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);

    const humanMessage = humanMessages.join("\n\n") || null;
    const systemResponse = systemMessages.join("\n\n") || null;

    if (!humanMessage && !systemResponse) {
      appendDebugLog(`[ConceptQueue] Task ${task.id} has no message content to process`);
      return false;
    }

    const currentConcepts = await loadConceptMap(
      task.target,
      task.target === "system" ? task.persona : undefined
    );

    const personaConcepts =
      task.target === "human"
        ? await loadConceptMap("system", task.persona)
        : currentConcepts;

    if (signal.aborted) {
      throw new LLMAbortedError();
    }

    const systemPrompt = buildConceptUpdateSystemPrompt(
      task.target,
      currentConcepts,
      task.persona
    );
    const userPrompt = buildConceptUpdateUserPrompt(
      humanMessage,
      systemResponse,
      task.persona
    );

    // Concept updates use operation/global defaults (persona models may not handle JSON well)
    const newConcepts = await callLLMForJSON<Concept[]>(
      systemPrompt,
      userPrompt,
      { signal, temperature: 0.3, operation: "concept" }
    );

    if (signal.aborted) {
      throw new LLMAbortedError();
    }

    if (!newConcepts) {
      appendDebugLog(`[ConceptQueue] Task ${task.id} got null response from LLM`);
      return false;
    }

    const proposedMap: ConceptMap = task.target === "system"
      ? {
          ...currentConcepts,
          last_updated: new Date().toISOString(),
          concepts: newConcepts,
        }
      : {
          entity: "human",
          last_updated: new Date().toISOString(),
          concepts: newConcepts,
        };

    let mapToSave: ConceptMap;

    if (task.target === "system") {
      const validation = validateSystemConcepts(proposedMap, currentConcepts);

      if (validation.valid) {
        mapToSave = proposedMap;
      } else {
        appendDebugLog(
          `[ConceptQueue] Task ${task.id} validation failed: ${validation.issues.join(", ")}`
        );
        mapToSave = mergeWithOriginalStatics(proposedMap, currentConcepts);
      }

      const changed = conceptsChanged(currentConcepts.concepts, mapToSave.concepts);

      if (changed && !signal.aborted) {
        appendDebugLog(`[ConceptQueue] Task ${task.id} concepts changed, regenerating descriptions`);
        const descriptions = await generatePersonaDescriptions(
          task.persona,
          mapToSave,
          signal
        );
        if (descriptions) {
          mapToSave.short_description = descriptions.short_description;
          mapToSave.long_description = descriptions.long_description;
        }
      }

      await saveConceptMap(mapToSave, task.persona);
      return changed;
    } else {
      const reconciledConcepts = reconcileConceptGroups(
        currentConcepts.concepts,
        newConcepts,
        personaConcepts,
        task.persona
      );
      mapToSave = { ...proposedMap, concepts: reconciledConcepts };
      const changed = conceptsChanged(currentConcepts.concepts, mapToSave.concepts);
      await saveConceptMap(mapToSave);
      return changed;
    }
  }

  /**
   * Gets the current number of tasks in the queue.
   * @returns Number of pending tasks
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Gets all pending tasks for a specific persona.
   * @param persona - The persona name to filter by
   * @returns Array of pending tasks for the persona
   */
  getPendingForPersona(persona: string): ConceptUpdateTask[] {
    return this.queue.filter((t) => t.persona === persona);
  }

  /**
   * Cancels all pending tasks for a specific persona.
   * Does not cancel the currently processing task.
   *
   * @param persona - The persona name to cancel tasks for
   * @returns Number of tasks cancelled
   */
  cancelPersonaTasks(persona: string): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((t) => t.persona !== persona);
    const cancelled = before - this.queue.length;
    if (cancelled > 0) {
      appendDebugLog(
        `[ConceptQueue] Cancelled ${cancelled} tasks for persona ${persona}`
      );
    }
    return cancelled;
  }

  /**
   * Checks if the queue is currently processing a task.
   * @returns True if a task is being processed
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Gracefully shuts down the queue.
   *
   * - Prevents new tasks from being enqueued
   * - Aborts the currently processing task (if any)
   * - Clears remaining tasks from the queue
   *
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    appendDebugLog("[ConceptQueue] Shutting down...");
    this.shuttingDown = true;

    if (this.abortController) {
      this.abortController.abort();
    }

    const SHUTDOWN_TIMEOUT_MS = 5000;
    const maxWait = SHUTDOWN_TIMEOUT_MS;
    const startTime = Date.now();
    while (this.processing && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const remaining = this.queue.length;
    this.queue = [];

    appendDebugLog(
      `[ConceptQueue] Shutdown complete (cleared ${remaining} pending tasks)`
    );
  }
}
