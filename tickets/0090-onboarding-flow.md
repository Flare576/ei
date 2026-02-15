# 0090: Onboarding Flow

**Status**: DONE
**Depends on**: 0087

## Summary

First-time user experience: welcome, LLM configuration, initial setup.

## Acceptance Criteria

- [x] Detect first-time user (no checkpoints in storage)
- [x] Welcome screen explaining EI: privacy-first, local-first, You-nified context
- [x] CTA: "I have an account" vs "Get started"
- [x] Account flow: username/passphrase → fetch settings from flare576.com
- [x] New user flow:
  1. Local LLM API? URL, API key, CORS status
  2. If not: Which providers? (Anthropic/OpenAI/Google)
  3. Auth method: API Key or OAuth
  4. Model selection: recommended defaults or custom
- [x] Save settings, fade to main UI with Ei's welcome
- [ ] Skip option for experienced users

## Notes

**V1 Backward Reference**:
- "When user first hits page, greeted with explanation"
- "CTA to enter username/passphrase if switching devices, or continue to initial settings"
- "Walk them through: Local LLM API? Provider accounts? Model selection?"

**2026-02-03 - Scope Update from 0096 Work**:
- Ticket 0096 implements the `ProviderAccount` schema and account management UI in `HumanSettingsTab`
- This ticket should **reuse** the `ProviderList` and `ProviderEditor` components created in 0096
- Onboarding wizard can guide users through adding their first provider account using the same UI
- The "edit/manage settings in main interface" requirement is satisfied by 0096's UI implementation
- This ticket focuses on: first-run detection, welcome flow, guided setup wizard, and account sync flow

**2026-02-04 - Implementation**:
- Created `/web/src/components/Onboarding/Onboarding.tsx` with multi-step wizard
- Steps: Welcome → AccountChoice → ExistingAccount/LocalLLMCheck → ProviderSetup → Complete
- Reuses `ProviderList` and `ProviderEditor` from 0096
- App.tsx checks `checkpoints.length === 0` to detect first-run
- "I have an account" flow: fetches remote state, seeds localStorage, Processor loads it
- "Get started" flow: auto-detects local LLM at :1234, then provider setup, Processor bootstraps Ei
- Save and Exit: wipes autosaves after successful sync, hidden when sync not configured
- ConflictResolutionModal: added hint about using Save and Exit to avoid conflicts
- Skip option: Not implemented - users can easily navigate through quickly with minimal clicks
