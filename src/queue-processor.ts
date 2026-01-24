/**
 * queue-processor.ts - Background processor for persistent LLM queue
 * 
 * Continuously processes queued extraction, validation, and description tasks.
 * Can be paused during high-priority user interactions (conversations).
 * Integrates with existing AbortController pattern for clean cancellation.
 * 
 * Part of epic 0107: Entity Data Architecture Overhaul
 * Ticket 0126: LLM Queue Processor
 */

import { 
  dequeueItem, 
  completeItem, 
  failItem,
  LLMQueueItem,
  FastScanPayload,
  DetailUpdatePayload,
  DescriptionRegenPayload,
} from "./llm-queue.js";
import { runFastScan, routeFastScanResults, runDetailUpdate, runThreeStepExtraction } from "./extraction.js";
import { appendDebugLog } from "./storage.js";
import { LLMAbortedError, sleep } from "./llm.js";

/**
 * Background processor for the persistent LLM queue.
 * Handles execution of queued extraction, validation, and description tasks.
 * 
 * @example
 * const processor = new QueueProcessor();
 * await processor.start();
 * 
 * // During user message processing
 * processor.pause();
 * // ... handle conversation ...
 * processor.resume();
 * 
 * // On shutdown
 * await processor.stop();
 */
export class QueueProcessor {
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private abortController: AbortController | null = null;
  private processingPromise: Promise<void> | null = null;
  
  /**
   * Start the queue processor.
   * Begins continuous processing of queued items.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      appendDebugLog("[QueueProcessor] Already running, ignoring start()");
      return;
    }
    
    this.isRunning = true;
    this.isPaused = false;
    this.processingPromise = this.processLoop();
    
    appendDebugLog("[QueueProcessor] Started");
  }
  
  /**
   * Stop the queue processor.
   * Aborts current work and stops processing.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      appendDebugLog("[QueueProcessor] Not running, ignoring stop()");
      return;
    }
    
    this.isRunning = false;
    this.abortCurrent();
    
    if (this.processingPromise) {
      await this.processingPromise;
    }
    
    appendDebugLog("[QueueProcessor] Stopped");
  }
  
  /**
   * Pause queue processing (e.g., when user sends message).
   * Aborts current work but remains ready to resume.
   */
  pause(): void {
    if (!this.isRunning) {
      appendDebugLog("[QueueProcessor] Not running, ignoring pause()");
      return;
    }
    
    this.isPaused = true;
    this.abortCurrent();
    
    appendDebugLog("[QueueProcessor] Paused");
  }
  
  /**
   * Resume queue processing after pause.
   */
  resume(): void {
    if (!this.isRunning) {
      appendDebugLog("[QueueProcessor] Not running, ignoring resume()");
      return;
    }
    
    this.isPaused = false;
    
    appendDebugLog("[QueueProcessor] Resumed");
  }
  
  /**
   * Main processing loop.
   * Continuously processes queue items until stopped.
   */
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      if (this.isPaused) {
        // Wait before checking again
        await sleep(100);
        continue;
      }
      
      const processed = await this.processNext();
      
      if (!processed) {
        // Queue empty, wait before checking again
        await sleep(1000);
      }
    }
  }
  
  /**
   * Process the next item from the queue.
   * Returns true if an item was processed, false if queue was empty.
   */
  private async processNext(): Promise<boolean> {
    const item = await dequeueItem();
    
    if (!item) {
      return false;
    }
    
    this.abortController = new AbortController();
    
    try {
      await this.executeItem(item);
      await completeItem(item.id);
      return true;
    } catch (err) {
      if (err instanceof LLMAbortedError) {
        appendDebugLog(`[QueueProcessor] Item ${item.id} aborted (paused or stopped)`);
      } else {
        await failItem(item.id, err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      this.abortController = null;
    }
  }
  
  /**
   * Execute a specific queue item based on its type.
   */
  private async executeItem(item: LLMQueueItem): Promise<void> {
    switch (item.type) {
      case "fast_scan":
        await this.executeFastScan(item.payload as FastScanPayload);
        break;
      case "detail_update":
        await this.executeDetailUpdate(item.payload as DetailUpdatePayload);
        break;
      case "description_regen":
        await this.executeDescriptionRegen(item.payload as DescriptionRegenPayload);
        break;
      case "response":
        // Responses should never be queued (they're synchronous)
        appendDebugLog(`[QueueProcessor] WARNING: response item in queue (should be synchronous)`);
        break;
      case "ei_validation":
        // Never dequeued - handled by dequeueItem() filter
        appendDebugLog(`[QueueProcessor] ERROR: ei_validation should never reach executeItem()`);
        break;
    }
  }
  
  /**
   * Execute a fast-scan extraction.
   * 
   * Uses three-step extraction flow: blind scan, match, update/create.
   * Determines which data types need extraction based on extraction frequency state.
   * 
   * Note: Currently only supports human target. System (persona) extraction 
   * queued by extraction-frequency will be skipped until 0136/0137 implement
   * persona-specific three-step extraction.
   */
  private async executeFastScan(payload: FastScanPayload): Promise<void> {
    const { target, persona, messages, dataTypes } = payload;
    
    if (target !== "human") {
      appendDebugLog(`[QueueProcessor] Skipping system extraction - three-step only supports human currently (see tickets 0136/0137)`);
      return;
    }
    
    appendDebugLog(`[QueueProcessor] Running extraction for types: ${dataTypes.join(", ")}`);
    
    await runThreeStepExtraction(
      target,
      persona,
      messages,
      dataTypes,
      this.abortController?.signal
    );
  }
  
  private async executeDetailUpdate(payload: DetailUpdatePayload): Promise<void> {
    await runDetailUpdate(payload, this.abortController?.signal);
  }
  
  private async executeDescriptionRegen(payload: DescriptionRegenPayload): Promise<void> {
    appendDebugLog(`[QueueProcessor] Description regen queued: ${payload.persona} - Awaiting PersonaEntity-based implementation`);
  }
  
  /**
   * Abort the currently processing item.
   */
  private abortCurrent(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
