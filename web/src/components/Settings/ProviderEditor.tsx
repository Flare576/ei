import React, { useState, useEffect, useRef } from 'react';
import { ProviderType, type ProviderAccount, type ModelConfig } from '../../../../src/core/types.js';
import { useOverlayClose } from '../../hooks/useOverlayClose';

const tokenFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const formatTokens = (n: number) => tokenFormatter.format(n);

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
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModelId, setDefaultModelId] = useState('');
  const [extraHeaders, setExtraHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [workflowJson, setWorkflowJson] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<string>('');

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
        setModels(account.models ?? []);
        setDefaultModelId(account.default_model || '');
        setWorkflowJson(account.workflow_json ? JSON.stringify(account.workflow_json, null, 2) : '');
        setExtraHeaders(
          account.extra_headers
            ? Object.entries(account.extra_headers).map(([key, value]) => ({ key, value }))
            : []
        );
      } else {
        setName('');
        setType(ProviderType.LLM);
        setUrl('');
        setApiKey('');
        setModels([]);
        setDefaultModelId('');
        setWorkflowJson('');
        setExtraHeaders([]);
        setShowAdvanced(false);
      }
      setErrors({});
      setJsonError('');
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

  const overlayProps = useOverlayClose(onClose);

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
    
    // Validate workflow JSON for image providers
    if (type === ProviderType.Image && workflowJson.trim()) {
      try {
        JSON.parse(workflowJson);
        setJsonError('');
      } catch {
        setJsonError('Invalid JSON format');
        return false;
      }
    }
    
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

    let finalModels = models.filter((m) => m.name.trim() !== '');
    let finalDefaultModel = defaultModelId;

    if (type === ProviderType.LLM) {
      if (finalModels.length === 0) {
        const defaultModel: ModelConfig = {
          id: crypto.randomUUID(),
          name: '(default)',
        };
        finalModels = [defaultModel];
        finalDefaultModel = defaultModel.id;
      }

      const defaultExists = finalModels.some((m) => m.id === finalDefaultModel);
      if (!finalDefaultModel || !defaultExists) {
        finalDefaultModel = finalModels[0].id;
      }
    }

    const updatedAccount: ProviderAccount = {
      id: account?.id || crypto.randomUUID(),
      name: name.trim(),
      type,
      url: url.trim(),
      api_key: apiKey.trim() || undefined,
      default_model: type === ProviderType.LLM && finalDefaultModel ? finalDefaultModel : undefined,
      models: type === ProviderType.LLM && finalModels.length > 0 ? finalModels : undefined,
      workflow_json: type === ProviderType.Image && workflowJson.trim() ? JSON.parse(workflowJson.trim()) : undefined,
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

  const handleAddModel = () => {
    const newModel: ModelConfig = {
      id: crypto.randomUUID(),
      name: '',
    };
    setModels([...models, newModel]);
    if (models.length === 0) {
      setDefaultModelId(newModel.id);
    }
  };

  const handleRemoveModel = (id: string) => {
    const updated = models.filter((m) => m.id !== id);
    setModels(updated);
    if (defaultModelId === id) {
      setDefaultModelId(updated.length > 0 ? updated[0].id : '');
    }
  };

  const handleModelChange = (id: string, field: keyof Pick<ModelConfig, 'name' | 'model_id' | 'token_limit' | 'max_output_tokens' | 'thinking_budget'>, value: string) => {
    setModels(models.map((m) => {
      if (m.id !== id) return m;
      if (field === 'name') {
        return { ...m, name: value };
      }
      if (field === 'model_id') {
        const trimmed = value.trim();
        return { ...m, model_id: trimmed === '' || trimmed === m.name ? undefined : trimmed };
      }
      if (field === 'thinking_budget') {
        if (value.trim() === '') return { ...m, thinking_budget: undefined };
        const numVal = parseInt(value.trim(), 10);
        return { ...m, thinking_budget: isNaN(numVal) ? undefined : numVal };
      }
      const numVal = value.trim() ? parseInt(value.trim(), 10) : undefined;
      return { ...m, [field]: isNaN(numVal as number) ? undefined : numVal };
    }));
  };

  return (
    <div className="ei-modal-overlay" {...overlayProps}>
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
              <option value={ProviderType.Image}>Image Provider</option>
            </select>
          </div>

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

          {type === ProviderType.Image && (
            <div className="ei-form-group">
              <label htmlFor="provider-workflow-json" className="ei-form-label">
                Workflow JSON <span className="ei-form-optional">(optional)</span>
              </label>
              <textarea
                id="provider-workflow-json"
                className={`ei-input ${jsonError ? 'ei-input--error' : ''}`}
                style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                value={workflowJson}
                onChange={(e) => {
                  setWorkflowJson(e.target.value);
                  // Clear error on edit
                  if (jsonError) setJsonError('');
                }}
                placeholder='{"9":{"inputs":{...}}}'
                rows={10}
              />
              {jsonError && <span className="ei-form-error">{jsonError}</span>}
              <small className="ei-form-hint">
                ComfyUI workflow template. Leave blank to use default workflow.
              </small>
            </div>
          )}

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
            <>
              {models.length > 0 && (
                <div className="ei-form-group">
                  <label htmlFor="provider-default-model" className="ei-form-label">
                    Default Model <span className="ei-form-optional">(optional)</span>
                  </label>
                  <select
                    id="provider-default-model"
                    className="ei-input ei-select"
                    value={defaultModelId}
                    onChange={(e) => setDefaultModelId(e.target.value)}
                  >
                    <option value="">— select a default —</option>
                    {models.filter((m) => m.name.trim() !== '').map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <small className="ei-form-hint">
                    Model used by default with this provider
                  </small>
                </div>
              )}

              <div className="ei-form-group">
                <label className="ei-form-label">
                  Models <span className="ei-form-optional">(optional)</span>
                </label>
                <div className="ei-provider-editor__models">
                  {models.map((model) => (
                    <div key={model.id} className="ei-provider-editor__model-card" style={{ position: 'relative' }}>
                      <button
                        className="ei-provider-editor__model-remove"
                        onClick={() => handleRemoveModel(model.id)}
                        type="button"
                        aria-label="Remove model"
                        title="Remove model"
                        style={{ position: 'absolute', top: '8px', right: '8px' }}
                      >
                        ✕
                      </button>
                      <div className="ei-provider-editor__model-token-fields">
                        <div className="ei-provider-editor__model-field">
                          <label className="ei-provider-editor__model-field-label">
                            Display name
                          </label>
                          <input
                            type="text"
                            className="ei-input ei-provider-editor__model-name"
                            value={model.name}
                            onChange={(e) => handleModelChange(model.id, 'name', e.target.value)}
                            placeholder="e.g., qwen/qwen3.5-35b-a3b"
                            aria-label="Model name"
                          />
                        </div>
                        <div className="ei-provider-editor__model-field">
                          <label className="ei-provider-editor__model-field-label">
                            API Model ID
                          </label>
                          <input
                            type="text"
                            className="ei-input"
                            value={model.model_id ?? ''}
                            onChange={(e) => handleModelChange(model.id, 'model_id', e.target.value)}
                            placeholder={model.name}
                            aria-label="API Model ID"
                          />
                          <small className="ei-provider-editor__model-field-hint">(defaults to name if blank)</small>
                        </div>
                      </div>
                      <div className="ei-provider-editor__model-token-fields">
                        <div className="ei-provider-editor__model-field">
                           <label className="ei-provider-editor__model-field-label">
                             Token limit <span className="ei-provider-editor__model-field-hint">(e.g., 128000)</span>
                           </label>
                           <input
                             type="number"
                             className="ei-input ei-provider-editor__model-context"
                             value={model.token_limit ?? ''}
                             onChange={(e) => handleModelChange(model.id, 'token_limit', e.target.value)}
                             min="1"
                             aria-label="Token limit"
                             title="Token limit"
                           />
                        </div>
                        <div className="ei-provider-editor__model-field">
                          <label className="ei-provider-editor__model-field-label">
                            Max output <span className="ei-provider-editor__model-field-hint">(e.g., 8000)</span>
                          </label>
                          <input
                            type="number"
                            className="ei-input ei-provider-editor__model-output"
                            value={model.max_output_tokens ?? ''}
                            onChange={(e) => handleModelChange(model.id, 'max_output_tokens', e.target.value)}
                            min="1"
                            aria-label="Max output tokens"
                            title="Max output tokens"
                          />
                         </div>
                      </div>
                      <div className="ei-provider-editor__model-field">
                        <label className="ei-provider-editor__model-field-label">
                          Thinking budget <span className="ei-provider-editor__model-field-hint">(tokens; 0 = disabled, blank = don't send)</span>
                        </label>
                        <input
                          type="number"
                          className="ei-input"
                          value={model.thinking_budget ?? ''}
                          onChange={(e) => handleModelChange(model.id, 'thinking_budget', e.target.value)}
                          min="0"
                          aria-label="Thinking budget"
                        />
                      </div>
                      {model.total_calls !== undefined && model.total_calls > 0 && (
                        <div className="ei-form-hint">
                          {formatTokens(model.total_calls)} calls · {formatTokens(model.total_tokens_in ?? 0)} in / {formatTokens(model.total_tokens_out ?? 0)} out tokens
                          {model.last_used ? ` · last used ${new Date(model.last_used).toLocaleDateString()}` : ''}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    className="ei-btn ei-btn--secondary ei-btn--sm"
                    onClick={handleAddModel}
                    type="button"
                  >
                    + Add Model
                  </button>
                </div>
                <small className="ei-form-hint">
                  Add models available from this provider. Context and Output limits are optional.
                </small>
              </div>
            </>
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
