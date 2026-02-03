import React, { useState } from 'react';
import type { ProviderAccount } from '../../../../src/core/types.js';

interface ProviderListProps {
  accounts: ProviderAccount[];
  onAdd: () => void;
  onEdit: (account: ProviderAccount) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

export const ProviderList: React.FC<ProviderListProps> = ({
  accounts,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDeleteClick = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleConfirmDelete = (id: string) => {
    onDelete(id);
    setDeleteConfirmId(null);
  };

  const handleCancelDelete = () => {
    setDeleteConfirmId(null);
  };

  const truncateUrl = (url: string, maxLength: number = 40): string => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  };

  return (
    <div className="ei-provider-list">
      {accounts.length === 0 ? (
        <div className="ei-provider-list__empty">
          <div className="ei-provider-list__empty-icon">🔌</div>
          <h3 className="ei-provider-list__empty-title">No Provider Accounts</h3>
          <p className="ei-provider-list__empty-text">
            Add your first LLM or storage provider to get started
          </p>
          <button className="ei-btn ei-btn--primary" onClick={onAdd}>
            Add Provider Account
          </button>
        </div>
      ) : (
        <>
          <div className="ei-provider-list__grid">
            {accounts.map((account) => {
              const isDeleting = deleteConfirmId === account.id;
              
              return (
                <div
                  key={account.id}
                  className={`ei-provider-card ${
                    !account.enabled ? 'ei-provider-card--disabled' : ''
                  } ${isDeleting ? 'ei-provider-card--deleting' : ''}`}
                >
                  {isDeleting ? (
                    <div className="ei-provider-card__delete-confirm">
                      <p className="ei-provider-card__delete-text">
                        Delete "{account.name}"?
                      </p>
                      <div className="ei-provider-card__delete-actions">
                        <button
                          className="ei-btn ei-btn--danger ei-btn--sm"
                          onClick={() => handleConfirmDelete(account.id)}
                        >
                          Delete
                        </button>
                        <button
                          className="ei-btn ei-btn--secondary ei-btn--sm"
                          onClick={handleCancelDelete}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="ei-provider-card__header">
                        <div className="ei-provider-card__title-row">
                          <h3 className="ei-provider-card__name">{account.name}</h3>
                          <span
                            className={`ei-provider-card__type ei-provider-card__type--${account.type}`}
                          >
                            {account.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="ei-provider-card__url" title={account.url}>
                          {truncateUrl(account.url)}
                        </div>
                      </div>

                      <div className="ei-provider-card__meta">
                        {account.type === 'llm' && account.default_model && (
                          <div className="ei-provider-card__meta-item">
                            <span className="ei-provider-card__meta-label">Model:</span>
                            <span className="ei-provider-card__meta-value">
                              {account.default_model}
                            </span>
                          </div>
                        )}
                        {account.api_key && (
                          <div className="ei-provider-card__meta-item">
                            <span className="ei-provider-card__meta-label">Auth:</span>
                            <span className="ei-provider-card__meta-value">
                              🔑 API Key
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="ei-provider-card__actions">
                        <label className="ei-provider-card__toggle">
                          <input
                            type="checkbox"
                            checked={account.enabled ?? true}
                            onChange={(e) => onToggle(account.id, e.target.checked)}
                            className="ei-provider-card__toggle-input"
                          />
                          <span className="ei-provider-card__toggle-label">
                            {account.enabled ?? true ? 'Enabled' : 'Disabled'}
                          </span>
                        </label>

                        <div className="ei-provider-card__action-buttons">
                          <button
                            className="ei-btn ei-btn--secondary ei-btn--sm"
                            onClick={() => onEdit(account)}
                          >
                            Edit
                          </button>
                          <button
                            className="ei-btn ei-btn--danger ei-btn--sm"
                            onClick={() => handleDeleteClick(account.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ei-provider-list__footer">
            <button className="ei-btn ei-btn--primary" onClick={onAdd}>
              + Add Provider Account
            </button>
          </div>
        </>
      )}
    </div>
  );
};
