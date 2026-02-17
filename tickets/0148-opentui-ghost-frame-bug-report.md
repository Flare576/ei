# 0148: OpenTUI Ghost Frame Bug Report

**Status**: PENDING
**Depends on**: None
**Type**: UPSTREAM_BUG_REPORT

## Summary

Document and create a minimal reproduction case for the "ghost frame" bug discovered during TUI editor integration. When spawning an external process (like $EDITOR) via `renderer.suspend()` and `renderer.resume()`, visual artifacts can occur on application exit under certain timing conditions.

## The Bug

### Symptoms

1. **Ghost Frame**: After exiting the TUI app (Ctrl+C or `/q`), the last rendered frame remains visible in the terminal above the cursor, instead of being cleared.

2. **Cursor Color Artifacts**: When re-entering an alternate screen application (like vim) after resume, the cursor may display with incorrect colors (e.g., white instead of the expected color).

3. **Invisible Ghost Frame**: Cursor appears at the bottom of the screen as if a blank frame is persisting.

### Trigger Conditions

The bug manifests when:
1. TUI is running (alternate screen mode)
2. User action triggers `renderer.suspend()` 
3. External process spawns (e.g., `$EDITOR`)
4. External process exits
5. `renderer.resume()` is called
6. **Immediately** another action triggers `renderer.suspend()` again (the key factor)
7. Steps 3-6 repeat
8. User exits the TUI app

### Root Cause Hypothesis

When `hideOverlay()` is called and the code immediately loops back to spawn the editor again, there isn't enough time for:
- The overlay state change to propagate through SolidJS reactivity
- The renderer to complete a full frame render
- The terminal to fully process the screen state change

This creates a race condition where the renderer's internal state doesn't match the actual terminal state.

### The Fix That Worked

Adding a 50ms delay between overlay dismissal and the next `renderer.suspend()` call:

```typescript
if (shouldReEdit) {
  yamlContent = result.content;
  await new Promise(r => setTimeout(r, 50));  // This fixed it
  continue;
}
```

## Acceptance Criteria

- [ ] Create minimal reproduction repository
- [ ] Document exact steps to reproduce
- [ ] Test on multiple terminals (iTerm2, Terminal.app, Alacritty, Kitty)
- [ ] Identify minimum delay required (is 50ms optimal? Could 16ms work?)
- [ ] File issue on OpenTUI GitHub repository
- [ ] Link to upstream issue in this ticket

## Minimal Reproduction Plan

### Proposed Test App Structure

```
opentui-ghost-frame-repro/
├── package.json
├── src/
│   └── index.tsx
└── README.md
```

### Minimal Code

```tsx
// src/index.tsx
import { render } from "@opentui/solid";
import { createSignal } from "solid-js";

function App() {
  const [showOverlay, setShowOverlay] = createSignal(false);
  const [iteration, setIteration] = createSignal(0);
  
  const spawnEditor = async (renderer: CliRenderer) => {
    renderer.suspend();
    
    // Spawn editor
    const child = spawn(process.env.EDITOR || "vi", ["/tmp/test.txt"], {
      stdio: "inherit",
      shell: true,
    });
    
    await new Promise(resolve => child.on("exit", resolve));
    
    renderer.resume();
    renderer.requestRender();
  };
  
  const handleKeypress = async (event, renderer) => {
    if (event.name === "e") {
      // First editor open
      await spawnEditor(renderer);
      
      // Show "error" overlay
      setShowOverlay(true);
    }
    
    if (event.name === "y" && showOverlay()) {
      setShowOverlay(false);
      
      // BUG: Without this delay, ghost frame occurs on exit
      // await new Promise(r => setTimeout(r, 50));
      
      // Re-open editor immediately
      setIteration(i => i + 1);
      await spawnEditor(renderer);
    }
    
    if (event.name === "q") {
      process.exit(0);
    }
  };
  
  return (
    <box>
      <text>Press 'e' to open editor, iteration: {iteration()}</text>
      <Show when={showOverlay()}>
        <box position="absolute">
          <text>Simulated error - press 'y' to retry</text>
        </box>
      </Show>
    </box>
  );
}

render(() => <App />);
```

### Reproduction Steps

1. Run the test app
2. Press 'e' to open editor
3. Save and quit editor (`:wq` in vim)
4. Overlay appears - press 'y'
5. Editor opens again
6. Save and quit editor
7. Press 'q' to exit
8. **Observe**: Ghost frame visible above cursor

### Expected vs Actual

**Expected**: Terminal returns to clean state, cursor at normal position, no remnants of TUI visible.

**Actual**: Last TUI frame remains visible above cursor; may need to run `clear` or `reset` to fix terminal.

## Environment Details

- **OpenTUI Version**: (check package.json)
- **SolidJS Version**: (check package.json)  
- **Bun Version**: 1.x
- **Terminal**: iTerm2 / Terminal.app / etc
- **OS**: macOS Sonoma

## Related Code References

- `tui/src/util/editor.ts` - `spawnEditor()` function
- `tui/src/commands/me.tsx` - Re-edit flow with delay fix
- `tui/src/util/persona-editor.tsx` - Same pattern

## Notes

The 50ms delay is a workaround, not a proper fix. Ideally OpenTUI should:
1. Provide an async `suspend()` that resolves when terminal state is stable
2. Or provide a `waitForRender()` method to ensure frame completion
3. Or internally handle the race condition in rapid suspend/resume cycles

This could also be a terminal emulator issue rather than OpenTUI, but the framework could potentially work around it.
