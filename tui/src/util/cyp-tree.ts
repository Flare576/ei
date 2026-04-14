import type { RoomMessage } from "../../../src/core/types.js";

export interface CYPTreeData {
  ordered: RoomMessage[];
  numToId: Map<number, string>;
  idToNum: Map<string, number>;
  childrenMap: Map<string, RoomMessage[]>;
}

export function buildCYPTree(messages: RoomMessage[]): CYPTreeData {
  const childrenMap = new Map<string, RoomMessage[]>();

  for (const m of messages) {
    if (m.parent_id !== null && m.parent_id !== undefined) {
      const existing = childrenMap.get(m.parent_id);
      if (existing) {
        existing.push(m);
      } else {
        childrenMap.set(m.parent_id, [m]);
      }
    }
  }

  const root = messages.find((m) => m.parent_id === null);
  const ordered: RoomMessage[] = [];
  const numToId = new Map<number, string>();
  const idToNum = new Map<string, number>();

  if (!root) {
    return { ordered, numToId, idToNum, childrenMap };
  }

  const queue: RoomMessage[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);
    const num = ordered.length;
    numToId.set(num, current.id);
    idToNum.set(current.id, num);
    for (const child of childrenMap.get(current.id) ?? []) {
      queue.push(child);
    }
  }

  return { ordered, numToId, idToNum, childrenMap };
}

export function getSubtreeIds(
  rootId: string,
  childrenMap: Map<string, RoomMessage[]>
): Set<string> {
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.add(id);
    for (const child of childrenMap.get(id) ?? []) {
      queue.push(child.id);
    }
  }
  return result;
}
