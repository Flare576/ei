# 0028: Investigate Slow LLM Response Times

**Status**: PENDING

## Problem

LLM responses are taking unexpectedly long, even with faster models (gpt-oss-20b). Possible causes:
- Multiple LLM calls being made per message (conversation + concept maps)
- Redundant or duplicate API calls
- Blocking operations in the processing pipeline
- Large context being sent unnecessarily

## Investigation Steps

- [ ] Monitor LM Studio logs during a single message send
- [ ] Count exact number of API calls per user message
- [ ] Measure time for each call individually
- [ ] Check if concept map generation is sequential or parallel
- [ ] Review `processor.ts` for unnecessary calls
- [ ] Check prompt sizes being sent

## Acceptance Criteria

- [ ] Document current call flow (how many calls, what order)
- [ ] Identify any redundant calls
- [ ] Optimize to minimum necessary calls
- [ ] Single message should complete in reasonable time for local models

## Technical Notes

This investigation must be done slowly and methodically - not parallelizable.

Check:
- `processor.ts` - main orchestration
- `llm.ts` - actual API calls
- `prompts.ts` - what's being sent
- `validate.ts` - concept validation flow

## Priority

Medium - Directly impacts user experience.
