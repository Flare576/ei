# E2E Test Failure Analysis

## Test Case
**File**: `tests/e2e/scenarios/quit-command-integration.e2e.test.ts`  
**Test**: `quit command works in different application states`  
**Error**: `Error: Application is already running. Call stopApp() first.`  
**Location**: `tests/e2e/framework/harness.ts:152:13`

## Error Reproduction

The test fails consistently when trying to start the application for the second time within the same test case:

```bash
npm test -- --run tests/e2e/scenarios/quit-command-integration.e2e.test.ts -t "quit command works in different application states"
```

**Error Output**:
```
Error: Application is already running. Call stopApp() first.
❯ E2ETestHarnessImpl.startApp tests/e2e/framework/harness.ts:152:13
❯ tests/e2e/scenarios/quit-command-integration.e2e.test.ts:298:19
```

## Root Cause Analysis

### Test Structure Issue
The failing test attempts to start and stop the application **multiple times within a single test case**:

```typescript
test('quit command works in different application states', async () => {
  // Test 1: Quit immediately after startup
  await harness.startApp({ debugMode: false });
  await harness.waitForIdleState(2000);
  await harness.sendCommand('/quit');
  await harness.assertExitCode(0, 5000);
  
  // Test 2: Quit after some interaction - FAILS HERE
  await harness.startApp({ debugMode: false }); // ← Error occurs here
  // ... rest of test
});
```

### Infrastructure Bug: Incomplete Process Cleanup

**File**: `tests/e2e/framework/harness.ts`  
**Method**: `assertExitCode()` (lines 844-862)

The `assertExitCode` method waits for the process to exit but **does not clean up the `currentProcess` reference**:

```typescript
async assertExitCode(expectedExitCode: number, timeout: number = 5000): Promise<void> {
  if (!this.currentProcess) {
    throw new Error('No application process to check exit code');
  }

  try {
    const actualExitCode = await this.processManager.waitForExit(this.currentProcess, timeout);
    
    if (actualExitCode !== expectedExitCode) {
      throw new Error(`Exit code assertion failed: Expected ${expectedExitCode}, got ${actualExitCode}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new Error(`Exit code assertion failed: Process did not exit within ${timeout}ms`);
    }
    throw error;
  }
  // ← MISSING: this.currentProcess = null;
}
```

### Process Lifecycle Mismatch

**File**: `tests/e2e/framework/harness.ts`  
**Method**: `startApp()` (lines 147-152)

The `startApp` method correctly checks if a process is already running:

```typescript
async startApp(options?: AppStartOptions): Promise<void> {
  if (!this.isSetup) {
    throw new Error('Test harness must be set up before starting app. Call setup() first.');
  }

  if (this.currentProcess) {
    throw new Error('Application is already running. Call stopApp() first.'); // ← This check fails
  }
  // ...
}
```

**The Problem**: After `assertExitCode` completes, the process has exited but `this.currentProcess` still references the dead process object.

### Comparison with Working Cleanup

**File**: `tests/e2e/framework/harness.ts`  
**Method**: `stopApp()` (lines 197-230)

The `stopApp` method correctly cleans up the process reference:

```typescript
async stopApp(): Promise<void> {
  if (!this.currentProcess) {
    return; // Already stopped or never started
  }

  // ... shutdown logic ...
  
  } finally {
    this.currentProcess = null; // ← Proper cleanup
  }
}
```

## Issue Classification

**This is a TEST INFRASTRUCTURE BUG**, not an application bug.

### Evidence:
1. **Application works correctly**: The `/quit` command successfully terminates the application with exit code 0
2. **Process exits cleanly**: `assertExitCode` successfully waits for and validates the exit code
3. **Test harness state management bug**: The harness fails to update its internal state after process exit
4. **Other tests pass**: Tests that don't restart the app within the same test case work fine

## Impact Analysis

### Affected Test Patterns
This bug affects any test that:
- Calls `assertExitCode()` followed by `startApp()` in the same test case
- Attempts to test multiple application lifecycle scenarios in sequence
- Uses the "restart app to test different states" pattern

### Currently Affected Tests
- `quit command works in different application states` - **FAILING**
- Other tests in the same file that follow similar patterns may be at risk

### Not Affected
- Tests that only start/stop the app once per test case
- Tests that use `beforeEach`/`afterEach` for app lifecycle management
- Tests that explicitly call `stopApp()` before restarting

## Recommended Fix

### Primary Fix: Update `assertExitCode` Method

**File**: `tests/e2e/framework/harness.ts`  
**Lines**: 844-862

Add process cleanup to the `assertExitCode` method:

```typescript
async assertExitCode(expectedExitCode: number, timeout: number = 5000): Promise<void> {
  if (!this.currentProcess) {
    throw new Error('No application process to check exit code');
  }

  try {
    const actualExitCode = await this.processManager.waitForExit(this.currentProcess, timeout);
    
    if (actualExitCode !== expectedExitCode) {
      throw new Error(`Exit code assertion failed: Expected ${expectedExitCode}, got ${actualExitCode}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new Error(`Exit code assertion failed: Process did not exit within ${timeout}ms`);
    }
    throw error;
  } finally {
    // Clean up process reference after exit verification
    this.currentProcess = null;
  }
}
```

### Alternative Fix: Test Restructuring

If the primary fix has unintended consequences, restructure the failing test:

```typescript
// Split into separate test cases
test('quit command works immediately after startup', async () => {
  await harness.startApp({ debugMode: false });
  await harness.waitForIdleState(2000);
  await harness.sendCommand('/quit');
  await harness.assertExitCode(0, 5000);
});

test('quit command works after interaction', async () => {
  await harness.startApp({ debugMode: false });
  await harness.waitForIdleState(2000);
  await harness.sendInput('Some interaction\n');
  await harness.waitForIdleState(3000);
  await harness.sendCommand('/quit');
  await harness.assertExitCode(0, 5000);
});

test('quit command works during processing', async () => {
  harness.setMockResponse('/v1/chat/completions', 'Processing response', 1500);
  await harness.startApp({ debugMode: false });
  await harness.waitForIdleState(2000);
  await harness.sendInput('Trigger processing\n');
  await harness.waitForLLMRequest(1000);
  await harness.sendCommand('/quit');
  await harness.assertExitCode(0, 8000);
});
```

## Risk Assessment

### Primary Fix Risk: **LOW**
- The fix aligns with existing patterns in `stopApp()`
- Process is already dead when `assertExitCode` completes
- No other code should depend on accessing a dead process reference

### Test Impact: **MINIMAL**
- Fix enables the intended test behavior
- No changes needed to other passing tests
- Improves test harness reliability

## Verification Steps

After implementing the fix:

1. **Run the failing test**: Verify it now passes
2. **Run all E2E tests**: Ensure no regressions
3. **Test multiple restart scenarios**: Verify the pattern works reliably
4. **Check process cleanup**: Ensure no zombie processes remain

## Conclusion

This is a clear test infrastructure bug in the E2E harness process lifecycle management. The `assertExitCode` method successfully waits for process exit but fails to clean up the internal process reference, causing subsequent `startApp()` calls to fail incorrectly.

The fix is straightforward and low-risk: add `this.currentProcess = null` to the `finally` block of `assertExitCode`, matching the cleanup pattern used in `stopApp()`.

This bug does not indicate any issues with the EI application itself - the `/quit` command works correctly and the application exits cleanly as expected.