/**
 * The one JSON shape a tool executor returns when a call fails in a way the human can act on.
 *
 * - `error`        short machine code (`token_refresh_failed`, `not_authenticated`, ...)
 * - `message`      plain-language cause: what actually broke
 * - `remediation`  what the human can do about it (omitted when there is nothing they can do)
 * - `...extra`     optional context fields (`tool`, `integration`, ...)
 *
 * The model reads this as the tool result and is told (see `buildToolsSection`) to relay the
 * cause and the remediation to the human instead of carrying on as if the call had worked.
 */
export interface ToolErrorInfo {
  error: string;
  message: string;
  remediation?: string;
  [extra: string]: unknown;
}

export function toolError(
  error: string,
  message: string,
  remediation?: string,
  extra?: Record<string, unknown>
): string {
  const info: ToolErrorInfo = { error, ...extra, message };
  if (remediation) info.remediation = remediation;
  return JSON.stringify(info);
}

/**
 * Throw this from an executor for a failure the human can act on. `executeToolCalls` turns it
 * into a `toolError` result, reports it as a failed call and drops the tool for the rest of the
 * interaction — so a dead token or missing key is explained once instead of being retried.
 */
export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly remediation?: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}
