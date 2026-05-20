import { useState, useCallback, useEffect } from "react";
import type { RefObject, Dispatch, SetStateAction } from "react";
import type { Processor } from "../../../src/core/processor";
import type { Message } from "../../../src/core/types";
import { generateImage, type GenerationResult } from "../comfyui";

export function useImageGeneration(
  processorRef: RefObject<Processor | null>,
  activePersonaId: string | null,
  messages: Message[],
  setMessages: Dispatch<SetStateAction<Message[]>>,
) {
  const [currentImageResult, setCurrentImageResult] = useState<GenerationResult | null>(null);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [messageImages, setMessageImages] = useState<Record<string, { blobUrl: string; result: GenerationResult }>>({});
  const [generatingImageFor, setGeneratingImageFor] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [currentViewingMessageId, setCurrentViewingMessageId] = useState<string | null>(null);

  // Revoke blob URLs on unmount / when messageImages changes
  useEffect(() => {
    return () => {
      Object.values(messageImages).forEach(imageData => URL.revokeObjectURL(imageData.blobUrl));
    };
  }, [messageImages]);

  const handleImageGenerate = useCallback(async (message: Message) => {
    const prompt = message.content ?? '';

    if (!prompt.trim()) {
      alert("No prompt text found in this message");
      return;
    }

    setGeneratingImageFor(message.id);
    setImageErrors(prev => {
      const updated = { ...prev };
      delete updated[message.id];
      return updated;
    });

    // If modal is open for this message, clear modal error state
    if (currentViewingMessageId === message.id) {
      setImageGenerationError(null);
    }

    try {
      const result = await generateImage(prompt, processorRef.current?.getStateManager());
      const blobUrl = URL.createObjectURL(result.image);
      setMessageImages(prev => ({ ...prev, [message.id]: { blobUrl, result } }));

      // If modal is open for this message, update modal result state
      if (currentViewingMessageId === message.id) {
        setCurrentImageResult(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setImageErrors(prev => ({ ...prev, [message.id]: errorMessage }));

      // If modal is open for this message, update modal error state
      if (currentViewingMessageId === message.id) {
        setImageGenerationError(errorMessage);
      }
      console.error("Image generation failed:", error);
    } finally {
      setGeneratingImageFor(null);
    }
  }, [currentViewingMessageId, processorRef]);

  const handleImageRegenerate = useCallback(async () => {
    if (!currentViewingMessageId) return;

    // Find the message being viewed
    const message = messages.find(m => m.id === currentViewingMessageId);
    if (!message) return;

    // Revoke old Blob URL before regenerating
    const oldImageData = messageImages[currentViewingMessageId];
    if (oldImageData) {
      URL.revokeObjectURL(oldImageData.blobUrl);
    }

    // Regenerate using the same flow as initial generation
    await handleImageGenerate(message);
  }, [currentViewingMessageId, messages, messageImages, handleImageGenerate]);

  const handleImagePreviewClose = useCallback(() => {
    setShowImagePreview(false);
    setCurrentImageResult(null);
    setImageGenerationError(null);
    setCurrentViewingMessageId(null);
  }, []);

  const handleImageRemove = useCallback(() => {
    if (!currentViewingMessageId) return;

    // Revoke the blob URL to free memory
    const imageData = messageImages[currentViewingMessageId];
    if (imageData?.blobUrl) {
      URL.revokeObjectURL(imageData.blobUrl);
    }

    // Remove from messageImages state
    setMessageImages(prev => {
      const newImages = { ...prev };
      delete newImages[currentViewingMessageId];
      return newImages;
    });

    // Clear any error for this message
    setImageErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[currentViewingMessageId];
      return newErrors;
    });

    // Close the modal
    handleImagePreviewClose();
  }, [currentViewingMessageId, messageImages, handleImagePreviewClose]);

  const handleImageClick = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    const imageData = messageImages[messageId];

    // For synthesis messages, always open modal (they have editable prompts)
    if (message?._synthesis) {
      setImageGenerationError(null);
      setCurrentViewingMessageId(messageId);
      setShowImagePreview(true);
      // Set result if available (for synthesis messages with generated images)
      if (imageData) {
        setCurrentImageResult(imageData.result);
      }
      return;
    }

    if (!imageData) {
      // If no image, might be error - show error in modal
      const error = imageErrors[messageId];
      if (error) {
        setImageGenerationError(error);
        setCurrentViewingMessageId(messageId);
        setShowImagePreview(true);
      }
      return;
    }

    // Open modal with generation result for normal messages
    setImageGenerationError(null);
    setCurrentImageResult(imageData.result);
    setCurrentViewingMessageId(messageId);
    setShowImagePreview(true);
  }, [messageImages, imageErrors, messages]);

  const handlePromptUpdate = useCallback((newPrompt: string) => {
    if (!currentViewingMessageId || !activePersonaId) return;

    processorRef.current?.updateMessage(activePersonaId, currentViewingMessageId, {
      content: newPrompt
    });

    // Update local messages state to reflect change immediately
    setMessages(prev => prev.map(msg =>
      msg.id === currentViewingMessageId
        ? { ...msg, content: newPrompt }
        : msg
    ));
  }, [currentViewingMessageId, activePersonaId, processorRef, setMessages]);

  return {
    currentImageResult,
    imageGenerationError,
    messageImages,
    generatingImageFor,
    imageErrors,
    showImagePreview,
    currentViewingMessageId,
    handleImageGenerate,
    handleImageRegenerate,
    handleImagePreviewClose,
    handleImageRemove,
    handleImageClick,
    handlePromptUpdate,
  };
}
