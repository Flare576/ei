# 0017: Ei Welcome Message

**Status**: PENDING
**Depends on**: 0015
**Epic**: E002 - MVP: Basic Chat

## Summary

When a user first opens Ei (no existing state), Ei should greet them with a welcome message explaining the system and asking for their name. This is the one pre-defined, user-facing prompt in the system — everything else is generated.

## Acceptance Criteria

- [ ] On first run (no checkpoints exist), Ei persona is created automatically
- [ ] Ei's first message is a welcome message (not LLM-generated)
- [ ] Welcome message introduces Ei and the system concept
- [ ] Welcome message asks for the user's name
- [ ] Message is appended to Ei's history like any other message
- [ ] Subsequent app loads (with existing state) do NOT show welcome again
- [ ] Welcome message content is configurable/templated (not hardcoded in logic)

## Technical Notes

### Welcome Message Content

From the backward doc:
> "Ei's message is waiting for the user, introducing themselves and the system. It asks them for their name."
> "Ironically, I think this is the ONLY pre-defined, user-facing prompt in the system."

Draft content:
```
Hello! I'm Ei, your personal companion in this space.

I'm here to listen, remember, and help you reflect. As we talk, I'll learn about you — your interests, the people in your life, what matters to you. This helps me (and any other personas you create) have more meaningful conversations with you.

Everything stays private and local to your device.

To get started, what should I call you?
```

### Implementation Location

Option 1: In Processor.start() after StateManager.initialize()
```typescript
async start(storage: Storage): Promise<void> {
  await this.stateManager.initialize(storage);
  
  // Check if this is first run
  const checkpoints = await this.stateManager.checkpoint_list();
  if (checkpoints.length === 0) {
    await this.bootstrapFirstRun();
  }
  // ...
}

private async bootstrapFirstRun(): Promise<void> {
  // Create Ei persona
  const eiEntity: PersonaEntity = {
    entity: "system",
    aliases: ["Ei", "ei"],
    short_description: "Your system guide and companion",
    long_description: "...",
    // ... other fields
  };
  this.stateManager.persona_add("ei", eiEntity);
  
  // Add welcome message
  const welcomeMessage: Message = {
    id: crypto.randomUUID(),
    role: "system",
    content: WELCOME_MESSAGE_CONTENT,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Always, // Always include in context
  };
  this.stateManager.messages_append("ei", welcomeMessage);
  
  this.interface.onPersonaAdded?.();
  this.interface.onMessageAdded?.("ei");
}
```

Option 2: Separate initialization module

### Welcome Message Template

Create `src/templates/welcome.ts`:
```typescript
export const WELCOME_MESSAGE = `
Hello! I'm Ei, your personal companion in this space.

I'm here to listen, remember, and help you reflect. As we talk, I'll learn about you — your interests, the people in your life, what matters to you. This helps me (and any other personas you create) have more meaningful conversations with you.

Everything stays private and local to your device.

To get started, what should I call you?
`.trim();
```

### Context Status

The welcome message should have `context_status: "always"` so it's never excluded from context — it establishes the relationship.

### Ei Persona Definition

Need to define Ei's initial traits/topics. From V0, Ei has:
- Traits: empathetic, curious, supportive
- Topics: self-reflection, emotional awareness, human connection
- Special: sees all groups, no group_primary

## Out of Scope

- Onboarding wizard (0090)
- LLM provider setup flow
- User preferences collection beyond name
