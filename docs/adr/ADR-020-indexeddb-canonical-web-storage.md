# ADR-020: IndexedDB Is the Web App's Canonical Storage Backend, localStorage Is a Non-Destructive Fallback

## Status

Accepted

## Date

2026-08-03

## Context

Ei's web app originally persisted its entire state — personas, messages, facts,
topics, quotes, and their embeddings — in `localStorage` via `LocalStorage`
(`src/storage/local.ts`), under two string keys: `ei_state` (primary) and
`ei_state_backup` (`src/storage/local.ts:6-7`). This hit a real ceiling: a
representative uncompressed state was already around 14MB, and even after the
existing gzip + base64 compression pipeline (`src/storage/compress.ts`,
`src/storage/embeddings.ts`) it still compressed to roughly 3.5MB — close to or
over the 5-10MB quota most browsers enforce on `localStorage`, with mobile
Safari's ~5MB limit and aggressive eviction-under-pressure behavior the worst
case. `localStorage.setItem` is also synchronous, so a multi-megabyte save
blocked the main thread for measurable time. None of this gets better as a
user accumulates more personas and messages — the ceiling was already being
hit, not approaching.

The `Storage` interface (`src/storage/interface.ts:3-12`) that both `LocalStorage`
and the TUI's `FileStorage` implement was already fully `Promise`-based
(`isAvailable`, `save`, `load`, `moveToBackup`, `loadBackup`,
`saveRollingBackup`), specifically so a new backend could be dropped in without
touching core. `PersistenceState` (`src/core/state/checkpoints.ts`) and the
`Processor` call only through this interface; core code has no awareness of
which concrete backend is behind it. IndexedDB satisfies every requirement
`localStorage` was failing on — an order of magnitude more quota headroom, a
fully async API that doesn't block the UI thread, and object-store semantics —
without requiring any interface change.

The one thing IndexedDB does not give for free is data continuity: existing
users already have state sitting in `localStorage` under `ei_state`/
`ei_state_backup`, and shipping IndexedDB as a hard cutover would strand it.
The decision below is as much about *how* to introduce a second backend
without a breaking migration step as it is about which backend to use.

## Decision

**IndexedDB is the canonical storage backend for the web app.** `localStorage`
is retained, but only in a supporting role: a one-time migration source on
first load, and an availability fallback if IndexedDB itself cannot be opened.
It is never written to again as primary storage once IndexedDB is confirmed
working.

Concretely, as implemented:

1. **`IndexedDBStorage`** (`src/storage/indexed.ts:12`) implements `Storage`
   against a database named `"ei_db"`, version `1`
   (`src/storage/indexed.ts:6-7`), with a single object store, `"state"`
   (`src/storage/indexed.ts:8`), created in `openDB()`'s `onupgradeneeded`
   handler (`src/storage/indexed.ts:93-102`). Two string keys —
   `"primary"` and `"backup"` (`src/storage/indexed.ts:9-10`) — hold the
   same role `ei_state`/`ei_state_backup` played in `localStorage`. There are
   no indexes: the app only ever loads or saves the entire state blob, never
   queries by field.

2. **The payload format is unchanged from `LocalStorage`.** `save()`
   (`src/storage/indexed.ts:27-39`) runs the identical
   `encodeAllEmbeddings` → `JSON.stringify` → `compress` (gzip + base64)
   pipeline as `LocalStorage.save()` (`src/storage/local.ts:25-37`) before
   writing the string via `setItem()`. `load()`
   (`src/storage/indexed.ts:41-52`) mirrors `LocalStorage.load()`: check
   `isCompressed()`, decompress if needed, `JSON.parse`, `decodeAllEmbeddings`.
   IndexedDB can natively store `Blob`s, but the implementation deliberately
   keeps compressed strings so both backends stay byte-for-byte comparable and
   remain debuggable by `JSON.parse`-ing the decompressed value directly in
   DevTools.

