import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NutritionAdherenceSection } from './NutritionAdherenceSection';

describe('NutritionAdherenceSection (ADR-0042 & previous-day calorie scoring)', () => {
  it('renders all 5 adherence options with unselected state and no clear button when unrated', () => {
    const html = renderToStaticMarkup(
      <NutritionAdherenceSection
        value={null}
        onChange={() => {}}
      />
    );

    expect(html).toContain("Yesterday&#x27;s Calorie Tracking (D-1)");
    expect(html).toContain('<details');
    expect(html).not.toContain('<details class="checkin-section nutrition-adherence-section" open="">');
    expect(html).toContain('(Optional)');
    expect(html).toContain('Fully Tracked');
    expect(html).toContain('Mostly Tracked');
    expect(html).toContain('Minimally Tracked');
    expect(html).toContain('Untracked');
    expect(html).toContain('Full-Day Fast (0 kcal)');
    expect(html).toContain('Zero recommendation authority; does not alter your training plan');

    // No clear button when value is null
    expect(html).not.toContain('aria-label="Clear calorie tracking score"');
    expect(html).not.toContain('is-selected');
    expect(html).toContain('aria-checked="false"');
  });

  it('renders selected option, clear button, and appropriate active class when value is set', () => {
    const html = renderToStaticMarkup(
      <NutritionAdherenceSection
        value="fasted"
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="Clear calorie tracking score"');
    expect(html).toMatch(/<details class="checkin-section nutrition-adherence-section"[^>]*open="">/);
    expect(html).toContain('is-selected adherence-fasted');
    expect(html).toContain('aria-checked="true"');
  });

  it('renders context summary when yesterday intake telemetry is provided', () => {
    const htmlWithCalories = renderToStaticMarkup(
      <NutritionAdherenceSection
        value="fully_tracked"
        yesterdayIntakeKcal={2150}
        hasIntakeData={true}
        onChange={() => {}}
      />
    );

    expect(htmlWithCalories).toContain('Yesterday&#x27;s synced intake (D-1):');
    expect(htmlWithCalories).not.toContain('Garmin');
    expect(htmlWithCalories).toContain('2,150 kcal');

    const htmlReportedWithoutCalories = renderToStaticMarkup(
      <NutritionAdherenceSection
        value="mostly_tracked"
        yesterdayIntakeKcal={null}
        hasIntakeData={true}
        onChange={() => {}}
      />
    );

    expect(htmlReportedWithoutCalories).toContain('Intake reported; calories unavailable');

    const htmlZeroFast = renderToStaticMarkup(
      <NutritionAdherenceSection
        value="fasted"
        yesterdayIntakeKcal={0}
        hasIntakeData={true}
        onChange={() => {}}
      />
    );

    expect(htmlZeroFast).toContain('0 kcal');

    const htmlUnlogged = renderToStaticMarkup(
      <NutritionAdherenceSection
        value="untracked"
        yesterdayIntakeKcal={null}
        hasIntakeData={false}
        onChange={() => {}}
      />
    );

    expect(htmlUnlogged).toContain('No intake data synced');
  });
});
