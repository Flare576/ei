import { useState, useRef, useEffect } from 'react';
import type { LLMRequest } from '../../../../src/core/types/llm';

interface QueuePanelProps {
  isOpen: boolean;
  pendingItems: LLMRequest[];
  dlqItems: LLMRequest[];
  personas: Array<{ id: string; display_name: string }>;
  onClose: () => void;
  onUpdateItems: (ids: string[], model: string) => void;
}

export function QueuePanel({
  isOpen,
  pendingItems,
  dlqItems,
  personas,
  onClose,
  onUpdateItems,
}: QueuePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newModel, setNewModel] = useState('');
  const modelInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
      setNewModel('');
    }
  }, [isOpen]);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const firstSelectedId = selectedIds[0];
  useEffect(() => {
    if (!firstSelectedId) return;
    const allItems = [...pendingItems, ...dlqItems];
    const firstSelected = allItems.find(item => item.id === firstSelectedId);
    if (firstSelected) {
      setNewModel(firstSelected.model ?? '');
    }
    setTimeout(() => modelInputRef.current?.focus(), 0);
  }, [firstSelectedId]);

  if (!isOpen) return null;

  const allItems = [...pendingItems, ...dlqItems];
  const totalCount = allItems.length;

  const lookupPersonaName = (item: LLMRequest): string => {
    const personaId = item.data.personaId;
    if (typeof personaId !== 'string') return '';
    return personas.find(p => p.id === personaId)?.display_name ?? '';
  };

  const handleToggleItem = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedIds(selectedIds.length === totalCount ? [] : allItems.map(item => item.id));
  };

  const handleUpdateSelected = () => {
    if (selectedIds.length === 0 || !newModel.trim()) return;
    onUpdateItems(selectedIds, newModel.trim());
    setSelectedIds([]);
    setNewModel('');
  };

  const allSelected = totalCount > 0 && selectedIds.length === totalCount;
  const someSelected = selectedIds.length > 0;
  const showDivider = pendingItems.length > 0 && dlqItems.length > 0;

  return (
    <div className="ei-modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="ei-modal-content ei-queue-panel"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="ei-queue-panel__header">
          <h2 className="ei-queue-panel__title">
            Queue{' '}
            <span className="ei-queue-panel__counts">
              ({pendingItems.length} pending, {dlqItems.length} DLQ)
            </span>
          </h2>
          <button
            className="ei-queue-panel__close ei-btn ei-btn--ghost ei-btn--icon"
            onClick={onClose}
            aria-label="Close queue panel"
          >
            ✕
          </button>
        </div>

        <div className="ei-queue-panel__toolbar">
          <button
            className="ei-btn ei-btn--secondary"
            onClick={handleSelectAll}
            disabled={totalCount === 0}
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>

          {someSelected && (
            <div className="ei-queue-panel__update-row">
              <label className="ei-queue-panel__update-label" htmlFor="ei-queue-model-input">
                New model for selected ({selectedIds.length}):
              </label>
              <input
                id="ei-queue-model-input"
                ref={modelInputRef}
                className="ei-queue-panel__model-input"
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="model name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUpdateSelected();
                }}
              />
              <button
                className="ei-btn ei-btn--primary"
                onClick={handleUpdateSelected}
                disabled={!newModel.trim()}
              >
                Update Selected
              </button>
            </div>
          )}
        </div>

        <div className="ei-queue-panel__body">
          {totalCount === 0 ? (
            <div className="ei-queue-panel__empty">Queue is empty</div>
          ) : (
            <>
              {pendingItems.length > 0 && (
                <ul className="ei-queue-panel__list" role="list">
                  {pendingItems.map(item => (
                    <QueueItem
                      key={item.id}
                      item={item}
                      personaName={lookupPersonaName(item)}
                      isSelected={selectedIds.includes(item.id)}
                      onToggle={handleToggleItem}
                      isDlq={false}
                    />
                  ))}
                </ul>
              )}

              {showDivider && (
                <div className="ei-queue-panel__section-divider">
                  <span className="ei-queue-panel__section-label">Dead Letter Queue</span>
                </div>
              )}

              {dlqItems.length > 0 && (
                <ul className="ei-queue-panel__list ei-queue-panel__list--dlq" role="list">
                  {dlqItems.map(item => (
                    <QueueItem
                      key={item.id}
                      item={item}
                      personaName={lookupPersonaName(item)}
                      isSelected={selectedIds.includes(item.id)}
                      onToggle={handleToggleItem}
                      isDlq={true}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface QueueItemProps {
  item: LLMRequest;
  personaName: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  isDlq: boolean;
}

function QueueItem({ item, personaName, isSelected, onToggle, isDlq }: QueueItemProps) {
  return (
    <li className={`ei-queue-panel__item${isSelected ? ' ei-queue-panel__item--selected' : ''}`}>
      <label className="ei-queue-panel__item-label">
        <input
          type="checkbox"
          className="ei-queue-panel__checkbox"
          checked={isSelected}
          onChange={() => onToggle(item.id)}
        />
        <span className="ei-queue-panel__item-type">
          {item.next_step}
        </span>
        {personaName && (
          <span className="ei-queue-panel__item-persona">{personaName}</span>
        )}
        <span className="ei-queue-panel__item-model">
          {item.model ?? '(no model)'}
        </span>
        <span className="ei-queue-panel__item-attempts" title="Attempts">
          {item.attempts}
        </span>
        {isDlq && (
          <span className="ei-queue-panel__dlq-badge" aria-label="Dead Letter Queue">
            DLQ
          </span>
        )}
      </label>
    </li>
  );
}
