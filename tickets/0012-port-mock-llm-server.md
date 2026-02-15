# 0012: Port Mock LLM Server

**Status**: DONE
**Depends on**: None
**Epic**: E002 - MVP: Basic Chat

## Summary

Port the V0 mock LLM server to V1's test infrastructure. This OpenAI-compatible server enables deterministic E2E testing without requiring a real LLM. It's 616 lines of battle-tested code — we're porting, not rewriting.

## Acceptance Criteria

- [x] Create `tests/e2e/mock-server.ts` (or similar structure)
- [x] Server implements OpenAI `/v1/chat/completions` endpoint
- [x] Server supports request type detection (response, extraction, description, etc.)
- [x] Server supports response overrides via `setResponse()` and `setResponseForType()`
- [x] Server supports response queues for sequential test scenarios
- [x] Server supports configurable delays for timing tests
- [x] Server supports streaming responses (SSE format)
- [x] Server tracks request history for test assertions
- [x] Server can interrupt active streams (for abort testing)
- [x] Server starts on configurable port
- [x] Server cleans up properly on stop
- [x] Basic smoke test verifies server works

## Technical Notes

### Source File

`v0/tests/e2e/framework/mock-server.ts` — copy and adapt.

### Key Features to Preserve

1. **Request Type Detection** — Inspects system message to determine request type:
   - `response` — conversational
   - `system-concepts` — persona extraction
   - `human-concepts` — human extraction
   - `description` — persona descriptions

2. **Response Queue** — `setResponseQueue(['response1', 'response2'])` for multi-turn tests

3. **Streaming Support** — Full SSE streaming with chunk control and interruption

4. **Request History** — `getRequestHistory()` for asserting what was sent

### Adaptations Needed

- Update import paths
- Ensure TypeScript config compatibility
- May need to adjust for Vite's test environment vs V0's Node environment

### Test File Location

Suggest: `tests/e2e/framework/mock-server.ts` to mirror V0 structure, or `tests/helpers/mock-server.ts` if we want flatter structure.

### Dependencies

- `express` (already in V0, add to devDependencies)
- Types from `tests/e2e/types.ts` (port MockServerConfig, MockResponse, MockRequest)

## Out of Scope

- Playwright setup (ticket 0031)
- Full E2E test harness (ticket 0016 uses this, but setup is separate)
- Rate limiting simulation (nice-to-have, not MVP)
