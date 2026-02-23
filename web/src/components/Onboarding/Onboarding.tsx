import React, { useState, useEffect, useCallback } from 'react';
import { remoteSync } from '../../../../src/storage/remote.js';
import { ProviderType, type ProviderAccount } from '../../../../src/core/types.js';
import { ProviderList, ProviderEditor } from '../Settings';

enum OnboardingStep {
  Welcome = 0,
  LocalLLMCheck = 1,
  ProviderSetup = 2,
  Complete = 3,
}

interface OnboardingProps {
  onComplete: (
    accounts: ProviderAccount[],
    syncCredentials?: { username: string; passphrase: string },
  ) => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState<OnboardingStep>(OnboardingStep.Welcome);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [editingAccount, setEditingAccount] = useState<ProviderAccount | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [localUrl, setLocalUrl] = useState('http://127.0.0.1:1234/v1');
  const [isCheckingLocal, setIsCheckingLocal] = useState(false);
  const [localCheckResult, setLocalCheckResult] = useState<'pending' | 'success' | 'cors' | 'failed'>('pending');

  const goToStep = (newStep: OnboardingStep) => {
    setStep(newStep);
  };

  const handleExistingAccountSubmit = useCallback(async () => {
    if (!username.trim() || !passphrase.trim()) {
      setSyncError('Please enter both username and passphrase');
      return;
    }
    setIsSyncing(true);
    setSyncError(null);
    try {
      await remoteSync.configure({ username: username.trim(), passphrase: passphrase.trim() });
      const remoteInfo = await remoteSync.checkRemote();
      if (!remoteInfo.exists) {
        setSyncError('No saved data found for this account. Try a different username/passphrase, or start fresh.');
        setIsSyncing(false);
        return;
      }

      // Creds validated — remote exists. Let processor.start() handle the actual pull.
      onComplete(
        [],
        { username: username.trim(), passphrase: passphrase.trim() },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setSyncError(`Sync failed: ${message}`);
      setIsSyncing(false);
    }
  }, [username, passphrase, onComplete]);

  const checkLocalLLM = useCallback(async () => {
    setIsCheckingLocal(true);
    setLocalCheckResult('pending');

    try {
      await fetch(localUrl, { mode: 'no-cors', cache: 'no-store' });
    } catch {
      setLocalCheckResult('failed');
      setIsCheckingLocal(false);
      return;
    }

    try {
      const response = await fetch(`${localUrl}/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        setLocalCheckResult('success');
        const localAccount: ProviderAccount = {
          id: crypto.randomUUID(),
          name: 'Local LLM',
          type: ProviderType.LLM,
          url: localUrl,
          enabled: true,
          created_at: new Date().toISOString(),
        };
        setAccounts([localAccount]);
      } else {
        setLocalCheckResult('failed');
      }
    } catch {
      setLocalCheckResult('cors');
    } finally {
      setIsCheckingLocal(false);
    }
  }, [localUrl]);

  const handleProviderSave = useCallback((account: ProviderAccount) => {
    setAccounts(prev => {
      const existing = prev.findIndex(a => a.id === account.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = account;
        return updated;
      }
      return [...prev, account];
    });
    setShowEditor(false);
    setEditingAccount(null);
  }, []);

  const handleProviderDelete = useCallback((id: string) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleProviderToggle = useCallback((id: string, enabled: boolean) => {
    setAccounts(prev =>
      prev.map(a => (a.id === id ? { ...a, enabled } : a))
    );
  }, []);

  const handleComplete = useCallback(() => {
    onComplete(accounts);
  }, [accounts, onComplete]);

  useEffect(() => {
    if (step === OnboardingStep.LocalLLMCheck && localCheckResult === 'pending') {
      checkLocalLLM();
    }
  }, [step, localCheckResult, checkLocalLLM]);

  const renderHero = () => (
    <>
      <div className="ei-onboarding__logo">
        <span className="ei-onboarding__logo-text">Ei</span>
      </div>
      
      <h1 className="ei-onboarding__title">Welcome to Ei</h1>
      <p className="ei-onboarding__subtitle">Your Local-First AI Companion</p>
    </>
  );
  // Info sections shown on Welcome and LocalLLMCheck only
  const renderInfoSections = () => (
    <>
      <div className="ei-onboarding__section">
        <h2>What Makes Ei Different</h2>
        <p>
          Unlike ChatGPT, Claude, or other cloud-based AI assistants, Ei is built on three core principles:
        </p>

        <div className="ei-onboarding__feature">
          <div className="ei-onboarding__feature-icon">🔒</div>
          <div className="ei-onboarding__feature-text">
            <strong>Privacy-First</strong>
            <p>
              Your conversations, your data, your memories - all stored locally on your device. 
              No corporation is training on your innermost thoughts. When you sync across devices, 
              your data is encrypted <em>before</em> it leaves your machine using a key only you know.
            </p>
          </div>
        </div>

        <div className="ei-onboarding__feature">
          <div className="ei-onboarding__feature-icon">💻</div>
          <div className="ei-onboarding__feature-text">
            <strong>Local-First</strong>
            <p>
              Run your own AI models on your hardware, or connect to cloud providers - your choice.
              No internet required for local models. Your data lives in your browser's storage, 
              not on someone else's server.
            </p>
          </div>
        </div>

        <div className="ei-onboarding__feature">
          <div className="ei-onboarding__feature-icon">🧠</div>
          <div className="ei-onboarding__feature-text">
            <strong>You-nified Context</strong>
            <p>
              Create multiple AI personas - each with their own personality, interests, and relationship with you.
              But <em>you</em> are the constant. Ei learns about you - your interests, the people in your life, 
              what matters to you - and shares that context across all your personas. One unified "you" across 
              unlimited conversations.
            </p>
          </div>
        </div>
      </div>

      <div className="ei-onboarding__section">
        <h2>How It Works</h2>
        <p>
          Ei runs entirely in your browser. It connects to LLM providers (local or cloud) to power conversations,
          but all your personal data - facts about you, your personality traits, the topics you care about, 
          the people in your life - stays on your device.
        </p>
        <p>
          As you chat with Ei and other personas, they learn about you. This isn't just chat history - 
          it's structured knowledge that persists and grows. Your future conversations are richer because 
          the AI actually <em>knows</em> you.
        </p>
      </div>

      <div className="ei-onboarding__section">
        <h2>Meet Your Guide</h2>
        <p>
          <strong>Ei</strong> (pronounced "eye" or "ee-eye") is your system guide and personal companion.
          They're curious and genuinely interested in getting to know you. Ei sees everything 
          across all your personas and helps you navigate the system.
        </p>
        <p>
          Later, you can create additional personas - a creative writing partner, a coding mentor, 
          a philosophical debate opponent - each with their own personality. But Ei is always there, 
          watching over everything, making sure the system serves <em>you</em>.
        </p>
      </div>
    </>
  );

  const renderWelcome = () => (
    <div className="ei-onboarding__content">
      {renderHero()}
      {/* Returning user sync form */}
      <div className="ei-onboarding__sync-section">
        <h3 className="ei-onboarding__sync-title">Restore from another device?</h3>
        <div className="ei-onboarding__sync-form">
          <input
            type="text"
            className="ei-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            disabled={isSyncing}
          />
          <input
            type="password"
            className="ei-input"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            disabled={isSyncing}
          />
          <button
            className="ei-btn ei-btn--secondary"
            onClick={handleExistingAccountSubmit}
            disabled={isSyncing || !username.trim() || !passphrase.trim()}
          >
            {isSyncing ? 'Syncing...' : 'Restore'}
          </button>
        </div>
        {syncError && (
          <div className="ei-onboarding__error">
            {syncError}
          </div>
        )}
      </div>

      {/* Start fresh CTA */}
      <div className="ei-onboarding__fresh-section">
        <div className="ei-onboarding__divider">
          <span>or</span>
        </div>
        <button
          className="ei-btn ei-btn--primary ei-btn--lg"
          onClick={() => goToStep(OnboardingStep.LocalLLMCheck)}
        >
          ✨ Start Fresh
        </button>
        <p className="ei-onboarding__fresh-hint">
          No sign in required — your data stays on this device
        </p>
      </div>

    </div>
  );

  const renderLocalLLMCheck = () => (
    <div className="ei-onboarding__content">
      {renderHero()}
      <div className="ei-onboarding__llm-check">
        {localCheckResult === 'success' && (
          <div className="ei-onboarding__status ei-onboarding__status--success">
            <div className="ei-onboarding__status-icon">✅</div>
            <div>
              <strong>Local LLM found!</strong>
              <p>Great! We detected a local AI model. You're all set to use Ei privately with your own hardware.</p>
            </div>
          </div>
        )}

        {localCheckResult === 'cors' && (
          <div className="ei-onboarding__status ei-onboarding__status--warning">
            <div className="ei-onboarding__status-icon">⚠️</div>
            <div>
              <strong>CORS Issue Detected</strong>
              <p>
                We found something at that address, but browser security is blocking the connection.
                If you're using <strong>LM Studio</strong>, go to the Local Server tab and enable 
                "Enable CORS" toggle, then click Check again.
              </p>
            </div>
          </div>
        )}

        {localCheckResult === 'failed' && (
          <div className="ei-onboarding__status ei-onboarding__status--info">
            <div className="ei-onboarding__status-icon">ℹ️</div>
            <div>
              <strong>No local LLM detected</strong>
              <p>
                That's okay! You can use cloud providers like OpenAI, Anthropic, or Google instead.
                Or you can set up a local model later (we recommend <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">LM Studio</a>).
              </p>
            </div>
          </div>
        )}
        <div className="ei-form-group">
          <label htmlFor="local-url" className="ei-form-label">
            Local LLM URL
          </label>
          <div className="ei-onboarding__url-row">
            <input
              id="local-url"
              type="text"
              className="ei-input"
              value={localUrl}
              onChange={(e) => {
                setLocalUrl(e.target.value);
                setLocalCheckResult('pending');
              }}
              placeholder="http://127.0.0.1:1234/v1"
              disabled={isCheckingLocal}
            />
            <button
              className="ei-btn ei-btn--secondary"
              onClick={checkLocalLLM}
              disabled={isCheckingLocal}
            >
              {isCheckingLocal ? 'Checking...' : 'Check'}
            </button>
          </div>
        </div>

      </div>

      {renderInfoSections()}

      <div className="ei-onboarding__actions">
        <button
          className="ei-btn ei-btn--secondary"
          onClick={() => goToStep(OnboardingStep.Welcome)}
        >
          ← Back
        </button>
        {localCheckResult === 'success' ? (
          <>
            <button
              className="ei-btn ei-btn--secondary"
              onClick={() => goToStep(OnboardingStep.ProviderSetup)}
            >
              Add Another Provider
            </button>
            <button
              className="ei-btn ei-btn--primary"
              onClick={() => goToStep(OnboardingStep.Complete)}
            >
              Continue
            </button>
          </>
        ) : (
          <button
            className="ei-btn ei-btn--primary"
            onClick={() => goToStep(OnboardingStep.ProviderSetup)}
          >
            Set Up Providers
          </button>
        )}
      </div>

    </div>
  );

  const renderProviderSetup = () => (
    <div className="ei-onboarding__content">
      <h1 className="ei-onboarding__title">LLM Providers</h1>
      <p className="ei-onboarding__subtitle">
        {accounts.length === 0
          ? 'Add at least one AI provider to power your conversations'
          : 'Manage your AI providers. You can add more or edit these later in Settings.'}
      </p>

      <div className="ei-onboarding__providers">
        <ProviderList
          accounts={accounts}
          onAdd={() => {
            setEditingAccount(null);
            setShowEditor(true);
          }}
          onEdit={(account) => {
            setEditingAccount(account);
            setShowEditor(true);
          }}
          onDelete={handleProviderDelete}
          onToggle={handleProviderToggle}
        />
      </div>

      <div className="ei-onboarding__provider-hints">
        <p>
          <strong>Popular options:</strong>
        </p>
        <ul>
          <li><strong>Local:</strong> LM Studio at <code>http://127.0.0.1:1234/v1</code></li>
          <li><strong>OpenAI:</strong> <code>https://api.openai.com/v1</code> (requires API key)</li>
          <li><strong>Anthropic:</strong> <code>https://api.anthropic.com/v1</code> (requires API key)</li>
          <li><strong>Google:</strong> <code>https://generativelanguage.googleapis.com/v1beta</code> (requires API key)</li>
        </ul>
      </div>

      <div className="ei-onboarding__actions">
        <button
          className="ei-btn ei-btn--secondary"
          onClick={() => goToStep(OnboardingStep.LocalLLMCheck)}
        >
          ← Back
        </button>
        <button
          className="ei-btn ei-btn--primary"
          onClick={() => goToStep(OnboardingStep.Complete)}
          disabled={accounts.length === 0}
        >
          {accounts.length === 0 ? 'Add a Provider First' : 'Continue'}
        </button>
      </div>

      <ProviderEditor
        isOpen={showEditor}
        account={editingAccount}
        onSave={handleProviderSave}
        onClose={() => {
          setShowEditor(false);
          setEditingAccount(null);
        }}
      />
    </div>
  );

  const renderComplete = () => (
    <div className="ei-onboarding__content">
      <div className="ei-onboarding__complete-icon">🎉</div>
      
      <h1 className="ei-onboarding__title">You're All Set!</h1>
      <p className="ei-onboarding__subtitle">
        Ei is ready to meet you.
      </p>

      <div className="ei-onboarding__complete-summary">
        <p>
          You've configured <strong>{accounts.length}</strong> LLM provider{accounts.length !== 1 ? 's' : ''}.
        </p>
        <p>
          Ei will introduce themselves and start learning about you. Take your time - 
          there's no rush. Everything you share stays private and local.
        </p>
      </div>

      <div className="ei-onboarding__tip">
        <strong>Pro tip:</strong> Later, go to Settings (gear icon) to set up device sync. 
        This lets you access Ei from multiple devices while keeping your data encrypted.
      </div>

      <div className="ei-onboarding__actions">
        <button
          className="ei-btn ei-btn--secondary"
          onClick={() => goToStep(OnboardingStep.ProviderSetup)}
        >
          ← Back
        </button>
        <button
          className="ei-btn ei-btn--primary ei-btn--lg"
          onClick={handleComplete}
        >
          Meet Ei →
        </button>
      </div>
    </div>
  );

  const renderStep = () => {
    switch (step) {
      case OnboardingStep.Welcome:
        return renderWelcome();
      case OnboardingStep.LocalLLMCheck:
        return renderLocalLLMCheck();
      case OnboardingStep.ProviderSetup:
        return renderProviderSetup();
      case OnboardingStep.Complete:
        return renderComplete();
      default:
        return renderWelcome();
    }
  };

  const getStepNumber = () => {
    switch (step) {
      case OnboardingStep.Welcome:
        return 1;
      case OnboardingStep.LocalLLMCheck:
        return 2;
      case OnboardingStep.ProviderSetup:
        return 3;
      case OnboardingStep.Complete:
        return 4;
      default:
        return 1;
    }
  };

  return (
    <div className="ei-onboarding">
      <div className="ei-onboarding__progress">
        <div className="ei-onboarding__progress-bar">
          <div
            className="ei-onboarding__progress-fill"
            style={{ width: `${(getStepNumber() / 4) * 100}%` }}
          />
        </div>
        <div className="ei-onboarding__progress-text">
          Step {getStepNumber()} of 4
        </div>
      </div>

      <div className="ei-onboarding__container">
        {renderStep()}
      </div>
    </div>
  );
};

export default Onboarding;
