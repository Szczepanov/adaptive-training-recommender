import { describe, expect, it } from 'vitest';
import type { HrMeasurement, NormalizedGarminActivity } from '../../ledger/models';
import {
    evaluateControlledRunningPaceHrComparison,
    evaluateRunningPaceHrAuthority,
    type ControlledRunningSessionEvidence,
} from './runningPaceHrEvidence';

function validChestStrapHr(overrides: Partial<HrMeasurement> = {}): HrMeasurement {
    return {
        externalHrSensorPresent: true,
        sourceForActivity: 'external',
        provenanceConfidence: 'confirmed',
        sensorTechnology: 'electrode_chest_strap',
        activityMotionRisk: 'moderate',
        coveragePct: 99,
        longestGapSeconds: 2,
        signalQuality: 'clean',
        measurementConfidence: 'high',
        summaryCompatibility: 'verified_same_effective_trace',
        artifactFlags: [],
        reasons: [],
        diagnosticVersion: 'hrf5-v1',
        ...overrides,
    };
}

function makeSession(overrides: Partial<ControlledRunningSessionEvidence> = {}): ControlledRunningSessionEvidence {
    return {
        sessionId: 'run-current',
        localDate: '2026-11-12',
        performedOccurrenceId: 'pto-current',
        venueContext: {
            kind: 'calibrated_treadmill',
            treadmillCalibrated: true,
            treadmillCalibrationId: 'tm-gym-1',
            inclinePct: 1.0,
            inclineLocked: true,
        },
        protocolContext: {
            protocolId: 'treadmill_steady_3x10',
            protocolRevision: 1,
            prescriptionHash: 'hash-run-1',
            executionState: 'completed',
            executedSteps: [
                { stepId: 'warmup', durationSeconds: 600, targetSpeedMps: 2.8 },
                { stepId: 'steady', durationSeconds: 1800, targetSpeedMps: 3.5 },
            ],
        },
        paceDistanceEvidence: {
            provenance: 'calibrated_treadmill_console',
            quality: 'verified',
            distanceMeters: 6300,
            durationSeconds: 1800,
        },
        hrEvidence: {
            averageHrBpm: 148,
            hrMeasurement: validChestStrapHr(),
        },
        ...overrides,
    };
}

describe('evaluateRunningPaceHrAuthority', () => {
    it('allows verified electrode chest strap with confirmed external high-confidence clean trace', () => {
        const result = evaluateRunningPaceHrAuthority({
            averageHrBpm: 150,
            hrMeasurement: validChestStrapHr(),
        });
        expect(result).toEqual({ status: 'ALLOWED', reasons: [] });
    });

    it('blocks optical wrist HR, unknown, unreliable, moderate, and discordant traces', () => {
        expect(evaluateRunningPaceHrAuthority({
            averageHrBpm: 150,
            hrMeasurement: validChestStrapHr({
                externalHrSensorPresent: false,
                sourceForActivity: 'wrist',
                provenanceConfidence: 'inferred',
                sensorTechnology: 'wrist_ppg',
            }),
        })).toMatchObject({
            status: 'BLOCKED',
            reasons: expect.arrayContaining([
                'RUNNING_HR_REQUIRES_CHEST_STRAP',
                'RUNNING_HR_SOURCE_NOT_EXTERNAL',
                'RUNNING_HR_PROVENANCE_UNCONFIRMED',
            ]),
        });

        expect(evaluateRunningPaceHrAuthority({
            averageHrBpm: 150,
            hrMeasurement: validChestStrapHr({
                sensorTechnology: 'unknown',
                measurementConfidence: 'unknown',
            }),
        })).toMatchObject({
            status: 'BLOCKED',
            reasons: expect.arrayContaining([
                'RUNNING_HR_REQUIRES_CHEST_STRAP',
                'MEASUREMENT_CONFIDENCE_NOT_HIGH',
            ]),
        });

        expect(evaluateRunningPaceHrAuthority({
            averageHrBpm: 150,
            hrMeasurement: validChestStrapHr({
                measurementConfidence: 'unreliable',
                signalQuality: 'poor',
                summaryCompatibility: 'discordant',
            }),
        })).toMatchObject({
            status: 'BLOCKED',
            reasons: expect.arrayContaining([
                'MEASUREMENT_CONFIDENCE_NOT_HIGH',
                'SIGNAL_QUALITY_NOT_CLEAN',
                'SUMMARY_LINEAGE_NOT_VERIFIED',
            ]),
        });

        expect(evaluateRunningPaceHrAuthority({
            averageHrBpm: 150,
            hrMeasurement: validChestStrapHr({ measurementConfidence: 'moderate' }),
        })).toMatchObject({
            status: 'BLOCKED',
            reasons: ['MEASUREMENT_CONFIDENCE_NOT_HIGH'],
        });
    });
});

