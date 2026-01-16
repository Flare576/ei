import { loadConceptMap, saveConceptMap, appendDebugLog } from './storage.js';

// Decay tuning constants
const MIN_DECAY_CHANGE = 0.001; // Threshold to avoid micro-updates
const MIN_HOURS_SINCE_UPDATE = 0.1; // Skip if updated in last 6 minutes

// Heartbeat trigger constants
const DESIRE_GAP_THRESHOLD = 0.3; // Trigger when level_ideal - level_current exceeds this
const SENTIMENT_FLOOR = -0.5; // Don't bring up topics with sentiment below this

function debugLog(message: string) {
  appendDebugLog(message);
}

/**
 * Logarithmic decay formula for level_current.
 * 
 * Rate is fastest at middle values (0.5), slowest at extremes (0.0, 1.0).
 * This models natural "forgetting" - recent memories fade quickly,
 * but deeply ingrained or completely forgotten things change slowly.
 * 
 * Formula: decay = k * value * (1 - value) * hours
 * Where k is a tuning constant (default 0.1)
 */
export function calculateLogarithmicDecay(currentValue: number, hoursSinceUpdate: number): number {
  const K = 0.1; // Tuning constant - adjust based on feel
  const decay = K * currentValue * (1 - currentValue) * hoursSinceUpdate;
  
  // Always decay toward 0.0
  return Math.max(0, currentValue - decay);
}

/**
 * Apply decay to all concepts for a persona based on time since last update.
 * Returns true if any concepts were modified.
 */
export async function applyConceptDecay(personaName: string): Promise<boolean> {
  const concepts = await loadConceptMap("system", personaName);
  const now = Date.now();
  let changed = false;
  
  for (const concept of concepts.concepts) {
    const lastUpdated = concept.last_updated 
      ? new Date(concept.last_updated).getTime() 
      : now;
    const hoursSince = (now - lastUpdated) / (1000 * 60 * 60);
    
    if (hoursSince < MIN_HOURS_SINCE_UPDATE) continue;
    
    const newValue = calculateLogarithmicDecay(concept.level_current, hoursSince);
    const decay = concept.level_current - newValue;
    if (Math.abs(decay) > MIN_DECAY_CHANGE) {
      concept.level_current = newValue;
      concept.last_updated = new Date().toISOString();
      changed = true;
      debugLog(`Decay applied to "${concept.name}": ${decay.toFixed(4)} (now ${concept.level_current.toFixed(2)})`);
    }
  }
  
  if (changed) {
    await saveConceptMap(concepts, personaName);
    debugLog(`Applied concept decay to ${personaName}`);
  }
  
  return changed;
}

/**
 * Check if any concepts have a significant gap between ideal and current levels.
 * Used to determine if the persona should proactively speak during heartbeat.
 */
export async function checkConceptDeltas(personaName: string): Promise<boolean> {
  const concepts = await loadConceptMap("system", personaName);
  
  for (const concept of concepts.concepts) {
    // Only trigger if they WANT to discuss MORE than they have been
    const desireGap = concept.level_ideal - concept.level_current;
    
    if (desireGap >= DESIRE_GAP_THRESHOLD && concept.sentiment > SENTIMENT_FLOOR) {
      debugLog(`Heartbeat trigger: "${concept.name}" - desire gap ${desireGap.toFixed(2)}, sentiment ${concept.sentiment.toFixed(2)}`);
      return true;
    }
  }
  
  return false;
}
