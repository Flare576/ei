import { HumanEntity, PersonaEntity, Topic, Person } from "./types.js";
import { loadHumanEntity, loadPersonaEntity, saveHumanEntity, savePersonaEntity, appendDebugLog } from "./storage.js";

const MIN_DECAY_CHANGE = 0.001;
const MIN_HOURS_SINCE_UPDATE = 0.1;

const DESIRE_GAP_THRESHOLD = 0.3;
const SENTIMENT_FLOOR = -0.5;

function calculateLogarithmicDecay(currentValue: number, hoursSinceUpdate: number): number {
  const K = 0.1;
  const decay = K * currentValue * (1 - currentValue) * hoursSinceUpdate;
  
  return Math.max(0, currentValue - decay);
}

export async function applyTopicDecay(
  entityType: "human" | "system",
  persona?: string
): Promise<boolean> {
  const entity = entityType === "human"
    ? await loadHumanEntity()
    : await loadPersonaEntity(persona!);
  
  const now = Date.now();
  let changed = false;
  
  for (const topic of entity.topics) {
    const lastUpdated = topic.last_updated 
      ? new Date(topic.last_updated).getTime() 
      : now;
    const hoursSince = (now - lastUpdated) / (1000 * 60 * 60);
    
    if (hoursSince < MIN_HOURS_SINCE_UPDATE) continue;
    
    const newValue = calculateLogarithmicDecay(topic.level_current, hoursSince);
    const decay = topic.level_current - newValue;
    if (Math.abs(decay) > MIN_DECAY_CHANGE) {
      topic.level_current = newValue;
      topic.last_updated = new Date().toISOString();
      changed = true;
      appendDebugLog(`[TopicDecay] "${topic.name}": ${decay.toFixed(4)} (now ${topic.level_current.toFixed(2)})`);
    }
  }
  
  if (entity.entity === "human") {
    for (const person of entity.people) {
      const lastUpdated = person.last_updated 
        ? new Date(person.last_updated).getTime() 
        : now;
      const hoursSince = (now - lastUpdated) / (1000 * 60 * 60);
      
      if (hoursSince < MIN_HOURS_SINCE_UPDATE) continue;
      
      const newValue = calculateLogarithmicDecay(person.level_current, hoursSince);
      const decay = person.level_current - newValue;
      if (Math.abs(decay) > MIN_DECAY_CHANGE) {
        person.level_current = newValue;
        person.last_updated = new Date().toISOString();
        changed = true;
        appendDebugLog(`[TopicDecay] Person "${person.name}": ${decay.toFixed(4)} (now ${person.level_current.toFixed(2)})`);
      }
    }
  }
  
  if (changed) {
    if (entityType === "human") {
      await saveHumanEntity(entity as HumanEntity);
    } else {
      await savePersonaEntity(entity as PersonaEntity, persona!);
    }
    
    const entityName = entityType === "human" ? "human" : persona;
    appendDebugLog(`[TopicDecay] Applied decay to ${entityName}`);
  }
  
  return changed;
}

export async function checkDesireGaps(
  entityType: "human" | "system",
  persona?: string
): Promise<boolean> {
  const entity = entityType === "human"
    ? await loadHumanEntity()
    : await loadPersonaEntity(persona!);
  
  for (const topic of entity.topics) {
    const desireGap = topic.level_ideal - topic.level_current;
    
    if (desireGap >= DESIRE_GAP_THRESHOLD && topic.sentiment > SENTIMENT_FLOOR) {
      appendDebugLog(
        `[TopicDecay] Heartbeat trigger: "${topic.name}" - gap ${desireGap.toFixed(2)}, sentiment ${topic.sentiment.toFixed(2)}`
      );
      return true;
    }
  }
  
  if (entity.entity === "human") {
    for (const person of entity.people) {
      const desireGap = person.level_ideal - person.level_current;
      
      if (desireGap >= DESIRE_GAP_THRESHOLD && person.sentiment > SENTIMENT_FLOOR) {
        appendDebugLog(
          `[TopicDecay] Heartbeat trigger: person "${person.name}" - gap ${desireGap.toFixed(2)}, sentiment ${person.sentiment.toFixed(2)}`
        );
        return true;
      }
    }
  }
  
  return false;
}
