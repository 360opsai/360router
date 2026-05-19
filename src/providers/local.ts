/**
 * Local OpenAI-compatible provider
 * Works with Ollama, LM Studio, vLLM, Jan, and other OpenAI-compatible servers
 */

import type { Provider, RouteResponse, EmbedResponse, ProviderRouteOptions } from './index.js';
import type { ProviderConfig } from '../core/config.js';
import type { Message } from '../core/router.js';

export class LocalProvider implements Provider {
  name: string;
  kind: 'local' | 'cloud' = 'local';
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.apiKey = config.apiKey;
  }

  /**
   * Route a request to the local provider
   */
  async route(messages: Message[], options: ProviderRouteOptions = {}): Promise<RouteResponse> {
    // Get available models if no model specified
    let model = options.model;
    if (!model) {
      const models = await this.listModels();
      if (models.length === 0) {
        throw new Error('No models available');
      }
      model = models[0];
    }

    // Try OpenAI-compatible endpoint
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const requestBody: any = {
      model,
      messages,
      stream: false
    };

    // Add tools if provided, but be ready to retry without them if backend doesn't support
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      if (options.tool_choice) {
        requestBody.tool_choice = options.tool_choice;
      }
    }

    if (options.maxTokens) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000)
    });

    // If tools caused an error, retry without tools
    if (!response.ok && options.tools) {
      const { tools, tool_choice, ...bodyWithoutTools } = requestBody;
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyWithoutTools),
        signal: AbortSignal.timeout(60000)
      });
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local provider error: ${response.status} ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const tool_calls = data.choices?.[0]?.message?.tool_calls;

    return {
      content,
      model: data.model || model,
      tool_calls
    };
  }

  /**
   * Check if provider is healthy
   */
  async health(): Promise<boolean> {
    try {
      // Try to list models as health check
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stream a request to the local provider
   */
  async *routeStream(messages: Message[], options: ProviderRouteOptions = {}): AsyncGenerator<string> {
    // Get available models if no model specified
    let model = options.model;
    if (!model) {
      const models = await this.listModels();
      if (models.length === 0) {
        throw new Error('No models available');
      }
      model = models[0];
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const requestBody: any = {
      model,
      messages,
      stream: true
    };

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      if (options.tool_choice) {
        requestBody.tool_choice = options.tool_choice;
      }
    }

    if (options.maxTokens) {
      requestBody.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local provider error: ${response.status} ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    // Parse SSE stream (Ollama and vLLM both return OpenAI format)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            try {
              const parsed = JSON.parse(data);
              // Pass through OpenAI-format SSE
              yield JSON.stringify(parsed);
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generate embeddings
   */
  async embed(input: string | string[], model?: string): Promise<EmbedResponse> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'nomic-embed-text',
        input
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding error: ${response.status} ${error}`);
    }

    const data = await response.json();
    const embeddings = (data.data || []).map((item: any) => item.embedding);

    return {
      embeddings,
      model: data.model || model || 'unknown'
    };
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Try Ollama-specific endpoint first
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers,
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const data = await response.json();
        return (data.models || []).map((m: any) => m.name);
      }
    } catch {
      // Fall through to OpenAI endpoint
    }

    // Try OpenAI-compatible endpoint
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    const data = await response.json();
    return (data.data || []).map((m: any) => m.id);
  }
}
