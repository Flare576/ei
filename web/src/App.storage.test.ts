// Coverage for `initializeStorage()` (web/src/App.tsx).
//
// Characterization tests below pin the NORMAL-path behavior exactly as it existed before
// item 4 of `.sisyphus/issues/pre-release-adr-batch-stale-code-cleanup.md` wrapped the
// function body in try/catch. They must stay green through the refactor — if migration
// ordering or call shape silently changes, one of these should fail.
//
// The four "QA scenario" tests further down are the red-first regression tests for the bug
// itself: before the fix, a genuine IndexedDB failure during load/save/migration rejected the
// returned promise (or otherwise never resolved to a usable Storage), instead of falling back
// to LocalStorage for the session. Per the issue's data-preservation constraint, the fallback
// must never present a failed read as a successful *empty* one — a later save could overwrite
// real data with that empty state.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { initializeStorage } from "./App";
import { IndexedDBStorage } from "../../src/storage/indexed";
import { LocalStorage } from "../../src/storage/local";
import type { StorageState } from "../../src/core/types";

function makeState(marker: string): StorageState {
  return {
    version: 1,
    timestamp: marker,
    human: {} as StorageState["human"],
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  };
}

describe("initializeStorage — normal-path characterization", () => {
  let idbIsAvailable: MockInstance;
  let idbLoad: MockInstance;
  let idbSave: MockInstance;
  let idbMoveToBackup: MockInstance;
  let lsIsAvailable: MockInstance;
  let lsLoad: MockInstance;
  let lsLoadBackup: MockInstance;

  beforeEach(() => {
    idbIsAvailable = vi.spyOn(IndexedDBStorage.prototype, "isAvailable");
    idbLoad = vi.spyOn(IndexedDBStorage.prototype, "load");
    idbSave = vi.spyOn(IndexedDBStorage.prototype, "save").mockResolvedValue(undefined);
    idbMoveToBackup = vi.spyOn(IndexedDBStorage.prototype, "moveToBackup").mockResolvedValue(undefined);
    lsIsAvailable = vi.spyOn(LocalStorage.prototype, "isAvailable");
    lsLoad = vi.spyOn(LocalStorage.prototype, "load");
    lsLoadBackup = vi.spyOn(LocalStorage.prototype, "loadBackup").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no IDB data + legacy localStorage data present → migrates localStorage into IndexedDB and returns the IDB instance", async () => {
    idbIsAvailable.mockResolvedValue(true);
    idbLoad.mockResolvedValue(null);
    lsIsAvailable.mockResolvedValue(true);
    const legacyState = makeState("legacy");
    lsLoad.mockResolvedValue(legacyState);

    const result = await initializeStorage();

    expect(result).toBeInstanceOf(IndexedDBStorage);
    expect(idbSave).toHaveBeenCalledWith(legacyState);
    expect(idbMoveToBackup).not.toHaveBeenCalled();
    expect(lsLoadBackup).toHaveBeenCalledTimes(1);
  });

  it("IDB already has data → prefers IndexedDB and never touches localStorage", async () => {
    idbIsAvailable.mockResolvedValue(true);
    const idbState = makeState("idb-primary");
    idbLoad.mockResolvedValue(idbState);

    const result = await initializeStorage();

    expect(result).toBeInstanceOf(IndexedDBStorage);
    expect(lsIsAvailable).not.toHaveBeenCalled();
    expect(idbSave).not.toHaveBeenCalled();
  });

  it("IndexedDB unavailable → falls back to a LocalStorage instance without ever calling IDB load/save", async () => {
    idbIsAvailable.mockResolvedValue(false);

    const result = await initializeStorage();

    expect(result).toBeInstanceOf(LocalStorage);
    expect(idbLoad).not.toHaveBeenCalled();
    expect(idbSave).not.toHaveBeenCalled();
  });
});

