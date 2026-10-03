import type { WlAnalysisFrame } from '../wlAnalysisCsv';

/** Synthetic, seeded pre-extraction corpus. Never update the golden during a refactor. */
export function segmentationGoldenCorpus(): { label: string; frames: WlAnalysisFrame[] }[] {
    let seed = 981;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    return Array.from({ length: 200 }, (_, caseIndex) => {
        const frames: WlAnalysisFrame[] = [];
        let displacementCm = 0;
        const dt = caseIndex % 2 === 0 ? 1 / 30 : 1 / 60;
        const append = (count: number, velocity: number) => {
            for (let i = 0; i < count; i += 1) {
                displacementCm += velocity * dt * 100;
                frames.push({
                    ordinal: frames.length + 1,
                    timeS: frames.length * dt,
                    velocityMps: velocity,
                    displacementCm,
                });
            }
        };
        const repCount = 1 + Math.floor(random() * 5);
        for (let rep = 0; rep < repCount; rep += 1) {
            // Some series begin mid-ascent; others contain a complete preceding descent.
            if (caseIndex % 7 !== 0 || rep > 0) append(20 + Math.floor(random() * 30), -0.5);
            append(2, 0);
            append(2 + Math.floor(random() * 7), 0.02);
            if (caseIndex % 11 === 0) {
                // All-below-floor run: v2 must retain the complete reporting window.
                append(500, 0.04);
            } else {
                append(15 + Math.floor(random() * 45), 0.3 + random());
                // Materially slow movement (>1 cm) must survive the v2 drift trim.
                if (caseIndex % 5 === 0) append(100, 0.03);
            }
            append(3 + Math.floor(random() * 5), 0.025);
            if (caseIndex % 9 !== 0 || rep + 1 < repCount) append(3, 0);
        }
        return { label: `synthetic-${caseIndex}`, frames };
    });
}
