import type { ContextStatus, Message } from "../../core/types.js";
import { getMachineId } from "../machine-id.js";

export type QualifyFn = (machine: string, sessionId: string, nativeId: string) => string;

export interface ConvertibleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Who a user-role line came from; only read when the parent-speaker mapping is asked for. */
  attribution?: "agent" | "user";
}

export interface ConvertOptions {
  /**
   * Stores a user-role message attributed `agent`, or carrying no attribution,
   * as a `system` message spoken by `PARENT_AGENT_SPEAKER`; one attributed
   * `user` stays the human's. Off by default: without it every user-role
   * message is the human's.
   */
  parentSpeaker?: boolean;
}

export const PARENT_AGENT_SPEAKER = "Parent agent";

export function convertToEiMessage(
  msg: ConvertibleMessage,
  sessionId: string,
  qualify: QualifyFn,
  options: ConvertOptions = {}
): Message {
  const fromParent = options.parentSpeaker === true && msg.role === "user" && msg.attribution !== "user";
  return {
    id: qualify(getMachineId(), sessionId, msg.id),
    role: msg.role === "user" && !fromParent ? "human" : "system",
    ...(fromParent && { speaker_name: PARENT_AGENT_SPEAKER }),
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
  qualify: QualifyFn,
  options: ConvertOptions = {}
): Message {
  return {
    ...convertToEiMessage(msg, sessionId, qualify, options),
    f: true,
    t: true,
    p: true,
    e: true,
  };
}
