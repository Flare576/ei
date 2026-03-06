import React, { useState, useEffect, useRef } from 'react';
import type { ToolProvider, ToolDefinition } from '../../../../src/core/types.js';

interface ToolkitEditorProps {
  isOpen: boolean;
  provider: ToolProvider | null;
  tools: ToolDefinition[];
  onSave: (provider: ToolProvider) => void;
  onToolUpdate: (id: string, updates: Partial<Omit<ToolDefinition, 'id' | 'created_at'>>) => void;
  onClose: () => void;
}

export const ToolkitEditor: React.FC<ToolkitEditorProps> = ({
  isOpen,
  provider,
  tools,
  onSave,
  onToolUpdate,
  onClose,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [configRows, setConfigRows] = useState<Array<{ key: string; value: string }>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Optimistic local state for tool toggles within the editor
  const [toolEnabled, setToolEnabled] = useState<Record<string, boolean>>({});

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  const providerTools = provider
    ? tools.filter((t) => t.provider_id === provider.id)
    : [];

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (provider) {
        setDisplayName(provider.display_name);
        setDescription(provider.description || '');
        setEnabled(provider.enabled);
        setConfigRows(
          Object.entries(provider.config).map(([key, value]) => ({ key, value }))
        );
      } else {
        setDisplayName('');
        setDescription('');
        setEnabled(true);
        setConfigRows([]);
      }
      setErrors({});
    }
  }, [isOpen, provider]);

  // Sync tool enabled state from props
  useEffect(() => {
    setToolEnabled(Object.fromEntries(tools.map((t) => [t.id, t.enabled])));
  }, [tools]);

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

  if (!isOpen || !provider) return null;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!displayName.trim()) {
      newErrors.displayName = 'Display name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const configObj: Record<string, string> = {};
    configRows.forEach(({ key, value }) => {
      if (key.trim()) {
        configObj[key.trim()] = value.trim();
      }
    });

    const updatedProvider: ToolProvider = {
      ...provider,
      display_name: displayName.trim(),
      description: description.trim() || undefined,
      enabled,
      config: configObj,
    };

    onSave(updatedProvider);
  };

  const handleConfigRowChange = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...configRows];
    updated[index][field] = value;
    setConfigRows(updated);
  };

  const handleToggleTool = (id: string, checked: boolean) => {
    setToolEnabled((prev) => ({ ...prev, [id]: checked }));
    onToolUpdate(id, { enabled: checked });
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="ei-modal-overlay" onClick={handleBackdropClick}>
      <div
        className="ei-provider-editor"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="toolkit-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ei-provider-editor__header">
          <h2 id="toolkit-editor-title" className="ei-provider-editor__title">
            Edit Tool Kit: {provider.display_name}
          </h2>
          <button
            className="ei-provider-editor__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="ei-provider-editor__content">
          <div className="ei-form-group">
            <label htmlFor="toolkit-display-name" className="ei-form-label">
              Display Name <span className="ei-form-required">*</span>
            </label>
            <input
              id="toolkit-display-name"
              type="text"
              className={`ei-input ${errors.displayName ? 'ei-input--error' : ''}`}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Brave Search"
            />
            {errors.displayName && (
              <span className="ei-form-error">{errors.displayName}</span>
            )}
          </div>

          <div className="ei-form-group">
            <label htmlFor="toolkit-description" className="ei-form-label">
              Description <span className="ei-form-optional">(optional)</span>
            </label>
            <textarea
              id="toolkit-description"
              className="ei-input ei-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of what this kit does"
              rows={2}
            />
          </div>

          {configRows.length > 0 && (
            <div className="ei-form-group">
              <label className="ei-form-label">Configuration</label>
              <div className="ei-provider-editor__headers">
                {configRows.map((row, index) => (
                  <div key={index} className="ei-provider-editor__header-row">
                    <input
                      type="text"
                      className="ei-input ei-provider-editor__header-key"
                      value={row.key}
                      onChange={(e) => handleConfigRowChange(index, 'key', e.target.value)}
                      placeholder="Key"
                      readOnly={provider.builtin}
                    />
                    <input
                      type="password"
                      className="ei-input ei-provider-editor__header-value"
                      value={row.value}
                      onChange={(e) => handleConfigRowChange(index, 'value', e.target.value)}
                      placeholder="Value"
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {providerTools.length > 0 && (
            <div className="ei-form-group">
              <label className="ei-form-label">Tools</label>
              <div className="ei-toolkit-tools-readonly">
                {providerTools.map((tool) => {
                  const isEnabled = toolEnabled[tool.id] ?? tool.enabled;
                  return (
                    <div key={tool.id} className={`ei-toolkit-tool-readonly ${!isEnabled ? 'ei-toolkit-tool--disabled' : ''}`}>
                      <span className="ei-toolkit-tool__name">{tool.display_name}</span>
                      <label className="ei-provider-card__toggle">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => handleToggleTool(tool.id, e.target.checked)}
                          className="ei-provider-card__toggle-input"
                        />
                        <span className="ei-provider-card__toggle-label">Enabled</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="ei-provider-editor__footer">
          <label className="ei-provider-card__toggle">
            <input
              type="checkbox"
              className="ei-provider-card__toggle-input"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="ei-provider-card__toggle-label">Enabled</span>
          </label>
          <div style={{ display: 'flex', gap: 'var(--ei-spacing-sm)' }}>
            <button className="ei-btn ei-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="ei-btn ei-btn--primary" onClick={handleSave}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
