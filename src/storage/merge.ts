import type { StorageState, DataItem, Quote, ToolProvider, ToolDefinition, ProviderAccount, ModelConfig } from "../core/types.js";

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

function mergeModels(local: ModelConfig[], remote: ModelConfig[], preferRemote: boolean): ModelConfig[] {
  const merged = [...local];

  for (const remoteModel of remote) {
    const localIndex = merged.findIndex(m => m.id === remoteModel.id);

    if (localIndex === -1) {
      merged.push(remoteModel);
    } else {
      const localModel = merged[localIndex];
      const localCalls = localModel.total_calls ?? 0;
      const remoteCalls = remoteModel.total_calls ?? 0;

      const total_calls = Math.max(localCalls, remoteCalls);
      const total_tokens_in = Math.max(localModel.total_tokens_in ?? 0, remoteModel.total_tokens_in ?? 0);
      const total_tokens_out = Math.max(localModel.total_tokens_out ?? 0, remoteModel.total_tokens_out ?? 0);
      const last_used = localCalls >= remoteCalls ? localModel.last_used : remoteModel.last_used;

      const base = preferRemote ? { ...localModel, ...remoteModel } : localModel;
      merged[localIndex] = { ...base, total_calls, total_tokens_in, total_tokens_out, last_used };
    }
  }

  return merged;
}

function mergeById(local: ProviderAccount[], remote: ProviderAccount[], preferRemote: boolean): ProviderAccount[] {
  const merged = [...local];

  for (const remoteProvider of remote) {
    const localIndex = merged.findIndex(p => p.id === remoteProvider.id);

    if (localIndex === -1) {
      merged.push(remoteProvider);
    } else {
      const localProvider = merged[localIndex];
      const mergedModels = mergeModels(localProvider.models ?? [], remoteProvider.models ?? [], preferRemote);
      const base = preferRemote ? { ...localProvider, ...remoteProvider } : localProvider;
      merged[localIndex] = { ...base, models: mergedModels };
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
    merged.human.settings.accounts = mergeById(
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
