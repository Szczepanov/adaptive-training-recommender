import type { CheckinStepState } from './checkinStepState';
import './CheckinStepper.css';

export function CheckinStepper({ steps }: { steps: CheckinStepState[] }) {
  const firstPendingIndex = steps.findIndex(step => step.status === 'pending');
  return (
    <ol className="checkin-stepper" aria-label="Check-in progress">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`checkin-stepper-step status-${step.status}`}
          aria-current={index === firstPendingIndex ? 'step' : undefined}
          data-step={step.id}
          data-status={step.status}
        >
          <span className="checkin-stepper-marker" aria-hidden="true">
            {step.status === 'done' ? '✓' : index + 1}
          </span>
          <span className="checkin-stepper-text">
            <span className="checkin-stepper-label">{step.label}</span>
            <span className="checkin-stepper-detail">{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
