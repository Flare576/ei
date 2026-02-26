import { useState, useRef, useEffect } from 'react';
import type { Message, Quote } from '../../../../src/core/types';
import { DualListPicker } from './DualListPicker';

interface DataItem {
  id: string;
  name: string;
  type: string;
}

interface QuoteManagementModalProps {
  isOpen: boolean;
  quote: Quote | null;
  message: Message | null;
  personaName: string;
  dataItems: DataItem[];
  skipDeleteConfirm?: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Quote>) => void;
  onDelete: (id: string) => void;
  onSkipDeleteConfirmChange: (skip: boolean) => void;
}

export function QuoteManagementModal({
  isOpen,
  quote,
  message,
  dataItems,
  skipDeleteConfirm = false,
  onClose,
  onSave,
  onDelete,
  onSkipDeleteConfirmChange,
}: QuoteManagementModalProps) {
  const [quoteText, setQuoteText] = useState('');
  const [selectedDataItems, setSelectedDataItems] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen && quote) {
      setQuoteText(quote.text);
      setSelectedDataItems(quote.data_item_ids);
      setShowDeleteConfirm(false);
    }
  }, [isOpen, quote]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      modalRef.current?.focus();
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, showDeleteConfirm]);

  if (!isOpen || !quote) return null;

  const handleDataItemsChange = (newSelected: string[]) => {
    setSelectedDataItems(newSelected);
  };

  const handleSave = () => {
    onSave(quote.id, {
      text: quoteText,
      data_item_ids: selectedDataItems,
    });
    onClose();
  };

  const handleDeleteClick = () => {
    if (skipDeleteConfirm) {
      onDelete(quote.id);
      onClose();
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const handleConfirmDelete = () => {
    onDelete(quote.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !showDeleteConfirm) {
      onClose();
    }
  };

  return (
    <div className="ei-modal-overlay" onClick={handleBackdropClick}>
      <div className="ei-quote-capture-modal" ref={modalRef} tabIndex={-1}>
        <div className="ei-quote-capture-modal__header">
          <h2 className="ei-quote-capture-modal__title">Edit Quote</h2>
          <button
            className="ei-quote-capture-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {showDeleteConfirm ? (
          <div className="ei-quote-capture-modal__content">
            <div className="ei-quote-capture-modal__section">
              <p style={{ marginBottom: '1rem' }}>
                Are you sure you want to delete this quote? This action cannot be undone.
              </p>
              <label className="ei-quote-capture-modal__checkbox-label">
                <input
                  type="checkbox"
                  checked={skipDeleteConfirm}
                  onChange={(e) => onSkipDeleteConfirmChange(e.target.checked)}
                  className="ei-quote-capture-modal__checkbox"
                />
                <span className="ei-quote-capture-modal__checkbox-text">
                  Don't ask again
                </span>
              </label>
            </div>

            <div className="ei-quote-capture-modal__footer">
              <button
                className="ei-quote-capture-modal__button ei-quote-capture-modal__button--secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="ei-quote-capture-modal__button ei-quote-capture-modal__button--danger"
                onClick={handleConfirmDelete}
              >
                Delete Quote
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="ei-quote-capture-modal__content">
              {/* Message Info */}
              <div className="ei-quote-capture-modal__section">
                <div className="ei-quote-capture-modal__message-info">
                  <span className="ei-quote-capture-modal__speaker">
                    {quote.speaker === 'human' ? 'Human' : quote.speaker}
                  </span>
                  <span className="ei-quote-capture-modal__timestamp">
                    {new Date(quote.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Original Message Display (if available) */}
              {message && (
                <div className="ei-quote-capture-modal__section">
                  <label className="ei-quote-capture-modal__label">Original Message</label>
                  <div className="ei-quote-capture-modal__message-display">
                    {(message.verbal_response ?? '')}
                  </div>
                </div>
              )}

              {/* Quote Text (Editable) */}
              <div className="ei-quote-capture-modal__section">
                <label className="ei-quote-capture-modal__label">Quote Text</label>
                <textarea
                  className="ei-quote-capture-modal__textarea"
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  placeholder="Edit the quote text here..."
                />
              </div>

              {/* Data Items Multi-Select */}
              {dataItems.length > 0 && (
                <div className="ei-quote-capture-modal__section">
                  <label className="ei-quote-capture-modal__label">Link to Data Items</label>
                  <DualListPicker
                    available={dataItems}
                    selected={selectedDataItems}
                    onChange={handleDataItemsChange}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="ei-quote-capture-modal__footer">
              <button
                className="ei-quote-capture-modal__button ei-quote-capture-modal__button--danger"
                onClick={handleDeleteClick}
              >
                Delete
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="ei-quote-capture-modal__button ei-quote-capture-modal__button--secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="ei-quote-capture-modal__button ei-quote-capture-modal__button--primary"
                onClick={handleSave}
              >
                Save Changes
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
