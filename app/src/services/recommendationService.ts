import { collection, deleteField, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DailyRecommendation, Recommendation, ShadowVerdict } from '../engine/models';
import { resolveEngineShadowVerdict } from '../engine/shadowAgreement';
import { validateRecommendation, validateAdherenceUpdate } from '../engine/validation';
import type { DataIssue, DataState } from '../engine/dataState';
import { parseDailyRecommendation } from '../persistence/parsers/trainingHistory';
import { isPermissionDeniedError } from '../utils/errors';
import { deepEqual } from '../utils/deepEqual';

type PersistedRecommendationWithVerdict = DailyRecommendation & { engineVerdict?: ShadowVerdict };

/**
 * Persists what the engine actually prescribed each day, and captures whether the user
 * followed it -- previously the engine's output was computed on page load and
 * discarded, so "is the algorithm working?" had no data to answer from. See
 * DailyRecommendation for the shape and getAdherenceStats for the summary this exists
 * to produce.
 */
export class RecommendationService {
    private readonly collectionPath = 'daily_recommendations';

    // Guards against overlapping saveRecommendation calls for the same (userId, date):
    // Home.tsx fires saveRecommendation unawaited from an effect, so a fast recompute
    // (e.g. two loadDashboardData runs racing) can otherwise issue two concurrent
    // read-then-write sequences against the same document, each computing revision/audit
    // decisions from a getDoc snapshot the other has since invalidated.
    private readonly inFlightSaves = new Map<string, Promise<DailyRecommendation | null>>();

    /**
     * Save (or re-save) the recommendation generated for a given date. Safe to call
     * every time the dashboard computes one -- merge:true means an already-answered
     * adherence field is preserved (see validateRecommendation), and re-saving the same
     * template/rationale for a date that hasn't changed is a no-op in effect.
     */
    async saveRecommendation(userId: string, date: string, rec: Recommendation): Promise<DailyRecommendation | null> {
        const key = `${userId}:${date}`;
        const previous = this.inFlightSaves.get(key) ?? Promise.resolve(null);
        const run = previous.catch(() => null).then(() => this.saveRecommendationInternal(userId, date, rec));
        this.inFlightSaves.set(key, run);
        try {
            return await run;
        } finally {
            if (this.inFlightSaves.get(key) === run) this.inFlightSaves.delete(key);
        }
    }

