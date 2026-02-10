import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("StatusBar queue status display", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SolidJS store updates correctly via setStore", async () => {
    const { createStore } = await import("solid-js/store");
    
    interface TestStore {
      queueStatus: { state: "idle" | "busy" | "paused"; pending_count: number };
    }
    
    const [store, setStore] = createStore<TestStore>({
      queueStatus: { state: "idle", pending_count: 0 },
    });

    expect(store.queueStatus.state).toBe("idle");
    setStore("queueStatus", { state: "busy", pending_count: 3 });
    expect(store.queueStatus.state).toBe("busy");
  });

  it("async callback updates store after await", async () => {
    const { createStore } = await import("solid-js/store");
    
    interface TestStore {
      queueStatus: { state: "idle" | "busy" | "paused"; pending_count: number };
    }
    
    const [store, setStore] = createStore<TestStore>({
      queueStatus: { state: "idle", pending_count: 0 },
    });

    const mockGetQueueStatus = vi.fn().mockResolvedValue({ 
      state: "busy", 
      pending_count: 5 
    });

    const onQueueStateChanged = async () => {
      const status = await mockGetQueueStatus();
      setStore("queueStatus", status);
    };

    expect(store.queueStatus.state).toBe("idle");
    await onQueueStateChanged();
    expect(store.queueStatus.state).toBe("busy");
    expect(store.queueStatus.pending_count).toBe(5);
  });

  it("FAILING: callback ignores parameter and re-fetches (simulating real bug)", async () => {
    const { createStore } = await import("solid-js/store");
    
    interface TestStore {
      queueStatus: { state: "idle" | "busy" | "paused"; pending_count: number };
    }
    
    const [store, setStore] = createStore<TestStore>({
      queueStatus: { state: "idle", pending_count: 0 },
    });

    let processorState: "idle" | "busy" = "idle";
    
    const mockGetQueueStatus = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { state: processorState, pending_count: processorState === "busy" ? 1 : 0 };
    });

    const onQueueStateChanged = async (state: "idle" | "busy") => {
      const status = await mockGetQueueStatus();
      setStore("queueStatus", status);
    };

    processorState = "busy";
    await onQueueStateChanged("busy");
    
    expect(store.queueStatus.state).toBe("busy");
  });
});

describe("StatusBar rendering", () => {
  it.skip("requires OpenTUI testRender for full E2E", () => {
    expect(true).toBe(true);
  });
});
