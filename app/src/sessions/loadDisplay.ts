import type { SessionLoad } from './models';

/** Human-readable, source-neutral load copy. This never resolves relative loads to kilograms. */
export function formatSessionLoad(load: SessionLoad): string {
    switch (load.kind) {
        case 'bodyweight': return 'Bodyweight';
        case 'unloaded': return 'No external load';
        case 'descriptive': return load.display ?? load.description ?? 'As described';
        case 'percent_one_rm': return `${load.percent}% 1RM`;
        case 'percent_max': return `${load.percent}% maximum`;
        case 'relative_step': return `${load.percent}% of prior step`;
        case 'mass': return `${typeof load.kg === 'number' ? load.kg : `${load.kg.min}-${load.kg.max}`} kg`;
        case 'band': return `${load.bandColor} band`;
    }
}
