import { useOverloadHistory } from '../hooks/useOverloadHistory';
import { EXERCISES } from '../workouts/exercises';
import { exerciseIdentityKey, type ExerciseIdentity } from '../workouts/overloadHistory';
import './StrengthOverloadHistory.css';

interface StrengthOverloadHistoryProps {
    userId: string;
}

function exerciseLabel(identity: ExerciseIdentity): string {
    if (identity.exerciseId) return EXERCISES.find(exercise => exercise.id === identity.exerciseId)?.name ?? identity.exerciseId;
    return identity.freeTextName ?? 'Unnamed exercise';
}

function identityValue(identity: ExerciseIdentity): string {
    return exerciseIdentityKey(identity);
}

/** Progressive-overload view (S1.7, ADR-0021). Reads the raw per-set log directly
 *  (D-SETLOG) via `useOverloadHistory` -- no dependency on S2.1's 1RM estimator or Step C,
 *  neither of which exist yet at this point in the plan. A table, not a chart: the plan
 *  asked for "load, reps, tonnage and best set over time," which a row per session already
 *  satisfies: charting is a presentation upgrade for later, not a correctness gap now. */
export function StrengthOverloadHistory({ userId }: StrengthOverloadHistoryProps) {
    const { loading, error, exercises, selected, select, history, invalidRecords } = useOverloadHistory(userId);

    if (loading) {
        return <div className="strength-overload-history"><p className="card-empty">Loading overload history…</p></div>;
    }

    if (error) {
        return <div className="strength-overload-history"><p className="strength-error">{error}</p></div>;
    }

    if (exercises.length === 0) {
        return (
            <div className="strength-overload-history">
                <h3>Overload history</h3>
                <p className="card-empty">No strength sets logged yet in the last 90 days.</p>
            </div>
        );
    }

    return (
        <div className="strength-overload-history">
            <h3>Overload history</h3>

            <select
                value={selected ? identityValue(selected) : ''}
                onChange={event => {
                    const identity = exercises.find(exercise => identityValue(exercise) === event.target.value) ?? null;
                    select(identity);
                }}
            >
                <option value="">Select an exercise…</option>
                {exercises.map(identity => (
                    <option key={identityValue(identity)} value={identityValue(identity)}>{exerciseLabel(identity)}</option>
                ))}
            </select>

            {invalidRecords > 0 && (
                <p className="strength-overload-warning">{invalidRecords} session record{invalidRecords === 1 ? '' : 's'} could not be read and {invalidRecords === 1 ? 'is' : 'are'} omitted below.</p>
            )}

            {selected && history.length === 0 && <p className="card-empty">No sets logged for this exercise in the last 90 days.</p>}

            {selected && history.length > 0 && (
                <table className="strength-overload-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Sets</th>
                            <th>Reps</th>
                            <th>Tonnage (kg)</th>
                            <th>Heaviest set</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map(entry => (
                            <tr key={entry.sessionId}>
                                <td>{entry.date}</td>
                                <td>{entry.workingSetCount}{entry.setCount !== entry.workingSetCount ? ` (+${entry.setCount - entry.workingSetCount} warm-up)` : ''}</td>
                                <td>{entry.totalReps}</td>
                                <td>{entry.tonnageKg}</td>
                                <td>
                                    {entry.heaviestSet
                                        ? `${entry.heaviestSet.reps} × ${entry.heaviestSet.weightKg ?? 'BW'}${entry.heaviestSet.weightKg !== null ? ' kg' : ''}`
                                        : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
