import type { StorageState, DataItem, Quote } from "../core/types.js";

function mergeDataItems<T extends DataItem>(local: T[], remote: T[]): T[] {
  const merged = [...local];
  
  for (const remoteItem of remote) {
    const localIndex = merged.findIndex(item => item.id === remoteItem.id);
    
    if (localIndex === -1) {
      merged.push(remoteItem);
    } else if (remoteItem.last_updated > merged[localIndex].last_updated) {
      merged[localIndex] = remoteItem;
    }
  }
  
  return merged;
}

function mergeQuotes(local: Quote[], remote: Quote[]): Quote[] {
  const merged = [...local];
  
  for (const remoteQuote of remote) {
    if (!merged.some(q => q.id === remoteQuote.id)) {
      merged.push(remoteQuote);
    }
  }
  
  return merged;
}

export function yoloMerge(local: StorageState, remote: StorageState): StorageState {
  const merged = structuredClone(local);
  
  merged.human.facts = mergeDataItems(merged.human.facts, remote.human.facts);
  merged.human.traits = mergeDataItems(merged.human.traits, remote.human.traits);
  merged.human.topics = mergeDataItems(merged.human.topics, remote.human.topics);
  merged.human.people = mergeDataItems(merged.human.people, remote.human.people);
  merged.human.quotes = mergeQuotes(merged.human.quotes || [], remote.human.quotes || []);
  
  if (remote.human.last_updated > merged.human.last_updated) {
    merged.human.last_updated = remote.human.last_updated;
  }
  
  for (const [personaName, remotePersonaData] of Object.entries(remote.personas)) {
    const localPersonaData = merged.personas[personaName];
    
    if (!localPersonaData) {
      merged.personas[personaName] = remotePersonaData;
      continue;
    }
    
    const messageIds = new Set(localPersonaData.messages.map(m => m.id));
    for (const msg of remotePersonaData.messages) {
      if (!messageIds.has(msg.id)) {
        localPersonaData.messages.push(msg);
      }
    }
    
    localPersonaData.messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    if (remotePersonaData.entity.last_updated > localPersonaData.entity.last_updated) {
      localPersonaData.entity = { ...localPersonaData.entity, ...remotePersonaData.entity };
    }
  }
  
  merged.timestamp = new Date().toISOString();
  
  return merged;
}
