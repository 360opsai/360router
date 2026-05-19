/**
 * Groq provider
 * Uses official Groq SDK
 */

import Groq from 'groq-sdk';
import type { Provider, RouteResponse, ProviderRouteOptions } from './index.js';
import type { ProviderConfig } from '../core/config.js';
import type { Message } from '../core/router.js';

export class GroqProvider implements Provider {
  name = 'groq';
  kind: 'local' | 'cloud' = 'cloud';
  private client: Groq;
  private defaultModel = 'llama-3.3-70b-versatile';

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Groq API key is required');
    }

    this.client = new Groq({
      apiKey: config.apiKey
    });
  }

  /**
   * Route a request to Groq
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
   * Stream a request to Groq
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
    return response.data.map(m => m.id);
  }
}
