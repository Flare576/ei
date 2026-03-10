import { useState, useEffect, useRef } from "react";
import type { GenerationResult } from "../../comfyui";
import type { Message } from "../../../../src/core/types/llm";

interface ImagePreviewModalProps {
  message: Message;
  imageUrl: string | null;
  isGenerating: boolean;
  generationResult: GenerationResult | null;
  onPromptUpdate: (newPrompt: string) => void;
  onRegenerate: () => void;
  onClose: () => void;
  onRemove?: () => void;
  error?: string | null;
}

export function ImagePreviewModal({
  message,
  imageUrl,
  isGenerating,
  generationResult,
  onPromptUpdate,
  onRegenerate,
  onClose,
  onRemove,
  error,
}: ImagePreviewModalProps) {
  const [metadataCollapsed, setMetadataCollapsed] = useState<boolean>(true);
  const [localPrompt, setLocalPrompt] = useState<string>(message.verbal_response || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isSynthesis = message._synthesis === true;

  // Sync local prompt with message changes
  useEffect(() => {
    setLocalPrompt(message.verbal_response || "");
  }, [message.verbal_response]);

  const handlePromptBlur = () => {
    // Save on blur if prompt changed
    if (localPrompt !== message.verbal_response) {
      onPromptUpdate(localPrompt);
    }
  };

  const handleRegenerateClick = () => {
    // Save prompt before regenerating if user hasn't blurred yet
    if (textareaRef.current === document.activeElement && localPrompt !== message.verbal_response) {
      onPromptUpdate(localPrompt);
    }
    onRegenerate();
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    
    // Sanitize prompt for filename (remove special chars, truncate)
    const promptText = message.verbal_response || "image";
    const sanitizedPrompt = promptText
      .slice(0, 50)
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    const filename = `ei_${sanitizedPrompt}_${Date.now()}.png`;
    
    // Create download link
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="ei-modal-overlay" onClick={onClose}>
      <div className="ei-modal ei-image-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ei-image-preview__header">
          <h2>Generated Image</h2>
          <button className="ei-image-preview__close" onClick={onClose}>×</button>
        </div>
        
        <div className="ei-image-preview__body">
          {error ? (
            <div className="ei-image-preview__error">
              <p>❌ {error}</p>
            </div>
          ) : isGenerating ? (
            <div className="ei-image-preview__loading">
              <div className="ei-spinner"></div>
              <p>Generating image...</p>
            </div>
          ) : (
            <>
              {/* Image display */}
              <div className="ei-image-preview__container">
                {imageUrl && (
                  <img 
                    src={imageUrl} 
                    alt="Generated" 
                    className="ei-image-preview__image"
                  />
                )}
              </div>
              
              {/* EDIT MODE: Editable textarea + inline size/seed */}
              {isSynthesis ? (
                <>
                  <div className="ei-editable-prompt-container">
                    <label htmlFor="prompt-edit">
                      <strong>Prompt:</strong>
                    </label>
                    <textarea
                      ref={textareaRef}
                      id="prompt-edit"
                      className="ei-editable-prompt"
                      value={localPrompt}
                      onChange={(e) => setLocalPrompt(e.target.value)}
                      onBlur={handlePromptBlur}
                      rows={6}
                    />
                  </div>
                  
                  {/* Inline size/seed for edit mode - NO collapsible */}
                  {generationResult && (
                    <div className="ei-image-preview__inline-metadata">
                      <strong>Size:</strong> {generationResult.width}×{generationResult.height} | 
                      <strong>Seed:</strong> {generationResult.seed}
                    </div>
                  )}
                </>
              ) : (
                /* VIEW-ONLY MODE: Collapsible metadata with prompt/size/seed */
                generationResult && (
                  <div className="ei-image-preview__metadata-section">
                    <button
                      className="ei-metadata-toggle"
                      onClick={() => setMetadataCollapsed(!metadataCollapsed)}
                      aria-expanded={!metadataCollapsed}
                    >
                      <span className={`ei-metadata-toggle__icon ${metadataCollapsed ? '' : 'expanded'}`}>
                        ▶
                      </span>
                      <strong>Metadata</strong>
                    </button>
                    {!metadataCollapsed && (
                      <div className="ei-image-preview__metadata">
                        <p><strong>Prompt:</strong> {generationResult.prompt}</p>
                        <p>
                          <strong>Size:</strong> {generationResult.width}×{generationResult.height} | 
                          <strong>Seed:</strong> {generationResult.seed}
                        </p>
                      </div>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </div>
        
        <div className="ei-image-preview__footer">
          {/* Remove button on LEFT, styled destructively */}
          <button 
            className="ei-btn ei-btn--danger"
            onClick={onRemove || onClose}
          >
            🗑️ Remove
          </button>
          
          {/* Download and Regenerate on RIGHT */}
          <div style={{ display: 'flex', gap: 'var(--ei-spacing-md)' }}>
            <button 
              className="ei-btn ei-btn--secondary"
              onClick={handleDownload}
              disabled={isGenerating || !imageUrl}
            >
              💾 Download
            </button>
            <button 
              className="ei-btn ei-btn--primary"
              onClick={handleRegenerateClick}
              disabled={isGenerating}
            >
              🔄 Regenerate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
