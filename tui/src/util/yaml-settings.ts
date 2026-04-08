import YAML from "yaml";
import type {
  HumanSettings,
  CeremonyConfig,
  OpenCodeSettings,
  ProviderAccount,
} from "../../../src/core/types.js";
import type { ClaudeCodeSettings } from "../../../src/integrations/claude-code/types.js";
import type { CursorSettings } from "../../../src/integrations/cursor/types.js";
import { modelGuidToDisplay, displayToModelGuid } from "./yaml-shared.js";

interface EditableSettingsData {
  default_model?: string | null;
  oneshot_model?: string | null;
  rewrite_model?: string | null;
  time_mode?: "24h" | "12h" | "local" | "utc" | null;
  name_display?: string | null;
  default_heartbeat_ms?: number | null;
  default_context_window_hours?: number | null;
  message_min_count?: number | null;
  message_max_age_days?: number | null;
  ceremony?: {
    time: string;
    decay_rate?: number | null;
    explore_threshold?: number | null;
    dedup_threshold?: number | null;
    event_window_hours?: number | null;
  };
  opencode?: {
    integration?: boolean | null;
    polling_interval_ms?: number | null;
    last_sync?: string | null;
    extraction_point?: string | null;
    extraction_model?: string | null;
  };
  claudeCode?: {
    integration?: boolean | null;
    polling_interval_ms?: number | null;
    last_sync?: string | null;
    extraction_point?: string | null;
    extraction_model?: string | null;
  };
  cursor?: {
    integration?: boolean | null;
    polling_interval_ms?: number | null;
    last_sync?: string | null;
    extraction_point?: string | null;
  };
  backup?: {
    enabled?: boolean | null;
    max_backups?: number | null;
    interval_ms?: number | null;
  };
}

export function settingsToYAML(settings: HumanSettings | undefined, accounts: ProviderAccount[]): string {
  const guidToDisplay = (guid: string | undefined | null): string | null => {
    if (!guid) return null;
    return modelGuidToDisplay(guid, accounts);
  };

  const data: EditableSettingsData = {
    default_model: guidToDisplay(settings?.default_model),
    oneshot_model: guidToDisplay(settings?.oneshot_model),
    rewrite_model: guidToDisplay(settings?.rewrite_model),
    time_mode: settings?.time_mode ?? null,
    name_display: settings?.name_display ?? null,
    default_heartbeat_ms: settings?.default_heartbeat_ms ?? 1800000,
    default_context_window_hours: settings?.default_context_window_hours ?? 8,
    message_min_count: settings?.message_min_count ?? 200,
    message_max_age_days: settings?.message_max_age_days ?? 14,
    ceremony: {
      time: settings?.ceremony?.time ?? "09:00",
      decay_rate: settings?.ceremony?.decay_rate ?? null,
      explore_threshold: settings?.ceremony?.explore_threshold ?? null,
      dedup_threshold: settings?.ceremony?.dedup_threshold ?? null,
      event_window_hours: settings?.ceremony?.event_window_hours ?? null,
    },
    opencode: {
      integration: settings?.opencode?.integration ?? false,
      polling_interval_ms: settings?.opencode?.polling_interval_ms ?? 60000,
      extraction_model: guidToDisplay(settings?.opencode?.extraction_model) ?? 'default',
      last_sync: settings?.opencode?.last_sync ?? null,
      extraction_point: settings?.opencode?.extraction_point ?? null,
    },
    claudeCode: {
      integration: settings?.claudeCode?.integration ?? false,
      polling_interval_ms: settings?.claudeCode?.polling_interval_ms ?? 60000,
      extraction_model: guidToDisplay(settings?.claudeCode?.extraction_model) ?? 'default',
      last_sync: settings?.claudeCode?.last_sync ?? null,
      extraction_point: settings?.claudeCode?.extraction_point ?? null,
    },
    cursor: {
      integration: settings?.cursor?.integration ?? false,
      polling_interval_ms: settings?.cursor?.polling_interval_ms ?? 60000,
      last_sync: settings?.cursor?.last_sync ?? null,
      extraction_point: settings?.cursor?.extraction_point ?? null,
    },
    backup: {
      enabled: settings?.backup?.enabled ?? false,
      max_backups: settings?.backup?.max_backups ?? 24,
      interval_ms: settings?.backup?.interval_ms ?? 3600000,
    },
  };

  return YAML.stringify(data, {
    lineWidth: 0,
  })
  .replace(/^(\s+)(last_sync: .+)$/mg, '$1# [read-only] $2')
  .replace(/^(\s+)(extraction_point: .+)$/mg, '$1# [read-only] $2')
  .replace(/^(\s+)(extraction_model: .+)$/mg, '$1$2 # e.g. Anthropic:claude-haiku-4-5');
}

