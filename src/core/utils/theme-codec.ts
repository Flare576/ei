import type { ThemeDefinition } from "../types/entities.js";

const VERSION = "v1";
const PREFIX = `ei-theme:${VERSION}:`;
const TOKEN_COUNT = 37;
const HEX_LENGTH = 6;

export const THEME_TOKEN_ORDER: readonly string[] = [
  "bg-primary", "bg-secondary", "bg-tertiary",
  "border", "border-light",
  "text-primary", "text-secondary", "text-muted",
  "accent", "accent-hover",
  "success", "success-hover",
  "warning", "warning-text",
  "danger",
  "status-thinking", "status-ready", "status-unread", "status-paused",
  "room-cyp", "room-ffa", "room-map",
  "archive-bg-start", "archive-bg-end", "archive-border",
  "ai-assist-start", "ai-assist-end",
  "code-bg", "code-bg-controls", "code-border",
  "code-text", "code-text-muted",
  "code-accent", "code-string", "code-error", "code-success", "code-special",
] as const;

export const BUILT_IN_THEME_NAMES: readonly string[] = [
  "default", "dark", "coder", "depressing", "cotton-candy",
  "crimuh", "spoopy", "lovey-dovey", "lucky",
] as const;

export type ThemeTokenMap = Record<string, string>;

export function encodeTheme(tokens: ThemeTokenMap): string {
  const hex = THEME_TOKEN_ORDER.map((key) => {
    const value = tokens[`--ei-${key}`] ?? tokens[key] ?? "000000";
    return value.replace(/^#/, "").toLowerCase().padEnd(HEX_LENGTH, "0").slice(0, HEX_LENGTH);
  }).join("");
  return PREFIX + btoa(hex);
}

export function decodeTheme(encoded: string): ThemeTokenMap | null {
  if (!encoded.startsWith(PREFIX)) return null;
  try {
    const hex = atob(encoded.slice(PREFIX.length));
    if (hex.length !== TOKEN_COUNT * HEX_LENGTH) return null;
    const tokens: ThemeTokenMap = {};
    for (let i = 0; i < TOKEN_COUNT; i++) {
      const key = THEME_TOKEN_ORDER[i];
      tokens[`--ei-${key}`] = `#${hex.slice(i * HEX_LENGTH, (i + 1) * HEX_LENGTH)}`;
    }
    return tokens;
  } catch {
    return null;
  }
}

export function themeToStyleString(tokens: ThemeTokenMap): string {
  return Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
}

export function isBuiltInTheme(id: string): boolean {
  return (BUILT_IN_THEME_NAMES as readonly string[]).includes(id);
}

export function makeThemeDefinition(
  name: string,
  tokens: ThemeTokenMap,
  base?: string,
): ThemeDefinition {
  return {
    id: crypto.randomUUID(),
    name,
    base,
    encoded: encodeTheme(tokens),
    created_at: new Date().toISOString(),
  };
}
