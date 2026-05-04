import { useState, useRef } from 'react';

interface DocumentRecord {
  created_at: string;
  type: "imported" | "generated";
  subject?: string;
}

interface HumanDocumentsTabProps {
  allDocuments: Record<string, DocumentRecord>;
  pendingDocuments: Array<{ batchId: string; filename: string; count: number }>;
  extractingDocuments: string[];
  onImport: (file: File) => Promise<void>;
  onUnsource: (sourceOrFilename: string) => Promise<void>;
  generatingDocuments: string[];
  onGenerate: (subject: string) => Promise<void>;
  onDownloadGenerated: (slug: string) => Promise<void>;
  checkGenerationModel: () => { model: string; isRewriteModel: boolean };
}

const slugToSubject = (slug: string): string => {
  const underscoreIdx = slug.lastIndexOf('_');
  const base = underscoreIdx >= 0 ? slug.slice(0, underscoreIdx) : slug;
  return base.replace(/-/g, ' ');
};

export const HumanDocumentsTab = ({
  allDocuments,
  pendingDocuments,
  extractingDocuments,
  onImport,
  onUnsource,
  generatingDocuments,
  onGenerate,
  onDownloadGenerated,
  checkGenerationModel,
}: HumanDocumentsTabProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [confirmingFilename, setConfirmingFilename] = useState<string | null>(null);
  const [unsourcing, setUnsourcing] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const [generateInput, setGenerateInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showModelWarning, setShowModelWarning] = useState(false);
  const [pendingGenerateSubject, setPendingGenerateSubject] = useState<string | null>(null);
  const [confirmingGeneratedSlug, setConfirmingGeneratedSlug] = useState<string | null>(null);
  const [deletingGeneratedSlug, setDeletingGeneratedSlug] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportStatus(`Importing ${file.name}...`);
    try {
      await onImport(file);
      setImportStatus(`${file.name} imported successfully.`);
    } catch {
      setImportStatus(`Import failed for ${file.name}.`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUnsourceConfirm = async (filename: string) => {
    setUnsourcing(filename);
    setConfirmingFilename(null);
    try {
      await onUnsource(filename);
      setNotification('Knowledge removed. Invoice downloaded.');
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setUnsourcing(null);
    }
  };

  const doGenerate = async (subject: string) => {
    setIsGenerating(true);
    setShowModelWarning(false);
    setPendingGenerateSubject(null);
    try {
      await onGenerate(subject);
      setGenerateInput('');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateClick = () => {
    const subject = generateInput.trim();
    if (!subject) return;
    const { isRewriteModel } = checkGenerationModel();
    if (!isRewriteModel) {
      setPendingGenerateSubject(subject);
      setShowModelWarning(true);
      return;
    }
    doGenerate(subject);
  };

  const handleDeleteGeneratedConfirm = async (slug: string) => {
    setDeletingGeneratedSlug(slug);
    setConfirmingGeneratedSlug(null);
    try {
      await onUnsource(`generate:document:${slug}`);
      setNotification('Generated document removed.');
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setDeletingGeneratedSlug(null);
    }
  };

  const pendingEntries = pendingDocuments;
  const sortedDocs = Object.entries(allDocuments).sort(
    ([, a], [, b]) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const processedEntries = sortedDocs.filter(([, r]) => r.type === "imported");
  const generatedEntries = sortedDocs.filter(([, r]) => r.type === "generated");

  return (
    <div className="ei-settings-form">

      <div className="ei-settings-section">
        <h3 className="ei-settings-section__title">Generate Document</h3>
        <div className="ei-form-group">
          <p className="ei-form-hint">
            Generate a markdown document from your knowledge base about a specific topic.
          </p>
          <div style={{ display: 'flex', gap: 'var(--ei-space-2, 8px)', alignItems: 'flex-start' }}>
            <input
              className="ei-input"
              type="text"
              value={generateInput}
              onChange={e => setGenerateInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && generateInput.trim()) handleGenerateClick(); }}
              placeholder="Describe what to generate (e.g. 'everything about the Uniform service')"
              disabled={isGenerating}
              style={{ flex: 1 }}
            />
            <button
              className="ei-btn ei-btn--primary"
              onClick={handleGenerateClick}
              disabled={!generateInput.trim() || isGenerating}
              style={{ alignSelf: 'flex-start', flexShrink: 0 }}
            >
              {isGenerating ? 'Queued...' : 'Generate'}
            </button>
          </div>
          {showModelWarning && pendingGenerateSubject && (
            <div className="ei-data-card" style={{ marginTop: 'var(--ei-space-3, 12px)' }}>
              <div className="ei-data-card__header">
                <span className="ei-data-card__meta" style={{ color: 'var(--ei-warning, #b58900)' }}>
                  ⚠ No rewrite model configured. Generation will use the default model ({checkGenerationModel().model}), which may produce lower-quality results.
                </span>
              </div>
              <div className="ei-data-card__footer">
                <div />
                <div className="ei-data-card__actions">
                  <button
                    className="ei-btn ei-btn--secondary"
                    onClick={() => { setShowModelWarning(false); setPendingGenerateSubject(null); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="ei-btn ei-btn--primary"
                    onClick={() => doGenerate(pendingGenerateSubject)}
                  >
                    Generate Anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {generatingDocuments.length > 0 && (
        <div className="ei-settings-section">
          <h3 className="ei-settings-section__title">Generating...</h3>
          <div className="ei-settings-section">
            {generatingDocuments.map(slug => (
              <div key={slug} className="ei-data-card" style={{ opacity: 0.7 }}>
                <span className="ei-form-hint" style={{ fontStyle: 'normal' }}>
                  {slugToSubject(slug)} — generating...
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {generatedEntries.length > 0 && (
        <div className="ei-settings-section">
          <h3 className="ei-settings-section__title">Generated Documents</h3>
          <div className="ei-settings-section">
            {generatedEntries.map(([slug, { subject, created_at }]) => {
              const isConfirming = confirmingGeneratedSlug === slug;
              const isDeleting = deletingGeneratedSlug === slug;
              const date = new Date(created_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });

              return (
                <div key={slug} className="ei-data-card">
                  <div className="ei-data-card__header">
                    <span style={{ flex: 1, fontWeight: 500, wordBreak: 'break-all' }}>
                      {subject}
                    </span>
                    <span className="ei-data-card__meta">generated {date}</span>
                  </div>

                  {isConfirming ? (
                    <div className="ei-data-card__footer">
                      <span className="ei-data-card__meta" style={{ color: 'var(--ei-danger)' }}>
                        Remove this generated document? This cannot be undone.
                      </span>
                      <div className="ei-data-card__actions">
                        <button
                          className="ei-btn ei-btn--secondary"
                          onClick={() => setConfirmingGeneratedSlug(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="ei-btn ei-btn--danger"
                          onClick={() => handleDeleteGeneratedConfirm(slug)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ei-data-card__footer">
                      <div />
                      <div className="ei-data-card__actions">
                        <button
                          className="ei-btn ei-btn--secondary"
                          onClick={() => onDownloadGenerated(slug)}
                          disabled={isDeleting}
                        >
                          Download .md
                        </button>
                        <button
                          className="ei-btn ei-btn--danger"
                          onClick={() => setConfirmingGeneratedSlug(slug)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? 'Removing...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="ei-settings-section">
        <h3 className="ei-settings-section__title">Import Document</h3>
        <div className="ei-form-group">
          <p className="ei-form-hint">
            Import a text or markdown file to add its content to your knowledge base.
            Accepted formats: .txt, .md, .markdown
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={importing}
          />
          <button
            className="ei-btn ei-btn--secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{ alignSelf: 'flex-start' }}
          >
            {importing ? 'Importing...' : 'Choose file'}
          </button>
          {importStatus && (
            <p className="ei-form-hint" style={{ marginTop: '0' }}>
              {importStatus}
            </p>
          )}
        </div>
      </div>

      {pendingEntries.length > 0 && (
        <div className="ei-settings-section">
          <h3 className="ei-settings-section__title">Processing...</h3>
          <div className="ei-settings-section">
            {pendingEntries.map(({ batchId, filename, count }) => (
              <div
                key={batchId}
                className="ei-data-card"
                style={{ opacity: 0.7 }}
              >
                <span className="ei-form-hint" style={{ fontStyle: 'normal' }}>
                  {filename} — {count} chunk{count !== 1 ? 's' : ''} segmenting
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ei-settings-section">
        <h3 className="ei-settings-section__title">Imported Documents</h3>

        {processedEntries.length === 0 && pendingDocuments.length === 0 ? (
          <div className="ei-placeholder-card">
            No documents imported yet.
          </div>
        ) : processedEntries.length === 0 ? null : (
          <div className="ei-settings-section">
            {processedEntries.map(([filename, record]) => {
              const isConfirming = confirmingFilename === filename;
              const isUnsourcing = unsourcing === filename;
              const date = new Date(record.created_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });

              const isExtracting = extractingDocuments.includes(filename);

              return (
                <div key={filename} className="ei-data-card">
                  <div className="ei-data-card__header">
                    <span style={{ flex: 1, fontWeight: 500, wordBreak: 'break-all' }}>
                      {filename}
                    </span>
                    {isExtracting
                      ? <span className="ei-data-card__meta" style={{ color: 'var(--ei-warning, #b58900)' }}>extracting knowledge...</span>
                      : <span className="ei-data-card__meta">imported {date}</span>
                    }
                  </div>

                  {isConfirming ? (
                    <div className="ei-data-card__footer">
                      <span className="ei-data-card__meta" style={{ color: 'var(--ei-danger)' }}>
                        Remove knowledge from {filename}? This cannot be undone.
                      </span>
                      <div className="ei-data-card__actions">
                        <button
                          className="ei-btn ei-btn--secondary"
                          onClick={() => setConfirmingFilename(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="ei-btn ei-btn--danger"
                          onClick={() => handleUnsourceConfirm(filename)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ei-data-card__footer">
                      <div />
                      <div className="ei-data-card__actions">
                        <button
                          className="ei-btn ei-btn--danger"
                          onClick={() => setConfirmingFilename(filename)}
                          disabled={isUnsourcing}
                        >
                          {isUnsourcing ? 'Removing...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {notification && (
        <div className="ei-toast">{notification}</div>
      )}
    </div>
  );
};
