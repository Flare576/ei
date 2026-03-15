import type { Message } from "../types.js";

const DEFAULT_EVENT_WINDOW_HOURS = 8;

export function buildEventWindows(
  messages: Message[],
  gapHours: number = DEFAULT_EVENT_WINDOW_HOURS
): Message[][] {
  if (messages.length === 0) return [];

  const gapMs = gapHours * 60 * 60 * 1000;
  const windows: Message[][] = [];
  let currentWindow: Message[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = new Date(messages[i - 1].timestamp).getTime();
    const curr = new Date(messages[i].timestamp).getTime();

    if (curr - prev >= gapMs) {
      windows.push(currentWindow);
      currentWindow = [];
    }
    currentWindow.push(messages[i]);
  }

  if (currentWindow.length > 0) {
    windows.push(currentWindow);
  }

  return windows;
}
