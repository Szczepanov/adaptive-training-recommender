/* eslint-disable @typescript-eslint/no-explicit-any -- validating untrusted raw persisted data, matching engine/validationCore.ts's own convention */

export interface EnginePersistenceContractResult {
    valid: boolean;
    errors: string[];
}

export function validateRecommendationAuditContract(audit: unknown): EnginePersistenceContractResult {
    const errors: string[] = [];
    if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
        return { valid: false, errors: ['RecommendationAudit must be a non-null object'] };
    }

    const a = audit as Record<string, any>;
    if (typeof a.policyVersion !== 'string' || !a.policyVersion.trim()) {
        errors.push('policyVersion must be a non-empty string');
    }
    if (typeof a.evaluatedAt !== 'string' || !a.evaluatedAt.trim()) {
        errors.push('evaluatedAt must be a non-empty ISO-8601 string');
    }
    if (typeof a.decisionContextRevision !== 'string') {
        errors.push('decisionContextRevision must be a string');
    }
    if (a.safetyStatus !== 'complete') {
        errors.push('safetyStatus must be \'complete\', got ' + a.safetyStatus);
    }

    // History block
    if (!a.history || typeof a.history !== 'object') {
        errors.push('history block is required');
    } else {
        if (typeof a.history.completedEventCount !== 'number' || a.history.completedEventCount < 0) {
            errors.push('history.completedEventCount must be a non-negative integer');
        }
        if (typeof a.history.unmatchedEventCount !== 'number' || a.history.unmatchedEventCount < 0) {
            errors.push('history.unmatchedEventCount must be a non-negative integer');
        }
        if (!a.history.sourceStatuses || typeof a.history.sourceStatuses !== 'object') {
            errors.push('history.sourceStatuses is required');
        } else {
            const validStatuses = ['AVAILABLE', 'MISSING', 'INVALID', 'UNAVAILABLE'];
            for (const key of ['activities', 'recommendations', 'manualTraining']) {
                if (!validStatuses.includes(a.history.sourceStatuses[key])) {
                    errors.push('history.sourceStatuses.' + key + ' must be one of ' + validStatuses.join(', '));
                }
            }
        }
    }

    // Envelope block
    if (!a.envelope || typeof a.envelope !== 'object') {
        errors.push('envelope block is required');
    } else {
        if (typeof a.envelope.safetyRestrictedModalityCount !== 'number' || a.envelope.safetyRestrictedModalityCount < 0) {
            errors.push('envelope.safetyRestrictedModalityCount must be a non-negative integer');
        }
        const validTiers = ['Rest', 'Mobility', 'Easy', 'Moderate', 'Hard'];
        if (!validTiers.includes(a.envelope.planMaxAllowableTier)) {
            errors.push('envelope.planMaxAllowableTier must be one of ' + validTiers.join(', '));
        }
    }

    // Candidate scores
    if (!Array.isArray(a.candidateScores) || a.candidateScores.length > 64) {
        errors.push('candidateScores must be an array with length <= 64');
    }

    return { valid: errors.length === 0, errors };
}

export function validatePersistedRecommendationContract(rec: unknown): EnginePersistenceContractResult {
    const errors: string[] = [];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
        return { valid: false, errors: ['DailyRecommendation must be a non-null object'] };
    }

    const r = rec as Record<string, any>;
    if (typeof r.userId !== 'string' || !r.userId.trim()) errors.push('userId is required');
    if (typeof r.date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date)) errors.push('date is required (YYYY-MM-DD)');
    if (typeof r.templateId !== 'string' || !r.templateId.trim()) errors.push('templateId is required');
    if (typeof r.templateTitle !== 'string' || !r.templateTitle.trim()) errors.push('templateTitle is required');
    if (typeof r.category !== 'string' || !r.category.trim()) errors.push('category is required');
    if (typeof r.modality !== 'string' || !r.modality.trim()) errors.push('modality is required');
    if (!['train', 'modify', 'recover'].includes(r.mode)) errors.push('mode must be train, modify, or recover, got ' + r.mode);
    if (typeof r.rationale !== 'string') errors.push('rationale is required');
    if (typeof r.revision !== 'number' || r.revision < 1) errors.push('revision must be an integer >= 1');

    if (r.recommendationAudit) {
        const auditValidation = validateRecommendationAuditContract(r.recommendationAudit);
        if (!auditValidation.valid) {
            errors.push(...auditValidation.errors);
        }
    }

    return { valid: errors.length === 0, errors };
}
