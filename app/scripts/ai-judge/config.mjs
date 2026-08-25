import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeLocalEndpoint(rawUrl, isOllama = true) {
  if (!rawUrl) return isOllama ? 'http://localhost:11434/api/chat' : 'http://localhost:1234/v1/chat/completions';
  const trimmed = rawUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/api/chat') || trimmed.endsWith('/v1/chat/completions')) return trimmed;
  return `${trimmed}${isOllama ? '/api/chat' : '/v1/chat/completions'}`;
}

export function parseCliArg(argv, name) {
  const flag = `--${name}`;
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (next && !next.startsWith('--')) return next;
  return 'true';
}

export function parseCliFlag(argv, ...flags) {
  return flags.some((flag) => argv.includes(flag));
}

export function resolveJudgeConfig(argv = process.argv.slice(2), env = process.env) {
  // Load standard env files if called in normal execution
  loadEnvFile(resolve('.env'));
  loadEnvFile(resolve('.env.local'));
  loadEnvFile(resolve('../.env'));

  const cliProvider = parseCliArg(argv, 'provider');
  const cliModel = parseCliArg(argv, 'model');
  const cliSamples = parseCliArg(argv, 'samples');
  const cliSeed = parseCliArg(argv, 'seed');
  const cliSeedStrategy = parseCliArg(argv, 'seed-strategy');
  const cliThinking = parseCliArg(argv, 'thinking');

  const isLocalFlag = parseCliFlag(argv, '--local');
  const isQuick = parseCliFlag(argv, '--quick', '--flash');
  const isResume = parseCliFlag(argv, '--resume');
  // --resume always wins over --fresh/--force so an explicit request to resume a run
  // can never be silently discarded by an also-passed --fresh flag.
  const isFresh = parseCliFlag(argv, '--fresh', '--force') && !isResume;
  const isDebug = parseCliFlag(argv, '--debug') || env.DEBUG === 'true' || env.DEBUG === '1';
  const exclusiveOllama = parseCliFlag(argv, '--exclusive-ollama') || env.JUDGE_EXCLUSIVE_OLLAMA === '1' || env.JUDGE_FLUSH_OLLAMA === '1';
  const isBlind = parseCliFlag(argv, '--blind', '-b');
  const cliPacketVersion = parseCliArg(argv, 'packet-version');
  const rawPacketVersion = isBlind ? 'v2' : (cliPacketVersion || env.JUDGE_PACKET_VERSION || 'v1');
  const packetVersion = rawPacketVersion === 'blind' ? 'v2' : rawPacketVersion;
  const validPacketVersions = new Set(['v1', 'v2']);
  if (!validPacketVersions.has(packetVersion)) {
    throw new Error(`Unsupported packet version '${packetVersion}'. Valid packet versions: v1, v2 (or --blind / 'blind' as an alias for v2).`);
  }
  const withDiagnosticsAudit = parseCliFlag(argv, '--with-diagnostics-audit', '--audit-diagnostics') || env.JUDGE_DIAGNOSTICS_AUDIT === '1';
  const isPairwise = parseCliFlag(argv, '--pairwise') || env.JUDGE_PAIRWISE === '1';
  const checkPositionBias = parseCliFlag(argv, '--check-position-bias', '--position-bias') || env.JUDGE_CHECK_POSITION_BIAS === '1';
  const cliRubricScale = parseCliArg(argv, 'rubric-scale');
  const rubricScale = cliRubricScale || env.JUDGE_RUBRIC_SCALE || (isPairwise ? '0-4' : '0-10');
  const validRubricScales = new Set(['0-4', '0-10']);
  if (!validRubricScales.has(rubricScale)) {
    throw new Error(`Unsupported rubric scale '${rubricScale}'. Valid scales: 0-4, 0-10.`);
  }

  const deepseekKey = env.DEEPSEEK_API_KEY;
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  const rawLocalUrl = env.LOCAL_LLM_URL || env.OLLAMA_BASE_URL;

  // Determine provider
  let provider = null;
  if (cliProvider) {
    provider = cliProvider.toLowerCase();
  } else if (env.JUDGE_PROVIDER) {
    provider = env.JUDGE_PROVIDER.toLowerCase();
  } else if (isLocalFlag) {
    provider = 'local';
  } else {
    // Infer only when unambiguous
    const available = [];
    if (deepseekKey) available.push('deepseek');
    if (geminiKey) available.push('gemini');
    if (openaiKey) available.push('openai');
    if (rawLocalUrl) available.push('local');

    if (available.length === 1) {
      provider = available[0];
    } else if (available.length === 0) {
      throw new Error(
        'No supported judge provider is configured. Set DEEPSEEK_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, OPENAI_API_KEY, or run with --local (or set LOCAL_LLM_URL/OLLAMA_BASE_URL).'
      );
    } else {
      throw new Error(
        `Ambiguous judge provider: multiple credentials found (${available.join(', ')}). Specify --provider <local|deepseek|gemini|openai> or set JUDGE_PROVIDER.`
      );
    }
  }

  const validProviders = new Set(['local', 'deepseek', 'gemini', 'openai']);
  if (!validProviders.has(provider)) {
    throw new Error(`Unsupported provider '${provider}'. Valid providers: local, deepseek, gemini, openai.`);
  }

  // Determine API Key
  let apiKey = 'local';
  if (provider === 'deepseek') {
    if (!deepseekKey) throw new Error('Missing DEEPSEEK_API_KEY for deepseek provider.');
    apiKey = deepseekKey;
  } else if (provider === 'gemini') {
    if (!geminiKey) throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY for gemini provider.');
    apiKey = geminiKey;
  } else if (provider === 'openai') {
    if (!openaiKey) throw new Error('Missing OPENAI_API_KEY for openai provider.');
    apiKey = openaiKey;
  }

  // Model resolution
  const localQuickModel = env.LOCAL_JUDGE_QUICK_MODEL || env.OLLAMA_QUICK_MODEL;
  const localStandardModel = env.LOCAL_JUDGE_MODEL || env.OLLAMA_MODEL;
  const defaultModels = {
    local: (isQuick ? localQuickModel : null) || localStandardModel || 'hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M',
    deepseek: isQuick ? 'deepseek-v4-flash' : 'deepseek-v4-pro',
    gemini: isQuick ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash',
    openai: 'gpt-4o',
  };

  const model = cliModel || env.JUDGE_MODEL || defaultModels[provider];

  // Thinking mode
  let thinkingEnabled = true;
  if (cliThinking !== undefined) {
    thinkingEnabled = cliThinking === 'on' || cliThinking === 'true';
  } else if (env.JUDGE_THINKING !== undefined) {
    thinkingEnabled = env.JUDGE_THINKING === 'on' || env.JUDGE_THINKING === 'true' || env.JUDGE_THINKING === '1';
  } else {
    thinkingEnabled = !isQuick && env.THINKING_MODE !== 'disabled';
  }

  const reasoningEffort = env.REASONING_EFFORT || 'low';

  // Sampling & Seeds
  const samples = positiveInt(cliSamples || env.JUDGE_SAMPLES || env.SAMPLES, 1);
  const baseSeed = positiveInt(cliSeed || env.JUDGE_SEED || env.SEED, 424242);
  const seedStrategy = cliSeedStrategy || env.JUDGE_SEED_STRATEGY || 'derived';

  // Local options
  const cliNumCtx = parseCliArg(argv, 'num-ctx') || parseCliArg(argv, 'ctx');
  const cliNumPredict = parseCliArg(argv, 'num-predict') || parseCliArg(argv, 'predict');
  const localNumCtx = positiveInt(cliNumCtx || env.NUM_CTX || env.OLLAMA_NUM_CTX, 32768);
  const localNumPredict = positiveInt(cliNumPredict || env.NUM_PREDICT || env.OLLAMA_NUM_PREDICT, 16384);
  const localIsOllama = !rawLocalUrl
    || rawLocalUrl === env.OLLAMA_BASE_URL
    || rawLocalUrl.includes('11434')
    || rawLocalUrl.includes('/api/chat');
  const localEndpoint = normalizeLocalEndpoint(rawLocalUrl, localIsOllama);

  // Network & inference timeouts (docs/analysis/ai-plan-judge.md § Network & inference timeout)
  const cliTimeoutMs = parseCliArg(argv, 'timeout-ms') || parseCliArg(argv, 'timeout');
  const localTimeoutMs = positiveInt(cliTimeoutMs || env.LOCAL_TIMEOUT_MS || env.JUDGE_TIMEOUT_MS, 600_000);
  const cloudTimeoutMs = positiveInt(cliTimeoutMs || env.REQUEST_TIMEOUT_MS || env.JUDGE_TIMEOUT_MS, 180_000);

  return {
    provider,
    apiKey,
    model,
    samples,
    baseSeed,
    seedStrategy,
    thinkingEnabled,
    reasoningEffort,
    isQuick,
    isFresh,
    isResume,
    isDebug,
    exclusiveOllama,
    packetVersion,
    withDiagnosticsAudit,
    isPairwise,
    checkPositionBias,
    rubricScale,
    local: {
      endpoint: localEndpoint,
      isOllama: localIsOllama,
      numCtx: localNumCtx,
      numPredict: localNumPredict,
      timeoutMs: localTimeoutMs,
    },
    cloud: {
      timeoutMs: cloudTimeoutMs,
      deepseekBaseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
      openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
    },
  };
}
