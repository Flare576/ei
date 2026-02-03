# 0096: Provider Accounts & Settings Sync

**Status**: DONE
**Depends on**: 0081

## Summary

Add a unified account system for external services:
1. **LLM providers** (OpenRouter, Bedrock, Google AI, local, etc.)
2. **Storage providers** (flare576.com, Dropbox, Google Drive, etc.)

This enables multi-provider LLM access and cross-device sync.

## Acceptance Criteria

### Provider Account Schema
- [x] Add `ProviderAccount` type to CONTRACTS.md and types.ts
- [x] Add `accounts?: ProviderAccount[]` to `HumanSettings`
- [x] Support both API key auth (`api_key`) and username/password (`username`+`password`)
- [x] User-defined names for accounts (e.g., "OpenRouter-Free", "Work Bedrock")
- [x] Account type enum: `"llm" | "storage"`

### LLM Provider Support
- [x] Wire account-based model resolution in llm-client.ts
- [x] Allow model spec format: `account-name:model` (e.g., `OpenRouter-Free:mistralai/mistral-7b`)
- [x] Fall back to environment variables if no matching account
- [x] Support provider-specific headers (OpenRouter needs `HTTP-Referer`, etc.)

### Storage Provider Support (V1.2)
- [ ] Define `RemoteStorage` interface (upload/download encrypted blob)
- [ ] Implement flare576.com storage adapter
- [ ] Username/passphrase → encryption key derivation
- [ ] Upload settings on change (debounced)
- [ ] Download settings on login
- [ ] Conflict resolution: remote wins (with warning) or manual merge
- [ ] Offline-first: works without sync, syncs when available
- [ ] Clear indication of sync status

### UI
- [x] Account management in HumanEditor settings tab
- [x] Add/edit/delete accounts
- [ ] Test connection button (deferred - nice to have)
- [ ] Show which account is active for LLM calls (deferred - nice to have)

### E2E Tests
- [x] Settings save/load test (basic UI verification)
- [x] Account CRUD test (basic UI verification, full CRUD deferred)

## Proposed Schema

```typescript
enum ProviderType {
  LLM = "llm",
  Storage = "storage",
}

interface ProviderAccount {
  id: string;                    // UUID
  name: string;                  // User-defined display name
  type: ProviderType;            // "llm" | "storage"
  url: string;                   // Base URL for API
  
  // Auth (one of these patterns)
  api_key?: string;              // Bearer token auth
  username?: string;             // Basic auth or custom
  password?: string;             // Basic auth or custom
  
  // LLM-specific
  default_model?: string;        // Default model for this account
  
  // Provider-specific extras (headers, etc.)
  extra_headers?: Record<string, string>;
  
  // Metadata
  enabled?: boolean;             // Default: true
  created_at: string;            // ISO timestamp
}

interface HumanSettings {
  // ... existing fields ...
  accounts?: ProviderAccount[];
}
```

## Notes

**Security Consideration**: Credentials stored in localStorage (clear text). This is acceptable for local-first app where the user controls their browser. For shared devices, users should use browser private mode or not save credentials.

**OpenRouter Specifics**:
- Base URL: `https://openrouter.ai/api/v1`
- Requires `HTTP-Referer` header (can be `https://ei.flare576.com`)
- Requires `X-Title` header (optional, shows in OpenRouter dashboard)
- Model format: `provider/model` (e.g., `mistralai/mistral-7b-instruct`)

**V1 Backward Reference**:
- "Username/pass phrase should run encryption flow and get latest settings from flare576.com"

**Implementation Order**:
1. Schema + CONTRACTS.md update
2. OpenRouter LLM provider (validates the pattern)
3. UI for account management
4. Storage providers (V1.2)