3. **Migration runs automatically, silently, and non-destructively on every
   startup**, in `initializeStorage()` (`web/src/App.tsx:107-142`), called from
   both places the app builds a `Processor`: the first-run/onboarding check on
   mount (`web/src/App.tsx:325-343`) and the main processor-start effect,
   which reuses whatever `storageRef.current` already holds instead of
   re-running migration a second time in the same session
   (`web/src/App.tsx:526-528`). The flow:
   - Construct an `IndexedDBStorage` and call `isAvailable()`
     (`web/src/App.tsx:108,110` → `src/storage/indexed.ts:17-25`, which opens
     and immediately closes the database to confirm it works).
   - If IndexedDB has no existing primary state yet (`web/src/App.tsx:111-113`),
     construct a `LocalStorage`, and if it has a saved state, copy it over:
     `indexedStorage.save(legacyState)` (`web/src/App.tsx:115-120`), then, if a
     legacy backup exists too, save it, move it into the IDB backup slot via
     `moveToBackup()`, and restore the primary state that `moveToBackup()`
     cleared (`web/src/App.tsx:121-132`, using `moveToBackup()` as implemented
     at `src/storage/indexed.ts:59-66`).
   - Return the `IndexedDBStorage` instance (`web/src/App.tsx:137`).
   - **`localStorage` is never cleared.** Nothing in this path calls
     `localStorage.removeItem`. A user who rolls back to an older Ei build
     that only knows `LocalStorage` still finds their data intact.
   - If IndexedDB itself is unavailable (`isAvailable()` returned `false`,
     e.g. some private-browsing modes), fall back to `new LocalStorage()`
     directly (`web/src/App.tsx:140-141`) — no migration is attempted because
     there is nowhere durable to migrate to.
   - There is no user-facing prompt, banner, or settings toggle anywhere in
     this path. The user experiences it, if at all, as a `console.log`
     (`web/src/App.tsx:119`) they will likely never see.

4. **Both backends are exported side by side** from
   `src/storage/index.ts:2-3` (`LocalStorage`, `IndexedDBStorage`) — the
   module makes no claim that one has replaced the other; `App.tsx` is where
   the canonical-vs-fallback relationship actually lives.

5. **The TUI is untouched.** It continues to use `FileStorage` against the
   local filesystem, which has no quota problem and is unrelated to this
   decision.

## Alternatives Considered

### Alternative A: Reduce state size instead of changing storage backend
- **Description**: Keep `localStorage`, but shard state across more keys, drop
  or lazily load embeddings, or otherwise shrink the payload below the quota.
- **Cons**: Buys a fixed amount of headroom against a quota that mobile Safari
  already sets as low as ~5MB, while state size only grows as a user
  accumulates personas and messages. Still synchronous, still blocks the main
  thread on every save, and does nothing for the eviction-under-pressure
  behavior mobile Safari applies regardless of payload size.
- **Why not chosen**: Treats the symptom (quota) without addressing the two
  other properties (blocking API, aggressive eviction) that also motivated the
  move. IndexedDB removes all three at once with no core-code changes, because
  the `Storage` interface was already backend-agnostic.

### Alternative B: Store embeddings as native IndexedDB `Blob`s instead of compressed strings
- **Description**: IndexedDB natively supports `Blob` values; storing
  embeddings as raw `Blob`s avoids the ~33% base64 overhead the current
  gzip+base64 string pipeline pays.
- **Pros**: Smaller stored payload, no `btoa`/`atob` decode cost.
- **Cons**: Breaks payload parity with `LocalStorage` — the two backends would
  no longer share a byte-identical compressed-string format, which is what
  lets `load()`/`save()` be near-identical ports of each other and lets a
  developer `JSON.parse` a decompressed value directly in DevTools while
  debugging. It would also complicate the migration path, which currently
  just hands a `StorageState` string between backends.
- **Why not chosen**: The size win doesn't justify losing format parity and
  migration simplicity for a v1. `Blob` storage is left as an explicit future
  option if quota pressure returns at scale — nothing in the v1 schema
  forecloses it, since `onupgradeneeded` (`src/storage/indexed.ts:97-102`)
  already provides IndexedDB's standard schema-versioning hook.

