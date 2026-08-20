import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  modelDisplayNames,
  noTemperatureModels,
  providerModels
} from '../src/shared/constants.js';
import {
  getReasoningEffort,
  supportsTemperature,
  usesOpenAIResponsesApi
} from '../src/shared/utils.js';
import {
  buildModelDefaultsMigration,
  MODEL_DEFAULTS_MIGRATION_VERSION
} from '../src/shared/model-migration.js';
import {
  buildOpenAIChatCompletionsRequestBody,
  buildOpenAIResponsesRequestBody,
  DEFAULT_OPENAI_MODEL
} from '../src/background/api/openai.js';
import {
  addThinkingConfig,
  DEFAULT_GEMINI_MODEL,
  resolveGeminiModel
} from '../src/background/api/gemini.js';
import {
  buildAnthropicRequestBody,
  DEFAULT_ANTHROPIC_MODEL,
  extractAnthropicText,
  parseAnthropicSseEvent,
  readAnthropicSseStream
} from '../src/background/api/anthropic.js';
import { normalizeElevenLabsModelId } from '../src/background/api/tts.js';

test('provider catalogs expose the latest defaults and preserve older choices', () => {
  assert.equal(providerModels.openai[0], 'gpt-5.6-sol');
  assert.equal(providerModels.anthropic[0], 'claude-sonnet-5');
  assert.equal(providerModels.gemini[0], 'gemini-3.7-flash-medium');
  assert.equal(DEFAULT_OPENAI_MODEL, providerModels.openai[0]);
  assert.equal(DEFAULT_ANTHROPIC_MODEL, providerModels.anthropic[0]);
  assert.equal(DEFAULT_GEMINI_MODEL, providerModels.gemini[0]);
  assert.ok(providerModels.openai.includes('gpt-5.5'));
  assert.ok(providerModels.anthropic.includes('claude-sonnet-4-6'));
  assert.ok(providerModels.gemini.includes('gemini-3-pro-preview'));
  assert.equal(modelDisplayNames['claude-fable-5'], 'Claude Fable 5 (30-day retention)');
});

test('classic options-page model catalogs stay synchronized with shared constants', () => {
  const optionsSource = readFileSync(new URL('../options.js', import.meta.url), 'utf8');
  const start = optionsSource.indexOf('const noTemperatureModels');
  const end = optionsSource.indexOf('// Default lesson prompt');
  assert.ok(start >= 0 && end > start);

  const optionsCatalog = vm.runInNewContext(
    `${optionsSource.slice(start, end)}\n({ noTemperatureModels, providerModels, modelDisplayNames })`
  );
  const normalizedOptionsCatalog = JSON.parse(JSON.stringify(optionsCatalog));

  assert.deepEqual(normalizedOptionsCatalog.providerModels, providerModels);
  assert.deepEqual(normalizedOptionsCatalog.modelDisplayNames, modelDisplayNames);
  assert.deepEqual(normalizedOptionsCatalog.noTemperatureModels, noTemperatureModels);
});

test('GPT-5.6 uses Responses with the preserved low and medium reasoning levels', () => {
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.equal(usesOpenAIResponsesApi(model), true);
    assert.equal(supportsTemperature(model), false);
    assert.equal(getReasoningEffort(model, false), 'low');
    assert.equal(getReasoningEffort(model, true), 'medium');
  }

  assert.deepEqual(
    buildOpenAIResponsesRequestBody('hello', 'gpt-5.6-sol', false),
    {
      model: 'gpt-5.6-sol',
      input: 'hello',
      max_output_tokens: 16384,
      reasoning: { effort: 'low' }
    }
  );
});

test('GPT-5.2 chat requests omit unsupported temperature values', () => {
  assert.equal(supportsTemperature('gpt-5.2'), false);
  assert.deepEqual(
    buildOpenAIChatCompletionsRequestBody('hello', 'gpt-5.2', true, 0.1, true),
    {
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoning_effort: 'medium'
    }
  );
});

test('Claude 5 request builder applies thinking policy and omits sampling parameters', () => {
  const disabled = buildAnthropicRequestBody('hello', 'claude-sonnet-5');
  assert.equal(disabled.max_tokens, 16384);
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal('temperature' in disabled, false);

  const enabled = buildAnthropicRequestBody('hello', 'claude-opus-5', {
    settings: { anthropicThinkingEnabled: true }
  });
  assert.deepEqual(enabled.thinking, { type: 'adaptive' });

  const fable = buildAnthropicRequestBody('hello', 'claude-fable-5', {
    settings: { anthropicThinkingEnabled: false }
  });
  assert.deepEqual(fable.thinking, { type: 'adaptive' });

  const legacy = buildAnthropicRequestBody('hello', 'claude-sonnet-4-6');
  assert.equal(legacy.temperature, 0.1);
  assert.equal('thinking' in legacy, false);
});

test('Claude response parsing finds text blocks and surfaces HTTP-200 refusals', () => {
  assert.equal(extractAnthropicText({
    content: [
      { type: 'thinking', thinking: 'hidden reasoning' },
      { type: 'text', text: 'translated text' }
    ],
    stop_reason: 'end_turn'
  }), 'translated text');

  assert.throws(() => extractAnthropicText({
    content: [],
    stop_reason: 'refusal',
    stop_details: { explanation: 'Request not allowed' }
  }), /Anthropic refused the request: Request not allowed/);

  const streamedRefusal = parseAnthropicSseEvent({
    type: 'message_delta',
    delta: {
      stop_reason: 'refusal',
      stop_details: { explanation: 'Streaming request not allowed' }
    }
  });
  assert.match(streamedRefusal.refusal.message, /Streaming request not allowed/);
});

