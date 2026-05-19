/**
 * Google Gemini provider
 * Uses official Google Generative AI SDK
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Provider, RouteResponse, ProviderRouteOptions } from './index.js';
import type { ProviderConfig } from '../core/config.js';
import type { Message } from '../core/router.js';

export class GeminiProvider implements Provider {
  name = 'gemini';
  kind: 'local' | 'cloud' = 'cloud';
  private client: GoogleGenerativeAI;
  private defaultModel = 'gemini-2.0-flash-exp';

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  /**
   * Route a request to Gemini
   */
  async route(messages: Message[], options: ProviderRouteOptions = {}): Promise<RouteResponse> {
    const modelConfig: any = {
      model: options.model || this.defaultModel
    };

    // Translate OpenAI tools to Gemini functionDeclarations
    if (options.tools && options.tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: options.tools.map((tool: any) => ({
          name: tool.function?.name || tool.name,
          description: tool.function?.description || tool.description || '',
          parameters: tool.function?.parameters || tool.parameters || {}
        }))
      }];
    }

    const genModel = this.client.getGenerativeModel(modelConfig);

    // Convert messages to Gemini format
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const lastMessage = messages[messages.length - 1];

    const generationConfig: any = {};
    if (options.maxTokens) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }

    const chat = genModel.startChat({
      history: history as any,
      generationConfig
    });

    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    // Extract text content and tool calls
    let textContent = '';
    const tool_calls: any[] = [];

    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          // Handle text parts
          if (part.text) {
            textContent += part.text;
          }
          // Handle function call parts - translate to OpenAI format
          if ((part as any).functionCall) {
            const functionCall = (part as any).functionCall;
            tool_calls.push({
              id: `call_${Math.random().toString(36).substring(2, 15)}`,
              type: 'function',
              function: {
                name: functionCall.name,
                arguments: JSON.stringify(functionCall.args || {})
              }
            });
          }
        }
      }
    }

    // Fallback to response.text() if no parts found
    if (!textContent && tool_calls.length === 0) {
      textContent = response.text();
    }

    return {
      content: textContent,
      model: options.model || this.defaultModel,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined
    };
  }

  /**
   * Stream a request to Gemini (translate to OpenAI SSE format)
   */
  async *routeStream(messages: Message[], options: ProviderRouteOptions = {}): AsyncGenerator<string> {
    const modelConfig: any = {
      model: options.model || this.defaultModel
    };

    // Translate OpenAI tools to Gemini functionDeclarations
    if (options.tools && options.tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: options.tools.map((tool: any) => ({
          name: tool.function?.name || tool.name,
          description: tool.function?.description || tool.description || '',
          parameters: tool.function?.parameters || tool.parameters || {}
        }))
      }];
    }

    const genModel = this.client.getGenerativeModel(modelConfig);

    // Convert messages to Gemini format
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const lastMessage = messages[messages.length - 1];

    const generationConfig: any = {};
    if (options.maxTokens) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }

    const chat = genModel.startChat({
      history: history as any,
      generationConfig
    });

    const result = await chat.sendMessageStream(lastMessage.content);

    // Translate Gemini stream to OpenAI format
    let hasContent = false;
    for await (const chunk of result.stream) {
      // Check for function calls in the chunk
      if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            // Handle text parts
            if (part.text) {
              hasContent = true;
              yield JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: options.model || this.defaultModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: part.text
                    },
                    finish_reason: null
                  }
                ]
              });
            }
            // Handle function call parts
            if ((part as any).functionCall) {
              hasContent = true;
              const functionCall = (part as any).functionCall;
              yield JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: options.model || this.defaultModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: `call_${Math.random().toString(36).substring(2, 15)}`,
                          type: 'function',
                          function: {
                            name: functionCall.name,
                            arguments: JSON.stringify(functionCall.args || {})
                          }
                        }
                      ]
                    },
                    finish_reason: null
                  }
                ]
              });
            }
          }
        }
      }
    }

    // Send final chunk
    yield JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: options.model || this.defaultModel,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }
      ]
    });
  }

  /**
   * Check if provider is healthy
   */
  async health(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.defaultModel });
      await model.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    // Google doesn't expose a models endpoint easily, return known models
    return [
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.0-pro'
    ];
  }
}
