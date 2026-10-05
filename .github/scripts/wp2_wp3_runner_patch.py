from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "app/src/services/sessionAuthoringService.ts",
    "        definitionSnapshot: snapshotSessionDefinition(definition),\n        definitionSnapshot: snapshotSessionDefinition(definition),",
    "        definitionSnapshot: snapshotSessionDefinition(definition),",
)
replace_once(
    "app/src/services/sessionAuthoringService.ts",
    "        blocks: acceptedDefinition.blocks,\n        displayMetadata: displayMetadataFor(acceptedDefinition),\n        createdAt: now,",
    "        blocks: acceptedDefinition.blocks,\n        displayMetadata: displayMetadataFor(acceptedDefinition),\n        definitionSnapshot: snapshotSessionDefinition(acceptedDefinition),\n        createdAt: now,",
)

replace_once("app/src/hooks/useSessionRunner.ts", "import { writeBatch } from 'firebase/firestore';\n", "")
replace_once("app/src/hooks/useSessionRunner.ts", "import { getDb } from '../firebase';\n", "")
replace_once("app/src/hooks/useSessionRunner.ts", "import { sessionResponseService } from '../services/sessionResponseService';\n", "")
replace_once("app/src/hooks/useSessionRunner.ts", "import { reconcileStructuredCompletion } from '../training-occurrence';\n", "")
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';",
    "import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';\nimport { projectSessionProgress } from '../sessions/sessionProgressProjection';\nimport { prepareFixtureSessionLaunch } from '../services/sessionAuthoringService';\nimport { convergeCompletedExecution } from '../services/sessionCompletionConvergence';",
)
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "    syncStatus: 'synced' | 'pending' | 'queued' | 'unavailable';\n    canUndo:",
    "    syncStatus: 'synced' | 'pending' | 'queued' | 'unavailable';\n    resumeStatus: 'none' | 'ready' | 'degraded';\n    resumeDegradedReason: string | null;\n    canUndo:",
)
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "export function useSessionRunner(userId: string, fixtures: readonly SessionDefinition[] = []): UseSessionRunnerResult {\n    const [rawDefinition",
    "export function useSessionRunner(userId: string, fixtures: readonly SessionDefinition[] = []): UseSessionRunnerResult {\n    // Fixtures are launch inputs only. Resume never consults their current bytes.\n    void fixtures;\n    const [rawDefinition",
)
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "    const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'queued' | 'unavailable'>('synced');\n    const [lastRemovedEntry",
    "    const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'queued' | 'unavailable'>('synced');\n    const [resumeStatus, setResumeStatus] = useState<'none' | 'ready' | 'degraded'>('none');\n    const [resumeDegradedReason, setResumeDegradedReason] = useState<string | null>(null);\n    const [lastRemovedEntry",
)

old_watch = """        const stopEntries = sessionExecutionService.watchEntries(userId, execution.executionId, (current, deleted) => {
            setEntries(current);
            setLastRemovedEntry(deleted);
        }, diaryWriteOptions.onFailed);"""
new_watch = """        const stopEntries = sessionExecutionService.watchEntries(userId, execution.executionId, () => {
            void sessionExecutionService.getResumeDiaryState(userId, execution.executionId).then(diary => {
                setEntries(diary.entries);
                setLastRemovedEntry(diary.lastDeletedEntry);
                if (diary.status === 'degraded') {
                    setResumeStatus('degraded');
                    setResumeDegradedReason(diary.reason);
                    setRawDefinition(null);
                    setSyncStatus('unavailable');
                    return;
                }
                if (rawDefinition) {
                    const cursor = projectSessionProgress(rawDefinition, diary.entries);
                    setActiveBlockIndex(cursor.blockIndex);
                    setActiveStepIndex(cursor.stepIndex);
                }
                if (!diaryFailedRef.current && resumeStatus !== 'degraded') {
                    setSyncStatus(diary.failedReceiptCount > 0
                        ? 'unavailable'
                        : diary.queuedReceiptCount > 0 ? 'queued' : 'synced');
                }
            }).catch(() => setSyncStatus('unavailable'));
        }, diaryWriteOptions.onFailed);"""
replace_once("app/src/hooks/useSessionRunner.ts", old_watch, new_watch)
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "    }, [userId, execution, diaryWriteOptions]);",
    "    }, [userId, execution, diaryWriteOptions, rawDefinition, resumeStatus]);",
)
replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "    const startInFlightRef = useRef(false);",
    "    const startInFlightRef = useRef(false);\n    const terminalInFlightRef = useRef<Promise<void> | null>(null);",
)

