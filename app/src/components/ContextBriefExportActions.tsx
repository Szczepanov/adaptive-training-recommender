import type { ReactNode } from 'react';

interface ContextBriefExportActionsProps {
  copied: boolean;
  /** Disables the Markdown outputs while the brief on screen is not the one the controls describe. */
  markdownDisabled?: boolean;
  children?: ReactNode;
  onCopy: () => void;
  onDownloadMarkdown: () => void;
  onDownloadJson: () => void;
}

export function ContextBriefExportActions({
  copied,
  markdownDisabled = false,
  children,
  onCopy,
  onDownloadMarkdown,
  onDownloadJson,
}: ContextBriefExportActionsProps) {
  return (
    <>
      <button type="button" className="brief-copy" disabled={markdownDisabled} onClick={onCopy}>
        {copied ? 'Copied' : 'Copy to clipboard'}
      </button>
      <button type="button" className="brief-copy" disabled={markdownDisabled} onClick={onDownloadMarkdown}>
        Download Markdown
      </button>
      <button type="button" className="brief-copy" onClick={onDownloadJson}>
        Download JSON
      </button>
      {children}
    </>
  );
}