describe('evaluateControlledRunningPaceHrComparison', () => {
    it('emits a bounded controlled_pace_hr_response_proxy for an eligible calibrated treadmill pair without claiming running economy', () => {
        const current = makeSession({
            hrEvidence: { averageHrBpm: 145, hrMeasurement: validChestStrapHr() },
        });
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
            hrEvidence: { averageHrBpm: 152, hrMeasurement: validChestStrapHr() },
        });

        const result = evaluateControlledRunningPaceHrComparison(current, prior);
        expect(result.state).toBe('comparable');
        if (result.state !== 'comparable') return;

        expect(result.resultKind).toBe('controlled_pace_hr_response_proxy');
        expect(result.authority).toBe('display_only');
        expect(result.confidenceCeiling).toBe('moderate');
        expect(result.currentSpeedMps).toBe(3.5);
        expect(result.priorSpeedMps).toBe(3.5);
        expect(result.currentAverageHrBpm).toBe(145);
        expect(result.priorAverageHrBpm).toBe(152);
        expect(result.paceHrRatioChangePct).toBeGreaterThan(0);
        expect(result.provenance).toEqual({
            venueKind: 'calibrated_treadmill',
            protocolId: 'treadmill_steady_3x10',
            paceDistanceProvenance: 'calibrated_treadmill_console',
            hrSensorTechnology: 'electrode_chest_strap',
            hrAuthorityStatus: 'ALLOWED',
        });
        expect(result.limitations.join(' ')).toContain('does not measure oxygen cost or running economy');
        expect(JSON.stringify(result).toLowerCase()).not.toContain('"running economy"');
    });

    it('supports verified standard track pairs with verified track splits', () => {
        const trackVenue = {
            kind: 'verified_standard_track' as const,
            trackVerified: true,
            trackLengthMeters: 400,
            laneNumber: 1,
        };
        const current = makeSession({
            venueContext: trackVenue,
            paceDistanceEvidence: {
                provenance: 'verified_track_splits',
                quality: 'verified',
                distanceMeters: 4000,
                durationSeconds: 1000,
            },
        });
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
            venueContext: trackVenue,
            paceDistanceEvidence: {
                provenance: 'verified_track_splits',
                quality: 'verified',
                distanceMeters: 4000,
                durationSeconds: 1000,
            },
        });

        const result = evaluateControlledRunningPaceHrComparison(current, prior);
        expect(result.state).toBe('comparable');
        if (result.state === 'comparable') {
            expect(result.provenance.venueKind).toBe('verified_standard_track');
            expect(result.provenance.paceDistanceProvenance).toBe('verified_track_splits');
        }
    });

    it('fails closed on missing context and never infers venue from Garmin activity type or running dynamics', () => {
        const providerOnlyActivity: NormalizedGarminActivity = {
            activityId: 'garmin-1',
            date: '2026-11-12',
            type: 'treadmill_running',
            durationMin: 40,
            trainingEffectAerobic: 3.1,
            trainingEffectAnaerobic: 0,
            averageHr: 148,
            activityTrainingLoad: 80,
            intensityTag: 'easy',
            stimulusDomain: 'endurance',
            runningDynamics: {
                groundContactTimeMs: 240,
                strideLengthM: 1.15,
            },
            hrMeasurement: validChestStrapHr(),
        };

        const missingVenue = makeSession({
            venueContext: undefined,
            activity: providerOnlyActivity,
        });
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
        });

        const result = evaluateControlledRunningPaceHrComparison(missingVenue, prior);
        expect(result.state).toBe('insufficient_evidence');
        if (result.state !== 'comparable') {
            expect(result.rejectionReasons).toContain('current: missing controlled venue context');
        }
    });

    it('rejects conflicting venue, incline, calibration, and protocol mismatches', () => {
        const current = makeSession();
        const trackPrior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
            venueContext: { kind: 'verified_standard_track', trackVerified: true, trackLengthMeters: 400 },
        });
        expect(evaluateControlledRunningPaceHrComparison(current, trackPrior)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['conflicting controlled venue (calibrated_treadmill vs verified_standard_track)'],
        });

        const differentIncline = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
            venueContext: {
                kind: 'calibrated_treadmill',
                treadmillCalibrated: true,
                treadmillCalibrationId: 'tm-gym-1',
                inclinePct: 2.0,
                inclineLocked: true,
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(current, differentIncline)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['conflicting treadmill incline'],
        });

        const differentProtocol = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
            protocolContext: {
                protocolId: 'treadmill_steady_3x10',
                protocolRevision: 1,
                prescriptionHash: 'hash-run-1',
                executionState: 'completed',
                executedSteps: [
                    { stepId: 'warmup', durationSeconds: 600, targetSpeedMps: 2.8 },
                    { stepId: 'steady', durationSeconds: 1800, targetSpeedMps: 3.9 },
                ],
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(current, differentProtocol)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['protocol step target speed mismatch at step 2'],
        });
    });

    it('deterministically excludes outdoor_road and trail activities', () => {
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
        });

        const outdoor = makeSession({ venueContext: { kind: 'outdoor_road' } });
        expect(evaluateControlledRunningPaceHrComparison(outdoor, prior)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['current: outdoor_road activities are excluded'],
        });

        const trail = makeSession({ venueContext: { kind: 'trail' } });
        expect(evaluateControlledRunningPaceHrComparison(trail, prior)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['current: trail activities are excluded'],
        });

        const trailActivity = makeSession({
            activity: {
                activityId: 'trail-1',
                date: '2026-11-12',
                type: 'trail_running',
                durationMin: 40,
                trainingEffectAerobic: 3.0,
                trainingEffectAnaerobic: 0,
                averageHr: 148,
                activityTrainingLoad: 70,
                intensityTag: 'easy',
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(trailActivity, prior)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: expect.arrayContaining(['current: outdoor/trail activity type excluded']),
        });
    });

    it('excludes Garmin street_running and rejects provider types that contradict the explicit venue', () => {
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
        });
        const activity = (type: string): NormalizedGarminActivity => ({
            activityId: `a-${type}`,
            date: '2026-11-12',
            type,
            durationMin: 40,
            trainingEffectAerobic: 3.0,
            trainingEffectAnaerobic: 0,
            averageHr: 148,
            activityTrainingLoad: 70,
            intensityTag: 'easy',
        });

        expect(evaluateControlledRunningPaceHrComparison(
            makeSession({ activity: activity('street_running') }), prior,
        )).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['current: outdoor/trail activity type excluded'],
        });

        expect(evaluateControlledRunningPaceHrComparison(
            makeSession({ activity: activity('track_running') }), prior,
        )).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['current: provider activity type (track_running) conflicts with calibrated_treadmill venue'],
        });

        const trackVenue = { kind: 'verified_standard_track' as const, trackVerified: true };
        expect(evaluateControlledRunningPaceHrComparison(
            makeSession({
                venueContext: trackVenue,
                activity: activity('treadmill_running'),
                paceDistanceEvidence: {
                    provenance: 'verified_track_splits', quality: 'verified', distanceMeters: 6300, durationSeconds: 1800,
                },
            }),
            prior,
        )).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: expect.arrayContaining([
                'current: provider activity type (treadmill_running) conflicts with verified_standard_track venue',
            ]),
        });

        // A matching treadmill label is consistent, but never required.
        expect(evaluateControlledRunningPaceHrComparison(
            makeSession({ activity: activity('treadmill_running') }), prior,
        ).state).toBe('comparable');
    });

    it('rejects pairs with different pace/distance provenance or a non-chronological date order', () => {
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
        });
        const footpod = makeSession({
            paceDistanceEvidence: {
                provenance: 'calibrated_footpod', quality: 'verified', distanceMeters: 6300, durationSeconds: 1800,
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(footpod, prior)).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['conflicting pace/distance provenance (calibrated_footpod vs calibrated_treadmill_console)'],
        });

        expect(evaluateControlledRunningPaceHrComparison(prior, makeSession())).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['prior session date (2026-11-12) is not before current (2026-10-29)'],
        });
    });

    it('rejects poor/unverified pace-distance quality and GPS provenance', () => {
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
        });

        const poorDistance = makeSession({
            paceDistanceEvidence: {
                provenance: 'calibrated_treadmill_console',
                quality: 'poor',
                distanceMeters: 6300,
                durationSeconds: 1800,
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(poorDistance, prior)).toMatchObject({
            state: 'insufficient_evidence',
            rejectionReasons: ['current: pace/distance quality rejected (poor)'],
        });

        const gpsDistance = makeSession({
            paceDistanceEvidence: {
                provenance: 'gps',
                quality: 'verified',
                distanceMeters: 6300,
                durationSeconds: 1800,
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(gpsDistance, prior)).toMatchObject({
            state: 'insufficient_evidence',
            rejectionReasons: ['current: pace/distance provenance (gps) not valid for controlled running'],
        });
    });

    it('rejects ineligible HR lineage (optical wrist, unknown, unreliable) and same occurrence', () => {
        const prior = makeSession({
            sessionId: 'run-prior',
            localDate: '2026-10-29',
            performedOccurrenceId: 'pto-prior',
        });

        const wristHr = makeSession({
            hrEvidence: {
                averageHrBpm: 148,
                hrMeasurement: validChestStrapHr({
                    externalHrSensorPresent: false,
                    sourceForActivity: 'wrist',
                    provenanceConfidence: 'inferred',
                    sensorTechnology: 'wrist_ppg',
                }),
            },
        });
        expect(evaluateControlledRunningPaceHrComparison(wristHr, prior)).toMatchObject({
            state: 'insufficient_evidence',
            hrReasons: expect.arrayContaining(['RUNNING_HR_REQUIRES_CHEST_STRAP']),
        });

        const sameOccurrence = makeSession({ sessionId: 'run-other' });
        expect(evaluateControlledRunningPaceHrComparison(sameOccurrence, makeSession())).toMatchObject({
            state: 'not_comparable',
            rejectionReasons: ['same performed session or occurrence'],
        });
    });
});
