// Trusted credential storage and provider configuration helpers.

export const CREDENTIAL_STORAGE_MIGRATION_VERSION = 1;

const TEXT_PROVIDER_API_KEY_FIELDS = Object.freeze({
  openai: 'openaiApiKey',
  anthropic: 'anthropicApiKey',
  gemini: 'geminiApiKey'
});

const TEXT_PROVIDER_STORAGE_KEYS = Object.freeze([
  'settings',
  'selectedProvider',
  ...Object.values(TEXT_PROVIDER_API_KEY_FIELDS)
]);

const CREDENTIAL_MIGRATION_STORAGE_KEYS = Object.freeze([
  'credentialStorageMigrationVersion',
  ...TEXT_PROVIDER_STORAGE_KEYS
]);

const ALL_CREDENTIAL_FIELDS = Object.freeze([
  'apiKey',
  ...Object.values(TEXT_PROVIDER_API_KEY_FIELDS),
  'elevenlabsApiKey',
  'googleTtsApiKey'
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stripEmbeddedCredentials(settings = {}) {
  if (!isRecord(settings)) return {};

  const safeSettings = { ...settings };
  for (const credentialField of ALL_CREDENTIAL_FIELDS) {
    delete safeSettings[credentialField];
  }
  return safeSettings;
}

export function buildCredentialStorageMigration(data = {}) {
  const currentVersion = Number(data.credentialStorageMigrationVersion) || 0;
  const embeddedCredentialFields = isRecord(data.settings)
    ? ALL_CREDENTIAL_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(data.settings, field))
    : [];
  const hasEmbeddedCredentials = embeddedCredentialFields.length > 0;

  if (currentVersion >= CREDENTIAL_STORAGE_MIGRATION_VERSION && !hasEmbeddedCredentials) {
    return {};
  }

  const patch = {
    credentialStorageMigrationVersion: CREDENTIAL_STORAGE_MIGRATION_VERSION
  };

  if (hasEmbeddedCredentials) {
    patch.settings = stripEmbeddedCredentials(data.settings);

    const provider = data.selectedProvider || data.settings.provider;
    const providerKeyField = TEXT_PROVIDER_API_KEY_FIELDS[provider];
    if (providerKeyField && !data[providerKeyField] && typeof data.settings.apiKey === 'string' && data.settings.apiKey) {
      patch[providerKeyField] = data.settings.apiKey;
    }
  }

  return patch;
}

export function getApiKeyForProvider(provider, data = {}) {
  const keyField = TEXT_PROVIDER_API_KEY_FIELDS[provider];
  return keyField ? data[keyField] || '' : '';
}

export function resolveTextProviderContext(data = {}) {
  const storedSettings = stripEmbeddedCredentials(data.settings);
  const requestedProvider = data.selectedProvider || storedSettings.provider || 'openai';
  const provider = Object.prototype.hasOwnProperty.call(TEXT_PROVIDER_API_KEY_FIELDS, requestedProvider)
    ? requestedProvider
    : 'openai';
  const settings = {
    ...storedSettings,
    provider
  };

  return {
    provider,
    model: settings.model,
    apiKey: getApiKeyForProvider(provider, data),
    settings
  };
}

export function buildContentTranslationSettings(settings = {}) {
  const safeSettings = stripEmbeddedCredentials(settings);
  const provider = Object.prototype.hasOwnProperty.call(TEXT_PROVIDER_API_KEY_FIELDS, safeSettings.provider)
    ? safeSettings.provider
    : 'openai';
  const targetLang = typeof safeSettings.targetLang === 'string' && safeSettings.targetLang.trim()
    ? safeSettings.targetLang
    : 'English';

  return { provider, targetLang };
}

export function extractContentTranslationRequest(payload = {}) {
  if (!isRecord(payload)) {
    return { requestId: '', textPayload: undefined };
  }

  return {
    requestId: typeof payload.requestId === 'string' ? payload.requestId : '',
    textPayload: typeof payload.textPayload === 'string' ? payload.textPayload : undefined
  };
}

export async function initializeCredentialStorageSecurity(storageArea) {
  if (!storageArea?.setAccessLevel || !storageArea?.get || !storageArea?.set) {
    throw new Error('Chrome trusted credential storage APIs are unavailable.');
  }

  await storageArea.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const data = await storageArea.get(CREDENTIAL_MIGRATION_STORAGE_KEYS);
  const migration = buildCredentialStorageMigration(data);

  if (Object.keys(migration).length > 0) {
    await storageArea.set(migration);
  }

  return migration;
}

export async function loadTextProviderContext(storageArea) {
  const data = await storageArea.get(TEXT_PROVIDER_STORAGE_KEYS);
  return resolveTextProviderContext(data);
}

export function isSameExtensionSender(sender, runtimeId) {
  return Boolean(sender && sender.id === runtimeId);
}

export function isExtensionPageSender(sender, runtimeId, pageUrl) {
  return isSameExtensionSender(sender, runtimeId) &&
    typeof sender.url === 'string' &&
    (sender.url === pageUrl || sender.url.startsWith(`${pageUrl}?`) || sender.url.startsWith(`${pageUrl}#`));
}

export function isOptionsSender(sender, runtimeId, getUrl) {
  return isExtensionPageSender(sender, runtimeId, getUrl('options.html'));
}

export function isOffscreenSender(sender, runtimeId, getUrl) {
  return !sender?.tab && isExtensionPageSender(sender, runtimeId, getUrl('offscreen.html'));
}

export function isStandaloneSender(sender, runtimeId, getUrl) {
  return isExtensionPageSender(sender, runtimeId, getUrl('standalone.html'));
}

export function isContentOperationSender(sender, runtimeId, getUrl) {
  if (!isSameExtensionSender(sender, runtimeId) || !Number.isInteger(sender?.tab?.id)) {
    return false;
  }

  const extensionRoot = getUrl('');
  return typeof sender.url === 'string' &&
    (!sender.url.startsWith(extensionRoot) || isStandaloneSender(sender, runtimeId, getUrl));
}
