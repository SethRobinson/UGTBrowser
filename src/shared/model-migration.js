// src/shared/model-migration.js
// Idempotent migration for provider defaults that changed in model catalog version 1.

export const MODEL_DEFAULTS_MIGRATION_VERSION = 1;

const DEFAULT_MODEL_MIGRATIONS = {
  openai: {
    from: new Set(["gpt-5.5"]),
    to: "gpt-5.6-sol"
  },
  anthropic: {
    from: new Set(["claude-sonnet-4-6"]),
    to: "claude-sonnet-5"
  },
  gemini: {
    from: new Set(["gemini-3.5-flash", "gemini-3.5-flash-medium"]),
    to: "gemini-3.7-flash-medium"
  }
};

function hasCustomModel(data, provider) {
  return Boolean(data?.[`${provider}CustomModel`]?.trim?.());
}

function migrateModelValue(provider, model) {
  const migration = DEFAULT_MODEL_MIGRATIONS[provider];
  return migration?.from.has(model) ? migration.to : model;
}

function hasExplicitProviderModel(data, provider) {
  const providerModel = data?.[`${provider}Model`];
  return Boolean(providerModel && migrateModelValue(provider, providerModel) === providerModel);
}

/**
 * Build the smallest storage patch needed to move exact former defaults.
 * Explicit non-default and custom model choices are preserved.
 */
export function buildModelDefaultsMigration(data = {}) {
  if ((data.modelDefaultsMigrationVersion || 0) >= MODEL_DEFAULTS_MIGRATION_VERSION) {
    return {};
  }

  const patch = {
    modelDefaultsMigrationVersion: MODEL_DEFAULTS_MIGRATION_VERSION
  };

  for (const provider of Object.keys(DEFAULT_MODEL_MIGRATIONS)) {
    const modelKey = `${provider}Model`;
    const currentModel = data[modelKey];
    if (!hasCustomModel(data, provider)) {
      const migratedModel = migrateModelValue(provider, currentModel);
      if (migratedModel && migratedModel !== currentModel) {
        patch[modelKey] = migratedModel;
      }
    }
  }

  const selectedProvider = data.selectedProvider || data.settings?.provider;
  const selectedHasCustomModel = selectedProvider && (
    hasCustomModel(data, selectedProvider) || Boolean(data.customModel?.trim?.())
  );

  if (selectedProvider && !selectedHasCustomModel && !hasExplicitProviderModel(data, selectedProvider)) {
    const migratedLegacyModel = migrateModelValue(selectedProvider, data.model);
    if (migratedLegacyModel && migratedLegacyModel !== data.model) {
      patch.model = migratedLegacyModel;
    }
  }

  if (data.settings && typeof data.settings === 'object') {
    const settingsProvider = data.settings.provider || selectedProvider;
    const settingsHasCustomModel = settingsProvider && (
      hasCustomModel(data, settingsProvider) || Boolean(data.customModel?.trim?.())
    );
    const migratedSettingsModel = settingsProvider && !settingsHasCustomModel && !hasExplicitProviderModel(data, settingsProvider)
      ? migrateModelValue(settingsProvider, data.settings.model)
      : data.settings.model;

    if (migratedSettingsModel && migratedSettingsModel !== data.settings.model) {
      patch.settings = {
        ...data.settings,
        model: migratedSettingsModel
      };
    }
  }

  return patch;
}
