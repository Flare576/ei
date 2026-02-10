import { describe, it, expect } from "vitest";

describe("Keyboard context logic", () => {
  const PANELS = ["sidebar", "messages", "input"] as const;
  type Panel = typeof PANELS[number];

  function createKeyboardNav() {
    let currentPanel: Panel = "input";

    const focusedPanel = () => currentPanel;
    
    const setFocusedPanel = (panel: Panel) => {
      currentPanel = panel;
    };

    const nextPanel = () => {
      const current = focusedPanel();
      const idx = PANELS.indexOf(current);
      const nextIdx = (idx + 1) % PANELS.length;
      currentPanel = PANELS[nextIdx];
    };

    const prevPanel = () => {
      const current = focusedPanel();
      const idx = PANELS.indexOf(current);
      const prevIdx = (idx - 1 + PANELS.length) % PANELS.length;
      currentPanel = PANELS[prevIdx];
    };

    return { focusedPanel, setFocusedPanel, nextPanel, prevPanel };
  }

  it("starts with input panel focused", () => {
    const nav = createKeyboardNav();
    expect(nav.focusedPanel()).toBe("input");
  });

  it("nextPanel cycles forward through panels", () => {
    const nav = createKeyboardNav();
    
    nav.nextPanel();
    expect(nav.focusedPanel()).toBe("sidebar");
    
    nav.nextPanel();
    expect(nav.focusedPanel()).toBe("messages");
    
    nav.nextPanel();
    expect(nav.focusedPanel()).toBe("input");
  });

  it("prevPanel cycles backward through panels", () => {
    const nav = createKeyboardNav();
    
    nav.prevPanel();
    expect(nav.focusedPanel()).toBe("messages");
    
    nav.prevPanel();
    expect(nav.focusedPanel()).toBe("sidebar");
    
    nav.prevPanel();
    expect(nav.focusedPanel()).toBe("input");
  });

  it("setFocusedPanel directly sets panel", () => {
    const nav = createKeyboardNav();
    
    nav.setFocusedPanel("sidebar");
    expect(nav.focusedPanel()).toBe("sidebar");
    
    nav.setFocusedPanel("messages");
    expect(nav.focusedPanel()).toBe("messages");
  });
});

describe("StatusBar logic", () => {
  type QueueState = "idle" | "busy" | "paused";
  
  function getQueueIndicator(state: QueueState, pendingCount: number): string {
    if (state === "busy") {
      return `Processing (${pendingCount})`;
    }
    if (state === "paused") {
      return "Paused";
    }
    return "Ready";
  }

  it("returns Ready for idle state", () => {
    expect(getQueueIndicator("idle", 0)).toBe("Ready");
  });

  it("returns Processing with count for busy state", () => {
    expect(getQueueIndicator("busy", 3)).toBe("Processing (3)");
  });

  it("returns Paused for paused state", () => {
    expect(getQueueIndicator("paused", 1)).toBe("Paused");
  });

  it("getFocusIndicator capitalizes panel name", () => {
    const getFocusIndicator = (panel: string) => {
      return panel.charAt(0).toUpperCase() + panel.slice(1);
    };
    
    expect(getFocusIndicator("sidebar")).toBe("Sidebar");
    expect(getFocusIndicator("messages")).toBe("Messages");
    expect(getFocusIndicator("input")).toBe("Input");
  });
});
