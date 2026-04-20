import { useState, useRef, useEffect } from 'react';
import { useOverlayClose } from '../../hooks/useOverlayClose';

interface SearchResult {
  id: string;
  name: string;
  type: 'fact' | 'topic' | 'person' | 'quote';
  content?: string;
}

export interface KnowledgeSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => Promise<SearchResult[]>;
}

export function KnowledgeSearchModal({
  isOpen,
  onClose,
}: KnowledgeSearchModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      previousActiveElement.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen) return null;

  return (
    <div className="ei-modal-overlay" {...overlayProps}>
      <div className="ei-data-search-modal">
        <div className="ei-data-search-modal__header">
          <h2 className="ei-data-search-modal__title">What does Ei know about…</h2>
          <button
            className="ei-data-search-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="ei-data-search-modal__search">
          <input
            ref={inputRef}
            type="text"
            className="ei-data-search-modal__input"
            placeholder="Type to search Ei's memory…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="ei-data-search-modal__results">
          <div className="ei-knowledge-search-modal__placeholder">
            Type to search Ei's memory…
          </div>
        </div>

        <div className="ei-data-search-modal__hint">Esc to close</div>
      </div>
    </div>
  );
}