export function settingsFromYAML(yamlContent: string, original: HumanSettings | undefined, accounts: ProviderAccount[]): HumanSettings {
  const data = YAML.parse(yamlContent) as EditableSettingsData;

  const nullToUndefined = <T>(value: T | null | undefined): T | undefined =>
    value === null ? undefined : value;

  const displayToGuid = (display: string | null | undefined): string | undefined => {
    if (!display || display === 'default') return undefined;
    return displayToModelGuid(display, accounts) ?? display;
  };

  let ceremony: CeremonyConfig | undefined;
  if (data.ceremony) {
    ceremony = {
      time: data.ceremony.time,
      decay_rate: nullToUndefined(data.ceremony.decay_rate),
      explore_threshold: nullToUndefined(data.ceremony.explore_threshold),
      dedup_threshold: nullToUndefined(data.ceremony.dedup_threshold),
      event_window_hours: nullToUndefined(data.ceremony.event_window_hours),
      last_ceremony: original?.ceremony?.last_ceremony,
    };
  }

  let opencode: OpenCodeSettings | undefined;
  if (data.opencode) {
    opencode = {
      integration: nullToUndefined(data.opencode.integration),
      polling_interval_ms: nullToUndefined(data.opencode.polling_interval_ms),
      last_sync: original?.opencode?.last_sync,
      extraction_point: original?.opencode?.extraction_point,
      processed_sessions: original?.opencode?.processed_sessions,
      extraction_model: displayToGuid(data.opencode.extraction_model),
    };
  }

  let claudeCode: ClaudeCodeSettings | undefined;
  if (data.claudeCode) {
    claudeCode = {
      integration: nullToUndefined(data.claudeCode.integration),
      polling_interval_ms: nullToUndefined(data.claudeCode.polling_interval_ms),
      last_sync: original?.claudeCode?.last_sync,
      extraction_point: original?.claudeCode?.extraction_point,
      processed_sessions: original?.claudeCode?.processed_sessions,
      extraction_model: displayToGuid(data.claudeCode.extraction_model),
    };
  }

  let cursor: CursorSettings | undefined;
  if (data.cursor) {
    cursor = {
      integration: nullToUndefined(data.cursor.integration),
      polling_interval_ms: nullToUndefined(data.cursor.polling_interval_ms),
      last_sync: original?.cursor?.last_sync,
      extraction_point: original?.cursor?.extraction_point,
      processed_sessions: original?.cursor?.processed_sessions,
    };
  }

  let backup: import('../../../src/core/types.js').BackupConfig | undefined;
  if (data.backup) {
    backup = {
      enabled: nullToUndefined(data.backup.enabled),
      max_backups: nullToUndefined(data.backup.max_backups),
      interval_ms: nullToUndefined(data.backup.interval_ms),
      last_backup: original?.backup?.last_backup,
    };
  }

  return {
    ...original,
    default_model: displayToGuid(data.default_model),
    oneshot_model: displayToGuid(data.oneshot_model),
    rewrite_model: displayToGuid(data.rewrite_model),
    time_mode: nullToUndefined(data.time_mode),
    name_display: nullToUndefined(data.name_display),
    default_heartbeat_ms: nullToUndefined(data.default_heartbeat_ms),
    default_context_window_hours: nullToUndefined(data.default_context_window_hours),
    message_min_count: nullToUndefined(data.message_min_count),
    message_max_age_days: nullToUndefined(data.message_max_age_days),
    ceremony,
    opencode,
    claudeCode,
    cursor,
    backup,
  };
}

export function validateModelProvider(
  modelSpec: string | undefined,
  accounts: ProviderAccount[]
): string | undefined {
  if (!modelSpec) return undefined;

  const colonIdx = modelSpec.indexOf(":");
  const providerPart = colonIdx >= 0 ? modelSpec.substring(0, colonIdx) : modelSpec;
  const modelPart = colonIdx >= 0 ? modelSpec.substring(colonIdx + 1) : undefined;

  const match = accounts.find(a => a.name.toLowerCase() === providerPart.toLowerCase());

  if (!match) {
    const available = accounts.map(a => a.name).join(", ");
    throw new Error(
      available
        ? `No provider named "${providerPart}". Available: ${available}`
        : `No provider named "${providerPart}". Create one with /provider new`
    );
  }

  return modelPart ? `${match.name}:${modelPart}` : match.name;
}
