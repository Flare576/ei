import React, { useState, useEffect, useRef } from 'react';
import { ProviderType, type ProviderAccount } from '../../../../src/core/types.js';

interface ProviderEditorProps {
  isOpen: boolean;
  account: ProviderAccount | null;
  onSave: (account: ProviderAccount) => void;
  onClose: () => void;
}

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  isOpen,
  account,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProviderType>(ProviderType.LLM);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [extraHeaders, setExtraHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  const isNewAccount = !account;

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (account) {
        setName(account.name);
        setType(account.type);
        setUrl(account.url);
        setApiKey(account.api_key || '');
        setDefaultModel(account.default_model || '');
        setExtraHeaders(
          account.extra_headers
            ? Object.entries(account.extra_headers).map(([key, value]) => ({ key, value }))
            : []
        );
        setShowAdvanced(!!account.extra_headers && Object.keys(account.extra_headers).length > 0);
      } else {
        setName('');
        setType(ProviderType.LLM);
        setUrl('');
        setApiKey('');
        setDefaultModel('');
        setExtraHeaders([]);
        setShowAdvanced(false);
      }
      setErrors({});
    }
  }, [isOpen, account]);

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

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!url.trim()) {
      newErrors.url = 'URL is required';
    } else {
      try {
        new URL(url);
      } catch {
        newErrors.url = 'Invalid URL format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const extraHeadersObj: Record<string, string> = {};
    extraHeaders.forEach(({ key, value }) => {
      if (key.trim() && value.trim()) {
        extraHeadersObj[key.trim()] = value.trim();
      }
    });

    const updatedAccount: ProviderAccount = {
      id: account?.id || crypto.randomUUID(),
      name: name.trim(),
      type,
      url: url.trim(),
      api_key: apiKey.trim() || undefined,
      default_model: type === ProviderType.LLM && defaultModel.trim() ? defaultModel.trim() : undefined,
      extra_headers: Object.keys(extraHeadersObj).length > 0 ? extraHeadersObj : undefined,
      enabled: account?.enabled ?? true,
      created_at: account?.created_at || new Date().toISOString(),
    };

    onSave(updatedAccount);
  };

  const handleAddHeader = () => {
    setExtraHeaders([...extraHeaders, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setExtraHeaders(extraHeaders.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...extraHeaders];
    updated[index][field] = value;
    setExtraHeaders(updated);
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
        aria-labelledby="provider-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ei-provider-editor__header">
          <h2 id="provider-editor-title" className="ei-provider-editor__title">
            {isNewAccount ? 'Add Provider Account' : 'Edit Provider Account'}
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
            <label htmlFor="provider-name" className="ei-form-label">
              Name <span className="ei-form-required">*</span>
            </label>
            <input
              id="provider-name"
              type="text"
              className={`ei-input ${errors.name ? 'ei-input--error' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., OpenAI, Local LLM, AWS S3"
            />
            {errors.name && <span className="ei-form-error">{errors.name}</span>}
          </div>

          {/* Type selector hidden for V1 - only LLM providers supported
              Storage providers will be added in V3 (requires OAuth flows, etc.)
              Keeping the field in the schema for future use */}
          {false && (
          <div className="ei-form-group">
            <label htmlFor="provider-type" className="ei-form-label">
              Type <span className="ei-form-required">*</span>
            </label>
            <select
              id="provider-type"
              className="ei-input ei-select"
              value={type}
              onChange={(e) => setType(e.target.value as ProviderType)}
            >
              <option value={ProviderType.LLM}>LLM Provider</option>
              <option value={ProviderType.Storage}>Storage Provider</option>
            </select>
          </div>
          )}

          <div className="ei-form-group">
            <label htmlFor="provider-url" className="ei-form-label">
              URL <span className="ei-form-required">*</span>
            </label>
            <input
              id="provider-url"
              type="text"
              className={`ei-input ${errors.url ? 'ei-input--error' : ''}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g., http://127.0.0.1:1234/v1 or https://api.openai.com/v1"
            />
            {errors.url && <span className="ei-form-error">{errors.url}</span>}
          </div>

          <div className="ei-form-group">
            <label htmlFor="provider-api-key" className="ei-form-label">
              API Key <span className="ei-form-optional">(optional)</span>
            </label>
            <input
              id="provider-api-key"
              type="password"
              className="ei-input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Leave blank if not required"
              autoComplete="off"
            />
          </div>

          {type === ProviderType.LLM && (
            <div className="ei-form-group">
              <label htmlFor="provider-default-model" className="ei-form-label">
                Default Model <span className="ei-form-optional">(optional)</span>
              </label>
              <input
                id="provider-default-model"
                type="text"
                className="ei-input"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="e.g., gpt-4o, llama-3.3-70b"
              />
              <small className="ei-form-hint">
                Model name to use by default with this provider
              </small>
            </div>
          )}

          <div className="ei-provider-editor__advanced">
            <button
              className="ei-provider-editor__advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
              type="button"
            >
              <span className="ei-provider-editor__advanced-icon">
                {showAdvanced ? '▼' : '▶'}
              </span>
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className="ei-provider-editor__advanced-content">
                <div className="ei-form-group">
                  <label className="ei-form-label">
                    Extra Headers <span className="ei-form-optional">(optional)</span>
                  </label>
                  <div className="ei-provider-editor__headers">
                    {extraHeaders.map((header, index) => (
                      <div key={index} className="ei-provider-editor__header-row">
                        <input
                          type="text"
                          className="ei-input ei-provider-editor__header-key"
                          value={header.key}
                          onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                          placeholder="Header name"
                        />
                        <input
                          type="text"
                          className="ei-input ei-provider-editor__header-value"
                          value={header.value}
                          onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                          placeholder="Header value"
                        />
                        <button
                          className="ei-btn ei-btn--danger ei-btn--sm"
                          onClick={() => handleRemoveHeader(index)}
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      className="ei-btn ei-btn--secondary ei-btn--sm"
                      onClick={handleAddHeader}
                      type="button"
                    >
                      + Add Header
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="ei-provider-editor__footer">
          <button className="ei-btn ei-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ei-btn ei-btn--primary" onClick={handleSave}>
                        {isNewAccount ? 'Save Provider' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
