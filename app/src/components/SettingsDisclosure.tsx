import { useState, type ReactNode, type SyntheticEvent } from 'react';

interface SettingsDisclosureProps {
  title: string;
  titleId: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SettingsDisclosure({ title, titleId, defaultOpen = false, children }: SettingsDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  };

  return (
    <details className="settings-disclosure" open={open} onToggle={handleToggle}>
      <summary id={titleId}>{title}</summary>
      <div className="settings-disclosure-content">{children}</div>
    </details>
  );
}
