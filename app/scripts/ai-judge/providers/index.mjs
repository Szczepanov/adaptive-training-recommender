import { callOllama } from './ollama.mjs';
import { callOpenAI } from './openai.mjs';
import { callDeepSeek } from './deepseek.mjs';
import { callGemini } from './gemini.mjs';

export async function callProvider(params) {
  const { config } = params;
  if (config.provider === 'local') {
    if (config.local.isOllama) {
      return callOllama(params);
    }
    return callOpenAI(params);
  }
  if (config.provider === 'deepseek') {
    return callDeepSeek(params);
  }
  if (config.provider === 'gemini') {
    return callGemini(params);
  }
  if (config.provider === 'openai') {
    return callOpenAI(params);
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}
