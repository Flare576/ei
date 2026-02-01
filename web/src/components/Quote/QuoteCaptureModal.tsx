import { useState, useRef, useEffect } from 'react';
import type { Message, Quote } from '../../../../src/core/types';
import { RangeSlider } from './RangeSlider';
import { DualListPicker } from './DualListPicker';

interface DataItem {
  id: string;
  name: string;
  type: string;
}

interface QuoteCaptureModalProps {
  isOpen: boolean;
  message: Message | null;
  personaName: string;
  dataItems: DataItem[];
  onClose: () => void;
  onSave: (quote: Omit<Quote, 'id' | 'created_at'>) => void;
}

export function QuoteCaptureModal({
  isOpen,
  message,
  personaName,
  dataItems,
  onClose,
  onSave,
}: QuoteCaptureModalProps) {
  const [startPos, setStartPos] = useState(0);
  const [endPos, setEndPos] = useState(0);
  const [quoteText, setQuoteText] = useState('');
  const [selectedDataItems, setSelectedDataItems] = useState<string[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen && message) {
      const contentLength = message.content.length;
      setStartPos(0);
      setEndPos(Math.min(100, contentLength));
      setQuoteText(message.content.substring(0, Math.min(100, contentLength)));
      setSelectedDataItems([]);
    }
  }, [isOpen, message]);

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
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !message) return null;

  const handleRangeChange = (start: number, end: number) => {
    setStartPos(start);
    setEndPos(end);
    setQuoteText(message.content.substring(start, end));
  };

  const handleDataItemsChange = (ids: string[]) => {
    setSelectedDataItems(ids);
  };

  const handleSave = () => {
    const quote: Omit<Quote, 'id' | 'created_at'> = {
      message_id: message.id,
      data_item_ids: selectedDataItems,
      persona_groups: [personaName],
      text: quoteText,
      speaker: message.role === 'human' ? 'human' : personaName,
      timestamp: message.timestamp,
      start: startPos,
      end: endPos,
      created_by: 'human',
    };
    onSave(quote);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="ei-modal-overlay" onClick={handleBackdropClick}>
      <div className="ei-quote-capture-modal" ref={modalRef} tabIndex={-1}>
        <div className="ei-quote-capture-modal__header">
          <h2 className="ei-quote-capture-modal__title">Capture Quote</h2>
          <button
            className="ei-quote-capture-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="ei-quote-capture-modal__content">
          {/* Range Slider */}
          <div className="ei-quote-capture-modal__section">
            <label className="ei-quote-capture-modal__label">Select Range</label>
            <RangeSlider
              min={0}
              max={message.content.length}
              startValue={startPos}
              endValue={endPos}
              onChange={handleRangeChange}
            />
            <div className="ei-quote-capture-modal__range-info">
              Characters{' '}
              <input
                type="number"
                className="ei-quote-capture-modal__range-input"
                value={startPos}
                min={0}
                max={endPos - 1}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(endPos - 1, parseInt(e.target.value) || 0));
                  handleRangeChange(val, endPos);
                }}
              />
              {' '}to{' '}
              <input
                type="number"
                className="ei-quote-capture-modal__range-input"
                value={endPos}
                min={startPos + 1}
                max={message.content.length}
                onChange={(e) => {
                  const val = Math.max(startPos + 1, Math.min(message.content.length, parseInt(e.target.value) || startPos + 1));
                  handleRangeChange(startPos, val);
                }}
              />
              {' '}of {message.content.length}
            </div>
          </div>

          {/* Preview with line breaks preserved */}
          <div className="ei-quote-capture-modal__section">
            <label className="ei-quote-capture-modal__label">Preview</label>
            <div className="ei-quote-preview">
              <span>{message.content.substring(0, startPos)}</span>
              <span className="ei-quote-preview__highlight">
                {message.content.substring(startPos, endPos)}
              </span>
              <span>{message.content.substring(endPos)}</span>
            </div>
          </div>

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

          {/* Link to Data Items */}
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
            className="ei-quote-capture-modal__button ei-quote-capture-modal__button--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="ei-quote-capture-modal__button ei-quote-capture-modal__button--primary"
            onClick={handleSave}
          >
            Save Quote
          </button>
        </div>
      </div>
    </div>
  );
}
