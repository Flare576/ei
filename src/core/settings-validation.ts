/**
 * Shared bounds check for HumanSettings numeric fields where 0 / negative / NaN
 * is a bug trigger, not a documented sentinel (default_heartbeat_ms,
 * default_context_window_ms, every integration's polling_interval_ms,
 * backup.interval_ms, backup.max_backups). Fields that DO use 0 as "disabled /
 * never prune" (message_min_count, message_max_age_days) must NOT use this.
 *
 * `undefined` is always valid (it means "use the default").
 */
export function positiveSettingError(field: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return undefined;
  return `${field} must be a finite number greater than 0 (got ${typeof value === "string" ? JSON.stringify(value) : String(value)}). ` +
    `0 does not mean "disabled" or "unlimited" for this setting.`;
}

/** Throws an Error naming `field` when `value` is not a positive finite number. */
export function assertPositiveSetting(field: string, value: unknown): void {
  const error = positiveSettingError(field, value);
  if (error) throw new Error(error);
}

/**
 * Owner's reasonable minimum for any heartbeat interval (default_heartbeat_ms and
 * persona heartbeat_delay_ms): anything more frequent than 5 minutes is not something
 * a human can react to. The absolute never-below is 60 s. Easily changed here.
 */
export const MIN_HEARTBEAT_MS = 5 * 60 * 1000;

export function heartbeatSettingError(field: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= MIN_HEARTBEAT_MS) return undefined;
  const got = typeof value === "number" ? `${value} ms` : JSON.stringify(value);
  return `${field} must be at least ${MIN_HEARTBEAT_MS / 60000} minutes (got ${got}). ` +
    `0 does not mean "disabled" for this setting.`;
}

/** Throws an Error naming `field` when `value` is below MIN_HEARTBEAT_MS (undefined = inherit default, valid). */
export function assertHeartbeatSetting(field: string, value: unknown): void {
  const error = heartbeatSettingError(field, value);
  if (error) throw new Error(error);
}
