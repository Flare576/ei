import { useState, useCallback } from "react";
import type React from "react";
import type { Processor } from "../../../src/core/processor";
import type { QueueStatus, LLMRequest } from "../../../src/core/types";

export function useQueueHandlers(
  processorRef: React.RefObject<Processor | null>,
  _queueStatus: QueueStatus | null,
  setQueueStatus: React.Dispatch<React.SetStateAction<QueueStatus>>,
) {
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [queueWasPaused, setQueueWasPaused] = useState(false);
  const [queuePanelItems, setQueuePanelItems] = useState<{ pending: LLMRequest[]; dlq: LLMRequest[] }>({ pending: [], dlq: [] });

  const handlePauseToggle = useCallback(async () => {
    if (!processorRef.current) return;
    const status = await processorRef.current.getQueueStatus();
    if (status.state === "paused") {
      await processorRef.current.resumeQueue();
    } else {
      await processorRef.current.abortCurrentOperation();
    }
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [processorRef, setQueueStatus]);

  const handleQueuePanelOpen = useCallback(async () => {
    if (!processorRef.current) return;
    const status = await processorRef.current.getQueueStatus();
    setQueueWasPaused(status.state === "paused");
    if (status.state !== "paused") {
      await processorRef.current.abortCurrentOperation();
    }
    const pending = processorRef.current.getQueueActiveItems();
    const dlq = processorRef.current.getDLQItems();
    setQueuePanelItems({ pending, dlq });
    setShowQueuePanel(true);
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [processorRef, setQueueStatus]);

  const handleQueuePanelClose = useCallback(async () => {
    setShowQueuePanel(false);
    if (!processorRef.current) return;
    if (!queueWasPaused) {
      await processorRef.current.resumeQueue();
    }
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [processorRef, queueWasPaused, setQueueStatus]);

  const handleQueueItemsUpdate = useCallback(async (ids: string[], model: string) => {
    if (!processorRef.current) return;
    for (const id of ids) {
      const allItems = [...queuePanelItems.pending, ...queuePanelItems.dlq];
      const item = allItems.find(i => i.id === id);
      const updates: Partial<LLMRequest> = {
        model,
        attempts: 0,
        retry_after: undefined,
      };
      if (item?.state === "dlq") {
        updates.state = "pending";
      }
      processorRef.current.updateQueueItem(id, updates);
    }
    const pending = processorRef.current.getQueueActiveItems();
    const dlq = processorRef.current.getDLQItems();
    setQueuePanelItems({ pending, dlq });
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [processorRef, queuePanelItems, setQueueStatus]);

  const handleQueueItemsDelete = useCallback((ids: string[]) => {
    if (!processorRef.current) return;
    processorRef.current.deleteQueueItems(ids);
    const pending = processorRef.current.getQueueActiveItems();
    const dlq = processorRef.current.getDLQItems();
    setQueuePanelItems({ pending, dlq });
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [processorRef, setQueueStatus]);

  return {
    showQueuePanel,
    queueWasPaused,
    queuePanelItems,
    handlePauseToggle,
    handleQueuePanelOpen,
    handleQueuePanelClose,
    handleQueueItemsUpdate,
    handleQueueItemsDelete,
  };
}
