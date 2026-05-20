import { useState, useRef, useCallback, useEffect } from "react";
import type { Processor } from "../../../src/core/processor";
import type { PersonaSummary, PersonaEntity, Message, PersonaTrait, PersonaTopic } from "../../../src/core/types";

export function useReflection(
  processor: Processor | null,
  setPersonas: React.Dispatch<React.SetStateAction<PersonaSummary[]>>,
) {
  const reflectionPersonaIdRef = useRef<string | null>(null);
  const [showReflectionModal, setShowReflectionModal] = useState(false);
  const [reflectionPersonaId, setReflectionPersonaId] = useState<string | null>(null);
  const [reflectionPersona, setReflectionPersona] = useState<PersonaEntity | null>(null);
  const [reflectionMessages, setReflectionMessages] = useState<Message[]>([]);
  const [reflectionInputValue, setReflectionInputValue] = useState("");

  useEffect(() => {
    reflectionPersonaIdRef.current = reflectionPersonaId;
  }, [reflectionPersonaId]);

  const handleOpenReflection = useCallback(async (personaId: string) => {
    if (!processor) return;
    const [persona, msgs] = await Promise.all([
      processor.getPersona(personaId),
      processor.getMessages(personaId),
    ]);
    if (!persona?.pending_update) return;
    setReflectionPersonaId(personaId);
    setReflectionPersona(persona);
    setReflectionMessages(msgs);
    setReflectionInputValue("");
    setShowReflectionModal(true);
  }, [processor]);

  const handleReflectionSendMessage = useCallback(async (content: string | null, silenceReason?: string) => {
    if (!processor || !reflectionPersonaId) return;
    if (content !== null && !content.trim()) return;
    await processor.sendMessage(reflectionPersonaId, content !== null ? content.trim() : null, silenceReason);
    setReflectionInputValue("");
  }, [processor, reflectionPersonaId]);

  const handleReflectionSaveAndApply = useCallback(async (updatedIdentity: {
    long_description: string;
    short_description: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
  }) => {
    if (!processor || !reflectionPersonaId) return;
    await processor.finalizeReflection(reflectionPersonaId, "apply", updatedIdentity);
    setShowReflectionModal(false);
    setReflectionPersonaId(null);
    setReflectionPersona(null);
    processor.getPersonaList().then(setPersonas);
  }, [processor, reflectionPersonaId, setPersonas]);

  const handleReflectionDismiss = useCallback(async () => {
    if (!processor || !reflectionPersonaId) return;
    await processor.finalizeReflection(reflectionPersonaId, "dismiss");
    setShowReflectionModal(false);
    setReflectionPersonaId(null);
    setReflectionPersona(null);
    processor.getPersonaList().then(setPersonas);
  }, [processor, reflectionPersonaId, setPersonas]);

  const handleReflectionClose = useCallback(async (updatedPending: {
    long_description: string;
    short_description: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
  }) => {
    if (!processor || !reflectionPersonaId || !reflectionPersona?.pending_update) return;
    await processor.updatePersona(reflectionPersonaId, {
      pending_update: {
        ...reflectionPersona.pending_update,
        ...updatedPending,
      },
    });
    setShowReflectionModal(false);
    processor.getPersonaList().then(setPersonas);
  }, [processor, reflectionPersonaId, reflectionPersona, setPersonas]);

  const handleReflectionPendingUpdateChange = useCallback(async (updatedPending: {
    long_description: string;
    short_description: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
  }) => {
    if (!processor || !reflectionPersonaId || !reflectionPersona?.pending_update) return;
    await processor.updatePersona(reflectionPersonaId, {
      pending_update: {
        ...reflectionPersona.pending_update,
        ...updatedPending,
      },
    });
    const updated = await processor.getPersona(reflectionPersonaId);
    if (updated) setReflectionPersona(updated);
  }, [processor, reflectionPersonaId, reflectionPersona]);

  return {
    showReflectionModal,
    reflectionPersonaId,
    reflectionPersona,
    reflectionMessages,
    reflectionInputValue,
    reflectionPersonaIdRef,
    setReflectionMessages,
    setReflectionInputValue,
    handleOpenReflection,
    handleReflectionSendMessage,
    handleReflectionSaveAndApply,
    handleReflectionDismiss,
    handleReflectionClose,
    handleReflectionPendingUpdateChange,
  };
}