    private async saveRecommendationInternal(userId: string, date: string, rec: Recommendation): Promise<DailyRecommendation | null> {
        const docPath = `users/${userId}/${this.collectionPath}/${date}`;
        let decisionChanged: boolean | undefined;
        let priorRevision: number | undefined;
        let nextRevision: number | undefined;
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            const existingSnap = await getDoc(docRef);
            const existing = existingSnap.exists() ? existingSnap.data() as PersistedRecommendationWithVerdict : undefined;

            const isNewDoc = !existing;
            priorRevision = existing ? (existing.revision ?? 1) : 1;
            const engineVerdict = resolveEngineShadowVerdict(rec.mode, rec.externalVerdict?.decision);
            const existingEngineVerdict = existing
                ? (existing.engineVerdict ?? resolveEngineShadowVerdict(existing.mode))
                : undefined;

            // Declared `const` (not reassigned) so TypeScript's control-flow narrowing of
            // `existing` inside `if (decisionChangedThisSave)` below still applies; the
            // outer `decisionChanged` (assigned right after) exists only for diagnostics.
            const decisionChangedThisSave = existing !== undefined && (
                existing.templateId !== rec.template.id ||
                existing.templateTitle !== rec.template.title ||
                existing.category !== rec.template.category ||
                existing.modality !== rec.template.modality ||
                existing.mode !== rec.mode ||
                existingEngineVerdict !== engineVerdict ||
                existing.rationale !== rec.rationale ||
                // Firestore returns map fields in sorted key order, which does not match
                // the construction order of a freshly-built prescription -- comparing via
                // JSON.stringify would treat an unchanged, round-tripped prescription as
                // "changed" and spuriously bump the revision (see deepEqual for detail).
                !deepEqual(existing.prescription ?? null, rec.prescription ?? null)
            );
            decisionChanged = decisionChangedThisSave;

            nextRevision = isNewDoc ? 1 : (decisionChangedThisSave ? priorRevision + 1 : priorRevision);
            const recommendationAudit = rec.recommendationAudit && (isNewDoc || decisionChangedThisSave || !existing?.recommendationAudit)
                ? rec.recommendationAudit
                : existing?.recommendationAudit;

            const rawData = {
                userId,
                date,
                templateId: rec.template.id,
                templateTitle: rec.template.title,
                category: rec.template.category,
                modality: rec.template.modality,
                mode: rec.mode,
                rationale: rec.rationale,
                ...(rec.prescription ? { prescription: rec.prescription } : {}),
                ...(rec.adjustment ? { adjustment: rec.adjustment } : {}),
                ...(existing?.adherence ? { adherence: existing.adherence } : {}),
                // Audit is write-once per decision (firestore.rules: auditWriteOnce()):
                // a freshly recomputed audit is only written when it actually describes a
                // new decision (or none was stored yet). Re-saving the same template/mode/
                // rationale later the same day must keep the original audit -- overwriting
                // it every recompute (evaluatedAt always differs) would fail the immutability
                // rule on every save after the first.
                ...(recommendationAudit ? { recommendationAudit } : {}),
                schemaVersion: recommendationAudit
                    ? Math.max(existing?.schemaVersion ?? 1, 3)
                    : (rec.prescription ? Math.max(existing?.schemaVersion ?? 1, 2) : (existing?.schemaVersion ?? 1)),
                createdAt: existing?.createdAt,
                revision: nextRevision,
            };

            const validation = validateRecommendation(rawData);
            if (!validation.isValid) {
                console.warn('Recommendation validation failed:', validation.errors);
                return null;
            }

            // `engineVerdict` is evidence-only metadata added in Phase 9.0. It is kept
            // outside validateRecommendation's historical v1-v3 shape so old documents
            // remain backward-compatible; Firestore rules validate the optional enum.
            // Persist the adjudicator's exact external decision when present instead of
            // reconstructing it later from train/modify/recover (which cannot represent
            // skip/advisory and is not equivalent on every imported-plan day).
            const validated = { ...validation.data!, engineVerdict } as PersistedRecommendationWithVerdict;
            const writeData = !rec.prescription && existing?.prescription
                ? { ...validated, prescription: deleteField() }
                : validated;

            if (decisionChangedThisSave) {
                const batch = writeBatch(getDb());
                const archiveRef = doc(getDb(), 'users', userId, this.collectionPath, date, 'revisions', String(priorRevision));
                const archiveData: Record<string, unknown> = {
                    revision: priorRevision,
                    templateId: existing.templateId,
                    templateTitle: existing.templateTitle,
                    category: existing.category,
                    modality: existing.modality,
                    mode: existing.mode,
                    rationale: existing.rationale,
                };
                if (existing.engineVerdict) archiveData.engineVerdict = existing.engineVerdict;
                if (existing.prescription) archiveData.prescription = existing.prescription;
                if (existing.recommendationAudit) archiveData.recommendationAudit = existing.recommendationAudit;

                batch.set(archiveRef, archiveData);
                batch.set(docRef, writeData, { merge: true });
                await batch.commit();
            } else {
                await setDoc(docRef, writeData, { merge: true });
            }

            return validated;
        } catch (error: unknown) {
            // Non-fatal by design: failing to persist a recommendation record shouldn't
            // block the dashboard from showing today's recommendation.
            if (isPermissionDeniedError(error)) {
                console.warn(
                    `Permission denied saving recommendation at ${docPath} ` +
                    `(decisionChanged=${decisionChanged}, priorRevision=${priorRevision}, nextRevision=${nextRevision}). ` +
                    'Usually means the local read (cache or a blocked connection) disagreed with the server about ' +
                    'whether the decision changed -- see firestore.rules decisionFieldsUnchanged()/auditWriteOnce().'
                );
                return null;
            }
            console.error(`Error saving recommendation at ${docPath}:`, error);
            return null;
        }
    }

    async getRecommendation(userId: string, date: string): Promise<DailyRecommendation | null> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                return docSnap.data() as DailyRecommendation;
            }
            return null;
        } catch (error: unknown) {
            if (isPermissionDeniedError(error)) {
                return null;
            }
            console.error('Error fetching recommendation:', error);
            return null;
        }
    }

    /**
     * Records the user's answer to "did you follow this?" for a given date's
     * recommendation. No-ops (returns null) if no recommendation was ever saved for
     * that date -- there's nothing to attach adherence to.
     */
    async recordAdherence(
        userId: string,
        date: string,
        answer: { followed: boolean; skipped?: boolean; actualModality?: string | null; actualDurationMin?: number | null; notes?: string | null }
    ): Promise<DailyRecommendation | null> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            const existingSnap = await getDoc(docRef);
            if (!existingSnap.exists()) {
                console.warn(`No recommendation recorded for ${date} -- nothing to attach adherence to.`);
                return null;
            }

            const validation = validateAdherenceUpdate(answer);
            if (!validation.isValid) {
                console.warn('Adherence validation failed:', validation.errors);
                return null;
            }

            await setDoc(docRef, { adherence: validation.data }, { merge: true });
            return { ...(existingSnap.data() as DailyRecommendation), adherence: validation.data! };
        } catch (error: unknown) {
            if (isPermissionDeniedError(error)) {
                console.warn('Permission denied recording adherence.');
                return null;
            }
            console.error('Error recording adherence:', error);
            return null;
        }
    }

    async getRecentRecommendations(userId: string, days: number = 30): Promise<DailyRecommendation[]> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const q = query(collRef, where('userId', '==', userId), orderBy('date', 'desc'), limit(days));
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(d => d.data() as DailyRecommendation);
        } catch (error: unknown) {
            if (isPermissionDeniedError(error)) {
                return [];
            }
            console.error('Error fetching recent recommendations:', error);
            return [];
        }
    }

    /** Retrieves a bounded history window in one query. This differs intentionally from
     * the legacy single-document getter: invalid or failed reads retain their state so
     * history consumers cannot treat them as an empty training week. */
    async getRecommendationsInRange(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<DataState<DailyRecommendation[]>> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const rangeQuery = query(
                collRef,
                where('date', '>=', startDateInclusive),
                where('date', '<', throughDateExclusive),
                orderBy('date', 'asc'),
            );
            const querySnapshot = await getDocs(rangeQuery);
            const recommendations: DailyRecommendation[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const recommendationDocument of querySnapshot.docs) {
                const path = `users/${userId}/${this.collectionPath}/${recommendationDocument.id}`;
                const parsed = parseDailyRecommendation(recommendationDocument.data(), path);
                if (parsed.status === 'AVAILABLE') {
                    recommendations.push(parsed.data);
                    if (parsed.revision) revisions.push(`${recommendationDocument.id}:${parsed.revision}`);
                } else if (parsed.status === 'INVALID') {
                    issues.push(...parsed.issues);
                }
            }
            if (issues.length > 0) return { status: 'INVALID', issues };
            return { status: 'AVAILABLE', data: recommendations, revision: revisions.sort().join('|') || null };
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read recommendation history',
                retryable: !isPermissionDeniedError(error),
            };
        }
    }

    /**
     * Summarizes how often recommendations were actually followed -- the concrete
     * answer to "is the algorithm working?" that raw template picks alone can't give.
     * Days with no adherence answer yet are excluded from the rate (not counted as
     * either followed or not), reported separately as `awaitingResponse`.
     */
    async getAdherenceStats(userId: string, days: number = 30): Promise<{
        totalRecommendations: number;
        answered: number;
        awaitingResponse: number;
        followedCount: number;
        modifiedCount: number;
        skippedCount: number;
        followedRate: number; // 0-100, of *answered* days
        byMode: Record<'train' | 'modify' | 'recover', { total: number; followedRate: number }>;
    }> {
        const recs = await this.getRecentRecommendations(userId, days);
        const answered = recs.filter(r => r.adherence.respondedAt !== null);
        const followedCount = answered.filter(r => r.adherence.followed === true).length;
        const skippedCount = answered.filter(r => r.adherence.followed === false && r.adherence.skipped).length;
        const modifiedCount = answered.filter(r => r.adherence.followed === false && !r.adherence.skipped).length;

        const byMode = {} as Record<'train' | 'modify' | 'recover', { total: number; followedRate: number }>;
        for (const mode of ['train', 'modify', 'recover'] as const) {
            const modeAnswered = answered.filter(r => r.mode === mode);
            const modeFollowed = modeAnswered.filter(r => r.adherence.followed === true).length;
            byMode[mode] = {
                total: modeAnswered.length,
                followedRate: modeAnswered.length > 0 ? Math.round((modeFollowed / modeAnswered.length) * 10000) / 100 : 0
            };
        }

        return {
            totalRecommendations: recs.length,
            answered: answered.length,
            awaitingResponse: recs.length - answered.length,
            followedCount,
            modifiedCount,
            skippedCount,
            followedRate: answered.length > 0 ? Math.round((followedCount / answered.length) * 10000) / 100 : 0,
            byMode
        };
    }
}

export const recommendationService = new RecommendationService();
