import { SlackAuthButton } from '../../Settings/SlackAuthButton';

interface HumanExternalTabProps {
  slackAuth?: { token?: string; workspace_name?: string };
  onSlackConnect: () => void;
  onSlackDisconnect: () => void;
}

export const HumanExternalTab = ({
  slackAuth,
  onSlackConnect: _onSlackConnect,
  onSlackDisconnect,
}: HumanExternalTabProps) => {
  const isConnected = Boolean(slackAuth?.token);

  return (
    <div className="ei-settings-form">
      <div className="ei-settings-section">
        <h3 className="ei-settings-section__title">Slack</h3>
        <div className="ei-form-group">
          <SlackAuthButton
            isConnected={isConnected}
            workspaceName={slackAuth?.workspace_name}
            onDisconnect={onSlackDisconnect}
          />
          <p className="ei-form-hint" style={{ marginTop: 'var(--ei-space-3, 12px)' }}>
            Slack conversations will be indexed automatically once connected. Enable in /settings.
          </p>
        </div>
      </div>
    </div>
  );
};