### Alternative C: A user-visible, opt-in migration step (banner, settings toggle, or explicit "upgrade storage" action)
- **Description**: Surface the localStorage → IndexedDB migration as something
  the user sees and confirms, rather than running it unconditionally on load.
- **Pros**: Gives the user visibility into a change to where their data lives;
  a natural place to explain the fallback behavior if IndexedDB isn't
  available.
- **Cons**: The migration is safe by construction — non-destructive,
  automatic, and reversible by clearing IndexedDB — so a confirmation step
  adds friction without adding safety. It would also require new UI surface
  (a modal or settings panel) for a one-time, invisible-when-successful
  operation.
- **Why not chosen**: Nothing about the migration is destructive or
  ambiguous enough to warrant interrupting the user. Silent-and-automatic
  keeps the change invisible to the common case (it just works) while
  `localStorage` staying intact underneath means a failed or partial
  migration is never a data-loss event.

### Alternative D: Hard cutover — ship IndexedDB and drop `LocalStorage` entirely
- **Description**: Since the `Storage` interface already made the swap clean,
  just replace `LocalStorage` with `IndexedDBStorage` everywhere and delete
  the old backend.
- **Cons**: Strands every existing user's data — a hard cutover has no path
  to recover an existing `ei_state` entry, and there's no way to migrate data
  the new code path never reads. It would also remove the availability
  fallback IndexedDB itself sometimes needs (unavailable or restricted in some
  private-browsing modes).
- **Why not chosen**: There was no reason to accept a breaking migration when
  the interface already supported running both backends side by side during a
  transition.

## Consequences

### Positive

- Removes the actual production blocker: a ~3.5MB compressed state no longer
  risks `QuotaExceededError` against a 5-10MB browser ceiling, and IndexedDB's
  fully async API means large saves no longer block the UI thread the way
  synchronous `localStorage.setItem()` did.
- Zero changes to core logic. `PersistenceState`, `Processor`, and everything
  above the `Storage` interface (`src/storage/interface.ts:3-12`) is unaware
  which concrete backend it holds — the interface did its job.
- Migration is genuinely safe for the common case: non-destructive (old
  `localStorage` data is never deleted), automatic (no user action required),
  and trivially reversible (clearing IndexedDB via DevTools makes the app
  re-migrate from `localStorage` on next load).
- Payload-format parity between the two backends (same compress/encode
  pipeline, same string representation) keeps both implementations easy to
  reason about together and keeps the migration path a straight
  `save(legacyState)` rather than a format conversion.

### Negative

- The canonical/fallback relationship is expressed only in `App.tsx`'s call
  order, not in the type system or the `Storage` interface itself. Nothing
  stops a future call site from constructing `LocalStorage` directly and
  writing through it, silently reintroducing a second, unsynchronized primary
  store. Anyone adding a new storage entry point must know to route through
  `initializeStorage()`.
- Two on-disk (well, in-browser) copies of a user's data now persist
  indefinitely after a successful migration — `localStorage`'s `ei_state`
  is never cleaned up. This is deliberate (rollback safety) but does mean the
  browser keeps holding the smaller, superseded copy forever, with no code
  path that ever revisits or prunes it.
- The plan that produced this decision explicitly called for exporting the
  new backend and updating `web/README.md`'s storage section and
  `AGENTS.md`'s storage table. `web/README.md:68` still reads *"Ei stores
  everything in your browser's local storage"* with no mention of IndexedDB or
  the fallback relationship, and `web/public/terms.html:47` still states
  outright *"The web app uses your browser's localStorage."* Both describe
  the pre-migration architecture as if it were still current. This is stale
  documentation, tracked here as a known gap, not fixed by this ADR.

### Risks

