import { useState, useRef, useEffect } from 'react';
import type { Message, Quote } from '../../../../src/core/types';
import { RangeSlider } from './RangeSlider';
import { DualListPicker } from './DualListPicker';
import { useOverlayClose } from '../../hooks/useOverlayClose';

interface DataItem {
  id: string;
  name: string;
  type: string;
}

interface QuoteCaptureModalProps {
  isOpen: boolean;
  message: Message | null;
  personaName: string;
  groupPrimary?: string;
  dataItems: DataItem[];
  onClose: () => void;
  onSave: (quote: Omit<Quote, 'id' | 'created_at'>) => void;
}

function getMessageText(msg: { content?: string; verbal_response?: string; action_response?: string }): string {
  if (msg.content) return msg.content;
  const parts: string[] = [];
  if (msg.action_response) parts.push(`_${msg.action_response}_`);
  if (msg.verbal_response) parts.push(msg.verbal_response);
  return parts.join('\n\n');
}

function snapToWordStart(text: string, pos: number): number {
  if (pos <= 0) return 0;
  // Walk back to start of current word
  while (pos > 0 && !/\s/.test(text[pos - 1])) pos--;
  return pos;
}

function snapToWordEnd(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  // Walk forward to end of current word
  while (pos < text.length && !/\s/.test(text[pos])) pos++;
  return pos;
}

export function QuoteCaptureModal({
  isOpen,
  message,
  personaName,
  groupPrimary,
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
      const messageText = getMessageText(message);
      const initialEnd = snapToWordEnd(messageText, Math.min(100, messageText.length));
      const initialStart = snapToWordStart(messageText, 0);
      setStartPos(initialStart);
      setEndPos(initialEnd);
      setQuoteText(messageText.substring(initialStart, initialEnd));
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

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen || !message) return null;

  const messageText = getMessageText(message);

  const handleRangeChange = (start: number, end: number) => {
    const snappedStart = snapToWordStart(messageText, start);
    const snappedEnd = snapToWordEnd(messageText, end);
    setStartPos(snappedStart);
    setEndPos(snappedEnd);
    setQuoteText(messageText.substring(snappedStart, snappedEnd));
  };

  const handleDataItemsChange = (ids: string[]) => {
    setSelectedDataItems(ids);
  };

  const handleSave = () => {
    const quote: Omit<Quote, 'id' | 'created_at'> = {
      message_id: message.id,
      data_item_ids: selectedDataItems,
      persona_groups: [groupPrimary || "General"],
      text: quoteText,
      speaker: message.role === 'human' ? 'human' : personaName,
      timestamp: message.timestamp,
      start: startPos,
      end: endPos,
      created_by: 'human',
    };
    onSave(quote);
  };

  return (
    <div className="ei-modal-overlay" {...overlayProps}>
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
              max={messageText.length}
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
                max={messageText.length}
                onChange={(e) => {
                  const val = Math.max(startPos + 1, Math.min(messageText.length, parseInt(e.target.value) || startPos + 1));
                  handleRangeChange(startPos, val);
                }}
              />
              {' '}of {messageText.length}
            </div>
          </div>

          {/* Preview with line breaks preserved */}
          <div className="ei-quote-capture-modal__section">
            <label className="ei-quote-capture-modal__label">Preview</label>
            <div className="ei-quote-preview">
              <span>{messageText.substring(0, startPos)}</span>
              <span className="ei-quote-preview__highlight">
                {messageText.substring(startPos, endPos)}
              </span>
              <span>{messageText.substring(endPos)}</span>
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
