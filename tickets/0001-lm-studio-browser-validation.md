# 0001: LM Studio Browser Validation

**Status**: PENDING
**Depends on**: None

## Summary

Validate that a web app running in a browser can successfully communicate with LM Studio's local API. This is a prerequisite for the entire V1 architecture—if CORS or other browser restrictions block local LLM calls, we need to know before building anything else.

## Acceptance Criteria

- [ ] Create a minimal HTML+JS page that calls LM Studio's `/v1/chat/completions` endpoint
- [ ] Test from `file://` protocol (local file)
- [ ] Test from `http://localhost:3000` (local dev server)
- [ ] Test from `https://` origin (GitHub Pages or similar)
- [ ] Document any CORS issues and workarounds
- [ ] Document LM Studio configuration requirements (if any)

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
