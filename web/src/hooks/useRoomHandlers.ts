import { useState, useCallback, useRef, useEffect } from "react";
import type { RefObject } from "react";
import type { Processor } from "../../../src/core/processor";
import type {
  RoomSummary,
  RoomEntity,
  RoomMessage,
  RoomCreationInput,
} from "../../../src/core/types";
import { ContextStatus, RoomMode, LLMNextStep } from "../../../src/core/types";

export function useRoomHandlers(
  processorRef: RefObject<Processor | null>,
  processor: Processor | null,
  switchPersona: (id: string | null) => void,
) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<RoomEntity | null>(null);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [activeRoomPath, setActiveRoomPath] = useState<RoomMessage[]>([]);
  const [processingRoomId, setProcessingRoomId] = useState<string | null>(null);
  const [roomActivating, setRoomActivating] = useState(false);
  const [showRoomCreator, setShowRoomCreator] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomEntity | null>(null);
  const [showRoomOverview, setShowRoomOverview] = useState(false);
  const [overviewRoomId, setOverviewRoomId] = useState<string | null>(null);
  const [roomInputValue, setRoomInputValue] = useState("");

  const activeRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  const refreshRoomActivating = useCallback((roomId: string) => {
    const pending = processorRef.current?.getQueueActiveItems().some(
      item => item.next_step === LLMNextStep.HandleRoomJudge &&
              (item.data.roomId as string) === roomId
    ) ?? false;
    setRoomActivating(pending);
  }, [processorRef]);

  const handleSelectRoom = useCallback(async (roomId: string) => {
    if (processor && activeRoomId && activeRoomId !== roomId) {
      await processor.markAllRoomMessagesRead(activeRoomId);
    }
    switchPersona(null);
    setActiveRoomId(roomId);
    refreshRoomActivating(roomId);
    if (processor) {
      const room = processor.getRoom(roomId);
      setActiveRoom(room ?? null);
      setRoomMessages(processor.getRoomMessages(roomId));
      setActiveRoomPath(processor.getRoomActivePath(roomId));
      processor.markAllRoomMessagesRead(roomId).then(() => {
        setRooms(processor.getRoomList());
      });
    }
  }, [processor, activeRoomId, switchPersona, refreshRoomActivating]);

  const handleCreateRoom = useCallback(async (input: RoomCreationInput) => {
    if (!processor) return;
    const roomId = await processor.createRoom(input);
    setRooms(processor.getRoomList());
    setShowRoomCreator(false);
    const room = processor.getRoom(roomId);
    setActiveRoom(room ?? null);
    switchPersona(null);
    setActiveRoomId(roomId);
    setRoomMessages(processor.getRoomMessages(roomId));
    setActiveRoomPath(processor.getRoomActivePath(roomId));
  }, [processor, switchPersona]);

  const handleArchiveRoom = useCallback(async (roomId: string) => {
    if (!processor) return;
    await processor.archiveRoom(roomId);
    setRooms(processor.getRoomList());
    if (activeRoomId === roomId) {
      setActiveRoomId(null);
      setActiveRoom(null);
      setRoomMessages([]);
      setActiveRoomPath([]);
    }
  }, [processor, activeRoomId]);

  const handleEditRoom = useCallback((roomId: string) => {
    if (!processor) return;
    const room = processor.getRoom(roomId);
    if (room) {
      setEditingRoom(room);
      setShowRoomEditor(true);
    }
  }, [processor]);

  const handleShowRoomOverview = useCallback((roomId: string) => {
    setOverviewRoomId(roomId);
    setShowRoomOverview(true);
  }, []);

  const handleSaveRoomEdits = useCallback(async (roomId: string, updates: Partial<RoomEntity>) => {
    if (!processor) return;
    await processor.updateRoom(roomId, updates);
    setRooms(processor.getRoomList());
    setShowRoomEditor(false);
    setEditingRoom(null);
  }, [processor]);

  const handleUnarchiveRoom = useCallback(async (roomId: string) => {
    if (!processor) return;
    await processor.unarchiveRoom(roomId);
    setRooms(processor.getRoomList());
  }, [processor]);

  const handleDeleteArchivedRoom = useCallback(async (roomId: string) => {
    if (!processor) return;
    await processor.deleteRoom(roomId);
    setRooms(processor.getRoomList());
  }, [processor]);

  const handleSubmitHumanRoomMessage = useCallback(async (content: string | null, silenceReason?: string) => {
    if (!activeRoomId || !processorRef.current) return;
    const currentRoom = processorRef.current.getRoom(activeRoomId);
    if (!currentRoom) return;
    if (currentRoom.mode === RoomMode.FreeForAll) {
      await processorRef.current.sendFfaMessage(activeRoomId, content, silenceReason);
    } else {
      processorRef.current.submitHumanRoomMessage(activeRoomId, content, silenceReason);
    }
    setRoomInputValue("");
    setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    const updatedRoom = processorRef.current.getRoom(activeRoomId);
    if (updatedRoom) setActiveRoom(updatedRoom);
    setActiveRoomPath(processorRef.current.getRoomActivePath(activeRoomId));
  }, [activeRoomId, processorRef]);

  const handleActivateRoom = useCallback(async () => {
    if (!activeRoomId || !processorRef.current) return;
    await processorRef.current.activateRoom(activeRoomId);
    refreshRoomActivating(activeRoomId);
    const updatedRoom = processorRef.current.getRoom(activeRoomId);
    if (updatedRoom) setActiveRoom(updatedRoom);
    setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    setActiveRoomPath(processorRef.current.getRoomActivePath(activeRoomId));
  }, [activeRoomId, processorRef, refreshRoomActivating]);

  const handleRecallHumanRoomMessage = useCallback(() => {
    if (!activeRoomId || !processorRef.current) return;
    const allMsgs = processorRef.current.getRoomMessages(activeRoomId);
    const humanMsg = allMsgs.find(
      m => m.role === "human" && m.parent_id === activeRoom?.active_node_id
    );
    if (humanMsg) {
      const childIds = new Set(allMsgs.filter(m => m.parent_id === humanMsg.id).map(m => m.id));
      const hasGrandchildren = allMsgs.some(m => m.parent_id && childIds.has(m.parent_id));
      if (hasGrandchildren) return;
    }
    const recalledText = humanMsg?.content ?? humanMsg?.silence_reason ?? "";
    const ok = processorRef.current.recallHumanRoomMessage(activeRoomId);
    if (ok) {
      setRoomInputValue(recalledText);
      setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    }
  }, [activeRoomId, activeRoom, processorRef]);

  const handleSelectCYPBranch = useCallback(async (messageId: string) => {
    if (!activeRoomId || !processorRef.current) return;
    await processorRef.current.selectCYPBranch(activeRoomId, messageId);
    const updatedRoom = processorRef.current.getRoom(activeRoomId);
    if (updatedRoom) setActiveRoom(updatedRoom);
    setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    setActiveRoomPath(processorRef.current.getRoomActivePath(activeRoomId));
  }, [activeRoomId, processorRef]);

  const handleSetRoomMessageContextStatus = useCallback(async (
    roomId: string,
    messageId: string,
    status: ContextStatus,
  ) => {
    if (!processorRef.current) return;
    processorRef.current.getStateManager().updateRoomMessage(roomId, messageId, { context_status: status });
    await processorRef.current.updateRoom(roomId, {});
  }, [processorRef]);

  const handleDeleteRoomMessages = useCallback(async (roomId: string, messageIds: string[]) => {
    if (!processorRef.current) return;
    processorRef.current.getStateManager().removeRoomMessages(roomId, messageIds);
    await processorRef.current.updateRoom(roomId, {});
  }, [processorRef]);

  return {
    rooms,
    setRooms,
    activeRoomId,
    setActiveRoomId,
    activeRoom,
    setActiveRoom,
    roomMessages,
    setRoomMessages,
    activeRoomPath,
    setActiveRoomPath,
    processingRoomId,
    setProcessingRoomId,
    roomActivating,
    showRoomCreator,
    setShowRoomCreator,
    showRoomEditor,
    setShowRoomEditor,
    editingRoom,
    setEditingRoom,
    showRoomOverview,
    setShowRoomOverview,
    overviewRoomId,
    setOverviewRoomId,
    roomInputValue,
    setRoomInputValue,
    activeRoomIdRef,
    refreshRoomActivating,
    handleSelectRoom,
    handleCreateRoom,
    handleArchiveRoom,
    handleEditRoom,
    handleShowRoomOverview,
    handleSaveRoomEdits,
    handleUnarchiveRoom,
    handleDeleteArchivedRoom,
    handleSubmitHumanRoomMessage,
    handleActivateRoom,
    handleRecallHumanRoomMessage,
    handleSelectCYPBranch,
    handleSetRoomMessageContextStatus,
    handleDeleteRoomMessages,
  };
}