p = Path("app/src/hooks/useSessionRunner.ts")
text = p.read_text()
start = text.index("    // Reloading or backgrounding must not create a second execution.")
end = text.index("\n    // Wall-clock timers:", start)
restore = """    // Reloading never replays current source bytes. The persisted prescription and
    // local accepted diary queue are the only authorities. An in-flight rest is deliberately
    // cleared before any restore work and is never reconstructed.
    useEffect(() => {
        let cancelled = false;
        activeRestRef.current = null;
        manualRestDeadlineRef.current = null;
        setRestSecondsRemaining(0);
        setIsRestRunning(false);
        setResumeStatus('none');
        setResumeDegradedReason(null);

        sessionExecutionService.findInProgressExecution(userId)
            .then(async existing => {
                if (!existing) {
                    const completed = await sessionExecutionService.findLatestCompletedExecution(userId, getLocalDateString());
                    if (completed) void convergeCompletedExecution(userId, completed);
                    return;
                }
                const diary = await sessionExecutionService.getResumeDiaryState(userId, existing.executionId);
                if (cancelled) return;
                setExecution(existing);
                setEntries(diary.entries);
                setLastRemovedEntry(diary.lastDeletedEntry);
                setElapsedSeconds(sessionElapsedSecondsAt(existing.startedAt, Date.now()));

                if (diary.status === 'degraded') {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason(diary.reason);
                    setSyncStatus('unavailable');
                    return;
                }
                if (!existing.prescriptionHash) {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason('missing-prescription-hash');
                    setSyncStatus('unavailable');
                    return;
                }
                const resolved = await resolveSessionDefinition(userId, existing.sessionSource, existing.prescriptionHash);
                if (cancelled) return;
                if (resolved.status !== 'AVAILABLE') {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason(`prescription-${resolved.status.toLowerCase()}`);
                    setSyncStatus('unavailable');
                    return;
                }
                const cursor = projectSessionProgress(resolved.data, diary.entries);
                setRawDefinition(resolved.data);
                setActiveBlockIndex(cursor.blockIndex);
                setActiveStepIndex(cursor.stepIndex);
                setResumeStatus('ready');
                setResumeDegradedReason(null);
                setSyncStatus(diary.failedReceiptCount > 0
                    ? 'unavailable'
                    : diary.queuedReceiptCount > 0 ? 'queued' : 'synced');
            })
            .catch(() => {
                if (!cancelled) {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason('resume-read-unavailable');
                    setSyncStatus('unavailable');
                }
            })
            .finally(() => {
                if (!cancelled) setIsRestoring(false);
            });
        return () => { cancelled = true; };
    }, [userId]);
"""
p.write_text(text[:start] + restore + text[end:])

old_fixture = """    const startFixtureSession = useCallback(async (fixture: SessionDefinition) => {
        await startSession(fixture, {
            kind: 'unplanned_fixture', fixtureId: fixture.id,
        });
    }, [startSession]);"""
new_fixture = """    const startFixtureSession = useCallback(async (fixture: SessionDefinition) => {
        const prepared = await prepareFixtureSessionLaunch(userId, fixture);
        await startSession(prepared.definition, prepared.binding.sessionSource, {
            prescriptionHash: prepared.binding.prescriptionHash,
        });
    }, [startSession, userId]);"""
replace_once("app/src/hooks/useSessionRunner.ts", old_fixture, new_fixture)

