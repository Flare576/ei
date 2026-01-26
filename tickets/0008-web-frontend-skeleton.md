# 0008: Web Frontend Skeleton

**Status**: PENDING
**Depends on**: 0007

## Summary

Create a minimal React web frontend that instantiates the Processor and demonstrates the event system working. This is the "hello world" that proves the architecture works end-to-end.

## Acceptance Criteria

- [ ] Create `web/` directory with React + Vite setup
- [ ] App creates Processor with Ei_Interface handlers
- [ ] Display list of personas (from `getPersonaList()`)
- [ ] Display queue status (from `getQueueStatus()`)
- [ ] Show "thinking..." when `onMessageProcessing` fires
- [ ] Show basic chat UI (even if non-functional beyond display)
- [ ] Console logs all events for debugging
- [ ] Runs on `http://localhost:5173` (Vite default)

## Implementation Notes

### Project Setup

```bash
cd web
npm create vite@latest . -- --template react-ts
npm install
```

### Minimal App Structure

```typescript
// web/src/App.tsx
function App() {
  const [processor, setProcessor] = useState<Processor | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ state: "idle", pending_count: 0 });
  
  useEffect(() => {
    const p = new Processor({
      onPersonaAdded: () => {
        console.log("Event: onPersonaAdded");
        p.getPersonaList().then(setPersonas);
      },
      onQueueStateChanged: (state) => {
        console.log("Event: onQueueStateChanged", state);
        p.getQueueStatus().then(setQueueStatus);
      },
      // ... etc
    });
    
    p.start().then(() => {
      setProcessor(p);
      p.getPersonaList().then(setPersonas);
    });
    
    return () => { p.stop(); };
  }, []);
  
  return (
    <div>
      <h1>EI V1</h1>
      <p>Queue: {queueStatus.state} ({queueStatus.pending_count} pending)</p>
      <ul>
        {personas.map(p => <li key={p.name}>{p.name}</li>)}
      </ul>
    </div>
  );
}
```

### No Styling Required

This ticket is about proving the architecture works. Styling comes later. A functional ugly page is success.

## File Structure

```
web/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── App.tsx
    ├── main.tsx
    └── vite-env.d.ts
```

## Success Criteria

1. `npm run dev` starts the app
2. App loads without errors
3. Console shows events firing
4. If LM Studio is running, can send a message and see response appear
