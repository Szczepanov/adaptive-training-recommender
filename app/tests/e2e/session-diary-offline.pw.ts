import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { expect, test } from './support/test';
import { openFixturePicker, provisionAthlete, readSessionExecutions, signInThroughUi } from './support/athlete';
import { FIRESTORE_EMULATOR_ROUTE, inspectAthlete } from './support/emulator';

test('offline diary survives a browser reload with corrections, tombstones and undo (#895 WP1)', async ({ page, context }) => {
  test.setTimeout(120_000);
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Log repetition set' })).toBeVisible();
  await expect.poll(async () => (await readSessionExecutions(athlete)).length).toBe(1);
  const [execution] = await readSessionExecutions(athlete);
  expect(execution.prescriptionHash).toBeTruthy();

  // Disable device connectivity while the already-loaded app remains available.
  await context.setOffline(true);
  for (let index = 1; index <= 3; index++) {
    await page.getByRole('button', { name: 'Log repetition set' }).click();
    await expect(page.locator('.entry-row')).toHaveCount(index);
    await expect(page.getByRole('button', { name: 'Log repetition set' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Edit set 1', exact: true }).click();
  await page.getByLabel('Repetitions for set 1', { exact: true }).fill('10');
  await page.locator('.entry-edit-box').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.entry-row').first()).toContainText('10 reps');
  await page.getByRole('button', { name: 'Remove set 2', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(2);
  await expect(page.locator('.sync-pill')).toHaveText('queued');

  // Keep Firestore disconnected while permitting the app shell and cached-auth reload.
  await page.route(FIRESTORE_EMULATOR_ROUTE, route => route.abort());
  await context.setOffline(false);
  await page.reload();
  // An incomplete daily check-in intentionally precedes deep-link restoration.
  await page.getByRole('button', { name: 'Skip to Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Sessions/ }).click();
  await expect(page.locator('.session-runner-container')).toBeVisible();
  await expect(page.locator('.entry-row')).toHaveCount(2, { timeout: 45_000 });
  await expect(page.locator('.entry-row').first()).toContainText('10 reps');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(page.locator('.sync-pill')).toHaveText('queued');
  await expect(page.locator('.rest-timer-banner')).toBeHidden();
  expect((await readSessionExecutions(athlete))[0].executionId).toBe(execution.executionId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(3);
  await page.unroute(FIRESTORE_EMULATOR_ROUTE);
  await expect(page.locator('.sync-pill')).toHaveText('synced', { timeout: 45_000 });

  // An independent client proves backend persistence, rather than merely local UI state.
  await inspectAthlete(athlete, async db => {
    const path = ['users', athlete.userId, 'session_executions', execution.executionId] as const;
    const entries = await getDocs(collection(db, ...path, 'entries'));
    expect(entries.size).toBe(3);
    expect(new Set(entries.docs.map(item => item.id)).size).toBe(3);
    expect(entries.docs.filter(item => item.data().payload.reps === 10)).toHaveLength(1);
    expect(entries.docs.every(item => item.data().deletedAt === null)).toBe(true);
    const mutations = await getDocs(collection(db, ...path, 'diaryMutations'));
    expect(mutations.docs.filter(item => item.data().kind === 'log')).toHaveLength(3);
    const correction = mutations.docs.find(item => item.data().kind === 'correct')?.data();
    expect(correction?.before.payload.reps).not.toBe(10);
    expect(correction?.after.payload.reps).toBe(10);
    expect(mutations.docs.filter(item => item.data().kind === 'delete')).toHaveLength(1);
    expect(mutations.docs.filter(item => item.data().kind === 'restore')).toHaveLength(1);
  });
  expect(await readSessionExecutions(athlete)).toHaveLength(1);
});

test('a conflicting offline correction remains failed with its attempted values after reload (#895 WP1)', async ({ page, context }) => {
  test.setTimeout(120_000);
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
  await page.getByRole('button', { name: 'Log repetition set' }).click();
  await expect(page.locator('.sync-pill')).toHaveText('synced');
  const [execution] = await readSessionExecutions(athlete);
  // The conflicting remote correction is written by an independent client as the same athlete.
  await inspectAthlete(athlete, async db => {
    const path = ['users', athlete.userId, 'session_executions', execution.executionId] as const;
    const [original] = (await getDocs(collection(db, ...path, 'entries'))).docs;
    expect(original).toBeDefined();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Edit set 1', exact: true }).click();
    await page.getByLabel('Repetitions for set 1', { exact: true }).fill('10');
    await page.locator('.entry-edit-box').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.sync-pill')).toHaveText('queued');
    const before = original.data();
    const id = 'remote-correction';
    const at = new Date().toISOString();
    const after = { ...before, updatedAt: at, diaryMutationId: id, payload: { ...before.payload, reps: 12 } };
    const batch = writeBatch(db);
    batch.set(original.ref, after);
    batch.set(doc(db, ...path, 'diaryMutations', id), {
      id, executionId: execution.executionId, targetId: original.id,
      targetKind: 'entry', kind: 'correct', at, before, after,
    });
    batch.set(doc(db, ...path), { updatedAt: at }, { merge: true });
    await batch.commit();
    await page.route(FIRESTORE_EMULATOR_ROUTE, route => route.abort());
    await context.setOffline(false);
    await page.reload();
    await page.getByRole('button', { name: 'Skip to Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Sessions/ }).click();
    await expect(page.locator('.entry-row').first()).toContainText('10 reps', { timeout: 45_000 });
    await page.unroute(FIRESTORE_EMULATOR_ROUTE);
    await expect(page.locator('.sync-pill')).toHaveText('unavailable', { timeout: 45_000 });
    await expect(page.locator('.entry-row').first()).toContainText('12 reps');
    const receipts = await page.evaluate(async ({ userId, executionId }) => {
      const moduleUrl = '/src/services/sessionExecutionService.ts';
      const { sessionExecutionService: service } = await import(moduleUrl);
      return service.getDiaryReceipts(userId, executionId);
    }, { userId: athlete.userId, executionId: execution.executionId });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ state: 'failed', mutation: { kind: 'correct', after: { payload: { reps: 10 } } } });
    expect((await getDoc(original.ref)).data()?.payload.reps).toBe(12);
  });
});
