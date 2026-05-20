import type { ContextStatus, Message } from "../../core/types.js";
import { getMachineId } from "../machine-id.js";

export type QualifyFn = (machine: string, sessionId: string, nativeId: string) => string;

export interface ConvertibleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export function convertToEiMessage(
  msg: ConvertibleMessage,
  sessionId: string,
  qualify: QualifyFn
): Message {
  return {
    id: qualify(getMachineId(), sessionId, msg.id),
    role: msg.role === "user" ? "human" : "system",
    content: msg.content,
    timestamp: msg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
    external: true,
  };
}

export function convertToPreMarkedEiMessage(
  msg: ConvertibleMessage,
  sessionId: string,
  qualify: QualifyFn
): Message {
  return {
    ...convertToEiMessage(msg, sessionId, qualify),
    f: true,
    t: true,
    p: true,
    e: true,
  };
}
