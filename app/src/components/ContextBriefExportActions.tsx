import type { ReactNode } from 'react';

interface ContextBriefExportActionsProps {
  copied: boolean;
  children?: ReactNode;
  onCopy: () => void;
  onDownloadMarkdown: () => void;
  onDownloadJson: () => void;
}

export function ContextBriefExportActions({
  copied,
  children,
  onCopy,
  onDownloadMarkdown,
  onDownloadJson,
}: ContextBriefExportActionsProps) {
  return (
    <>
      <button type="button" className="brief-copy" onClick={onCopy}>
        {copied ? 'Copied' : 'Copy to clipboard'}
      </button>
      <button type="button" className="brief-copy" onClick={onDownloadMarkdown}>
        Download Markdown
      </button>
      <button type="button" className="brief-copy" onClick={onDownloadJson}>
        Download JSON
      </button>
      {children}
    </>
  );
}
