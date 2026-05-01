import { useState, useRef } from 'react';

interface HumanDocumentsTabProps {
  processedDocuments: Record<string, string>;
  pendingDocuments: Array<{ batchId: string; filename: string; count: number }>;
  extractingDocuments: string[];
  onImport: (file: File) => Promise<void>;
  onUnsource: (filename: string) => Promise<void>;
}

export const HumanDocumentsTab = ({
  processedDocuments,
  pendingDocuments,
  extractingDocuments,
  onImport,
  onUnsource,
}: HumanDocumentsTabProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [confirmingFilename, setConfirmingFilename] = useState<string | null>(null);
  const [unsourcing, setUnsourcing] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

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

  const pendingEntries = pendingDocuments;
  const processedEntries = Object.entries(processedDocuments).sort(
    ([, a], [, b]) => new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <div className="ei-settings-form">

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
            {processedEntries.map(([filename, timestamp]) => {
              const isConfirming = confirmingFilename === filename;
              const isUnsourcing = unsourcing === filename;
              const date = new Date(timestamp).toLocaleDateString(undefined, {
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
