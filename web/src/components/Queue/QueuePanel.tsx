import { useState, useRef, useEffect } from 'react';
import type { LLMRequest } from '../../../../src/core/types/llm';
import type { ProviderAccount } from '../../../../src/core/types';
import { ModelPicker } from '../Settings/ModelPicker';

function resolveModelName(modelId: string | undefined, accounts: ProviderAccount[]): string {
  if (!modelId) return '(no model)';
  for (const account of accounts) {
    const model = account.models?.find(m => m.id === modelId);
    if (model) return `${account.name} - ${model.name}`;
  }
  return '(no model)';
}

interface QueuePanelProps {
  isOpen: boolean;
  pendingItems: LLMRequest[];
  dlqItems: LLMRequest[];
  personas: Array<{ id: string; display_name: string }>;
  accounts: ProviderAccount[];
  onClose: () => void;
  onUpdateItems: (ids: string[], model: string) => void;
  onDeleteItems: (ids: string[]) => void;
}

export function QueuePanel({
  isOpen,
  pendingItems,
  dlqItems,
  personas,
  accounts,
  onClose,
  onUpdateItems,
  onDeleteItems,
}: QueuePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newModel, setNewModel] = useState<string | undefined>(undefined);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
      setNewModel(undefined);
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
      setNewModel(firstSelected.model ?? undefined);
    }
  }, [firstSelectedId]);

  const allItemCount = pendingItems.length + dlqItems.length;
  const allSelected = allItemCount > 0 && selectedIds.length === allItemCount;
  const someSelected = selectedIds.length > 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

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
    if (selectedIds.length === 0 || !newModel) return;
    onUpdateItems(selectedIds, newModel);
    setSelectedIds([]);
    setNewModel(undefined);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    onDeleteItems(selectedIds);
    setSelectedIds([]);
    setNewModel(undefined);
  };

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

        <div className="ei-queue-panel__controls">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="ei-queue-panel__checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
            disabled={totalCount === 0}
            title="Select all"
            aria-label="Select all"
          />
          <span className="ei-queue-panel__controls-gap" aria-hidden="true" />
          <div className="ei-queue-panel__controls-picker">
            <ModelPicker
              value={newModel}
              onChange={setNewModel}
              accounts={accounts}
              label=""
              id="ei-queue-model-picker"
              allowEmpty
            />
          </div>
          <button
            className="ei-btn ei-btn--icon"
            onClick={handleUpdateSelected}
            disabled={!someSelected || !newModel}
            title="Update selected items"
            aria-label="Update selected"
          >💾</button>
          <button
            className="ei-btn ei-btn--icon ei-btn--danger-icon"
            onClick={handleDeleteSelected}
            disabled={!someSelected}
            title="Delete selected — permanent, cannot be undone"
            aria-label="Delete selected"
          >🗑️</button>
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
                      accounts={accounts}
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
                      accounts={accounts}
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
  accounts: ProviderAccount[];
}

function QueueItem({ item, personaName, isSelected, onToggle, isDlq, accounts }: QueueItemProps) {
  return (
    <li className={`ei-queue-panel__item${isSelected ? ' ei-queue-panel__item--selected' : ''}`}>
      <label className="ei-queue-panel__item-label">
        <input
          type="checkbox"
          className="ei-queue-panel__checkbox"
          checked={isSelected}
          onChange={() => onToggle(item.id)}
        />
        {personaName && <span className="ei-queue-panel__item-persona">{personaName}</span>}
        <span className="ei-queue-panel__item-model">{resolveModelName(item.model, accounts)}</span>
        <span className="ei-queue-panel__item-type">{item.next_step}</span>
        <span className="ei-queue-panel__item-attempts" title="Attempts">{item.attempts}</span>
        {isDlq && (
          <span className="ei-queue-panel__dlq-badge" aria-label="Dead Letter Queue">
            DLQ
          </span>
        )}
      </label>
    </li>
  );
}
