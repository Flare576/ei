import React, { useState } from 'react';
import { SliderControl } from './SliderControl';

interface DataItemBase {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  last_updated: string;
  learned_by?: string;
  last_changed_by?: string;
  persona_groups?: string[];
}

interface SliderConfig {
  field: string;
  label: string;
  min?: number;
  max?: number;
  formatValue?: (v: number) => string;
  tooltip?: string;
}

interface DataItemCardProps<T extends DataItemBase> {
  item: T;
  sliders: SliderConfig[];
  onChange: (field: keyof T, value: T[keyof T]) => void;
  onSave: () => void;
  onDelete: () => void;
  isDirty?: boolean;
  showMeta?: boolean;
  resolvePersonaName?: (id: string) => string;
  renderAfterHeader?: () => React.ReactNode;
  onAiAssist?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  aiContext?: string;
}

const defaultFormat = (v: number) => v.toFixed(2);

export const DataItemCard = <T extends DataItemBase>({
  item,
  sliders,
  onChange,
  onSave,
  onDelete,
  isDirty = false,
  showMeta = true,
  renderAfterHeader,
  resolvePersonaName,
  onAiAssist,
  aiContext,
}: DataItemCardProps<T>): React.ReactElement => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const handleBlur = (e: React.FocusEvent) => {
    if (isDirty && cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      onSave();
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('name' as keyof T, e.target.value as T[keyof T]);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange('description' as keyof T, e.target.value as T[keyof T]);
  };

  const handleSliderChange = (field: string, value: number) => {
    onChange(field as keyof T, value as T[keyof T]);
  };

  const handleWand = async () => {
    if (!onAiAssist) return;
    setAiLoading(true);
    const negativeClause = suggestion
      ? `\n\nThe user didn't like this previous version — avoid it:\n"${suggestion}"`
      : '';
    const systemPrompt = [
      aiContext ? `You're helping define a persona. Their description is:\n\n${aiContext}\n\n` : '',
      `You're improving the **Description** for a trait called **${item.name}**. Return only the improved description text, nothing else.`,
      negativeClause,
    ].join('');
    try {
      const result = await onAiAssist(systemPrompt, `Current description: ${item.description || '(empty)'}`);
      setSuggestion(result);
    } catch (err) {
      console.error('AI assist failed:', err);
    } finally {
      setAiLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div 
      ref={cardRef}
      className={`ei-data-card ${isDirty ? 'ei-data-card--dirty' : ''}`}
      onBlur={handleBlur}
    >
      <div className="ei-data-card__header">
        <input
          type="text"
          className="ei-data-card__name"
          value={item.name}
          onChange={handleNameChange}
          placeholder="Name"
        />
      </div>

      {renderAfterHeader?.()}

      <div className="ei-data-card__body">
        <div style={{ position: 'relative' }}>
          <div className="ei-creator-modal__field-with-assist ei-creator-modal__field-with-assist--inline">
            <label className="ei-form-label ei-form-label--sm">Description</label>
            {onAiAssist && (
              <button
                className="ei-ai-assist-btn ei-ai-assist-btn--sm"
                onClick={handleWand}
                disabled={aiLoading}
                title="AI assist"
              >
                ✨
              </button>
            )}
          </div>
          <textarea
            className="ei-data-card__description"
            value={item.description}
            onChange={handleDescriptionChange}
            placeholder="Description"
          />
          {aiLoading && (
            <div className="ei-field-loading-overlay">
              <div className="ei-field-loading-overlay__spinner" />
            </div>
          )}
        </div>
        {suggestion && (
          <div className="ei-ai-suggestion">
            <div className="ei-ai-suggestion__text">{suggestion}</div>
            <div className="ei-ai-suggestion__actions">
              <button className="ei-btn ei-btn--primary ei-btn--sm" onClick={() => {
                onChange('description' as keyof T, suggestion as T[keyof T]);
                setSuggestion(null);
              }}>Accept</button>
              <button className="ei-btn ei-btn--secondary ei-btn--sm" onClick={handleWand} disabled={aiLoading}>Re-roll</button>
              <button className="ei-btn ei-btn--ghost ei-btn--sm" onClick={() => setSuggestion(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <div className="ei-data-card__sliders">
          {sliders.map((slider) => (
            <SliderControl
              key={slider.field}
              label={slider.label}
              value={item[slider.field as keyof T] as number}
              min={slider.min}
              max={slider.max}
              onChange={(value) => handleSliderChange(slider.field, value)}
              formatValue={slider.formatValue || defaultFormat}
              tooltip={slider.tooltip}
            />
          ))}
        </div>
      </div>

      <div className="ei-data-card__footer">
        {showMeta && (
          <div className="ei-data-card__meta">
            {item.learned_by && <span>Learned by: {resolvePersonaName ? resolvePersonaName(item.learned_by) : item.learned_by} • </span>}
            <span>Updated: {formatTimestamp(item.last_updated)}</span>
          </div>
        )}
        {item.persona_groups && item.persona_groups.length > 0 && (
          <div className="ei-data-card__groups">
            {item.persona_groups.map((group, idx) => (
              <span key={group} className={`ei-data-card__group-badge ${idx === 0 ? 'ei-data-card__group-badge--primary' : ''}`}>
                {group}
              </span>
            ))}
          </div>
        )}
        <div className="ei-data-card__actions">
          <button 
            className="ei-control-btn ei-control-btn--danger" 
            onClick={onDelete}
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
};
