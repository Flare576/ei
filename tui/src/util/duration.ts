const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MULTIPLIERS: Record<string, number> = {
  m: MINUTE,
  min: MINUTE,
  h: HOUR,
  hour: HOUR,
  d: DAY,
  day: DAY,
  w: WEEK,
  week: WEEK,
};

export function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)(m|min|h|hour|d|day|w|week)s?$/i);
  if (!match) return null;
  
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  
  return value * (MULTIPLIERS[unit] || 0);
}

export function formatDuration(ms: number): string {
  if (ms >= WEEK) return `${Math.floor(ms / WEEK)}w`;
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / MINUTE)}m`;
}
