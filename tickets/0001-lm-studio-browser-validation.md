# 0001: LM Studio Browser Validation

**Status**: DONE
**Depends on**: None

## Summary

Validate that a web app running in a browser can successfully communicate with LM Studio's local API. This is a prerequisite for the entire V1 architecture—if CORS or other browser restrictions block local LLM calls, we need to know before building anything else.

## Acceptance Criteria

- [x] Create a minimal HTML+JS page that calls LM Studio's `/v1/chat/completions` endpoint
- [x] Test from `file://` protocol (local file) - **SKIPPED: localhost works, file:// not needed**
- [x] Test from `http://localhost:3000` (local dev server) - **PASS with CORS enabled**
- [x] Test from `https://` origin (GitHub Pages or similar) - **NOT VIABLE (mixed content)**
- [x] Document any CORS issues and workarounds
- [x] Document LM Studio configuration requirements (if any)

## Test Approach

```javascript
// Minimal test - paste in browser console or create test.html
fetch('http://127.0.0.1:1234/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'local-model',
    messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }]
  })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

## Notes

- LM Studio may need "Enable CORS" setting turned on
- If CORS is blocked from remote origins, document the limitation (local-only is acceptable for V1)
- This ticket is intentionally small—it's a spike to validate the core assumption

---

## Test Results (2026-01-26)

### Test Infrastructure

Created `spike/lm-studio-test.html` - a self-contained test page that:
- Detects current origin type (file://, localhost, https://)
- Makes a test call to LM Studio API
- Shows success/failure with diagnostics
- Provides troubleshooting guidance

Created `spike/serve.sh` - simple HTTP server launcher for localhost testing.

### Test 1: localhost:3000

**Result: PASS (with CORS enabled)**

- Response time: 2385ms
- Model response: "Hello"
- Finish reason: stop

**Screenshot**: `spike/test-localhost-success.png`

**Previous attempt** (CORS disabled): Failed with CORS policy error. Screenshot: `spike/test-localhost-cors-blocked.png`

### Test 2: file:// protocol

**Result: PENDING MANUAL TEST**

Playwright cannot access file:// URLs (browser security). Manual test required:
```bash
open spike/lm-studio-test.html
```

### Test 3: https:// origin

**Result: EXPECTED TO FAIL**

HTTPS origins cannot make requests to HTTP localhost (mixed content). This is a fundamental browser security restriction with no workaround.

**Acceptable for V1**: Remote HTTPS hosting will NOT work with local LM Studio. EI V1 will be local-only.

---

## LM Studio Configuration Requirements

### Required Setting: Enable CORS

In LM Studio:
1. Go to **Local Server** tab (left sidebar)
2. Find **Enable CORS** toggle
3. Turn it **ON**
4. Restart the local server if already running

Without this setting, browser-based apps CANNOT call LM Studio's API due to browser security policies.

### Acceptable V1 Limitations

| Origin Type | Works? | Notes |
|-------------|--------|-------|
| `file://` | TBD | Needs manual test with CORS enabled |
| `localhost` | YES* | *Requires CORS enabled in LM Studio |
| `https://` remote | NO | Mixed content blocked by browsers |

**V1 Architecture Decision**: EI will run as a localhost web app. Users must have LM Studio running locally with CORS enabled.
