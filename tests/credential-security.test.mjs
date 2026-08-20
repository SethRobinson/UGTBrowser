import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CREDENTIAL_STORAGE_MIGRATION_VERSION,
  buildContentTranslationSettings,
  buildCredentialStorageMigration,
  extractContentTranslationRequest,
  initializeCredentialStorageSecurity,
  isContentOperationSender,
  isOffscreenSender,
  isOptionsSender,
  isStandaloneSender,
  loadTextProviderContext,
  resolveTextProviderContext
} from '../src/background/credential-security.js';
import {
  TRANSLATION_AUTHORIZATION_TTL_MS,
  TranslationAuthorizationStore
} from '../src/background/translation-authorization.js';

test('credential migration removes only the embedded settings key and is idempotent', () => {
  const stored = {
    openaiApiKey: 'openai-secret',
    anthropicApiKey: 'anthropic-secret',
    geminiApiKey: 'gemini-secret',
    elevenlabsApiKey: 'elevenlabs-secret',
    googleTtsApiKey: 'google-tts-secret',
    settings: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'legacy-embedded-secret',
      elevenlabsApiKey: 'legacy-elevenlabs-secret',
      googleTtsApiKey: 'legacy-google-tts-secret',
      targetLang: 'Japanese'
    }
  };

  const patch = buildCredentialStorageMigration(stored);
  assert.deepEqual(patch, {
    credentialStorageMigrationVersion: CREDENTIAL_STORAGE_MIGRATION_VERSION,
    settings: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      targetLang: 'Japanese'
    }
  });

  const migrated = { ...stored, ...patch };
  assert.equal(migrated.openaiApiKey, 'openai-secret');
  assert.equal(migrated.anthropicApiKey, 'anthropic-secret');
  assert.equal(migrated.geminiApiKey, 'gemini-secret');
  assert.equal(migrated.elevenlabsApiKey, 'elevenlabs-secret');
  assert.equal(migrated.googleTtsApiKey, 'google-tts-secret');
  assert.deepEqual(buildCredentialStorageMigration(migrated), {});
});

test('credential migration promotes an orphaned legacy key without overwriting a top-level key', () => {
  assert.deepEqual(buildCredentialStorageMigration({
    selectedProvider: 'gemini',
    settings: { provider: 'gemini', apiKey: 'legacy-gemini-secret', targetLang: 'English' }
  }), {
    credentialStorageMigrationVersion: CREDENTIAL_STORAGE_MIGRATION_VERSION,
    geminiApiKey: 'legacy-gemini-secret',
    settings: { provider: 'gemini', targetLang: 'English' }
  });

  const patch = buildCredentialStorageMigration({
    selectedProvider: 'openai',
    openaiApiKey: 'current-top-level-secret',
    settings: { provider: 'openai', apiKey: 'stale-embedded-secret' }
  });
  assert.equal('openaiApiKey' in patch, false);
});

test('credential storage initialization restricts access before migrating data', async () => {
  const calls = [];
  const storage = {
    async setAccessLevel(options) {
      calls.push(['setAccessLevel', options]);
    },
    async get(keys) {
      calls.push(['get', keys]);
      return { settings: { provider: 'openai', apiKey: 'legacy-secret' } };
    },
    async set(patch) {
      calls.push(['set', patch]);
    }
  };

  await initializeCredentialStorageSecurity(storage);
  assert.deepEqual(calls[0], ['setAccessLevel', { accessLevel: 'TRUSTED_CONTEXTS' }]);
  assert.equal(calls[1][0], 'get');
  assert.deepEqual(calls[2], ['set', {
    credentialStorageMigrationVersion: CREDENTIAL_STORAGE_MIGRATION_VERSION,
    openaiApiKey: 'legacy-secret',
    settings: { provider: 'openai' }
  }]);
});

test('credential storage initialization does not overwrite a retained top-level key', async () => {
  const writes = [];
  const storage = {
    async setAccessLevel() {},
    async get(keys) {
      assert.equal(keys.includes('openaiApiKey'), true);
      assert.equal(keys.includes('anthropicApiKey'), true);
      assert.equal(keys.includes('geminiApiKey'), true);
      return {
        openaiApiKey: 'current-top-level-secret',
        settings: { provider: 'openai', apiKey: 'stale-embedded-secret' }
      };
    },
    async set(patch) {
      writes.push(patch);
    }
  };

  await initializeCredentialStorageSecurity(storage);
  assert.equal(writes.length, 1);
  assert.equal('openaiApiKey' in writes[0], false);
  assert.deepEqual(writes[0].settings, { provider: 'openai' });
});

test('content translation settings expose only provider and target language', () => {
  assert.deepEqual(buildContentTranslationSettings({
    provider: 'gemini',
    targetLang: 'French',
    model: 'gemini-secret-model',
    promptTemplate: 'private prompt',
    apiKey: 'embedded-secret',
    openaiApiKey: 'top-level-shaped-secret'
  }), {
    provider: 'gemini',
    targetLang: 'French'
  });
});

