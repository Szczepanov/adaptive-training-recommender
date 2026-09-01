import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function readGit(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

const gitSha = process.env.VITE_GIT_SHA?.trim() || readGit(['rev-parse', 'HEAD']) || 'unknown';
const gitDirty = process.env.VITE_GIT_DIRTY !== undefined
  ? process.env.VITE_GIT_DIRTY === 'true'
  : Boolean(readGit(['status', '--porcelain']));

export default defineConfig({
  define: {
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
    'import.meta.env.VITE_GIT_DIRTY': JSON.stringify(String(gitDirty)),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Adaptive Coach',
        short_name: 'Coach',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(rawId) {
          const id = rawId.replace(/\\/g, '/');

          // ── Third-party vendors ─────────────────────────────────────────
          if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) {
            return 'firebase-firestore';
          }
          if (id.includes('@firebase/auth') || id.includes('firebase/auth')) {
            return 'firebase-auth';
          }
          if (id.includes('@firebase/app') || id.includes('firebase/app') || id.includes('@firebase/component') || id.includes('@firebase/util')) {
            return 'firebase-core';
          }
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }

          // ── App: exercise & workout catalogue (largest static data blobs) ─
          // exercises-base.ts (~54 kB) + exercise-catalog-extensions.ts (~59 kB)
          // + prescription.ts + parameter-bindings.ts + catalog.ts
          if (
            id.includes('/workouts/exercises-base') ||
            id.includes('/workouts/exercise-catalog-extensions') ||
            id.includes('/workouts/prescription') ||
            id.includes('/workouts/parameter-bindings') ||
            id.includes('/workouts/catalog') ||
            id.includes('/workouts/exercises.')
          ) {
            return 'workouts-catalog';
          }

          // ── App: engine validation (validationCore ~88 kB source) ────────
          if (
            id.includes('/engine/validationCore') ||
            id.includes('/engine/healthContextValidation') ||
            id.includes('/engine/coPresenceValidator')
          ) {
            return 'engine-validation';
          }

          // ── App: identity subsystem ───────────────────────────────────────
          if (
            id.includes('/engine/identityPassport') ||
            id.includes('/engine/identityReplay') ||
            id.includes('/engine/identityAttribution') ||
            id.includes('/engine/identityFeatures') ||
            id.includes('/engine/identityLineage') ||
            id.includes('/engine/identityEligibility') ||
            id.includes('/engine/identityProvenance') ||
            id.includes('/engine/identityReviewUi')
          ) {
            return 'engine-identity';
          }

          // ── App: context & training-history subsystem ─────────────────────
          if (
            id.includes('/engine/contextBrief') ||
            id.includes('/engine/contextBriefPlanningHandoff') ||
            id.includes('/engine/contextBriefActivityTelemetry') ||
            id.includes('/engine/completedTraining') ||
            id.includes('/engine/microcycle') ||
            id.includes('/engine/fatigue') ||
            id.includes('/engine/adapters') ||
            id.includes('/engine/dataConfidence') ||
            id.includes('/engine/multisourceFusion') ||
            id.includes('/engine/multisourceBaselines')
          ) {
            return 'engine-context';
          }

          // ── App: core decision engine (rules + planner + optimizer) ───────
          // rules.ts (~67 kB) + planner.ts (~74 kB) + optimizer.ts (~49 kB)
          // + periodization.ts (~36 kB) + templates.ts (~39 kB) + supporting modules
          if (
            id.includes('/engine/rules') ||
            id.includes('/engine/planner') ||
            id.includes('/engine/optimizer') ||
            id.includes('/engine/periodization') ||
            id.includes('/engine/templates') ||
            id.includes('/engine/eligibility') ||
            id.includes('/engine/schedule') ||
            id.includes('/engine/stimulus') ||
            id.includes('/engine/coverage') ||
            id.includes('/engine/weeklyAllocation') ||
            id.includes('/engine/weeklyDosePacking') ||
            id.includes('/engine/evergreenStrategy') ||
            id.includes('/engine/evergreenPlanning') ||
            id.includes('/engine/planningCandidate') ||
            id.includes('/engine/planningMode') ||
            id.includes('/engine/planningOverlays') ||
            id.includes('/engine/planSchedule') ||
            id.includes('/engine/dose') ||
            id.includes('/engine/trainingCapacity') ||
            id.includes('/engine/injuryPolicy') ||
            id.includes('/engine/taperPolicy') ||
            id.includes('/engine/externalSession') ||
            id.includes('/engine/externalSessionProfiles') ||
            id.includes('/engine/externalPlacement') ||
            id.includes('/engine/externalCritique')
          ) {
            return 'engine-core';
          }
        }
      }
    }
  },
  test: {
    hookTimeout: 30000,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/**/*.d.ts', 'src/visual/**'],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'artifacts/coverage/frontend',
    },
  }
});
