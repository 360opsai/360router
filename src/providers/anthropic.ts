/**
 * Anthropic provider (Claude)
 * Uses official Anthropic SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Provider, RouteResponse, EmbedResponse, ProviderRouteOptions } from './index.js';
import type { ProviderConfig } from '../core/config.js';
import type { Message } from '../core/router.js';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  kind: 'local' | 'cloud' = 'cloud';
  private client: Anthropic;
  private defaultModel = 'claude-sonnet-4-5';

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.client = new Anthropic({
      apiKey: config.apiKey
    });
  }

  /**
   * Route a request to Anthropic
   */
  async route(messages: Message[], options: ProviderRouteOptions = {}): Promise<RouteResponse> {
    // Extract system message if present
    let system: string | undefined;
    const chatMessages = messages.filter(m => {
      if (m.role === 'system') {
        system = m.content;
        return false;
      }
      return true;
    });

    const requestParams: any = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      system,
      messages: chatMessages as any
    };

    // Translate OpenAI tools format to Anthropic format
    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools.map((tool: any) => ({
        name: tool.function?.name || tool.name,
        description: tool.function?.description || tool.description || '',
        input_schema: tool.function?.parameters || tool.input_schema || {}
      }));

      if (options.tool_choice) {
        requestParams.tool_choice = options.tool_choice;
      }
    }

    if (options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const response = await this.client.messages.create(requestParams);

    // Extract text content
    let textContent = '';
    const tool_calls: any[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        // Translate Anthropic tool_use to OpenAI tool_calls format
        tool_calls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      }
    }

    return {
      content: textContent,
      model: response.model,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined
    };
  }

  /**
   * Stream a request to Anthropic (translate to OpenAI SSE format)
   */
  async *routeStream(messages: Message[], options: ProviderRouteOptions = {}): AsyncGenerator<string> {
    // Extract system message if present
    let system: string | undefined;
    const chatMessages = messages.filter(m => {
      if (m.role === 'system') {
        system = m.content;
        return false;
      }
      return true;
    });

    const requestParams: any = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      system,
      messages: chatMessages as any
    };

    // Translate OpenAI tools format to Anthropic format
    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools.map((tool: any) => ({
        name: tool.function?.name || tool.name,
        description: tool.function?.description || tool.description || '',
        input_schema: tool.function?.parameters || tool.input_schema || {}
      }));

      if (options.tool_choice) {
        requestParams.tool_choice = options.tool_choice;
      }
    }

    if (options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const stream = await this.client.messages.stream(requestParams);

    // Translate Anthropic events to OpenAI format
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          // Translate to OpenAI format
          yield JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model || this.defaultModel,
            choices: [
              {
                index: 0,
                delta: {
                  content: delta.text
                },
                finish_reason: null
              }
            ]
          });
        }
      } else if (event.type === 'message_stop') {
        // Send final chunk
        yield JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model || this.defaultModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }
          ]
        });
      }
    }
  }

  /**
   * Check if provider is healthy
   */
  async health(): Promise<boolean> {
    try {
      // Simple health check - try to list models
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a models endpoint, return known models
    return [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ];
  }
}
