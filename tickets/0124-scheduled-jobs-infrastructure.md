# 0124: Scheduled Jobs Infrastructure

**Status**: PENDING

## Summary

Create a centralized scheduled jobs system to handle regular background operations. Separates "Heartbeat" (idle persona behavior) from system-wide maintenance tasks.

## Terminology Clarification

| Term | Definition | Old Confusion |
|------|------------|---------------|
| **Heartbeat** | Idle behavior of a specific persona (every 30min of inactivity) | Used to mean "anything on a timer" |
| **Scheduled Job** | System-wide regular interval task | Didn't exist as concept |

In the old architecture, "heartbeat" was overloaded:
- Countdown timer for persona
- Activity when switching away from persona  
- Human map generation trigger
- Concept decay trigger
- etc.

In the new architecture:
- **Heartbeat** = ONE thing: "Does this persona want to reach out after 30min of silence?"
- **Scheduled Jobs** = Stand-alone processes on various intervals

## Scheduled Jobs Needed

| Job | Interval | Purpose | Ticket |
|-----|----------|---------|--------|
| **Daily Ceremony** | Daily at 9am (configurable) | Ei presents validations | 0115 |
| **Decay Operation** | Hourly | Reduce `level_current` on topics/people | existing |
| **Stale Message Check** | Every 20 minutes | Find messages >10min old without extraction, queue extraction | 0113 |
| **Description Maintenance** | (future) | Regenerate stale persona descriptions | (future) |

## Infrastructure Design

```typescript
interface ScheduledJob {
  name: string;
  interval: number;           // milliseconds
  enabled: boolean;
  lastRun: string | null;     // ISO timestamp
  nextRun: string | null;     // ISO timestamp
  handler: () => Promise<void>;
}

class ScheduledJobManager {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  
  register(job: ScheduledJob): void {
    this.jobs.set(job.name, job);
  }
  
  start(): void {
    for (const [name, job] of this.jobs) {
      if (!job.enabled) continue;
      
      const interval = setInterval(async () => {
        await this.runJob(name);
      }, job.interval);
      
      this.timers.set(name, interval);
      
      // Run immediately if never run or overdue
      if (!job.lastRun || Date.now() > new Date(job.nextRun!).getTime()) {
        await this.runJob(name);
      }
    }
  }
  
  private async runJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) return;
    
    const now = new Date().toISOString();
    job.lastRun = now;
    job.nextRun = new Date(Date.now() + job.interval).toISOString();
    
    try {
      await job.handler();
      await this.persistJobState();
    } catch (err) {
      console.error(`[ScheduledJob] ${name} failed:`, err);
    }
  }
  
  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
  
  private async persistJobState(): Promise<void> {
    const state = Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      lastRun: job.lastRun,
      nextRun: job.nextRun
    }));
    await writeFile(
      path.join(getDataPath(), 'scheduled_jobs.jsonc'),
      JSON.stringify({ jobs: state }, null, 2)
    );
  }
}
```

## Job Implementations

### Daily Ceremony (0115)

```typescript
const dailyCeremonyJob: ScheduledJob = {
  name: "daily_ceremony",
  interval: 24 * 60 * 60 * 1000,  // 24 hours
  enabled: true,
  lastRun: null,
  nextRun: null,
  handler: async () => {
    const config = await loadCeremonyConfig();
    const now = new Date();
    
    // Only run if it's past ceremony time and we haven't run today
    if (!isPastCeremonyTime(config.time, now)) return;
    
    const message = await buildDailyCeremonyMessage();
    if (message) {
      await sendEiMessage(message);
    }
  }
};
```

### Decay Operation

```typescript
const decayJob: ScheduledJob = {
  name: "level_decay",
  interval: 60 * 60 * 1000,  // 1 hour
  enabled: true,
  lastRun: null,
  nextRun: null,
  handler: async () => {
    // Decay all topics and people across all entities
    await decayHumanTopicsAndPeople();
    
    const personas = await listPersonas();
    for (const persona of personas) {
      await decayPersonaTopics(persona.name);
    }
  }
};
```

### Stale Message Check (0113)

```typescript
const staleMessageJob: ScheduledJob = {
  name: "stale_messages",
  interval: 20 * 60 * 1000,  // 20 minutes
  enabled: true,
  lastRun: null,
  nextRun: null,
  handler: async () => {
    const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    
    for (const persona of await listPersonas()) {
      const unprocessed = await getUnprocessedMessages(persona.name);
      
      for (const msg of unprocessed) {
        const age = now - new Date(msg.timestamp).getTime();
        if (age > STALE_THRESHOLD_MS) {
          await triggerExtraction("human", persona.name, [msg]);
          await triggerExtraction("system", persona.name, [msg]);
        }
      }
    }
  }
};
```

## Integration Points

### App Startup

```typescript
async function startApp(): Promise<void> {
  // ... existing startup logic
  
  const jobManager = new ScheduledJobManager();
  jobManager.register(dailyCeremonyJob);
  jobManager.register(decayJob);
  jobManager.register(staleMessageJob);
  jobManager.start();
  
  // ... continue app initialization
}
```

### Graceful Shutdown

```typescript
async function shutdown(): Promise<void> {
  jobManager.stop();
  // ... other cleanup
}
```

## State Persistence

Jobs persist their state to `data/scheduled_jobs.jsonc`:

```json
{
  "jobs": [
    {
      "name": "daily_ceremony",
      "lastRun": "2026-01-19T09:00:00Z",
      "nextRun": "2026-01-20T09:00:00Z"
    },
    {
      "name": "level_decay",
      "lastRun": "2026-01-19T14:00:00Z",
      "nextRun": "2026-01-19T15:00:00Z"
    }
  ]
}
```

This ensures jobs don't re-run unnecessarily after restart.

## Heartbeat vs Scheduled Job

**Heartbeat** (per-persona):
- Triggered by inactivity timer (30min of no messages)
- Each persona has its own heartbeat logic
- Checks: "Do I want to reach out?"
  - Topics/people I want to discuss (my level_ideal - level_current > threshold)
  - Topics/people human wants to discuss (their level_ideal - level_current > threshold)
  - Haven't pinged recently outside normal conversation

**Scheduled Jobs** (system-wide):
- Run on fixed intervals regardless of conversation activity
- Handle maintenance, validation, decay
- Not persona-specific

## Acceptance Criteria

- [ ] ScheduledJobManager implemented
- [ ] Job registration and execution working
- [ ] State persists across restarts
- [ ] Daily Ceremony integrated
- [ ] Decay operation integrated
- [ ] Stale message check integrated
- [ ] Jobs can be enabled/disabled
- [ ] Errors in one job don't crash others
- [ ] Tests verify job scheduling and execution

## Dependencies

- 0110: LLM queue (stale message check queues extractions)
- 0113: Extraction frequency (stale message integration)
- 0115: Daily Ceremony (ceremony job)

## Effort Estimate

Medium (~3-4 hours)

## Notes

This infrastructure ticket should be implemented early (alongside 0108-0110) since other tickets depend on scheduled jobs existing.
