/**
 * Cloud provider presets
 *
 * Tier 1: Native SDK providers (anthropic, openai, groq, gemini, grok)
 *         → handled by dedicated provider files
 *
 * Tier 2: OpenAI-compatible cloud providers (this file)
 *         → all use the same protocol, just different base URLs + API keys
 *
 * Tier 3: Custom "bring your own endpoint"
 *         → user adds via init wizard (any URL + key)
 */

export interface CloudPreset {
  name: string;
  label: string;
  baseUrl: string;
  keyEnvVar: string;   // conventional env var name
  keyPrefix?: string;  // e.g. "sk-" for OpenAI-compat
  models: string[];    // known models for /v1/models fallback
  docs: string;        // link to API docs
}

export const CLOUD_PRESETS: CloudPreset[] = [
  {
    name: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    keyEnvVar: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    docs: 'https://platform.deepseek.com/docs',
  },
  {
    name: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai',
    keyEnvVar: 'MISTRAL_API_KEY',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'],
    docs: 'https://docs.mistral.ai/api/',
  },
  {
    name: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz',
    keyEnvVar: 'TOGETHER_API_KEY',
    models: ['meta-llama/Llama-3.1-405B-Instruct-Turbo', 'meta-llama/Llama-3.1-70B-Instruct-Turbo', 'meta-llama/Llama-3.1-8B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    docs: 'https://docs.together.ai/reference',
  },
  {
    name: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference',
    keyEnvVar: 'FIREWORKS_API_KEY',
    models: ['accounts/fireworks/models/llama-v3p1-405b-instruct', 'accounts/fireworks/models/llama-v3p1-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct'],
    docs: 'https://docs.fireworks.ai/api-reference',
  },
  {
    name: 'perplexity',
    label: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    keyEnvVar: 'PERPLEXITY_API_KEY',
    models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'],
    docs: 'https://docs.perplexity.ai/reference',
  },
  {
    name: 'cohere',
    label: 'Cohere',
    baseUrl: 'https://api.cohere.com/compatibility',
    keyEnvVar: 'COHERE_API_KEY',
    models: ['command-r-plus', 'command-r', 'command-a-03-2025'],
    docs: 'https://docs.cohere.com/reference',
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    keyEnvVar: 'OPENROUTER_API_KEY',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'meta-llama/llama-3.1-405b-instruct', 'google/gemini-2.0-flash'],
    docs: 'https://openrouter.ai/docs',
  },
];

/**
 * All provider names (Tier 1 + Tier 2) for display in init wizard
 */
export const TIER1_PROVIDERS = [
  { name: 'anthropic', label: 'Anthropic (Claude)', keyEnvVar: 'ANTHROPIC_API_KEY' },
  { name: 'openai',    label: 'OpenAI (GPT)',       keyEnvVar: 'OPENAI_API_KEY' },
  { name: 'groq',      label: 'Groq',               keyEnvVar: 'GROQ_API_KEY' },
  { name: 'gemini',    label: 'Google Gemini',       keyEnvVar: 'GEMINI_API_KEY' },
  { name: 'grok',      label: 'xAI Grok',           keyEnvVar: 'GROK_API_KEY' },
];

export function getPreset(name: string): CloudPreset | undefined {
  return CLOUD_PRESETS.find(p => p.name === name);
}

export function getAllCloudProviders() {
  return [
    ...TIER1_PROVIDERS.map(p => ({ ...p, tier: 1 as const })),
    ...CLOUD_PRESETS.map(p => ({ name: p.name, label: p.label, keyEnvVar: p.keyEnvVar, tier: 2 as const })),
  ];
}
