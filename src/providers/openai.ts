/**
 * OpenAI provider
 * Uses official OpenAI SDK
 */

import OpenAI from 'openai';
import type { Provider, RouteResponse, EmbedResponse, ProviderRouteOptions } from './index.js';
import type { ProviderConfig } from '../core/config.js';
import type { Message } from '../core/router.js';

export class OpenAIProvider implements Provider {
  name = 'openai';
  kind: 'local' | 'cloud' = 'cloud';
  private client: OpenAI;
  private defaultModel = 'gpt-4o';

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey
    });
  }

  /**
   * Route a request to OpenAI
   */
  async route(messages: Message[], options: ProviderRouteOptions = {}): Promise<RouteResponse> {
    const requestParams: any = {
      model: options.model || this.defaultModel,
      messages: messages as any
    };

    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools;
      if (options.tool_choice) {
        requestParams.tool_choice = options.tool_choice;
      }
    }

    if (options.maxTokens) {
      requestParams.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const response = await this.client.chat.completions.create(requestParams);

    const content = response.choices[0]?.message?.content || '';
    const tool_calls = response.choices[0]?.message?.tool_calls;

    return {
      content,
      model: response.model,
      tool_calls: tool_calls as any
    };
  }

  /**
   * Stream a request to OpenAI
   */
  async *routeStream(messages: Message[], options: ProviderRouteOptions = {}): AsyncGenerator<string> {
    const requestParams: any = {
      model: options.model || this.defaultModel,
      messages: messages as any,
      stream: true
    };

    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools;
      if (options.tool_choice) {
        requestParams.tool_choice = options.tool_choice;
      }
    }

    if (options.maxTokens) {
      requestParams.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const stream = await this.client.chat.completions.create(requestParams);

    for await (const chunk of stream) {
      // Pass through OpenAI SSE format
      yield JSON.stringify(chunk);
    }
  }

  /**
   * Generate embeddings
   */
  async embed(input: string | string[], model?: string): Promise<EmbedResponse> {
    const response = await this.client.embeddings.create({
      model: model || 'text-embedding-3-small',
      input
    });

    const embeddings = response.data.map(item => item.embedding);

    return {
      embeddings,
      model: response.model
    };
  }

  /**
   * Check if provider is healthy
   */
  async health(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    return response.data
      .filter(m => m.id.startsWith('gpt-'))
      .map(m => m.id)
      .sort()
      .reverse();
  }
}
