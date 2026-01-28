# 0015: Wire UI to Processor

**Status**: PENDING
**Depends on**: 0011, 0013, 0014
**Epic**: E002 - MVP: Basic Chat

## Summary

Connect the UI components to the Processor, establishing the complete message flow from user input to LLM response to displayed message. This is the integration ticket that makes everything work together.

## Acceptance Criteria

- [ ] App component creates Processor instance with Ei_Interface handlers
- [ ] App calls `processor.start(storage)` on mount
- [ ] App calls `processor.stop()` on unmount
- [ ] Persona list populated from `processor.getPersonaList()`
- [ ] Switching personas calls `processor.getMessages(name)` to load history
- [ ] Sending message calls `processor.sendMessage(personaName, content)`
- [ ] `onMessageAdded` event triggers re-fetch of messages
- [ ] `onPersonaUpdated` event triggers re-fetch of persona list
- [ ] `onQueueStateChanged` shows some indicator (can be simple)
- [ ] Human message appears immediately after send
- [ ] AI response appears when `onMessageAdded` fires
- [ ] Basic error handling shows errors from `onError`

## Technical Notes

### App Structure

```tsx
function App() {
  const [processor] = useState(() => new Processor(eiInterface));
  const [activePersona, setActivePersona] = useState('ei');
  const [messages, setMessages] = useState<Message[]>([]);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const eiInterface: Ei_Interface = {
    onMessageAdded: (personaName) => {
      if (personaName === activePersona) {
        processor.getMessages(personaName).then(setMessages);
      }
    },
    onPersonaUpdated: () => {
      processor.getPersonaList().then(setPersonas);
    },
    onQueueStateChanged: (state) => {
      setIsProcessing(state === 'busy');
    },
    onError: (error) => {
      console.error(error); // MVP: just log
    },
  };

  useEffect(() => {
    const storage = new LocalStorage();
    processor.start(storage);
    processor.getPersonaList().then(setPersonas);
    processor.getMessages('ei').then(setMessages);
    
    return () => { processor.stop(); };
  }, []);

  // ... render PersonaPanel and ChatPanel
}
```

### Event Flow

```
User types message
    ↓
ChatPanel.onSendMessage(content)
    ↓
App calls processor.sendMessage(personaName, content)
    ↓
Processor: 
  1. Appends human message to StateManager
  2. Fires onMessageAdded(personaName)
  3. Enqueues LLM request
  4. Fires onMessageQueued(personaName)
    ↓
UI re-fetches messages, shows human message
    ↓
QueueProcessor executes LLM call
    ↓
Handler appends AI response to StateManager
    ↓
Processor fires onMessageAdded(personaName)
    ↓
UI re-fetches messages, shows AI response
```

### Response Prompt Integration

Ticket 0011 creates `buildResponsePrompt`. This ticket integrates it:

1. Update `Processor.sendMessage()` to:
   - Gather ResponsePromptData from StateManager
   - Call `buildResponsePrompt(data)`
   - Use returned system/user in LLMRequest

2. Need helper function to build ResponsePromptData:
   - Get persona entity
   - Get human entity
   - Filter human data by persona's visible groups
   - Get visible personas list
   - Calculate delay_ms from last message timestamp

### Storage

Use `LocalStorage` from `src/storage/local.ts` — it's ready.

### Ei Bootstrap

On first run (no checkpoints), StateManager has empty state. Need to:
- Create "ei" persona if it doesn't exist
- This could be in Processor.start() or a separate initialization

## Out of Scope

- Full state management (Redux/Zustand)
- Optimistic updates with rollback
- Error UI beyond console.log
- Loading states
- Checkpoint UI
