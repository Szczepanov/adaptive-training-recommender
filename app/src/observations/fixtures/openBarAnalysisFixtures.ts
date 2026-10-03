/** Generated schema-v1 synthetic trajectories; no public or private lift export is copied. */
export interface OpenBarFixtureOptions {
    dt?: number;
    dropSamples?: readonly number[];
    nullVelocities?: readonly number[];
    videoHash?: string;
    filtered?: boolean;
}

export function openBarSingleRepProfile(): number[] {
    return [...Array<number>(20).fill(-0.6), ...Array<number>(3).fill(0),
        ...Array<number>(25).fill(0.6), ...Array<number>(7).fill(0.025), ...Array<number>(4).fill(0)];
}

export function buildOpenBarAnalysis(
    profile: readonly number[] = openBarSingleRepProfile(),
    options: OpenBarFixtureOptions = {},
) {
    const dt = options.dt ?? 1 / 30;
    let y = 0;
    const retained = profile.map((velocity, index) => {
        if (index > 0) y += velocity * dt;
        return {
            timestamp_s: index * dt, x_m: 0, y_m: y,
            vx_mps: index === 0 ? null : 0,
            vy_mps: index === 0 || options.nullVelocities?.includes(index) ? null : velocity,
            confidence: 1,
        };
    }).filter((_, index) => !options.dropSamples?.includes(index));
    const samples = retained.map((sample, index) => {
        const previous = retained[index - 1];
        const dtS = previous ? sample.timestamp_s - previous.timestamp_s : 0;
        return {
            ...sample,
            vy_mps: !previous || sample.vy_mps === null || dtS > 0.2
                ? null : (sample.y_m - previous.y_m) / dtS,
        };
    });
    const positions = samples.map(({ timestamp_s, x_m, y_m, confidence }) => ({ timestamp_s, x_m, y_m, confidence }));
    const filtered = options.filtered ?? true;
    return {
        schema_version: 1,
        identity: { source_id: 'synthetic-video', source_sha256: options.videoHash ?? 'a'.repeat(64) },
        video: {
            decoded_width_px: 1920, decoded_height_px: 1080, display_width_px: 1920, display_height_px: 1080,
            source_rotation_deg: 0,
            frame_rate: { timestamp_basis: 'decoded_presentation_timestamp', nominal_fps: 1 / dt, measured_fps: 1 / dt },
            trim: { start_s: 0, end_s: (profile.length - 1) * dt },
        },
        manual_seed: {
            timestamp_s: 0, target: { center: { x_px: 400, y_px: 400 }, radius_px: 100 },
            coordinate_space: 'display_top_left', source_rotation_deg: 0,
        },
        calibration: {
            method: 'plate_diameter', method_version: 1,
            scale: { diameter_m: 0.45, diameter_px: 200, metres_per_pixel: 0.00225 },
            reference: {
                timestamp_s: 0, coordinate_space: 'display_top_left', source_rotation_deg: 0,
                geometry: { center_px: { x_px: 400, y_px: 400 }, bounds_px: { left_px: 300, top_px: 300, width_px: 200, height_px: 200 } },
                provenance: { source: 'manual_target_seed' },
            },
            coordinate_convention: 'reference_centre_x_right_y_up',
            quality: { status: 'unassessed', warnings: ['geometry_unassessed'] },
        },
        raw_observations: samples.map(sample => ({
            timestamp_s: sample.timestamp_s, tracking_state: 'tracked', visibility: 'visible', tracker_id: 'opencv-csrt',
            measurement: { timestamp_s: sample.timestamp_s, x_px: 400, y_px: 400 - sample.y_m / 0.00225, confidence: 1 },
        })),
        derived: {
            calibrated: { samples: positions },
            ...(filtered ? { filtered: { filter: { implementation: 'savitzky-golay', version: '1', parameters: { window: 9, order: 2 } }, samples: positions } } : {}),
            kinematics: {
                input: filtered ? 'filtered' : 'calibrated',
                method: { implementation: 'backward-difference', version: '1', parameters: { max_gap_s: 0.2, min_confidence: 0.5 } },
                samples,
            },
        },
        provenance: {
            pipeline: { openbar_version: '0.1.0', git_commit: '703c097' },
            tracker: { id: 'opencv-csrt', implementation: { implementation: 'opencv-csrt', version: '1', parameters: {} } },
        },
    };
}

export function openBarProfileToWlCsv(profile: readonly number[], dt = 1 / 30): string {
    const analysis = buildOpenBarAnalysis(profile, { dt });
    const lines = [
        'Video id,date,Video resolution,Frame rate,weight,tags',
        `1,03/10/2026,1920x1080,${1 / dt},100,back squat attempt 1`,
        'Video id: 1',
        'Frame ordinal,Time (s),"velocity (vertical, m/s)","displacement (vertical, cm)"',
    ];
    // Match the usable OpenBar frames exactly, including the displacement conversion.
    for (const [index, sample] of analysis.derived.kinematics.samples.entries()) {
        if (sample.vy_mps === null) continue;
        lines.push(`${index + 1},${sample.timestamp_s},${sample.vy_mps},${sample.y_m * 100}`);
    }
    return lines.join('\n') + '\n';
}