- **The intended graceful in-session fallback does not exist in shipped code.**
  The original plan for this work specified that a mid-migration IndexedDB
  failure should be caught and the app should fall back to `LocalStorage` "for
  that session," with a user-facing message ("Ei encountered a storage error
  and has fallen back to localStorage...") and a `USE_INDEXED_DB` escape-hatch
  flag. Neither shipped: there is no such string and no such flag anywhere in
  `web/src` or `src` today. What actually shipped is `initializeStorage()`
  (`web/src/App.tsx:107-142`) with **no `try`/`catch` anywhere in its body**,
  called at both use sites (`web/src/App.tsx:326`, `web/src/App.tsx:528`) via
  a bare `.then()` with no attached `.catch()`. Concretely: `indexedStorage
  .load()` (`web/src/App.tsx:111`) awaits `IndexedDBStorage.load()`, whose
  internal `try`/`catch` (`src/storage/indexed.ts:44-49`) only guards the
  decompress/parse step — if the underlying `getItem()` call rejects (an IDB
  transaction or `openDB()` failure, `src/storage/indexed.ts:114-132`), that
  rejection propagates unguarded out of `load()`, out of `initializeStorage()`,
  and out through an unhandled promise rejection at the call site. The same is
  true of `indexedStorage.save(legacyState)` (`web/src/App.tsx:120`) for any
  non-quota error, and of the backup-migration calls at
  `web/src/App.tsx:127-131`. **The practical effect is the opposite of the
  design intent**: a real IndexedDB failure during migration does not degrade
  to `localStorage` for the session — it fails `initializeStorage()`'s
  promise outright, so neither call site's `.then()` ever runs, and app
  startup effectively hangs (no processor gets created; the onboarding check
  never resolves) rather than recovering. This is a real, currently-shipped
  gap between the documented intent and the actual behavior — not
  hypothetical, and not fixed here.
- **No telemetry or user signal exists for a failed or partial migration.**
  Beyond the missing fallback, there is also no error surface at all if
  migration fails — not even the `console.warn` used for the
  "IndexedDB unavailable" branch (`web/src/App.tsx:140`). A user who hits this
  path sees a stuck app with no diagnostic short of opening DevTools.
- **The canonical/fallback split is a convention enforced by one function**,
  not by the type system. Any future code that constructs `LocalStorage`
  directly (bypassing `initializeStorage()`) can write to the fallback store
  while IndexedDB is canonical, producing two diverging copies of state with
  nothing to reconcile them.

## Reversibility

High for the storage choice itself, low for the specific gap noted above.
Rolling back to `localStorage`-only would mean reverting `initializeStorage()`
to always return `new LocalStorage()` — cheap, since `localStorage` data was
never deleted and both backends still ship side by side from
`src/storage/index.ts:2-3`. Fixing the missing-fallback risk is also low-cost
in isolation (wrap the migration branch in `initializeStorage()` in a
`try`/`catch` that falls back to `new LocalStorage()`, matching the
`isAvailable()`-false branch that already exists) — the reason it's flagged
as a risk here rather than fixed is scope, not difficulty. What is *not*
cheaply reversible is the accumulated in-browser state: once a user has been
running on IndexedDB for a while, their most current data lives there, and
`localStorage`'s copy is whatever was true at migration time — reverting the
backend choice without also re-syncing `localStorage` would silently lose
everything written since.

## References

- `src/storage/interface.ts:3-12` — the `Storage` interface both backends
  implement; the reason this migration required zero core changes
- `src/storage/indexed.ts:6-10,12,17-25,27-52,59-66,93-112,114-170` —
  `IndexedDBStorage`: schema constants, class declaration, `isAvailable`,
  `save`/`load`, `moveToBackup`, `openDB`, and the private IDB transaction
  helpers (`getItem`/`setItem`/`deleteItem`)
- `src/storage/local.ts:6-7,25-50` — `LocalStorage`'s keys and `save`/`load`,
  the format `IndexedDBStorage` mirrors byte-for-byte
- `src/storage/index.ts:2-3` — both backends exported side by side
- `web/src/App.tsx:107-142` — `initializeStorage()`, the migration/fallback
  logic and the gap noted in Risks
- `web/src/App.tsx:325-343,526-528` — the two call sites, neither of which
  attaches a `.catch()` to the returned promise
- `web/README.md:68` — stale "browser's local storage" claim, not updated for
  this change
- `web/public/terms.html:47` — stale "uses your browser's localStorage" claim,
  not updated for this change
