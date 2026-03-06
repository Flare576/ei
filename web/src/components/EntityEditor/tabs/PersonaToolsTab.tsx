import React from 'react';
import type { ToolProvider, ToolDefinition } from '../../../../../src/core/types.js';

interface PersonaToolsTabProps {
  assignedToolIds: string[];
  providers: ToolProvider[];
  tools: ToolDefinition[];
  onUpdate: (toolIds: string[]) => void;
}

export const PersonaToolsTab: React.FC<PersonaToolsTabProps> = ({
  assignedToolIds,
  providers,
  tools,
  onUpdate,
}) => {
  // Only show tools where tool.enabled AND provider.enabled
  const enabledProviderIds = new Set(
    providers.filter((p) => p.enabled).map((p) => p.id)
  );
  const visibleTools = tools.filter(
    (t) => t.enabled && enabledProviderIds.has(t.provider_id)
  );

  // Group visible tools by provider
  const toolsByProvider = providers
    .filter((p) => p.enabled)
    .map((p) => ({
      provider: p,
      tools: visibleTools.filter((t) => t.provider_id === p.id),
    }))
    .filter((group) => group.tools.length > 0);

  const handleToggle = (toolId: string, checked: boolean) => {
    const next = checked
      ? [...assignedToolIds, toolId]
      : assignedToolIds.filter((id) => id !== toolId);
    onUpdate(next);
  };

  if (toolsByProvider.length === 0) {
    return (
      <div className="ei-settings-form">
        <div className="ei-provider-list__empty">
          <div className="ei-provider-list__empty-icon">🔧</div>
          <h3 className="ei-provider-list__empty-title">No Tools Available</h3>
          <p className="ei-provider-list__empty-text">
            Enable tool providers and their tools in Settings → Toolkits to make them
            available here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ei-settings-form">
      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Assigned Tools</h3>
        <p className="ei-settings-section__description">
          Check a tool to give this persona access to it during conversations.
        </p>

        {toolsByProvider.map(({ provider, tools: providerTools }) => {
          const isBrave = provider.name === 'brave';
          const hasApiKey =
            provider.config &&
            Object.keys(provider.config).some(
              (k) => k === 'api_key' && provider.config[k]
            );
          const showApiWarning = isBrave && !hasApiKey;

          return (
            <div key={provider.id} className="ei-toolkit-group">
              <div className="ei-toolkit-group__header">
                <span className="ei-toolkit-group__name">{provider.display_name}</span>
                {showApiWarning && (
                  <span className="ei-toolkit-warning ei-toolkit-warning--inline">
                    ⚠️ No API key — web search may fail
                  </span>
                )}
              </div>

              <div className="ei-toolkit-group__tools">
                {providerTools.map((tool) => {
                  const isAssigned = assignedToolIds.includes(tool.id);
                  return (
                    <label
                      key={tool.id}
                      className={`ei-toolkit-tool-checkbox ${showApiWarning ? 'ei-toolkit-tool-checkbox--dim' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="ei-checkbox"
                        checked={isAssigned}
                        onChange={(e) => handleToggle(tool.id, e.target.checked)}
                      />
                      <span className="ei-toolkit-tool__name">{tool.display_name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};
