/**
 * Provider factory and interface
 * Creates provider instances from configuration
 */

import type { ProviderConfig } from '../core/config.js';
import type { Message } from '../core/router.js';
import { LocalProvider } from './local.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GroqProvider } from './groq.js';
import { GeminiProvider } from './gemini.js';
import { GrokProvider } from './grok.js';

export interface RouteResponse {
  content: string;
  model: string;
  tool_calls?: any[];
}

export interface ProviderRouteOptions {
  model?: string;
  tools?: any[];
  tool_choice?: any;
  maxTokens?: number;
  temperature?: number;
}

export interface Provider {
  name: string;
  kind: 'local' | 'cloud';
  route(messages: Message[], options?: ProviderRouteOptions): Promise<RouteResponse>;
  routeStream?(messages: Message[], options?: ProviderRouteOptions): AsyncGenerator<string>;
  embed?(input: string | string[], model?: string): Promise<EmbedResponse>;
  health(): Promise<boolean>;
  listModels(): Promise<string[]>;
}

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
}

/**
 * Create a provider instance from config
 */
export function createProvider(config: ProviderConfig): Provider {
  switch (config.kind) {
    case 'local':
      return new LocalProvider(config);

    case 'cloud':
      switch (config.name) {
        case 'anthropic':
          return new AnthropicProvider(config);
        case 'openai':
          return new OpenAIProvider(config);
        case 'groq':
          return new GroqProvider(config);
        case 'gemini':
          return new GeminiProvider(config);
        case 'grok':
          return new GrokProvider(config);
        default:
          throw new Error(`Unknown cloud provider: ${config.name}`);
      }

    default:
      throw new Error(`Unknown provider kind: ${config.kind}`);
  }
}
