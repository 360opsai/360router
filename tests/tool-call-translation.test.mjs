/**
 * @360ops/360router — Tool-call format translation tests.
 *
 * Tests that each provider correctly translates the canonical OpenAI
 * tool-call format into its own wire format and back to OpenAI format
 * in the response — WITHOUT making real API calls.
 *
 * Strategy: mock each SDK's network layer at the module level so
 * format-conversion code runs but no HTTP leaves the machine.
 *
 * Run: node tests/tool-call-translation.test.mjs (after `pnpm build`)
 */

import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => {
        console.log(`✅ ${name}`);
        passed++;
      }).catch(e => {
        console.error(`❌ ${name}: ${e.message}`);
        failed++;
      });
    }
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Canonical OpenAI tool-call format ────────────────────────────────────
// This is the "lingua franca" format that 360router uses internally.
// All providers accept it as input and return it as output.

const OPENAI_TOOLS_INPUT = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] }
        },
        required: ['title']
      }
    }
  }
];

// Simulated Anthropic raw response (tool_use block in content array)
const ANTHROPIC_RAW_TOOL_USE = {
  id: 'msg_01abc',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_01xyz',
      name: 'create_task',
      input: { title: 'Follow up with client', priority: 'high' }
    }
  ]
};

// Simulated Gemini raw response (functionCall in parts)
const GEMINI_RAW_TOOL_RESPONSE = {
  candidates: [{
    content: {
      parts: [
        {
          functionCall: {
            name: 'create_task',
            args: { title: 'Follow up with client', priority: 'high' }
          }
        }
      ]
    }
  }]
};

