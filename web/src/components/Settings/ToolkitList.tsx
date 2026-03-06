import React, { useState, useEffect } from 'react';
import type { ToolProvider, ToolDefinition } from '../../../../src/core/types.js';

interface ToolkitListProps {
  providers: ToolProvider[];
  tools: ToolDefinition[];
  onEdit: (provider: ToolProvider) => void;
  onDelete: (id: string) => void;
  onToggleProvider: (id: string, enabled: boolean) => void;
  onToggleTool: (id: string, enabled: boolean) => void;
}

export const ToolkitList: React.FC<ToolkitListProps> = ({
  providers,
  tools,
  onEdit,
  onDelete,
  onToggleProvider,
  onToggleTool,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Optimistic local state for enabled toggles — avoids stale prop after click
  const [providerEnabled, setProviderEnabled] = useState<Record<string, boolean>>({});
  const [toolEnabled, setToolEnabled] = useState<Record<string, boolean>>({});

  // Sync from props (covers initial load and external updates)
  useEffect(() => {
    setProviderEnabled(Object.fromEntries(providers.map((p) => [p.id, p.enabled])));
  }, [providers]);

  useEffect(() => {
    setToolEnabled(Object.fromEntries(tools.map((t) => [t.id, t.enabled])));
  }, [tools]);

  const getProviderTools = (providerId: string): ToolDefinition[] =>
    tools.filter((t) => t.provider_id === providerId);

  const handleToggleProvider = (id: string, enabled: boolean) => {
    setProviderEnabled((prev) => ({ ...prev, [id]: enabled }));
    onToggleProvider(id, enabled);
  };

  const handleToggleTool = (id: string, enabled: boolean) => {
    setToolEnabled((prev) => ({ ...prev, [id]: enabled }));
    onToggleTool(id, enabled);
  };

  const handleDeleteClick = (id: string) => setDeleteConfirmId(id);
  const handleConfirmDelete = (id: string) => { onDelete(id); setDeleteConfirmId(null); };
  const handleCancelDelete = () => setDeleteConfirmId(null);

  if (providers.length === 0) {
    return (
      <div className="ei-provider-list">
        <div className="ei-provider-list__empty">
          <div className="ei-provider-list__empty-icon">🔧</div>
          <h3 className="ei-provider-list__empty-title">No Tool Kits</h3>
          <p className="ei-provider-list__empty-text">
            No tool providers are configured yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ei-provider-list">
      <div className="ei-provider-list__grid">
        {providers.map((provider) => {
          const isDeleting = deleteConfirmId === provider.id;
          const providerTools = getProviderTools(provider.id);
          const isProviderEnabled = providerEnabled[provider.id] ?? provider.enabled;
          const hasApiKey = provider.config && Object.keys(provider.config).some(
            (k) => k === 'api_key' && provider.config[k]
          );
          const isBrave = provider.name === 'brave';

          return (
            <div
              key={provider.id}
              className={`ei-provider-card ei-provider-card--toolkit ${
                !isProviderEnabled ? 'ei-provider-card--disabled' : ''
              } ${isDeleting ? 'ei-provider-card--deleting' : ''}`}
            >
              {isDeleting ? (
                <div className="ei-provider-card__delete-confirm">
                  <p className="ei-provider-card__delete-text">
                    Delete "{provider.display_name}"?
                  </p>
                  <div className="ei-provider-card__delete-actions">
                    <button
                      className="ei-btn ei-btn--danger ei-btn--sm"
                      onClick={() => handleConfirmDelete(provider.id)}
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
                      <h3 className="ei-provider-card__name">
                        {provider.display_name}
                        {provider.builtin && (
                          <span className="ei-toolkit-badge ei-toolkit-badge--builtin">
                            🔒 Built-in
                          </span>
                        )}
                      </h3>
                    </div>
                    {isBrave && !hasApiKey && (
                      <div className="ei-toolkit-warning">
                        ⚠️ Add API key to enable web search
                      </div>
                    )}
                  </div>

                  <div className="ei-toolkit-tools">
                    {providerTools.length === 0 ? (
                      <div className="ei-toolkit-tools__empty">No tools in this kit</div>
                    ) : (
                      providerTools.map((tool) => {
                        const isToolEnabled = toolEnabled[tool.id] ?? tool.enabled;
                        return (
                          <div
                            key={tool.id}
                            className={`ei-toolkit-tool ${!isToolEnabled ? 'ei-toolkit-tool--disabled' : ''}`}
                          >
                            <span className="ei-toolkit-tool__name">{tool.display_name}</span>
                            <label className="ei-provider-card__toggle">
                              <input
                                type="checkbox"
                                checked={isToolEnabled}
                                onChange={(e) => handleToggleTool(tool.id, e.target.checked)}
                                className="ei-provider-card__toggle-input"
                              />
                              <span className="ei-provider-card__toggle-label">Enabled</span>
                            </label>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="ei-provider-card__actions">
                    <label className="ei-provider-card__toggle">
                      <input
                        type="checkbox"
                        checked={isProviderEnabled}
                        onChange={(e) => handleToggleProvider(provider.id, e.target.checked)}
                        className="ei-provider-card__toggle-input"
                      />
                      <span className="ei-provider-card__toggle-label">Enabled</span>
                    </label>

                    <div className="ei-provider-card__action-buttons">
                      <button
                        className="ei-btn ei-btn--primary ei-btn--sm"
                        onClick={() => onEdit(provider)}
                      >
                        Edit
                      </button>
                      {!provider.builtin && (
                        <button
                          className="ei-btn ei-btn--danger ei-btn--sm"
                          onClick={() => handleDeleteClick(provider.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
