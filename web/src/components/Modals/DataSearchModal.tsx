import { useState, useRef, useEffect, useMemo } from 'react';
import { useOverlayClose } from '../../hooks/useOverlayClose';

interface DataItem {
  id: string;
  name: string;
  type: 'Person' | 'Topic';
}

export interface DataSearchModalProps {
  isOpen: boolean;
  title: string;
  placeholder: string;
  items: DataItem[];
  onSelect: (item: DataItem) => void;
  onClose: () => void;
  footerHint?: string;
  footerContent?: React.ReactNode;
}

export function DataSearchModal({
  isOpen,
  title,
  placeholder,
  items,
  onSelect,
  onClose,
  footerHint,
  footerContent,
}: DataSearchModalProps) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightedIndex(0);
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

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase();
    const matched = q
      ? items.filter(i => i.name.toLowerCase().includes(q))
      : [...items];
    matched.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'Person' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return matched;
  }, [items, query]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredItems]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredItems[highlightedIndex];
      if (item) {
        onSelect(item);
        onClose();
      }
    }
  };

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen) return null;

  return (
    <div className="ei-modal-overlay" {...overlayProps}>
      <div className="ei-data-search-modal">
        <div className="ei-data-search-modal__header">
          <h2 className="ei-data-search-modal__title">{title}</h2>
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
            placeholder={placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>

        <div className="ei-data-search-modal__results">
          {filteredItems.length === 0 ? (
            <div className="ei-data-search-modal__empty">No matches</div>
          ) : (
            filteredItems.map((item, idx) => (
              <div
                key={item.id}
                className={
                  `ei-data-search-modal__result` +
                  (idx === highlightedIndex ? ' ei-data-search-modal__result--highlighted' : '')
                }
                onClick={() => { onSelect(item); onClose(); }}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <span className="ei-data-search-modal__result-badge">
                  {item.type === 'Person' ? '👤' : '📌'}
                </span>
                <span className="ei-data-search-modal__result-name">{item.name}</span>
              </div>
            ))
          )}
        </div>

        {footerContent !== undefined && (
          <div className="ei-data-search-modal__footer-content">
            {footerContent}
          </div>
        )}

        {footerHint !== undefined && (
          <div className="ei-data-search-modal__hint">{footerHint}</div>
        )}
      </div>
    </div>
  );
}
