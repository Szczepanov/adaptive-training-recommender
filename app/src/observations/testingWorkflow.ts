import type {
    AssessmentAttemptPurpose,
    ComparisonContext,
    ComparisonContextValue,
    MeasurementProtocol,
} from './models';
import { assertComparisonDimensionValue, assertValidMeasurementProtocol, getComparisonDimensionDefinition } from './protocols';
import type { SessionDefinition } from '../sessions/models';
import { validateSessionDefinition } from '../sessions/validation';

export function buildTestingSessionDefinition(protocol: MeasurementProtocol): SessionDefinition {
    assertValidMeasurementProtocol(protocol);

    const instructionSteps = protocol.instructions.length > 0
        ? protocol.instructions.map((instruction, index) => ({
            id: `protocol-${protocol.id}-r${protocol.revision}-instruction-${index + 1}`,
            kind: 'transition' as const,
            title: instruction.text,
            dose: { kind: 'checkoff' as const, rounds: 1 },
        }))
        : [{
            id: `protocol-${protocol.id}-r${protocol.revision}-perform`,
            kind: 'transition' as const,
            title: 'Perform the locked test protocol.',
            dose: { kind: 'checkoff' as const, rounds: 1 },
        }];

    const definition: SessionDefinition = {
        schemaVersion: 1,
        id: `testing-${protocol.id}-r${protocol.revision}`,
        revision: 1,
        title: protocol.title,
        summary: `Protocol-locked assessment: ${protocol.metricIds.join(', ')}`,
        intent: 'testing',
        blocks: [
            ...(protocol.warmupRef ? [{
                id: `protocol-${protocol.id}-r${protocol.revision}-warmup`,
                title: 'Locked warm-up',
                role: 'warmup' as const,
                executionMode: 'sequential' as const,
                steps: [{
                    id: `protocol-${protocol.id}-r${protocol.revision}-warmup-ref`,
                    kind: 'transition' as const,
                    title: `Complete warm-up: ${protocol.warmupRef}`,
                    dose: { kind: 'checkoff' as const, rounds: 1 },
                }],
            }] : []),
            {
                id: `protocol-${protocol.id}-r${protocol.revision}-test`,
                title: 'Protocol execution',
                role: 'test',
                executionMode: 'sequential',
                steps: instructionSteps,
            },
        ],
    };

    const validation = validateSessionDefinition(definition);
    if (!validation.ok) {
        throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    }
    return definition;
}

export function parseComparisonContextValue(
    protocol: MeasurementProtocol,
    dimensionId: keyof ComparisonContext,
    rawValue: string,
): ComparisonContextValue {
    assertValidMeasurementProtocol(protocol);
    const dimension = protocol.comparisonContext.required.find(id => id === dimensionId);
    if (!dimension) throw new Error(`Comparison dimension ${String(dimensionId)} is not required by this protocol`);
    const definition = getComparisonDimensionDefinition(dimension);
    const trimmed = rawValue.trim();

    let parsed: ComparisonContextValue;
    switch (definition.valueKind) {
        case 'number': {
            const numeric = Number(trimmed);
            if (!Number.isFinite(numeric)) throw new Error(`${dimension} requires a finite number`);
            parsed = numeric;
            break;
        }
        case 'boolean':
            if (trimmed !== 'true' && trimmed !== 'false') throw new Error(`${dimension} requires true or false`);
            parsed = trimmed === 'true';
            break;
        case 'identifier':
        case 'text':
            parsed = trimmed;
            break;
    }
    assertComparisonDimensionValue(dimension, parsed);
    return parsed;
}

export function buildComparisonContextFromStrings(
    protocol: MeasurementProtocol,
    values: Readonly<Record<string, string>>,
): ComparisonContext {
    assertValidMeasurementProtocol(protocol);
    return Object.fromEntries(protocol.comparisonContext.required.map(dimension => {
        const raw = values[dimension];
        if (raw === undefined) throw new Error(`Missing required comparison dimension: ${dimension}`);
        return [dimension, parseComparisonContextValue(protocol, dimension, raw)];
    })) as ComparisonContext;
}

export function createAssessmentAttemptId(protocol: MeasurementProtocol, entropy = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): string {
    assertValidMeasurementProtocol(protocol);
    return `assessment-${protocol.id}-r${protocol.revision}-${entropy}`;
}

export function purposeForFamiliarization(protocol: MeasurementProtocol, requested: AssessmentAttemptPurpose): AssessmentAttemptPurpose {
    assertValidMeasurementProtocol(protocol);
    if (requested === 'familiarization') return requested;
    return requested;
}
