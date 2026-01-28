# 0090: Onboarding Flow

**Status**: PENDING
**Depends on**: 0087

## Summary

First-time user experience: welcome, LLM configuration, initial setup.

## Acceptance Criteria

- [ ] Detect first-time user (no checkpoints in storage)
- [ ] Welcome screen explaining EI: privacy-first, local-first, You-nified context
- [ ] CTA: "I have an account" vs "Get started"
- [ ] Account flow: username/passphrase → fetch settings from flare576.com
- [ ] New user flow:
  1. Local LLM API? URL, API key, CORS status
  2. If not: Which providers? (Anthropic/OpenAI/Google)
  3. Auth method: API Key or OAuth
  4. Model selection: recommended defaults or custom
- [ ] Save settings, fade to main UI with Ei's welcome
- [ ] Skip option for experienced users

## Notes

**V1 Backward Reference**:
- "When user first hits page, greeted with explanation"
- "CTA to enter username/passphrase if switching devices, or continue to initial settings"
- "Walk them through: Local LLM API? Provider accounts? Model selection?"