test('content translation requests ignore message-supplied settings and credentials', () => {
  assert.deepEqual(extractContentTranslationRequest({
    requestId: 'request-1',
    textPayload: 'ugt_1: text',
    settings: { provider: 'openai', apiKey: 'embedded-secret' },
    apiKey: 'message-secret',
    openaiApiKey: 'top-level-shaped-secret'
  }), {
    requestId: 'request-1',
    textPayload: 'ugt_1: text'
  });
});

test('trusted provider context resolves only top-level credentials and strips message-shaped keys', async () => {
  const data = {
    selectedProvider: 'anthropic',
    openaiApiKey: 'openai-secret',
    anthropicApiKey: 'anthropic-secret',
    geminiApiKey: 'gemini-secret',
    settings: {
      provider: 'openai',
      model: 'claude-sonnet-5',
      apiKey: 'untrusted-embedded-secret',
      targetLang: 'English'
    }
  };

  const resolved = resolveTextProviderContext(data);
  assert.equal(resolved.provider, 'anthropic');
  assert.equal(resolved.apiKey, 'anthropic-secret');
  assert.equal('apiKey' in resolved.settings, false);

  const storage = {
    async get() {
      return data;
    }
  };
  assert.deepEqual(await loadTextProviderContext(storage), resolved);
});

test('translation authorizations are tab-bound, frame-bound, expiring, and single-use', () => {
  let now = 1_000;
  let sequence = 0;
  const store = new TranslationAuthorizationStore({
    now: () => now,
    createId: () => `request-${++sequence}`
  });

  const requestId = store.issue({ tabId: 12, frameId: 3, simpleMode: true });
  assert.equal(store.consume(requestId, { tabId: 99, frameId: 3 }), null);
  assert.equal(store.consume(requestId, { tabId: 12, frameId: 2 }), null);
  assert.deepEqual(store.consume(requestId, { tabId: 12, frameId: 3 }), {
    requestId,
    tabId: 12,
    frameId: 3,
    simpleMode: true,
    expiresAt: 1_000 + TRANSLATION_AUTHORIZATION_TTL_MS
  });
  assert.equal(store.consume(requestId, { tabId: 12, frameId: 3 }), null);

  const expiredId = store.issue({ tabId: 12, frameId: 0 });
  now += TRANSLATION_AUTHORIZATION_TTL_MS;
  assert.equal(store.consume(expiredId, { tabId: 12, frameId: 0 }), null);
});

test('sender validation separates options, offscreen, standalone, and web content contexts', () => {
  const runtimeId = 'extension-id';
  const getUrl = (path) => `chrome-extension://${runtimeId}/${path}`;
  const optionsSender = { id: runtimeId, url: getUrl('options.html'), tab: { id: 1 } };
  const offscreenSender = { id: runtimeId, url: getUrl('offscreen.html') };
  const standaloneSender = { id: runtimeId, url: `${getUrl('standalone.html')}?action=translate`, tab: { id: 2 } };
  const contentSender = { id: runtimeId, url: 'https://example.com/article', tab: { id: 3 } };

  assert.equal(isOptionsSender(optionsSender, runtimeId, getUrl), true);
  assert.equal(isOptionsSender(contentSender, runtimeId, getUrl), false);
  assert.equal(isOffscreenSender(offscreenSender, runtimeId, getUrl), true);
  assert.equal(isOffscreenSender({ ...offscreenSender, tab: { id: 4 } }, runtimeId, getUrl), false);
  assert.equal(isStandaloneSender(standaloneSender, runtimeId, getUrl), true);
  assert.equal(isContentOperationSender(contentSender, runtimeId, getUrl), true);
  assert.equal(isContentOperationSender(standaloneSender, runtimeId, getUrl), true);
  assert.equal(isContentOperationSender(optionsSender, runtimeId, getUrl), false);
  assert.equal(isContentOperationSender({ ...contentSender, id: 'other-extension' }, runtimeId, getUrl), false);
});

test('source contracts keep credentials and storage access out of the content script', () => {
  const contentSource = readFileSync(new URL('../contentScript.js', import.meta.url), 'utf8');
  const optionsSource = readFileSync(new URL('../options.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.doesNotMatch(contentSource, /chrome\.storage/);

  const saveStart = optionsSource.indexOf('const settingsToSave =');
  const nestedStart = optionsSource.indexOf('settings: {', saveStart);
  const saveEnd = optionsSource.indexOf('\n  };', nestedStart);
  assert.ok(saveStart >= 0 && nestedStart > saveStart && saveEnd > nestedStart);
  assert.doesNotMatch(optionsSource.slice(nestedStart, saveEnd), /\bapiKey\s*:/);

  const fetchMessageStart = contentSource.indexOf('type: "FETCH_TRANSLATION"');
  assert.ok(fetchMessageStart >= 0);
  assert.doesNotMatch(contentSource.slice(fetchMessageStart, fetchMessageStart + 350), /\bsettings\s*:|\bapiKey\s*:/);
  assert.equal(Number(manifest.minimum_chrome_version) >= 102, true);
});