p = Path("app/src/hooks/useSessionRunner.ts")
text = p.read_text()
start = text.index("    const completeSession = useCallback")
end = text.index("\n    return {", start)
terminal = r'''    const completeSession = useCallback(async (payload?: SessionCompletionPayload) => {
        if (!execution) return;
        if (terminalInFlightRef.current) return terminalInFlightRef.current;

        const operation = (async () => {
            if (execution.state === 'completed') {
                await convergeCompletedExecution(userId, execution, definition?.dominantModality);
                return;
            }
            if (execution.state !== 'in_progress') return;

            manualRestDeadlineRef.current = null;
            setIsRestRunning(false);
            try {
                await closeActiveRest('session_ended');
            } catch (err) {
                console.warn('[useSessionRunner] Failed to persist rest event:', err);
            }

            const submittedAt = new Date().toISOString();
            const note = payload?.notes?.trim();
            const completionEvidence = payload ? {
                submittedAt,
                ...(payload.sessionRpe !== undefined ? { sessionRpe: payload.sessionRpe } : {}),
                ...(payload.completedFraction !== undefined ? { completedFraction: payload.completedFraction } : {}),
                ...(payload.unexpectedFatigue !== undefined ? { unexpectedFatigue: payload.unexpectedFatigue } : {}),
                ...(note ? { note } : {}),
            } : undefined;
            const persistedEntries = await sessionExecutionService.getEntries(userId, execution.executionId);
            const outcome = await sessionExecutionService.transitionExecutionTerminal(
                userId,
                execution.executionId,
                'completed',
                {
                    ...(payload?.sessionRpe !== undefined ? { sessionRpe: payload.sessionRpe } : {}),
                    ...(note ? { notes: note } : {}),
                    ...(completionEvidence ? { completionEvidence } : {}),
                },
                async (batch, terminalExecution) => {
                    if (!persistedEntries.some(entry => entry.payload.kind === 'repetition')) return;
                    const adaptedSession = adaptNormalizedExecutionToStrengthSession({
                        execution: terminalExecution,
                        entries: persistedEntries,
                    });
                    if (adaptedSession.exercises.length > 0) {
                        await preferencesService.applyOneRepMaxDerivations(userId, adaptedSession, submittedAt, batch);
                    }
                },
            );
            setExecution(outcome.execution);
            if (outcome.status === 'already_abandoned') return;

            if (outcome.status === 'transitioned' && payload?.tissueFeedback?.length) {
                try {
                    const existingCheckin = await checkinService.getCheckin(userId, outcome.execution.date);
                    const existingResponses = (existingCheckin?.tissueResponses ?? {}) as Partial<Record<BodyRegion, RegionTissueResponse>>;
                    const tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> = { ...existingResponses };
                    for (const item of payload.tissueFeedback) {
                        const existingSource = existingResponses[item.region]?.sourceSessionRef;
                        if (existingSource && (
                            existingSource.kind !== 'execution'
                            || existingSource.id !== outcome.execution.executionId
                            || existingSource.date !== outcome.execution.date
                        )) throw new Error(`A tissue response for ${item.region} is already linked to another session`);
                        tissueResponses[item.region] = {
                            region: item.region,
                            morningState: existingResponses[item.region]?.morningState ?? 'normal',
                            painDuringTraining: item.painDuringTraining,
                            afterTrainingState: item.afterTrainingState ?? item.painDuringTraining,
                            sourceSessionRef: { kind: 'execution', id: outcome.execution.executionId, date: outcome.execution.date },
                        };
                    }
                    await checkinService.upsertCheckin(userId, {
                        date: outcome.execution.date,
                        painOrInjury: true,
                        tissueResponses,
                    });
                } catch (err) {
                    console.warn('[useSessionRunner] Failed to persist tissue response:', err);
                }
            }
            await convergeCompletedExecution(userId, outcome.execution, definition?.dominantModality);
        })();
        terminalInFlightRef.current = operation;
        try {
            await operation;
        } finally {
            if (terminalInFlightRef.current === operation) terminalInFlightRef.current = null;
        }
    }, [execution, userId, definition, closeActiveRest]);

    const abandonSession = useCallback(async (notes?: string) => {
        if (!execution) return;
        if (terminalInFlightRef.current) return terminalInFlightRef.current;

        const operation = (async () => {
            if (execution.state === 'completed') {
                await convergeCompletedExecution(userId, execution, definition?.dominantModality);
                return;
            }
            if (execution.state !== 'in_progress') return;

            manualRestDeadlineRef.current = null;
            setIsRestRunning(false);
            try {
                await closeActiveRest('session_ended');
            } catch (err) {
                console.warn('[useSessionRunner] Failed to persist rest event:', err);
            }
            const note = notes?.trim();
            const outcome = await sessionExecutionService.transitionExecutionTerminal(
                userId,
                execution.executionId,
                'abandoned',
                note ? { notes: note } : undefined,
            );
            setExecution(outcome.execution);

            if (outcome.status === 'already_completed') {
                await convergeCompletedExecution(userId, outcome.execution, definition?.dominantModality);
                return;
            }
            if (outcome.execution.occurrenceId) {
                try {
                    await sessionOccurrenceService.transitionOccurrenceState(
                        userId,
                        outcome.execution.occurrenceId,
                        'abandoned',
                        outcome.execution.updatedAt,
                    );
                } catch (err) {
                    console.warn('[useSessionRunner] Failed to converge occurrence state to abandoned:', err);
                }
            }
        })();
        terminalInFlightRef.current = operation;
        try {
            await operation;
        } finally {
            if (terminalInFlightRef.current === operation) terminalInFlightRef.current = null;
        }
    }, [execution, userId, definition, closeActiveRest]);
'''
p.write_text(text[:start] + terminal + text[end:])

replace_once(
    "app/src/hooks/useSessionRunner.ts",
    "        syncStatus,\n        canUndo:",
    "        syncStatus,\n        resumeStatus,\n        resumeDegradedReason,\n        canUndo:",
)
