import { useState, type ReactNode, type SyntheticEvent } from 'react';
import './SettingsDisclosure.css';

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
      {/* <summary>'s content model explicitly permits a single heading element as its
          label (MDN/HTML spec) -- this keeps the native disclosure control while giving
          screen readers a real heading to navigate by, which plain text inside <summary>
          does not. */}
      <summary id={titleId}><h2>{title}</h2></summary>
      <div className="settings-disclosure-content">{children}</div>
    </details>
  );
}
