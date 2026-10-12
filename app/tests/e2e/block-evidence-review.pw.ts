import { readFile } from 'node:fs/promises';
import { doc, setDoc } from 'firebase/firestore';
import { expect, test } from './support/test';
import { completeTypicalCheckin, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { seedWithRulesDisabled } from './support/emulator';
import { addDaysToLocalDateString, getLocalDateString } from '../../src/utils/localDate';
import type { IntentBlock } from '../../src/engine/blockIntent';
import { buildTreatmentIntentReplayPayloadV1, hashTreatmentIntentReplayPayload } from '../../src/engine/blockIntentReplay';
import { hashEvaluationContent } from '../../src/outcomes/evaluationHash';
import type { OutcomeEvaluationSnapshot } from '../../src/outcomes/evaluationSpec';
import type { CompetitionOutcome } from '../../src/observations/models';
import { STANDING_BROAD_JUMP_PROTOCOL } from '../../src/observations/physicalCapitalProtocols';
import { buildComparisonSeries } from '../../src/observations/comparability';

async function seedReview(userId: string, corruptHash = false) {
  const today = getLocalDateString();
  const baselineDate = addDaysToLocalDateString(today, -30);
  const startDate = addDaysToLocalDateString(today, -14);
  const endDate = addDaysToLocalDateString(today, -2);
  const timestamp = `${baselineDate}T10:00:00Z`;
  const protocol = STANDING_BROAD_JUMP_PROTOCOL;
  const metricId = protocol.metricIds[0];
  const evaluation: OutcomeEvaluationSnapshot = {
    revision: { id: 'synthetic-evaluation', revision: 1, title: 'Synthetic jump block', startDate, endDate,
      status: 'completed', contentHash: '', createdAt: timestamp, activatedAt: timestamp },
    bindings: [{ id: 'jump', metricId, role: 'primary', protocolRef: { id: protocol.id, revision: protocol.revision },
      baseline: { kind: 'declared_observation', observationId: `baseline:${metricId}` },
      targetObservationWindow: { startDate: endDate, endDate: today },
      expectedDirection: { kind: 'higher_is_better' }, rationale: 'Synthetic evidence wiring verification' }],
  };
  const evaluationHash = await hashEvaluationContent(evaluation);
  evaluation.revision.contentHash = corruptHash ? 'corrupted-hash' : evaluationHash;
  const block: IntentBlock = {
    id: 'synthetic-block', revision: 1, title: 'Synthetic jump block', sourcePlanId: 'synthetic-block', sourcePlanRevision: 1,
    dateRange: { startDate, endDate }, reviewSchedule: { reviewCadenceDays: 7, nextReviewDate: endDate },
    objectives: [{ id: 'objective', sport: 'cross_training', adaptationScope: 'strength_maintenance', coverageKey: 'field_maintenance',
      intent: 'maintain', priority: 'should_have', doseEnvelope: { min: 1, target: 2, max: 3, unit: 'sessions', floorSemantics: 'soft_floor' },
      knowledgeLineage: ['athlete-authored-manual-v1'], successCriteria: {
        evaluationRef: { id: evaluation.revision.id, revision: 1, metricId }, acceptableDeclineTolerancePct: 5,
      } }],
  };
  const pinnedProfile = { priorities: ['balanced_performance' as const], weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 }, schemaVersion: 1 };
  const sourceSchemaVersion = 'manual-intent-block-v1';
  const contentHash = await hashTreatmentIntentReplayPayload(buildTreatmentIntentReplayPayloadV1(block, pinnedProfile, sourceSchemaVersion));
  const context = { test_environment: 'indoor' };
  const series = await buildComparisonSeries(metricId, 'cm', protocol, context);
  await seedWithRulesDisabled(async db => {
    await setDoc(doc(db, 'users', userId, 'intent_blocks', block.id), {
      userId, blockId: block.id, revision: 1, contentHash, sourcePlanId: block.sourcePlanId,
      sourcePlanRevision: 1, createdAt: timestamp, updatedAt: timestamp,
    });
    await setDoc(doc(db, 'users', userId, 'intent_blocks', block.id, 'revisions', '1'), {
      userId, blockId: block.id, revision: 1, block, pinnedTrainingIntentProfile: pinnedProfile,
      sourceSchemaVersion, sourceRef: null, contentHash, createdAt: timestamp,
    });
    await setDoc(doc(db, 'users', userId, 'outcome_evaluations', evaluation.revision.id, 'revisions', '1'), {
      ...evaluation.revision, bindings: evaluation.bindings,
    });
    // A newer, unbound revision must never replace the explicitly pinned revision.
    await setDoc(doc(db, 'users', userId, 'outcome_evaluations', evaluation.revision.id), { id: evaluation.revision.id, currentRevision: 2 });
    await setDoc(doc(db, 'users', userId, 'measurement_protocols', protocol.id, 'revisions', String(protocol.revision)), protocol);
    if (!corruptHash) {
      const outcome: CompetitionOutcome = { id: 'z-linked-outcome', sport: 'field', source: 'manual',
        occurredAt: `${endDate}T08:00:00Z`, createdAt: timestamp,
        evaluationRef: { id: evaluation.revision.id, revision: 1, contentHash: evaluationHash },
        result: { completed: true }, metrics: {}, context: {} };
      await Promise.all([
        ...Array.from({ length: 105 }, (_, index) => ({ ...outcome, id: `a-unrelated-${String(index).padStart(3, '0')}`,
          evaluationRef: { ...outcome.evaluationRef!, id: 'other-evaluation' } })),
        outcome,
        { ...outcome, id: 'z-legacy-outcome', evaluationRef: undefined,
          occurredAt: `${startDate}T12:30:00+02:00` },
      ].map(record => {
        const { evaluationRef, ...legacy } = record;
        return setDoc(doc(db, 'users', userId, 'competition_outcomes', record.id),
          evaluationRef ? record : legacy);
      }));
    }
    for (const [id, date, value, purpose] of [
      ['baseline', baselineDate, 230, 'baseline'], ['repeat', today, 240, 'post_block'],
    ] as const) {
      const observedAt = `${date}T08:00:00Z`;
      const protocolRef = { id: protocol.id, revision: protocol.revision };
      const observationKey = `${id}:${metricId}`;
      await setDoc(doc(db, 'users', userId, 'assessment_attempts', id), { id, state: 'completed', purpose, protocolRef, startedAt: observedAt, completedAt: observedAt });
      await setDoc(doc(db, 'users', userId, 'metric_observations', observationKey), {
        observationKey, assessmentAttemptId: id, metricId, headRevision: 1, createdAt: observedAt, updatedAt: observedAt,
      });
      await setDoc(doc(db, 'users', userId, 'metric_observations', observationKey, 'revisions', '1'), {
        observationKey, assessmentAttemptId: id, metricId, revision: 1, value, unit: 'cm', protocolRef,
        comparisonSeriesKey: series.key, comparisonCanonicalizationVersion: series.canonicalizationVersion,
        observedAt, createdAt: observedAt, context, validity: 'valid', source: 'derived',
        sourceRef: `synthetic-execution-${id}`, algorithmVersion: 'assessment-reducer-v1',
        derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: id, trialId: 'trial-1' }],
      });
    }
  });
  return { evaluationHash, metricId };
}

