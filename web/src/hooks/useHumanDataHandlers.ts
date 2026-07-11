import { useState, useCallback } from "react";
import type { Processor } from "../../../src/core/processor";
import type { HumanEntity, Fact, Topic, Person, Quote, StateConflictResolution } from "../../../src/core/types";
import { remoteSync } from "../../../src/storage/remote";

export function useHumanDataHandlers(
  processor: Processor | null,
  onHumanUpdated: (human: HumanEntity) => void,
) {
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState<{ localTimestamp: Date; remoteTimestamp: Date } | null>(null);

  const handleHumanUpdate = useCallback(async (updates: Record<string, unknown>) => {
    if (!processor) return;
    const currentHuman = await processor.getHuman();
    const { default_model, conversation_model, extraction_model, oneshot_model, rewrite_model, queue_paused, name_display, accounts, sync, ceremony_time, default_heartbeat_ms, default_context_window_ms, message_min_count, message_max_age_days, event_window_hours, active_theme, custom_themes, ...rest } = updates;

    const settingsUpdates: Record<string, unknown> = {};
    if (default_model !== undefined) settingsUpdates.default_model = default_model;
    if (conversation_model !== undefined) settingsUpdates.conversation_model = conversation_model;
    if (extraction_model !== undefined) settingsUpdates.extraction_model = extraction_model;
    if (oneshot_model !== undefined) settingsUpdates.oneshot_model = oneshot_model;
    if (rewrite_model !== undefined) settingsUpdates.rewrite_model = rewrite_model;
    if (queue_paused !== undefined) settingsUpdates.queue_paused = queue_paused;
    if (name_display !== undefined) settingsUpdates.name_display = name_display;
    if (default_heartbeat_ms !== undefined) settingsUpdates.default_heartbeat_ms = default_heartbeat_ms;
    if (default_context_window_ms !== undefined) settingsUpdates.default_context_window_ms = default_context_window_ms;
    if (message_min_count !== undefined) settingsUpdates.message_min_count = message_min_count;
    if (message_max_age_days !== undefined) settingsUpdates.message_max_age_days = message_max_age_days;
    if (accounts !== undefined) settingsUpdates.accounts = accounts;
    if (sync !== undefined || Object.prototype.hasOwnProperty.call(updates, 'sync')) settingsUpdates.sync = sync;
    if (active_theme !== undefined) settingsUpdates.active_theme = active_theme;
    if (custom_themes !== undefined) settingsUpdates.custom_themes = custom_themes;
    if (ceremony_time !== undefined) {
      settingsUpdates.ceremony = { ...currentHuman?.settings?.ceremony, time: ceremony_time as string };
    }
    if (event_window_hours !== undefined) {
      settingsUpdates.ceremony = { ...currentHuman?.settings?.ceremony, ...settingsUpdates.ceremony as object, event_window_hours: event_window_hours as number | undefined };
    }

    const hasSettings = Object.keys(settingsUpdates).length > 0;
    const coreUpdates: Partial<HumanEntity> = {
      ...(rest as Partial<HumanEntity>),
      ...(hasSettings ? { settings: { ...currentHuman?.settings, ...settingsUpdates } as HumanEntity['settings'] } : {}),
    };

    if (sync && typeof sync === 'object' && 'username' in sync && 'passphrase' in sync) {
      await remoteSync.configure({ username: sync.username as string, passphrase: sync.passphrase as string });
    } else if (sync === undefined && Object.prototype.hasOwnProperty.call(updates, 'sync')) {
      remoteSync.clear();
    }

    await processor.updateHuman(coreUpdates);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handleConflictResolve = useCallback(async (resolution: StateConflictResolution) => {
    if (!processor) return;
    await processor.resolveStateConflict(resolution);
    setShowConflictModal(false);
    setConflictData(null);
  }, [processor]);

  const handleFactSave = useCallback(async (fact: Fact) => {
    if (!processor) return;
    await processor.upsertFact(fact);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handleFactDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("fact", id);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handleTopicSave = useCallback(async (topic: Topic) => {
    if (!processor) return;
    await processor.upsertTopic(topic);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handleTopicDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("topic", id);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handlePersonSave = useCallback(async (person: Person) => {
    if (!processor) return;
    await processor.upsertPerson(person);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handlePersonDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("person", id);
    processor.getHuman().then(onHumanUpdated);
  }, [processor, onHumanUpdated]);

  const handleQuoteSave = useCallback(async (quoteData: Omit<Quote, 'id' | 'created_at'>) => {
    if (!processor) return;
    const quote: Quote = {
      ...quoteData,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    await processor.addQuote(quote);
  }, [processor]);

  const handleQuoteDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeQuote(id);
  }, [processor]);

  return {
    showConflictModal,
    conflictData,
    setShowConflictModal,
    setConflictData,
    handleHumanUpdate,
    handleConflictResolve,
    handleFactSave,
    handleFactDelete,
    handleTopicSave,
    handleTopicDelete,
    handlePersonSave,
    handlePersonDelete,
    handleQuoteSave,
    handleQuoteDelete,
  };
}
