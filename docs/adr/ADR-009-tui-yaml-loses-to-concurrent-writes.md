# ADR-009: A Stale TUI YAML Edit Loses to a Concurrent Write

## Status

Accepted

## Date

2026-08-01

## Context

ADR-008 records two write races Ei accepts without fixing. This one it **does** handle, and the mechanism is worth recording separately so nobody assumes the accept-and-document posture is universal.

The TUI edits human data — facts, topics, people — by rendering the current state to YAML, opening it in `$EDITOR`, and parsing the result back on save. That editing session is open-ended: a user might save in ten seconds or leave the buffer open for twenty minutes while doing something else.

**This is the widest race window in the system, by a wide margin.** ADR-008's corrections drain is roughly 100 ms. Its read-modify-write across an LLM call is seconds to tens of seconds. An `$EDITOR` session is minutes, and bounded only by the user's attention.

Meanwhile extraction runs continuously. A conversation happening while the buffer is open can rewrite exactly the fact the user is editing. On save, the parsed YAML is a snapshot of a world that no longer exists.

## Decision

**The concurrent write wins. The stale edit is discarded, per item, and the user is told.**

`staleInState` (`tui/src/util/yaml-human.ts:308-312`) records each item's `last_updated` when the editor opens and re-compares at save:

```ts
const currentItem = currentItems.find(i => i.id === id);
return !!currentItem && currentItem.last_updated !== originalItem.last_updated;
```

If the timestamp moved, the user's change to that item is skipped rather than applied. The parse reports counts — `skippedFactCount`, `skippedTopicCount`, `skippedPersonCount` — and `/me` surfaces them:

> `Updated 3, deleted 0, skipped 1 (changed by another process)`

Three properties make this work rather than merely fail safely:

**Per-item, not per-file.** Editing ten facts where one moved underneath applies nine and skips one. A whole-file rejection would punish the user for an unrelated collision and is the obvious wrong design here.

**The comparison key is not user-editable.** `last_updated` renders as a read-only comment in the YAML (`yaml-human.ts:186`), so a user cannot spoof it past the check, accidentally or otherwise.

**The user is told, with a count.** A silent skip would be worse than either outcome — the user would believe an edit landed that did not. ADR-008's accepted races are silent, and that silence is their single worst property; this one is not.

### Why the machine wins and the human loses

That reads backwards until you consider what each write knows.

An extraction write is derived from a conversation the user *just had*. A YAML edit is derived from a snapshot that may be twenty minutes old — taken before that conversation happened. The stale side is the human's, through no fault of theirs; they are simply working from an older view of the world.

Applying the YAML would silently erase something the user themselves caused moments ago, in a surface where they cannot see it happened. Skipping it discards a change the user can see was skipped, and can simply make again against current state.

The losing write is recoverable by retry. The other is not.

## Known gap: only `/me` is protected

`staleInState` lives in `yaml-human.ts` and guards facts, topics, and people. Verified by search: **`tui/src/util/yaml-persona.ts` and `tui/src/util/yaml-quotes.ts` have no equivalent.** Both stamp a fresh `last_updated` on write and apply unconditionally.

So persona and quote YAML edits race in the opposite direction — a stale editor buffer clobbers a concurrent write, silently, with no skip count and no notification.

This is not a decision, it is an omission; the guard was built for `/me` and not carried across. Whether it should be is a real question, since the collision likelihood differs: persona records change far less often than extracted human data. But the current asymmetry is undocumented and would surprise anyone who read this record and assumed it applied to every YAML editor.

## Alternatives Considered

### Alternative A: the YAML edit wins
- **Description**: Apply the parsed buffer unconditionally. This is what persona and quote editing does today.
- **Pros**: Simplest. Honours the user's explicit, deliberate action over an automatic one.
- **Cons**: Silently erases a write derived from newer information — often something the user caused themselves and cannot see being undone.
- **Why not chosen**: The unrecoverable direction. A discarded YAML edit can be retyped; an erased extraction is gone.

### Alternative B: merge field-by-field
- **Description**: Apply only the fields the user actually changed, keeping concurrent changes to other fields of the same item.
- **Pros**: Loses the least.
- **Cons**: Requires a three-way diff per item, and produces records that are a blend of two intents — a `description` from one write and a `sentiment` from another, coherent to neither.
- **Why not chosen**: Real merge semantics for a single-user local app is disproportionate, and a blended record is arguably worse than a clean loss.

### Alternative C: prompt on conflict
- **Description**: Detect the collision and ask which version to keep.
- **Pros**: The user decides, with full information.
- **Cons**: Interrupts a save the user considered finished, mid-flow, with a diff they must read. Ei already has a conflict prompt for local-versus-remote sync at bootstrap — a natural pause point. A save is not.
- **Why not chosen**: Right mechanism, wrong moment. Worth revisiting if collisions turn out to be common, which they currently are not.

## Consequences

### Positive
- The widest race window in the system is the one that is handled.
- Per-item granularity keeps the cost proportional to the actual collision.
- The user learns their edit did not land, which is the property ADR-008's accepted races lack.

### Negative
- Work is lost. The message says an edit was skipped, not what it was — the user must reconstruct it from memory against the new state.
- The asymmetry with persona and quote editing is live and undocumented outside this record.

### Risks

- **The skip message is a count, not a diff.** "skipped 1" tells the user something was dropped but not what. For a small edit that is fine; for a long description rewritten in the buffer, it means retyping from memory. Worth improving if anyone hits it in anger.

- **`last_updated` equality is the whole check.** Any write path that mutates an item without advancing `last_updated` is invisible to this guard, and the stale edit would be applied over it. The guard's correctness depends on every writer maintaining that invariant.

## Reversibility

Easy. The guard is one helper and three call sites; removing it restores unconditional apply, which is what the unguarded editors already do. Extending it to persona and quote editing is the same shape of change in the other direction.

## References

- ADR-008 — the two races Ei accepts rather than handles; this is the contrasting case
- `tui/src/util/yaml-human.ts` — `staleInState` and its three call sites
- `tui/src/commands/me.tsx` — the user-facing skip count
- `tui/src/util/yaml-persona.ts`, `tui/src/util/yaml-quotes.ts` — the unguarded editors