for (const width of [1440, 390]) {
  test(`block review exports exact frozen evidence and limitations at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const athlete = await provisionAthlete();
    const date = await seedRecoverySnapshot(athlete);
    const evidence = await seedReview(athlete.userId);
    await signInThroughUi(page, athlete);
    await completeTypicalCheckin(page, athlete, date);
    await page.goto('/?screen=testing');
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Block evidence review' });
    await expect(panel.getByRole('button', { name: 'Export block report (JSON)' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Review block evidence', exact: true }).click();
    await panel.getByRole('button', { name: /^Review Synthetic jump block/ }).click();
    await expect(panel).toContainText('Raw comparable change: +10.00 cm');
    await expect(panel).toContainText('No reliability estimate');
    await expect(panel).toContainText('Evidence limitations');
    await expect(panel.getByText('Insufficient evidence', { exact: true }).first()).toBeVisible();
    const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1 && !element.closest('.history-table-wrapper'))
      .map(element => `${element.tagName}.${element.className}`).slice(0, 15));
    expect(overflow).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`block-review-${width}.png`), fullPage: true });
    for (const format of ['JSON', 'CSV']) {
      const pending = page.waitForEvent('download');
      await panel.getByRole('button', { name: `Export block report (${format})` }).click();
      const download = await pending;
      const path = await download.path();
      const contents = await readFile(path!, 'utf8');
      expect(contents).toContain(evidence.evaluationHash);
      expect(contents).toContain(evidence.metricId);
      expect(contents).toContain('ov-progress-v1');
      expect(contents).toContain('block-adequacy-v1');
      expect(contents).toContain('baseline:');
      expect(contents).toContain('repeat:');
      expect(contents).toContain('unsupported');
      if (format === 'JSON') {
        const report = JSON.parse(contents);
        expect(report.evaluationRef.revision).toBe(1);
        expect(report.sourceIds.ecologicalOutcomeIds).toEqual(['z-legacy-outcome', 'z-linked-outcome']);
        expect(report.reviewProvenance.sources.find((source: { source: string }) => source.source === 'ecological_outcomes'))
          .toMatchObject({ status: 'available', recordCount: 2 });
      } else expect(contents).toContain('ecological_outcomes:available:2');
    }
  });
}

test('block review refuses a corrupted frozen evaluation instead of exporting an empty report', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  await seedReview(athlete.userId, true);
  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);
  await page.goto('/?screen=testing');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Block evidence review' });
  await panel.getByRole('button', { name: 'Review block evidence', exact: true }).click();
  await panel.getByRole('button', { name: /^Review Synthetic jump block/ }).click();
  await expect(panel).toContainText('A verified frozen evaluation is unavailable');
  await expect(panel.getByRole('button', { name: 'Export block report (JSON)' })).toHaveCount(0);
});