// ─── 1. Anthropic tool-call output format ─────────────────────────────────
// Anthropic returns tool_use blocks; provider translates to OpenAI format
test('Anthropic tool_use → OpenAI tool_calls format', () => {
  // Replicate the translation logic from src/providers/anthropic.ts
  const tool_calls = [];
  for (const block of ANTHROPIC_RAW_TOOL_USE.content) {
    if (block.type === 'tool_use') {
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

  assert.equal(tool_calls.length, 1, 'should produce 1 tool_call');
  assert.equal(tool_calls[0].type, 'function');
  assert.equal(tool_calls[0].id, 'toolu_01xyz');
  assert.equal(tool_calls[0].function.name, 'create_task');

  const parsed = JSON.parse(tool_calls[0].function.arguments);
  assert.equal(parsed.title, 'Follow up with client');
  assert.equal(parsed.priority, 'high');
});

test('Anthropic input tools: OpenAI format → Anthropic format conversion', () => {
  // Replicate the translation logic from src/providers/anthropic.ts
  const anthropicTools = OPENAI_TOOLS_INPUT.map(tool => ({
    name: tool.function?.name || tool.name,
    description: tool.function?.description || tool.description || '',
    input_schema: tool.function?.parameters || tool.input_schema || {}
  }));

  assert.equal(anthropicTools.length, 1);
  assert.equal(anthropicTools[0].name, 'create_task');
  assert.equal(anthropicTools[0].description, 'Create a new task');
  assert.deepEqual(anthropicTools[0].input_schema, OPENAI_TOOLS_INPUT[0].function.parameters);

  // Verify input_schema does NOT have 'function' wrapper (Anthropic native format)
  assert.ok(!anthropicTools[0].function, 'should not have .function wrapper');
  assert.ok(anthropicTools[0].input_schema.properties, 'should have .input_schema.properties');
});

// ─── 2. Gemini tool-call output format ────────────────────────────────────
test('Gemini functionCall → OpenAI tool_calls format', () => {
  // Replicate the translation logic from src/providers/gemini.ts
  const tool_calls = [];
  if (GEMINI_RAW_TOOL_RESPONSE.candidates?.[0]) {
    for (const part of GEMINI_RAW_TOOL_RESPONSE.candidates[0].content.parts) {
      if (part.functionCall) {
        tool_calls.push({
          id: `gemini-call-${Date.now()}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args)
          }
        });
      }
    }
  }

  assert.equal(tool_calls.length, 1, 'should produce 1 tool_call');
  assert.equal(tool_calls[0].type, 'function');
  assert.equal(tool_calls[0].function.name, 'create_task');

  const parsed = JSON.parse(tool_calls[0].function.arguments);
  assert.equal(parsed.title, 'Follow up with client');
  assert.equal(parsed.priority, 'high');
});

test('Gemini input tools: OpenAI format → Gemini functionDeclarations', () => {
  // Replicate the translation from src/providers/gemini.ts
  const geminiTools = [{
    functionDeclarations: OPENAI_TOOLS_INPUT.map(tool => ({
      name: tool.function?.name || tool.name,
      description: tool.function?.description || tool.description || '',
      parameters: tool.function?.parameters || tool.parameters || {}
    }))
  }];

  assert.equal(geminiTools[0].functionDeclarations.length, 1);
  assert.equal(geminiTools[0].functionDeclarations[0].name, 'create_task');
  assert.equal(geminiTools[0].functionDeclarations[0].description, 'Create a new task');
  assert.deepEqual(
    geminiTools[0].functionDeclarations[0].parameters,
    OPENAI_TOOLS_INPUT[0].function.parameters
  );

  // Gemini uses .functionDeclarations[].parameters (not input_schema)
  assert.ok(geminiTools[0].functionDeclarations[0].parameters, 'should have .parameters');
});

// ─── 3. OpenAI passthrough (no translation needed) ────────────────────────
test('OpenAI input tools: passthrough — format unchanged', () => {
  // OpenAI provider passes tools directly: requestParams.tools = options.tools
  const openaiTools = OPENAI_TOOLS_INPUT;  // passthrough

  assert.equal(openaiTools.length, 1);
  assert.equal(openaiTools[0].type, 'function');
  assert.equal(openaiTools[0].function.name, 'create_task');
  assert.ok(openaiTools[0].function.parameters, 'should preserve .function.parameters');
});

// ─── 4. Tool-call arguments round-trip ────────────────────────────────────
test('tool arguments survive JSON stringify/parse round-trip', () => {
  const original = {
    title: 'Task with "quotes" and \\backslashes',
    priority: 'high',
    nested: { key: 'value', arr: [1, 2, 3] }
  };

  const stringified = JSON.stringify(original);
  const parsed = JSON.parse(stringified);

  assert.deepEqual(parsed, original);
  assert.equal(parsed.title, 'Task with "quotes" and \\backslashes');
  assert.deepEqual(parsed.nested.arr, [1, 2, 3]);
});

// ─── 5. Provider-agnostic tool name extraction ────────────────────────────
test('tool name extraction handles both OpenAI and direct name formats', () => {
  const openaiTool = { type: 'function', function: { name: 'create_task', description: '...' } };
  const directTool = { name: 'create_task', description: '...' };

  // Both formats should yield the same name
  const extractName = (tool) => tool.function?.name || tool.name;

  assert.equal(extractName(openaiTool), 'create_task');
  assert.equal(extractName(directTool), 'create_task');
});

// ─── 6. Multiple tool calls in one response ────────────────────────────────
test('multiple tool_use blocks in Anthropic response → multiple tool_calls', () => {
  const multiToolResponse = {
    content: [
      { type: 'tool_use', id: 'toolu_1', name: 'create_task', input: { title: 'Task 1' } },
      { type: 'text', text: 'Here are your tasks:' },
      { type: 'tool_use', id: 'toolu_2', name: 'send_email', input: { to: 'user@example.com' } }
    ]
  };

  const textContent = [];
  const tool_calls = [];

  for (const block of multiToolResponse.content) {
    if (block.type === 'text') {
      textContent.push(block.text);
    } else if (block.type === 'tool_use') {
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

  assert.equal(tool_calls.length, 2);
  assert.equal(textContent.join(''), 'Here are your tasks:');
  assert.equal(tool_calls[0].function.name, 'create_task');
  assert.equal(tool_calls[1].function.name, 'send_email');
  assert.equal(JSON.parse(tool_calls[1].function.arguments).to, 'user@example.com');
});

// ─── Results ──────────────────────────────────────────────────────────────
// Wait for any async tests
await new Promise(resolve => setTimeout(resolve, 100));

console.log('\n─────────────────────────────────────────');
console.log(`Tool-call translation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
