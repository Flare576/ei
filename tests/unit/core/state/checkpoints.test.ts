import { describe, it, expect, beforeEach, vi } from "vitest";
import { CheckpointState } from "../../../../src/core/state/index.js";
import { createMockStorage, createDefaultTestState } from "../../../helpers/mock-storage.js";

describe("CheckpointState", () => {
  let state: CheckpointState;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    state = new CheckpointState();
    storage = createMockStorage();
    state.setStorage(storage);
  });

  describe("saveAuto", () => {
    it("calls storage.saveAutoCheckpoint", async () => {
      const testState = createDefaultTestState();
      
      await state.saveAuto(testState);
      
      expect(storage.saveAutoCheckpoint).toHaveBeenCalled();
    });

    it("sets timestamp on state before saving", async () => {
      const testState = createDefaultTestState();
      testState.timestamp = "old-timestamp";
      
      await state.saveAuto(testState);
      
      const savedState = (storage.saveAutoCheckpoint as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(savedState.timestamp).not.toBe("old-timestamp");
    });

    it("throws if storage not initialized", async () => {
      const uninitState = new CheckpointState();
      
      await expect(uninitState.saveAuto(createDefaultTestState()))
        .rejects.toThrow("Storage not initialized");
    });
  });

  describe("saveManual", () => {
    it("calls storage.saveManualCheckpoint with correct args", async () => {
      const testState = createDefaultTestState();
      
      await state.saveManual(10, "My Save", testState);
      
      expect(storage.saveManualCheckpoint).toHaveBeenCalledWith(
        10,
        "My Save",
        expect.objectContaining({ version: 1 })
      );
    });

    it("sets timestamp on state before saving", async () => {
      const testState = createDefaultTestState();
      testState.timestamp = "old-timestamp";
      
      await state.saveManual(11, "Test", testState);
      
      const savedState = (storage.saveManualCheckpoint as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(savedState.timestamp).not.toBe("old-timestamp");
    });
  });

  describe("list", () => {
    it("returns checkpoints from storage", async () => {
      storage._autoSaves.push(createDefaultTestState());
      storage._manualSaves.set(10, { state: createDefaultTestState(), name: "Manual" });
      
      const checkpoints = await state.list();
      
      expect(checkpoints).toHaveLength(2);
    });

    it("throws if storage not initialized", async () => {
      const uninitState = new CheckpointState();
      
      await expect(uninitState.list()).rejects.toThrow("Storage not initialized");
    });
  });

  describe("delete", () => {
    it("calls storage.deleteManualCheckpoint", async () => {
      storage._manualSaves.set(10, { state: createDefaultTestState(), name: "Test" });
      
      const result = await state.delete(10);
      
      expect(result).toBe(true);
      expect(storage.deleteManualCheckpoint).toHaveBeenCalledWith(10);
    });
  });

  describe("load", () => {
    it("loads checkpoint by index", async () => {
      const testState = createDefaultTestState();
      testState.human.facts = [{ 
        id: "f1", 
        name: "Test", 
        description: "Test", 
        sentiment: 0, 
        confidence: 1, 
        last_updated: "" 
      }];
      storage._autoSaves.push(testState);
      
      const loaded = await state.load(0);
      
      expect(loaded).not.toBeNull();
      expect(loaded?.human.facts).toHaveLength(1);
    });

    it("returns null for empty slot", async () => {
      const loaded = await state.load(5);
      
      expect(loaded).toBeNull();
    });
  });

  describe("loadNewest", () => {
    it("returns newest checkpoint by timestamp", async () => {
      const older = createDefaultTestState();
      older.timestamp = "2024-01-01T00:00:00Z";
      
      const newer = createDefaultTestState();
      newer.timestamp = "2024-01-02T00:00:00Z";
      newer.human.facts = [{ 
        id: "f1", 
        name: "Newer", 
        description: "Test", 
        sentiment: 0, 
        confidence: 1, 
        last_updated: "" 
      }];
      
      storage._autoSaves.push(older);
      storage._autoSaves.push(newer);
      
      const loaded = await state.loadNewest();
      
      expect(loaded?.human.facts[0].name).toBe("Newer");
    });

    it("returns null when no checkpoints exist", async () => {
      const loaded = await state.loadNewest();
      
      expect(loaded).toBeNull();
    });

    it("considers manual saves when finding newest", async () => {
      const auto = createDefaultTestState();
      auto.timestamp = "2024-01-01T00:00:00Z";
      
      const manual = createDefaultTestState();
      manual.timestamp = "2024-01-03T00:00:00Z";
      manual.human.facts = [{ 
        id: "f1", 
        name: "Manual", 
        description: "Test", 
        sentiment: 0, 
        confidence: 1, 
        last_updated: "" 
      }];
      
      storage._autoSaves.push(auto);
      storage._manualSaves.set(10, { state: manual, name: "Manual Save" });
      
      const loaded = await state.loadNewest();
      
      expect(loaded?.human.facts[0].name).toBe("Manual");
    });
  });
});
