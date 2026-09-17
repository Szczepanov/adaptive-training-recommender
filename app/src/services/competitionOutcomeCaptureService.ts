import type { UserEvent, UserGoal } from '../engine/models';
import { goalToUserEvent } from '../engine/periodization';
import type { CompetitionOutcome } from '../observations/models';
import { assertValidCompetitionOutcome } from '../observations/validation';
import type { OutcomeEvaluationSnapshot, OutcomeEvaluationSpecRevision, OutcomeMetricBinding } from '../outcomes/evaluationSpec';
import { assertValidOutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { sortOutcomeBindings } from '../outcomes/evaluationHash';
import { getLocalDateString } from '../utils/localDate';
import { goalService } from './goalService';
import { competitionOutcomeService } from './competitionOutcomeService';
import { outcomeEvaluationService } from './outcomeEvaluationService';

export type EventGoal = UserGoal & { id: string };

/** The caller supplies the real result; this adapter supplies event identity and provenance. */
export interface CompetitionOutcomeCaptureInput {
    outcomeId: string;
    evaluationId: string;
    occurredAt: string;
    source: CompetitionOutcome['source'];
    sourceRef?: string;
    result: CompetitionOutcome['result'];
    metrics: CompetitionOutcome['metrics'];
    context: CompetitionOutcome['context'];
    /** Frozen outcome criteria; the service must never invent an empty evaluation. */
    evaluationBindings: readonly OutcomeMetricBinding[];
    createdAt: string;
}

export interface DerivedCompetitionOutcomeCapture {
    event: UserEvent;
    evaluation: OutcomeEvaluationSnapshot;
    outcome: CompetitionOutcome;
}

export interface CompetitionOutcomeCaptureResult extends DerivedCompetitionOutcomeCapture {
    evaluation: OutcomeEvaluationSnapshot;
}

interface OutcomeEvaluationWriter {
    getRevision(userId: string, evaluationId: string, revision: number): Promise<OutcomeEvaluationSnapshot | null>;
    createDraftRevision(
        userId: string,
        revision: OutcomeEvaluationSpecRevision,
        bindings: readonly OutcomeMetricBinding[],
    ): Promise<OutcomeEvaluationSnapshot>;
    activateRevision(userId: string, evaluationId: string, revision: number): Promise<OutcomeEvaluationSnapshot>;
}

interface CompetitionOutcomeWriter {
    getOutcome(userId: string, outcomeId: string): Promise<CompetitionOutcome | null>;
    createOutcome(userId: string, outcome: CompetitionOutcome): Promise<CompetitionOutcome>;
}

export interface CompetitionOutcomeCaptureDependencies {
    loadGoal: (userId: string, goalId: string) => Promise<EventGoal | null>;
    evaluationService: OutcomeEvaluationWriter;
    outcomeService: CompetitionOutcomeWriter;
}

function sportForEvent(category: UserEvent['category']): CompetitionOutcome['sport'] {
    switch (category) {
        case 'cycling_event': return 'cycling';
        case 'running_race': return 'running';
        case 'strength_meet': return 'other';
        case 'triathlon': return 'other';
        case 'general_target': return 'other';
    }
}

function eventFromGoal(userId: string, goal: EventGoal): UserEvent {
    if (goal.userId !== userId) throw new Error(`Goal ${goal.id} does not belong to user ${userId}`);
    if (goal.status !== 'active' && goal.status !== 'completed') {
        throw new Error(`Goal ${goal.id} must be active or completed to capture an outcome`);
    }
    if (!goal.targetDate || !goal.eventCategory) {
        throw new Error(`Goal ${goal.id} must have a dated event to capture an outcome`);
    }

    // goalToUserEvent intentionally only exposes active goals to planning. Outcome capture
    // also runs after an event goal is marked completed, so use the same adapter while keeping
    // the persisted lifecycle and event identity unchanged.
    const event = goalToUserEvent({ ...goal, status: 'active' });
    if (!event) throw new Error(`Goal ${goal.id} could not be resolved as an event`);
    return event;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return value;
}

function sameRecord(left: unknown, right: unknown): boolean {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function isAlreadyExistsError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('already exists');
}

function assertEquivalentEvaluation(
    existing: OutcomeEvaluationSnapshot,
    expected: OutcomeEvaluationSnapshot,
): void {
    const existingRevision = existing.revision;
    const expectedRevision = expected.revision;
    const sameCriteria = sameRecord(
        {
            id: existingRevision.id,
            revision: existingRevision.revision,
            title: existingRevision.title,
            startDate: existingRevision.startDate,
            endDate: existingRevision.endDate,
            sourceRef: existingRevision.sourceRef,
            createdAt: existingRevision.createdAt,
        },
        {
            id: expectedRevision.id,
            revision: expectedRevision.revision,
            title: expectedRevision.title,
            startDate: expectedRevision.startDate,
            endDate: expectedRevision.endDate,
            sourceRef: expectedRevision.sourceRef,
            createdAt: expectedRevision.createdAt,
        },
    ) && sameRecord(sortOutcomeBindings(existing.bindings), sortOutcomeBindings(expected.bindings));
    if (!sameCriteria) {
        throw new Error(`Outcome evaluation ${expectedRevision.id}@${expectedRevision.revision} conflicts with the requested capture`);
    }
}

function linkedOutcome(
    outcome: CompetitionOutcome,
    evaluation: OutcomeEvaluationSnapshot,
): CompetitionOutcome {
    return {
        ...outcome,
        evaluationRef: {
            id: evaluation.revision.id,
            revision: evaluation.revision.revision,
            contentHash: evaluation.revision.contentHash,
        },
    };
}

export function deriveCompetitionOutcomeCapture(
    userId: string,
    goal: EventGoal,
    input: CompetitionOutcomeCaptureInput,
): DerivedCompetitionOutcomeCapture {
    const event = eventFromGoal(userId, goal);
    const outcome: CompetitionOutcome = {
        id: input.outcomeId,
        eventRef: event.id,
        sport: sportForEvent(event.category),
        occurredAt: input.occurredAt,
        source: input.source,
        ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
        result: input.result,
        metrics: input.metrics,
        context: input.context,
        createdAt: input.createdAt,
    };
    assertValidCompetitionOutcome(outcome);

    const outcomeDate = getLocalDateString(new Date(input.occurredAt));
    const evaluation: OutcomeEvaluationSnapshot = {
        revision: {
            id: input.evaluationId,
            revision: 1,
            title: `${event.title} ecological outcome`,
            startDate: outcomeDate,
            endDate: outcomeDate,
            sourceRef: { kind: 'event', id: event.id },
            status: 'draft',
            contentHash: '',
            createdAt: input.createdAt,
        },
        bindings: input.evaluationBindings,
    };
    assertValidOutcomeEvaluationSnapshot(evaluation);
    return { event, evaluation, outcome };
}

export class CompetitionOutcomeCaptureService {
    private readonly loadGoal: CompetitionOutcomeCaptureDependencies['loadGoal'];
    private readonly evaluationService: OutcomeEvaluationWriter;
    private readonly outcomeService: CompetitionOutcomeWriter;

    constructor(dependencies: Partial<CompetitionOutcomeCaptureDependencies> = {}) {
        this.loadGoal = dependencies.loadGoal ?? ((userId, goalId) => goalService.getGoal(userId, goalId));
        this.evaluationService = dependencies.evaluationService ?? outcomeEvaluationService;
        this.outcomeService = dependencies.outcomeService ?? competitionOutcomeService;
    }

    /**
     * The evaluation is frozen before the outcome write. Existing equivalent records are reused
     * so a failed outcome write can be retried without creating another revision or outcome.
     */
    async capture(
        userId: string,
        goalId: string,
        input: CompetitionOutcomeCaptureInput,
    ): Promise<CompetitionOutcomeCaptureResult> {
        const goal = await this.loadGoal(userId, goalId);
        if (!goal) throw new Error(`Goal ${goalId} not found`);
        const derived = deriveCompetitionOutcomeCapture(userId, goal, input);
        const existingEvaluation = await this.evaluationService.getRevision(
            userId,
            input.evaluationId,
            derived.evaluation.revision.revision,
        );
        let evaluation: OutcomeEvaluationSnapshot;
        let evaluationToReuse = existingEvaluation;
        if (!evaluationToReuse) {
            try {
                await this.evaluationService.createDraftRevision(
                    userId,
                    derived.evaluation.revision,
                    derived.evaluation.bindings,
                );
            } catch (error) {
                if (!isAlreadyExistsError(error)) throw error;
                evaluationToReuse = await this.evaluationService.getRevision(
                    userId,
                    input.evaluationId,
                    derived.evaluation.revision.revision,
                );
                if (!evaluationToReuse) throw error;
            }
        }
        if (evaluationToReuse) {
            assertEquivalentEvaluation(evaluationToReuse, derived.evaluation);
            if (evaluationToReuse.revision.status !== 'draft') {
                evaluation = evaluationToReuse;
            } else {
                try {
                    evaluation = await this.evaluationService.activateRevision(
                        userId,
                        input.evaluationId,
                        derived.evaluation.revision.revision,
                    );
                } catch (error) {
                    const racedEvaluation = await this.evaluationService.getRevision(
                        userId,
                        input.evaluationId,
                        derived.evaluation.revision.revision,
                    );
                    if (!racedEvaluation) throw error;
                    assertEquivalentEvaluation(racedEvaluation, derived.evaluation);
                    if (racedEvaluation.revision.status === 'draft') throw error;
                    evaluation = racedEvaluation;
                }
            }
        } else {
            evaluation = await this.evaluationService.activateRevision(
                userId,
                input.evaluationId,
                derived.evaluation.revision.revision,
            );
        }
        const expectedOutcome = linkedOutcome(derived.outcome, evaluation);
        const existingOutcome = await this.outcomeService.getOutcome(userId, input.outcomeId);
        if (existingOutcome) {
            if (!sameRecord(existingOutcome, expectedOutcome)) {
                throw new Error(`Competition outcome ${input.outcomeId} conflicts with the requested capture`);
            }
            return { ...derived, evaluation, outcome: existingOutcome };
        }
        let outcome: CompetitionOutcome;
        try {
            outcome = await this.outcomeService.createOutcome(userId, expectedOutcome);
        } catch (error) {
            if (!isAlreadyExistsError(error)) throw error;
            const racedOutcome = await this.outcomeService.getOutcome(userId, input.outcomeId);
            if (!racedOutcome) throw error;
            if (!sameRecord(racedOutcome, expectedOutcome)) {
                throw new Error(`Competition outcome ${input.outcomeId} conflicts with the requested capture`, { cause: error });
            }
            outcome = racedOutcome;
        }
        return { ...derived, evaluation, outcome };
    }
}

export const competitionOutcomeCaptureService = new CompetitionOutcomeCaptureService();
