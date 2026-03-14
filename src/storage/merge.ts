import type { StorageState, DataItem, Quote, ToolProvider, ToolDefinition, ProviderAccount } from "../core/types.js";

function mergeByName<T extends { name: string }>(
  local: T[],
  remote: T[],
  preferRemote: boolean,
): T[] {
  const merged = [...local];

  for (const remoteItem of remote) {
    const localIndex = merged.findIndex(item => item.name === remoteItem.name);
    if (localIndex === -1) {
      merged.push(remoteItem);
    } else if (preferRemote) {
      merged[localIndex] = remoteItem;
    }
  }

  return merged;
}

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
  
  if ('traits' in merged.human) {
    delete (merged.human as Record<string, unknown>)['traits'];
  }

  const preferRemote = remote.timestamp > local.timestamp;

  if (remote.human.settings?.accounts && merged.human.settings) {
    merged.human.settings.accounts = mergeByName<ProviderAccount>(
      merged.human.settings?.accounts || [],
      remote.human.settings.accounts,
      preferRemote,
    );
  }

  if (preferRemote && remote.human.settings) {
    const remoteSettings = remote.human.settings;
    const localSettings = merged.human.settings || {};

    if (remoteSettings.default_model !== undefined) localSettings.default_model = remoteSettings.default_model;
    if (remoteSettings.oneshot_model !== undefined) localSettings.oneshot_model = remoteSettings.oneshot_model;
    if (remoteSettings.rewrite_model !== undefined) localSettings.rewrite_model = remoteSettings.rewrite_model;
    if (remoteSettings.queue_paused !== undefined) localSettings.queue_paused = remoteSettings.queue_paused;
    if (remoteSettings.skip_quote_delete_confirm !== undefined) localSettings.skip_quote_delete_confirm = remoteSettings.skip_quote_delete_confirm;
    if (remoteSettings.name_display !== undefined) localSettings.name_display = remoteSettings.name_display;
    if (remoteSettings.time_mode !== undefined) localSettings.time_mode = remoteSettings.time_mode;

    if (remoteSettings.opencode) localSettings.opencode = remoteSettings.opencode;
    if (remoteSettings.ceremony) localSettings.ceremony = remoteSettings.ceremony;
    if (remoteSettings.backup) localSettings.backup = remoteSettings.backup;
    if (remoteSettings.claudeCode) localSettings.claudeCode = remoteSettings.claudeCode;
    // NOTE: Do NOT merge sync credentials — always keep local sync creds

    merged.human.settings = localSettings;
  }

  merged.providers = mergeByName<ToolProvider>(
    merged.providers || [],
    remote.providers || [],
    preferRemote,
  );

  merged.tools = mergeByName<ToolDefinition>(
    merged.tools || [],
    remote.tools || [],
    preferRemote,
  );

  merged.timestamp = new Date().toISOString();
  
  return merged;
}
