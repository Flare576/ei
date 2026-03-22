/**
 * Shared timestamp formatter for all LLM-facing date/time strings.
 * Consistent format across system prompt, quotes, and message history
 * so models can trivially compute time deltas.
 */
const TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
};

export function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString('en-US', TIMESTAMP_FORMAT);
}

export function formatCurrentTime(): string {
  return formatTimestamp(new Date().toISOString());
}
