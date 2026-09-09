import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CheckinStepper,
} from './CheckinStepper';
import { deriveCheckinSteps } from './checkinStepState';

describe('deriveCheckinSteps', () => {
  it('reports unsaved groups pending for a missing persisted document', () => {
    const steps = deriveCheckinSteps(null, 0);

    expect(steps.map(step => step.id)).toEqual([
      'followups',
      'recovery',
      'safety',
      'availability',
    ]);
    // A new-day form can contain local defaults, but the stepper receives the persisted
    // snapshot. With no document yet, only the empty follow-up queue is complete.
    expect(steps[0].status).toBe('done');
    expect(steps[1]).toMatchObject({ status: 'pending', detail: '0/6 saved' });
    expect(steps[2]).toMatchObject({ status: 'pending', detail: '0/4 saved' });
    expect(steps[3]).toMatchObject({ status: 'pending', detail: 'Not saved' });
  });

  it('marks follow-ups pending while yesterday reactions await review', () => {
    const steps = deriveCheckinSteps(null, 2);

    expect(steps[0]).toMatchObject({ status: 'pending', detail: '2 to review' });
  });

  it('marks recovery done only when all six saved scores are present', () => {
    const partial = deriveCheckinSteps(
      { readiness: 7, sleepQuality: 6, fatigue: 3, soreness: null, mentalStress: null, motivation: null },
      0,
    );
    expect(partial[1]).toMatchObject({ status: 'pending', detail: '3/6 saved' });

    const complete = deriveCheckinSteps(
      { readiness: 7, sleepQuality: 6, fatigue: 3, soreness: 2, mentalStress: 3, motivation: 8 },
      0,
    );
    expect(complete[1]).toMatchObject({ status: 'done', detail: '6/6 saved' });
  });

  it('marks safety pending until every saved flag is present', () => {
    const partial = deriveCheckinSteps(
      { painOrInjury: false, illnessSymptoms: false, alreadyTrainedToday: false },
      0,
    );
    expect(partial[2]).toMatchObject({ status: 'pending', detail: '3/4 saved' });

    const saved = deriveCheckinSteps(
      {
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
      },
      0,
    );
    expect(saved[2]).toMatchObject({ status: 'done', detail: 'Complete' });
  });

  it('reflects availability from the saved time value', () => {
    const unset = deriveCheckinSteps(
      {
        availability: { timeAvailableMin: null, preferredModalityToday: null, indoorOnly: false },
      },
      0,
    );
    expect(unset[3]).toMatchObject({ status: 'pending', detail: 'Not saved' });

    const set = deriveCheckinSteps(
      {
        availability: { timeAvailableMin: 45, preferredModalityToday: null, indoorOnly: false },
      },
      0,
    );
    expect(set[3]).toMatchObject({ status: 'done', detail: '45 min saved' });
  });
});

describe('CheckinStepper', () => {
  const completeSavedSteps = () => deriveCheckinSteps(
    {
      readiness: 7,
      sleepQuality: 6,
      fatigue: 3,
      soreness: 2,
      mentalStress: 3,
      motivation: 8,
      painOrInjury: false,
      illnessSymptoms: false,
      unusuallyLimitedTime: false,
      alreadyTrainedToday: false,
      availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
    },
    0,
  );

  it('renders the four step labels with saved vs pending state', () => {
    const html = renderToStaticMarkup(
      <CheckinStepper
        steps={deriveCheckinSteps(
          {
            readiness: 7,
            sleepQuality: 6,
            fatigue: 3,
            soreness: 2,
            mentalStress: 3,
            motivation: 8,
            painOrInjury: false,
            illnessSymptoms: false,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
          },
          1,
        )}
      />,
    );

    expect(html).toContain('aria-label="Check-in progress"');
    expect(html).toContain('Follow-ups');
    expect(html).toContain('Recovery');
    expect(html).toContain('Safety');
    expect(html).toContain('Availability');
    expect(html).toContain('1 to review');
    expect(html).toContain('6/6 saved');
    expect(html).toContain('data-status="pending"');
    expect(html).toContain('data-status="done"');
    // The first pending step is the current one for assistive technology.
    expect(html).toContain('aria-current="step"');
  });

  it('does not announce a current step after all four steps are complete', () => {
    const html = renderToStaticMarkup(<CheckinStepper steps={completeSavedSteps()} />);

    expect(html).not.toContain('aria-current=');
  });
});
