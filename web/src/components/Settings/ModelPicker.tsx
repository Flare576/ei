import React from 'react';
import type { ProviderAccount } from '../../../../src/core/types';

interface ModelPickerProps {
  value: string | undefined;
  onChange: (modelId: string | undefined) => void;
  accounts: ProviderAccount[];
  label: string;
  id: string;
  allowEmpty?: boolean;
  hint?: string;
  optionalLabel?: boolean;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  value,
  onChange,
  accounts,
  label,
  id,
  allowEmpty = false,
  hint,
  optionalLabel = false,
}) => {
  const enabledLlmAccounts = accounts.filter(
    (a) => a.enabled !== false && a.type === 'llm' && a.models && a.models.length > 0
  );

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    onChange(val === '' ? undefined : val);
  };

  return (
    <div className="ei-form-group">
      <label htmlFor={id} className="ei-form-label">
        {label}
        {optionalLabel && (
          <span className="ei-form-optional"> (optional)</span>
        )}
      </label>
      <select
        id={id}
        className="ei-input ei-select"
        value={value ?? ''}
        onChange={handleChange}
      >
        {allowEmpty && (
          <option value="">None</option>
        )}
        {!allowEmpty && !value && (
          <option value="" disabled>
            — select a model —
          </option>
        )}
        {enabledLlmAccounts.map((account) => (
          <optgroup key={account.id} label={account.name}>
            {(account.models ?? []).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {hint && <small className="ei-form-hint">{hint}</small>}
    </div>
  );
};