test('Claude streaming surfaces a terminal refusal instead of treating HTTP 200 as success', async () => {
  const events = [
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}',
    '',
    'data: {"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"explanation":"Policy refusal"}}}',
    ''
  ].join('\n');
  const chunks = [];

  await assert.rejects(
    readAnthropicSseStream(new Response(events), null, (chunk) => chunks.push(chunk)),
    /Anthropic refused the request: Policy refusal/
  );
  assert.deepEqual(chunks, ['partial']);
});

test('Gemini picker variants normalize to official model IDs and fixed thinking levels', () => {
  assert.deepEqual(resolveGeminiModel(), {
    requestedModel: 'gemini-3.7-flash-medium',
    modelId: 'gemini-3.7-flash',
    thinkingLevel: 'medium'
  });
  assert.equal(resolveGeminiModel('gemini-3.7-flash-low').thinkingLevel, 'low');
  assert.deepEqual(resolveGeminiModel('gemini-3.5-flash-lite'), {
    requestedModel: 'gemini-3.5-flash-lite',
    modelId: 'gemini-3.5-flash-lite',
    thinkingLevel: 'minimal'
  });
  assert.equal(supportsTemperature('gemini-3.7-flash'), false);

  const generationConfig = {};
  addThinkingConfig(generationConfig, 'gemini-3.7-flash', 'high', false);
  assert.deepEqual(generationConfig.thinkingConfig, { thinkingLevel: 'high' });

  assert.equal(resolveGeminiModel('gemini-3-pro-preview').modelId, 'gemini-3.1-pro-preview');
  const proThinkingOff = {};
  addThinkingConfig(proThinkingOff, 'gemini-2.5-pro', null, false);
  assert.deepEqual(proThinkingOff.thinkingConfig, { thinkingBudget: 128 });
  const proThinkingOn = {};
  addThinkingConfig(proThinkingOn, 'gemini-2.5-pro', null, true);
  assert.deepEqual(proThinkingOn.thinkingConfig, { thinkingBudget: -1 });
});

test('ElevenLabs settings list current TTS models and normalize retired saved choices', () => {
  const optionsHtml = readFileSync(new URL('../options.html', import.meta.url), 'utf8');
  for (const model of ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2']) {
    assert.match(optionsHtml, new RegExp(`<option value="${model}">`));
  }
  for (const retired of ['eleven_monolingual_v1', 'eleven_turbo_v2_5', 'eleven_turbo_v2']) {
    assert.doesNotMatch(optionsHtml, new RegExp(`<option value="${retired}">`));
  }
  assert.equal(normalizeElevenLabsModelId('eleven_monolingual_v1'), 'eleven_flash_v2');
  assert.equal(normalizeElevenLabsModelId('eleven_multilingual_v1'), 'eleven_multilingual_v2');
  assert.equal(normalizeElevenLabsModelId('eleven_turbo_v2_5'), 'eleven_flash_v2_5');
  assert.equal(normalizeElevenLabsModelId('eleven_turbo_v2'), 'eleven_flash_v2');
});

test('default-model migration updates exact defaults and active nested settings once', () => {
  const patch = buildModelDefaultsMigration({
    selectedProvider: 'anthropic',
    openaiModel: 'gpt-5.5',
    anthropicModel: 'claude-sonnet-4-6',
    geminiModel: 'gemini-3.5-flash-medium',
    model: 'claude-sonnet-4-6',
    settings: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      targetLang: 'English'
    }
  });

  assert.deepEqual(patch, {
    modelDefaultsMigrationVersion: MODEL_DEFAULTS_MIGRATION_VERSION,
    openaiModel: 'gpt-5.6-sol',
    anthropicModel: 'claude-sonnet-5',
    geminiModel: 'gemini-3.7-flash-medium',
    model: 'claude-sonnet-5',
    settings: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      targetLang: 'English'
    }
  });

  assert.deepEqual(buildModelDefaultsMigration({
    modelDefaultsMigrationVersion: MODEL_DEFAULTS_MIGRATION_VERSION
  }), {});
});

test('default-model migration preserves custom and explicit non-default selections', () => {
  assert.deepEqual(buildModelDefaultsMigration({
    selectedProvider: 'openai',
    openaiModel: 'gpt-5.5',
    openaiCustomModel: 'gpt-custom',
    anthropicModel: 'claude-opus-4-8',
    geminiModel: 'gemini-3.5-flash-high',
    model: 'gpt-5.5',
    customModel: 'gpt-custom',
    settings: { provider: 'openai', model: 'gpt-5.5' }
  }), {
    modelDefaultsMigrationVersion: MODEL_DEFAULTS_MIGRATION_VERSION
  });

  assert.deepEqual(buildModelDefaultsMigration({
    selectedProvider: 'openai',
    openaiModel: 'gpt-5.4',
    model: 'gpt-5.5',
    settings: { provider: 'openai', model: 'gpt-5.5' }
  }), {
    modelDefaultsMigrationVersion: MODEL_DEFAULTS_MIGRATION_VERSION
  });
});
