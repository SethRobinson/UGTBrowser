// src/shared/model-migration.js
// Idempotent, versioned migration for saved provider models.
// Each step runs once, in order, for installs whose stored version is below it,
// so a version-0 install passes through every step (gpt-5.5 -> gpt-5.6-sol -> gpt-6.1-sol).

export const MODEL_DEFAULTS_MIGRATION_VERSION = 2;

// Version 1 and the OpenAI/Anthropic parts of version 2 move only exact former
// defaults. The Gemini part of version 2 moves deprecated or shut-down IDs to the
// model Google already routes them to, keeping the same thinking level.
const MODEL_MIGRATION_STEPS = [
  {
    version: 1,
    models: {
      openai: { "gpt-5.5": "gpt-5.6-sol" },
      anthropic: { "claude-sonnet-4-6": "claude-sonnet-5" },
      gemini: {
        "gemini-3.5-flash": "gemini-3.7-flash-medium",
        "gemini-3.5-flash-medium": "gemini-3.7-flash-medium"
      }
    }
  },
  {
    version: 2,
    models: {
      openai: { "gpt-5.6-sol": "gpt-6.1-sol" },
      anthropic: { "claude-sonnet-5": "claude-sonnet-5-5" },
      gemini: {
        "gemini-3.7-flash": "gemini-3.8-flash-medium",
        "gemini-3.7-flash-low": "gemini-3.8-flash-low",
        "gemini-3.7-flash-medium": "gemini-3.8-flash-medium",
        "gemini-3.7-flash-high": "gemini-3.8-flash-high",
        "gemini-3.5-flash": "gemini-3.6-flash-medium",
        "gemini-3.5-flash-low": "gemini-3.6-flash-low",
        "gemini-3.5-flash-medium": "gemini-3.6-flash-medium",
        "gemini-3.5-flash-high": "gemini-3.6-flash-high",
        "gemini-3-pro-preview": "gemini-3.1-pro-preview"
      }
    }
  }
];

const PROVIDERS = ["openai", "anthropic", "gemini"];

function hasCustomModel(data, provider) {
  return Boolean(data?.[`${provider}CustomModel`]?.trim?.());
}

function getPendingSteps(data) {
  const currentVersion = Number(data.modelDefaultsMigrationVersion) || 0;
  return MODEL_MIGRATION_STEPS.filter((step) => step.version > currentVersion);
}

function migrateModelValue(steps, provider, model) {
  let migrated = model;
  for (const step of steps) {
    migrated = step.models[provider]?.[migrated] || migrated;
  }
  return migrated;
}

/**
 * A provider-specific model that no pending step changes is an explicit choice,
 * and the legacy `model` / `settings.model` copies must not override it.
 */
function hasExplicitProviderModel(data, steps, provider) {
  const providerModel = data?.[`${provider}Model`];
  return Boolean(providerModel && migrateModelValue(steps, provider, providerModel) === providerModel);
}

/**
 * Build the smallest storage patch needed to apply pending model migrations.
 * Explicit non-default and custom model choices are preserved.
 */
export function buildModelDefaultsMigration(data = {}) {
  const steps = getPendingSteps(data);
  if (steps.length === 0) {
    return {};
  }

  const patch = {
    modelDefaultsMigrationVersion: MODEL_DEFAULTS_MIGRATION_VERSION
  };

  for (const provider of PROVIDERS) {
    const modelKey = `${provider}Model`;
    const currentModel = data[modelKey];
    if (!hasCustomModel(data, provider)) {
      const migratedModel = migrateModelValue(steps, provider, currentModel);
      if (migratedModel && migratedModel !== currentModel) {
        patch[modelKey] = migratedModel;
      }
    }
  }

  const selectedProvider = data.selectedProvider || data.settings?.provider;
  const selectedHasCustomModel = selectedProvider && (
    hasCustomModel(data, selectedProvider) || Boolean(data.customModel?.trim?.())
  );

  if (selectedProvider && !selectedHasCustomModel && !hasExplicitProviderModel(data, steps, selectedProvider)) {
    const migratedLegacyModel = migrateModelValue(steps, selectedProvider, data.model);
    if (migratedLegacyModel && migratedLegacyModel !== data.model) {
      patch.model = migratedLegacyModel;
    }
  }

  if (data.settings && typeof data.settings === 'object') {
    const settingsProvider = data.settings.provider || selectedProvider;
    const settingsHasCustomModel = settingsProvider && (
      hasCustomModel(data, settingsProvider) || Boolean(data.customModel?.trim?.())
    );
    const migratedSettingsModel = settingsProvider && !settingsHasCustomModel && !hasExplicitProviderModel(data, steps, settingsProvider)
      ? migrateModelValue(steps, settingsProvider, data.settings.model)
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