describe("initializeStorage — failure-handling QA scenarios (item 4)", () => {
  let idbIsAvailable: MockInstance;
  let idbLoad: MockInstance;
  let idbSave: MockInstance;
  let lsIsAvailable: MockInstance;
  let lsLoad: MockInstance;
  let consoleErrorSpy: MockInstance;
  let alertSpy: MockInstance;

  beforeEach(() => {
    idbIsAvailable = vi.spyOn(IndexedDBStorage.prototype, "isAvailable");
    idbLoad = vi.spyOn(IndexedDBStorage.prototype, "load");
    idbSave = vi.spyOn(IndexedDBStorage.prototype, "save").mockResolvedValue(undefined);
    lsIsAvailable = vi.spyOn(LocalStorage.prototype, "isAvailable");
    lsLoad = vi.spyOn(LocalStorage.prototype, "load");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // QA scenario 1: happy-path fallback-engages — a genuine IndexedDB failure during load()
  // must not reject/hang startup; it must resolve to a usable LocalStorage instance and tell
  // the user their storage degraded (a console log alone is not enough).
  it("IndexedDB throws during load() → resolves (never rejects) to a LocalStorage instance and surfaces the failure to the user", async () => {
    idbIsAvailable.mockResolvedValue(true);
    idbLoad.mockRejectedValue(new Error("IDB read error"));
    lsIsAvailable.mockResolvedValue(true);
    lsLoad.mockResolvedValue(makeState("legacy-fallback"));

    const result = await initializeStorage();

    expect(result).toBeInstanceOf(LocalStorage);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });

  // QA scenario 2: error-path no-overwrite — the data-preservation constraint. A failed IDB
  // load must never present as a successful *empty* load: the returned fallback storage must
  // still surface the real, recoverable localStorage data, and IndexedDB must never be told to
  // save an empty state over whatever it was actually holding.
  it("IndexedDB failure does not erase or overwrite recoverable localStorage data", async () => {
    idbIsAvailable.mockResolvedValue(true);
    idbLoad.mockRejectedValue(new Error("IDB read error"));
    lsIsAvailable.mockResolvedValue(true);
    const realUserData = makeState("real-user-data");
    lsLoad.mockResolvedValue(realUserData);

    const result = await initializeStorage();

    // The fallback storage must round-trip the real data — proving the failure path never
    // substituted an empty state for it.
    await expect(result.load()).resolves.toEqual(realUserData);
    // Nothing was ever written back to IndexedDB during the failure path.
    expect(idbSave).not.toHaveBeenCalled();
  });

  // QA scenario 3: error-path both-stores-unavailable — even when IndexedDB fails AND
  // localStorage reports itself unavailable, initializeStorage must still resolve (not hang,
  // not reject) rather than leaving the caller stuck with a rejected promise.
  it("IndexedDB throws and localStorage also reports unavailable → still resolves without throwing", async () => {
    idbIsAvailable.mockRejectedValue(new Error("IDB completely unreachable"));
    lsIsAvailable.mockResolvedValue(false);

    await expect(initializeStorage()).resolves.toBeInstanceOf(LocalStorage);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });

  // QA scenario 4: edge-case normal-path-unchanged — with no failure injected, the try/catch
  // wrapping must not alter the normal migration path asserted in the characterization suite
  // above (guards against the refactor silently rerouting the happy path through the catch).
  it("no failure injected → normal migration path is unchanged by the try/catch wrapping", async () => {
    idbIsAvailable.mockResolvedValue(true);
    idbLoad.mockResolvedValue(null);
    lsIsAvailable.mockResolvedValue(true);
    const legacyState = makeState("legacy-unchanged");
    lsLoad.mockResolvedValue(legacyState);
    vi.spyOn(LocalStorage.prototype, "loadBackup").mockResolvedValue(null);

    const result = await initializeStorage();

    expect(result).toBeInstanceOf(IndexedDBStorage);
    expect(idbSave).toHaveBeenCalledWith(legacyState);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
