import { describe, it, expect, beforeEach } from "vitest";
import { RoomState } from "../../../src/core/state/rooms.js";
import { RoomMode, ContextStatus } from "../../../src/core/types.js";
import type { RoomEntity, RoomMessage } from "../../../src/core/types.js";

describe("RoomState", () => {
  let state: RoomState;

  // ─── Factories ───────────────────────────────────────────────────────────────

  const makeRoom = (id: string, overrides: Partial<RoomEntity> = {}): RoomEntity => ({
    id,
    display_name: `Room ${id}`,
    entity: "room",
    mode: RoomMode.FreeForAll,
    persona_ids: [],
    active_node_id: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00.000Z",
    last_updated: "2026-01-01T00:00:00.000Z",
    last_activity: "2026-01-01T00:00:00.000Z",
    messages: [],
    ...overrides,
  });

  const makeMessage = (
    id: string,
    parentId: string | null = null,
    overrides: Partial<RoomMessage> = {}
  ): RoomMessage => ({
    id,
    parent_id: parentId,
    role: "human",
    timestamp: "2026-01-01T12:00:00.000Z",
    read: true,
    context_status: ContextStatus.Default,
    ...overrides,
  });

  beforeEach(() => {
    state = new RoomState();
  });

  // ─── add / getById / getAll ───────────────────────────────────────────────────

  describe("add / getById / getAll", () => {
    it("adds a room and retrieves it by id", () => {
      const room = makeRoom("r1");
      state.add(room);
      expect(state.getById("r1")).toEqual(room);
    });

    it("returns null for an unknown id", () => {
      expect(state.getById("nope")).toBeNull();
    });

    it("getAll excludes archived rooms by default", () => {
      state.add(makeRoom("r1"));
      state.add(makeRoom("r2", { is_archived: true }));
      const all = state.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("r1");
    });

    it("getAll includes archived rooms when flag is true", () => {
      state.add(makeRoom("r1"));
      state.add(makeRoom("r2", { is_archived: true }));
      expect(state.getAll(true)).toHaveLength(2);
    });

    it("getAll returns empty array when no rooms added", () => {
      expect(state.getAll()).toEqual([]);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("merges partial updates and sets last_updated", () => {
      const before = new Date().toISOString();
      state.add(makeRoom("r1", { display_name: "Old Name" }));

      const result = state.update("r1", { display_name: "New Name" });

      expect(result).toBe(true);
      const room = state.getById("r1")!;
      expect(room.display_name).toBe("New Name");
      expect(room.last_updated >= before).toBe(true);
    });

    it("can update display_name without touching other fields", () => {
      state.add(makeRoom("r1", { persona_ids: ["p1", "p2"] }));
      state.update("r1", { display_name: "Renamed" });
      const room = state.getById("r1")!;
      expect(room.display_name).toBe("Renamed");
      expect(room.persona_ids).toEqual(["p1", "p2"]);
    });

    it("can update judge_persona_id", () => {
      state.add(makeRoom("r1"));
      state.update("r1", { judge_persona_id: "judge-42" });
      expect(state.getById("r1")!.judge_persona_id).toBe("judge-42");
    });

    it("can archive via update with { is_archived: true }", () => {
      state.add(makeRoom("r1"));
      const result = state.update("r1", { is_archived: true });
      expect(result).toBe(true);
      expect(state.getById("r1")!.is_archived).toBe(true);
    });

    it("returns false for an unknown room", () => {
      expect(state.update("nope", { display_name: "X" })).toBe(false);
    });
  });

  // ─── archive ─────────────────────────────────────────────────────────────────

  describe("archive", () => {
    it("sets is_archived = true and updates last_updated", () => {
      const before = new Date().toISOString();
      state.add(makeRoom("r1"));

      const result = state.archive("r1");

      expect(result).toBe(true);
      const room = state.getById("r1")!;
      expect(room.is_archived).toBe(true);
      expect(room.last_updated >= before).toBe(true);
    });

    it("archived room no longer appears in getAll without flag", () => {
      state.add(makeRoom("r1"));
      state.archive("r1");
      expect(state.getAll()).toHaveLength(0);
      expect(state.getAll(true)).toHaveLength(1);
    });

    it("returns false for an unknown room", () => {
      expect(state.archive("nope")).toBe(false);
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("removes the room so getById returns null", () => {
      state.add(makeRoom("r1"));
      expect(state.delete("r1")).toBe(true);
      expect(state.getById("r1")).toBeNull();
    });

    it("removed room does not appear in getAll", () => {
      state.add(makeRoom("r1"));
      state.add(makeRoom("r2"));
      state.delete("r1");
      const all = state.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("r2");
    });

    it("returns false for an unknown room", () => {
      expect(state.delete("nope")).toBe(false);
    });
  });

  // ─── messages_append / messages_get ─────────────────────────────────────────

  describe("messages_append / messages_get", () => {
    it("appends a message and updates last_activity", () => {
      state.add(makeRoom("r1"));
      const msg = makeMessage("m1", null, { timestamp: "2026-06-01T09:00:00.000Z" });
      state.messages_append("r1", msg);

      const msgs = state.messages_get("r1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe("m1");
      expect(state.getById("r1")!.last_activity).toBe("2026-06-01T09:00:00.000Z");
    });

    it("appending multiple messages preserves order", () => {
      state.add(makeRoom("r1"));
      state.messages_append("r1", makeMessage("m1"));
      state.messages_append("r1", makeMessage("m2"));
      state.messages_append("r1", makeMessage("m3"));

      const msgs = state.messages_get("r1");
      expect(msgs.map(m => m.id)).toEqual(["m1", "m2", "m3"]);
    });

    it("messages_get returns empty array for unknown room", () => {
      expect(state.messages_get("nope")).toEqual([]);
    });

    it("messages_append to unknown room is a silent no-op", () => {
      // should not throw
      state.messages_append("nope", makeMessage("m1"));
      expect(state.getAll()).toHaveLength(0);
    });
  });

  // ─── messages_setActiveNode ───────────────────────────────────────────────────

  describe("messages_setActiveNode", () => {
    it("sets active_node_id when the message exists", () => {
      state.add(makeRoom("r1"));
      state.messages_append("r1", makeMessage("m1"));

      const result = state.messages_setActiveNode("r1", "m1");

      expect(result).toBe(true);
      expect(state.getById("r1")!.active_node_id).toBe("m1");
    });

    it("returns false and does not mutate when message does not exist", () => {
      state.add(makeRoom("r1", { active_node_id: null }));
      const result = state.messages_setActiveNode("r1", "ghost");
      expect(result).toBe(false);
      expect(state.getById("r1")!.active_node_id).toBeNull();
    });

    it("returns false for an unknown room", () => {
      expect(state.messages_setActiveNode("nope", "m1")).toBe(false);
    });
  });

  // ─── messages_getActivePath ───────────────────────────────────────────────────

  describe("messages_getActivePath", () => {
    it("returns [] when active_node_id is null", () => {
      state.add(makeRoom("r1", { active_node_id: null }));
      expect(state.messages_getActivePath("r1")).toEqual([]);
    });

    it("returns [] for an unknown room", () => {
      expect(state.messages_getActivePath("nope")).toEqual([]);
    });

    it("returns [root] for a single root node as the active node", () => {
      const root = makeMessage("root", null);
      state.add(makeRoom("r1", { active_node_id: "root", messages: [root] }));

      const path = state.messages_getActivePath("r1");
      expect(path).toHaveLength(1);
      expect(path[0].id).toBe("root");
    });

    it("returns [root, child, grandchild] for a 3-level linear chain", () => {
      const root = makeMessage("root", null);
      const child = makeMessage("child", "root");
      const grandchild = makeMessage("grandchild", "child");

      state.add(makeRoom("r1", {
        active_node_id: "grandchild",
        messages: [root, child, grandchild],
      }));

      const path = state.messages_getActivePath("r1");
      expect(path).toHaveLength(3);
      expect(path[0].id).toBe("root");
      expect(path[1].id).toBe("child");
      expect(path[2].id).toBe("grandchild");
    });

    it("excludes sibling branches — only walks ancestor chain of active node", () => {
      // Tree shape:
      //   root
      //   ├── childA
      //   │     └── grandchildA  ← active
      //   └── childB             ← sibling branch, must NOT appear
      const root = makeMessage("root", null);
      const childA = makeMessage("childA", "root");
      const childB = makeMessage("childB", "root");
      const grandchildA = makeMessage("grandchildA", "childA");

      state.add(makeRoom("r1", {
        active_node_id: "grandchildA",
        messages: [root, childA, childB, grandchildA],
      }));

      const path = state.messages_getActivePath("r1");
      expect(path).toHaveLength(3);
      expect(path.map(m => m.id)).toEqual(["root", "childA", "grandchildA"]);
      expect(path.find(m => m.id === "childB")).toBeUndefined();
    });

    it("path changes when active_node is updated to a sibling", () => {
      const root = makeMessage("root", null);
      const childA = makeMessage("childA", "root");
      const childB = makeMessage("childB", "root");

      state.add(makeRoom("r1", {
        active_node_id: "childA",
        messages: [root, childA, childB],
      }));

      let path = state.messages_getActivePath("r1");
      expect(path.map(m => m.id)).toEqual(["root", "childA"]);

      state.messages_setActiveNode("r1", "childB");

      path = state.messages_getActivePath("r1");
      expect(path.map(m => m.id)).toEqual(["root", "childB"]);
    });
  });

  // ─── messages_getChildren ────────────────────────────────────────────────────

  describe("messages_getChildren", () => {
    beforeEach(() => {
      // Tree shape:
      //   root (parent_id: null)
      //   ├── childA (parent_id: "root")
      //   │     └── grandchild (parent_id: "childA")
      //   └── childB (parent_id: "root")
      const root = makeMessage("root", null);
      const childA = makeMessage("childA", "root");
      const childB = makeMessage("childB", "root");
      const grandchild = makeMessage("grandchild", "childA");
      state.add(makeRoom("r1", { messages: [root, childA, childB, grandchild] }));
    });

    it("returns root-level messages (parent_id = null)", () => {
      const children = state.messages_getChildren("r1", null);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("root");
    });

    it("returns all direct children of a given node", () => {
      const children = state.messages_getChildren("r1", "root");
      expect(children).toHaveLength(2);
      expect(children.map(m => m.id).sort()).toEqual(["childA", "childB"]);
    });

    it("returns only first-level children, not grandchildren", () => {
      const children = state.messages_getChildren("r1", "root");
      expect(children.find(m => m.id === "grandchild")).toBeUndefined();
    });

    it("returns children of a mid-tree node", () => {
      const children = state.messages_getChildren("r1", "childA");
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("grandchild");
    });

    it("returns empty array for a leaf node", () => {
      expect(state.messages_getChildren("r1", "grandchild")).toEqual([]);
    });

    it("returns empty array for an unknown room", () => {
      expect(state.messages_getChildren("nope", null)).toEqual([]);
    });
  });

  // ─── messages_markAllRead ────────────────────────────────────────────────────

  describe("messages_markAllRead", () => {
    it("marks all unread messages as read and returns the count", () => {
      state.add(makeRoom("r1", {
        messages: [
          makeMessage("m1", null, { read: false }),
          makeMessage("m2", null, { read: false }),
          makeMessage("m3", null, { read: true }),
        ],
      }));

      const count = state.messages_markAllRead("r1");

      expect(count).toBe(2);
      expect(state.messages_get("r1").every(m => m.read)).toBe(true);
    });

    it("returns 0 when all messages are already read", () => {
      state.add(makeRoom("r1", {
        messages: [makeMessage("m1", null, { read: true })],
      }));
      expect(state.messages_markAllRead("r1")).toBe(0);
    });

    it("returns 0 for an unknown room", () => {
      expect(state.messages_markAllRead("nope")).toBe(0);
    });
  });

  // ─── getSummary ───────────────────────────────────────────────────────────────

  describe("getSummary", () => {
    it("returns null for an unknown room", () => {
      expect(state.getSummary("nope")).toBeNull();
    });

    it("returns a RoomSummary with all correct scalar fields", () => {
      state.add(makeRoom("r1", {
        display_name: "My Room",
        mode: RoomMode.ChooseYourPath,
        persona_ids: ["p1", "p2"],
        active_node_id: null,
        is_archived: false,
        last_activity: "2026-03-01T00:00:00.000Z",
      }));

      const summary = state.getSummary("r1")!;
      expect(summary.id).toBe("r1");
      expect(summary.display_name).toBe("My Room");
      expect(summary.mode).toBe(RoomMode.ChooseYourPath);
      expect(summary.persona_ids).toEqual(["p1", "p2"]);
      expect(summary.active_node_id).toBeNull();
      expect(summary.is_archived).toBe(false);
      expect(summary.last_activity).toBe("2026-03-01T00:00:00.000Z");
    });

    it("unread_count counts only persona messages on the active path", () => {
      // Active path: root → child (active_node_id = "child")
      // "root"   — persona, unread → ON path → counted
      // "child"  — persona, unread → ON path (active node) → counted
      // "side"   — persona, unread → NOT on path (sibling of child) → NOT counted
      const root = makeMessage("root", null, { role: "persona", read: false });
      const child = makeMessage("child", "root", { role: "persona", read: false });
      const side = makeMessage("side", "root", { role: "persona", read: false });

      state.add(makeRoom("r1", {
        active_node_id: "child",
        messages: [root, child, side],
      }));

      expect(state.getSummary("r1")!.unread_count).toBe(2);
    });

    it("unread_count ignores human-role messages even when on the active path", () => {
      const root = makeMessage("root", null, { role: "human", read: false });
      state.add(makeRoom("r1", { active_node_id: "root", messages: [root] }));
      expect(state.getSummary("r1")!.unread_count).toBe(0);
    });

    it("unread_count ignores already-read persona messages on the path", () => {
      const root = makeMessage("root", null, { role: "persona", read: true });
      state.add(makeRoom("r1", { active_node_id: "root", messages: [root] }));
      expect(state.getSummary("r1")!.unread_count).toBe(0);
    });

    it("unread_count is 0 when active_node_id is null (no path)", () => {
      const root = makeMessage("root", null, { role: "persona", read: false });
      state.add(makeRoom("r1", { active_node_id: null, messages: [root] }));
      expect(state.getSummary("r1")!.unread_count).toBe(0);
    });

    it("unread_count reflects reads after messages_markAllRead", () => {
      const root = makeMessage("root", null, { role: "persona", read: false });
      const child = makeMessage("child", "root", { role: "persona", read: false });
      state.add(makeRoom("r1", { active_node_id: "child", messages: [root, child] }));

      expect(state.getSummary("r1")!.unread_count).toBe(2);
      state.messages_markAllRead("r1");
      expect(state.getSummary("r1")!.unread_count).toBe(0);
    });
  });

  // ─── load / export ────────────────────────────────────────────────────────────

  describe("load / export", () => {
    it("round-trips rooms through export then load", () => {
      state.add(makeRoom("r1", { display_name: "Persisted" }));
      const exported = state.export();

      const state2 = new RoomState();
      state2.load(exported);

      expect(state2.getById("r1")?.display_name).toBe("Persisted");
    });

    it("load with undefined is a no-op — existing rooms remain", () => {
      state.add(makeRoom("r1"));
      state.load(undefined);
      expect(state.getById("r1")).not.toBeNull();
    });

    it("load replaces all rooms when given a new record", () => {
      state.add(makeRoom("r1"));
      const exported = state.export();
      // Mutate the export to change display_name (simulating persisted data)
      exported["r1"].display_name = "From Disk";

      const state2 = new RoomState();
      state2.add(makeRoom("old-room"));
      state2.load(exported);

      expect(state2.getById("old-room")).toBeNull();
      expect(state2.getById("r1")?.display_name).toBe("From Disk");
    });
  });
});
