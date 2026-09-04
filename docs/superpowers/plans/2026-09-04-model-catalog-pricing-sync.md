# Model Catalog Pricing Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Models.dev as the single curated source for a daily, reviewable model metadata snapshot that ships offline, filters models per tool, and preserves user-edited metadata.

**Architecture:** A dependency-free Node synchronizer fetches `https://models.dev/api.json`, applies a checked-in popular-model policy, normalizes provider-scoped entries into the existing `src/config/model-metadata.json` shape, and leaves the previous snapshot untouched on failure. GitHub Actions runs it daily and opens a PR. Runtime code reads the packaged snapshot only; `modelMetadataOverrides` and `modelDefinitions` remain the higher-priority local layer, and the OMP catalog-metadata operation reads the snapshot without invoking the network or OMP's external model command.

**Tech Stack:** Node.js >=22.13.0 with built-in `fetch`, JSON, Express, Vue 3, Vitest, GitHub Actions, and the existing npm scripts.

---

## Files and ownership

### New files

- `scripts/model-catalog-policy.json`: explicit provider/model-family allowlist, runtime ID mode, tool visibility, and minimum accepted result size.
- `scripts/sync-model-catalog.js`: pure source validation/normalization functions plus the CLI entry point that writes the generated snapshot and a temporary PR report.
- `tests/unit/scripts/model-catalog-sync.test.js`: deterministic fixture tests for filtering, ID mapping, prices, preservation, and invalid upstream data.
- `src/web/src/composables/__tests__/useDefaultModels.test.js`: front-end tool-specific model grouping tests.
- `.github/workflows/sync-model-catalog.yml`: daily and manually dispatched synchronizer that opens a PR only for a validated diff.

### Modified files

- `package.json`: add `sync:model-catalog` without adding a runtime dependency.
- `src/config/model-metadata.json`: generated snapshot; never hand-edit generated model entries.
- `src/config/model-metadata.js`: expose snapshot provenance and tool-aware lookup helpers while preserving old aliases and fallback behavior.
- `src/server/api/settings.js`: return source information and tool-grouped catalog data without changing existing response fields.
- `src/platforms/drivers/codex/proxy-implementation.js`: remove the duplicate OpenAI model price table and family fallback.
- `src/platforms/drivers/gemini/proxy-implementation.js`: remove the duplicate Gemini model price table and family fallback.
- `src/platforms/drivers/gemini/sessions-implementation.js`: use the shared pricing resolver/default object instead of literal rates.
- `src/platforms/drivers/opencode/proxy-implementation.js`: remove the duplicate OpenAI model price table and family fallback.
- `src/platforms/drivers/omp/channels-implementation.js`: add local snapshot-backed `getCatalogMetadata`.
- `src/platforms/drivers/omp/channels.js`: expose `catalogMetadata` to the descriptor route.
- `src/web/src/composables/useDefaultModels.js`: group catalog entries using `toolTypes`, with legacy prefix fallback.
- `src/web/src/components/SettingsDrawer.vue`: display the Models.dev reference-price label and use metadata/provider fields for filters.
- `src/web/src/components/channel/BaseChannelPanel.vue`: explain the offline metadata action versus live model probing.
- `src/web/src/components/channel/channelPanelFactories.js`: allow offline OMP metadata retrieval without requiring a Provider Key.
- `tests/unit/config/model-metadata.test.js`: test provenance and tool-aware lookup.
- `tests/unit/api/settings.test.js`: test source and tool-group response fields.
- `tests/unit/services/proxy-cost.test.js`: prove shared metadata/default pricing is used instead of stale family tables.
- `tests/unit/platforms/drivers/omp-channels.test.js`: test the descriptor driver operation contract.
- `tests/unit/services/omp-catalog-metadata.test.js`: test local OMP metadata selection and no external lookup.

---

## Task 1: Freeze the synchronizer contract with policy and failing tests

**Files:**

- Create: `scripts/model-catalog-policy.json`
- Create: `tests/unit/scripts/model-catalog-sync.test.js`

- [ ] **Step 1: Add the explicit policy file.**

Create `scripts/model-catalog-policy.json` with this exact initial policy. Provider entries refer to the outer provider keys in Models.dev `api.json`; compatible providers retain a provider prefix in their runtime model ID.

```json
{
  "sourceUrl": "https://models.dev/api.json",
  "minimumModelCount": 12,
  "providers": {
    "openai": {
      "runtimeMode": "direct",
      "toolTypes": ["codex", "opencode", "omp"],
      "modelPatterns": ["^(gpt-|o[134](?:-|$))"]
    },
    "anthropic": {
      "runtimeMode": "direct",
      "toolTypes": ["claude", "opencode", "omp"],
      "modelPatterns": ["^claude-"]
    },
    "google": {
      "runtimeMode": "direct",
      "toolTypes": ["gemini", "opencode", "omp"],
      "modelPatterns": ["^gemini-"]
    },
    "deepseek": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^deepseek-"]
    },
    "alibaba": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^(qwen|deepseek-)"]
    },
    "moonshotai": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^kimi-"]
    },
    "zai": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^glm-"]
    },
    "mistral": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^(mistral|codestral|devstral)"]
    },
    "meta": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^(llama|meta-llama)"]
    },
    "xai": {
      "runtimeMode": "compatible",
      "toolTypes": ["opencode", "omp"],
      "modelPatterns": ["^grok-"]
    }
  }
}
```

- [ ] **Step 2: Write the normalizer tests before the implementation.**

Create `tests/unit/scripts/model-catalog-sync.test.js` using a source fixture shaped like the real Models.dev response: outer provider key, then `models`, then a model whose `id` is provider-local.

```js
'use strict';

const {
  buildSnapshot,
  validateSourcePayload,
  validateSnapshot
} = require('../../../scripts/sync-model-catalog');

const policy = {
  sourceUrl: 'https://models.dev/api.json',
  minimumModelCount: 1,
  providers: {
    openai: {
      runtimeMode: 'direct',
      toolTypes: ['codex', 'opencode', 'omp'],
      modelPatterns: ['^(gpt-|o[134](?:-|$))']
    },
    deepseek: {
      runtimeMode: 'compatible',
      toolTypes: ['opencode', 'omp'],
      modelPatterns: ['^deepseek-']
    }
  }
};

const source = {
  openai: {
    id: 'openai',
    models: {
      'gpt-5.5': {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        family: 'gpt',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1050000, output: 128000 },
        cost: { input: 5, output: 30, cache_read: 0.5 }
      },
      'chatgpt-image-latest': {
        id: 'chatgpt-image-latest',
        name: 'ChatGPT Image',
        family: 'image',
        tool_call: false,
        modalities: { input: ['text'], output: ['image'] },
        limit: { context: 128000, output: 1 },
        cost: { input: 1, output: 1 }
      }
    }
  },
  deepseek: {
    id: 'deepseek',
    models: {
      'deepseek-v4-pro': {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        family: 'deepseek-thinking',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.435, output: 0.87, cache_read: 0.003625 }
      },
      'deepseek-no-price': {
        id: 'deepseek-no-price',
        family: 'deepseek',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 128000, output: 8192 }
      }
    }
  }
};

describe('model catalog synchronizer contract', () => {
  test('accepts a provider-scoped Models.dev payload', () => {
    expect(() => validateSourcePayload(source)).not.toThrow();
  });

  test('normalizes direct and compatible IDs and maps cost fields', () => {
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models['gpt-5.5']).toMatchObject({
      sourceId: 'openai/gpt-5.5',
      provider: 'openai',
      toolTypes: ['codex', 'opencode', 'omp'],
      pricing: { input: 5, output: 30, cacheRead: 0.5 }
    });
    expect(result.snapshot.models['deepseek/deepseek-v4-pro']).toMatchObject({
      sourceId: 'deepseek/deepseek-v4-pro',
      provider: 'deepseek',
      toolTypes: ['opencode', 'omp']
    });
    expect(result.snapshot.aliases['deepseek-v4-pro']).toBe('deepseek/deepseek-v4-pro');
  });

  test('excludes non-text and unpriced entries and reports them', () => {
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models).not.toHaveProperty('chatgpt-image-latest');
    expect(result.snapshot.models).not.toHaveProperty('deepseek/deepseek-no-price');
    expect(result.warnings.join('\n')).toMatch(/chatgpt-image-latest|deepseek-no-price/);
  });

  test('preserves an existing model omitted by the source', () => {
    const previousSnapshot = {
      aliases: {},
      defaultModels: { claude: [], codex: [], gemini: [] },
      models: {
        'legacy-model': {
          limit: { context: 8192, output: 1024 },
          pricing: { input: 1, output: 2 }
        }
      }
    };
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot,
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models['legacy-model']).toEqual(previousSnapshot.models['legacy-model']);
    expect(result.changes.removed).toContain('legacy-model');
  });

  test('reports price and limit changes deterministically', () => {
    const previousSnapshot = {
      aliases: {},
      models: {
        'gpt-5.5': {
          sourceId: 'openai/gpt-5.5',
          limit: { context: 500000, output: 64000 },
          pricing: { input: 4, output: 20 }
        }
      }
    };
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot,
      updatedAt: '2026-09-04'
    });
    expect(result.changes.updated).toContain('gpt-5.5');
    expect(result.changes.priceChanged).toContain('gpt-5.5');
    expect(result.changes.limitChanged).toContain('gpt-5.5');
    expect(result.snapshot.models['gpt-5.5'].limit).toEqual({ context: 1050000, output: 128000 });
    expect(result.snapshot.models['gpt-5.5'].pricing.input).toBe(5);
  });

  test('keeps the previous snapshot date when normalized content is unchanged', () => {
    const first = buildSnapshot(source, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    }).snapshot;
    const second = buildSnapshot(source, {
      policy,
      previousSnapshot: first,
      updatedAt: '2026-09-05'
    }).snapshot;

    expect(second.lastUpdated).toBe('2026-09-04');
  });

  test('rejects duplicate runtime IDs and abnormal result sizes', () => {
    const duplicatePolicy = {
      ...policy,
      providers: {
        ...policy.providers,
        mirror: {
          runtimeMode: 'direct',
          toolTypes: ['codex'],
          modelPatterns: ['^gpt-']
        }
      }
    };
    const duplicateSource = {
      ...source,
      mirror: {
        models: {
          'gpt-5.5': { ...source.openai.models['gpt-5.5'], id: 'gpt-5.5' }
        }
      }
    };
    expect(() => buildSnapshot(duplicateSource, {
      policy: duplicatePolicy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    })).toThrow(/duplicate runtime model id/i);

    expect(() => validateSnapshot({ models: {} }, {
      selectedCount: 0,
      previousCount: 4,
      minimumModelCount: 1
    })).toThrow(/empty|abnormal/i);
  });

  test('filters negative prices and invalid limits with a warning', () => {
    const invalidSource = {
      ...source,
      openai: {
        ...source.openai,
        models: {
          ...source.openai.models,
          'gpt-invalid': {
            id: 'gpt-invalid',
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: -1, output: 1 },
            cost: { input: -1, output: 1 }
          }
        }
      }
    };
    const result = buildSnapshot(invalidSource, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    });
    expect(result.snapshot.models).not.toHaveProperty('gpt-invalid');
    expect(result.warnings.join('\n')).toMatch(/gpt-invalid|limit|cost/i);
  });

  test('rejects an invalid or empty upstream payload', () => {
    expect(() => validateSourcePayload({})).toThrow(/provider models/i);
    expect(() => validateSourcePayload({ openai: { models: [] } })).toThrow(/models must be an object/i);
    expect(() => validateSourcePayload({
      openai: { models: { invalid: { id: '' } } }
    })).toThrow(/model id/i);
  });
});
```

- [ ] **Step 3: Run only the new test to verify the contract is red.**

```bash
npx vitest run tests/unit/scripts/model-catalog-sync.test.js
```

Expected result: the test process fails because `scripts/sync-model-catalog.js` does not exist yet. Do not change the assertions to make a missing implementation pass.

- [ ] **Step 4: Commit the policy and red tests.**

```bash
git add scripts/model-catalog-policy.json tests/unit/scripts/model-catalog-sync.test.js
git commit -m "test: define model catalog sync contract"
```

Expected result: one commit containing only the synchronizer policy and its failing contract tests.

## Task 2: Implement the Models.dev normalizer and generator

**Files:**

- Create: `scripts/sync-model-catalog.js`
- Modify: `package.json`
- Modify: `src/config/model-metadata.json` through the generator only

- [ ] **Step 1: Implement the pure normalizer interface used by Task 1.**

Create `scripts/sync-model-catalog.js` with these exported functions and invariants:

```js
const SOURCE_URL = 'https://models.dev/api.json';

module.exports = {
  SOURCE_URL,
  validateSourcePayload,
  validateSnapshot,
  buildSnapshot,
  fetchSource,
  writeSnapshot,
  formatReport
};
```

Implement the functions as follows:

1. `validateSourcePayload(payload)` requires a non-array object with at least one outer provider whose `models` is a non-array object. Each model entry must be an object with a non-empty string `id`; throw messages containing `provider models`, `models must be an object`, or `model id` for those failures.
2. `buildSnapshot(payload, { policy, previousSnapshot, updatedAt })` iterates the policy provider keys, reads `payload[provider].models`, and applies the configured regular expressions to the provider-local model ID.
3. Reject entries unless `modalities.input` contains `text`, `modalities.output` contains `text`, `limit.context` and `limit.output` are finite positive numbers, and `cost.input` and `cost.output` are finite non-negative numbers. `tool_call === false` is rejected; missing `tool_call` is allowed so popular text models with incomplete capability metadata are not silently lost.
4. Omit entries whose `status` is explicitly `deprecated` or `expired`, unless the previous snapshot references their runtime ID or source ID; append a warning for every such omission.
5. Use `runtimeMode: "direct"` to set `id` to the raw model ID. Use `runtimeMode: "compatible"` to set `id` to `${provider}/${raw.id}`. Always set `sourceId` to `${provider}/${raw.id}` and `provider` to the outer provider key.
6. Map only fields understood by the current project: `name`, `reasoning`, `input` from text/image modalities, `supportsTools` from `tool_call`, `limit.context`, `limit.output`, and `pricing.input`, `pricing.output`, `pricing.cacheRead` from `cost.cache_read`, and `pricing.cacheCreation` from `cost.cache_write`. Copy only recognized reasoning effort values `minimal`, `low`, `medium`, `high`, and `xhigh` into the existing `thinking: { mode: 'effort', efforts }` shape.
7. If a selected entry lacks a usable cost or text capability, omit it from the generated source set and append a warning with its source ID. If it has `cost.tiers`, `context_over_200k`, or other unrepresented pricing dimensions, use the base `cost` values and append a warning naming the model and ignored fields.
8. Preserve every previous `aliases` entry and every previous `models` entry not selected in the new source. Record those retained IDs in `changes.removed`; never delete them automatically.
9. Build each native `defaultModels` list by retaining previous entries that still exist, then appending newly selected direct-provider entries with the matching tool type in `last_updated` descending/runtime ID ascending order. Preserve the previous order of retained defaults. Preserve `defaultSpeedTestModels` when its model still exists; otherwise choose the first generated entry for that tool.
10. Set `source: 'models.dev'` and `sourceUrl: SOURCE_URL`. Set `lastUpdated` to `updatedAt` only when normalized model/alias/default content differs from the previous snapshot; otherwise preserve `previousSnapshot.lastUpdated` so a no-change daily run produces no diff. Sort all model keys, aliases, and only the newly appended default entries deterministically before serialization. For a compatible model, add `aliases[raw.id] = runtimeId` only when that short ID is not already a model ID or alias; never overwrite an existing alias.
11. Return `{ snapshot, warnings, changes: { added, updated, removed, priceChanged, limitChanged } }`.

`validateSnapshot(snapshot, { selectedCount, previousCount, minimumModelCount })` rejects zero selected entries, selected counts below the policy minimum, selected counts below half of the previous model count when the previous count is non-zero, duplicate IDs, non-positive limits, and negative prices. `buildSnapshot` calls it only after source filtering and before returning.

The implementation must keep the CLI behind `if (require.main === module)` so the fixture tests import the pure functions without performing network I/O. `fetchSource(fetchImpl = fetch)` uses a 30-second abort timeout and throws on non-2xx responses. `writeSnapshot` compares the current file text before replacing it and writes `${JSON.stringify(snapshot, null, 2)}\n` only when it differs. `main` must read the previous snapshot before fetching, validate the transformed snapshot before writing, preserve `previousSnapshot.lastUpdated` when `changes` has no model/alias/default changes, and write `process.env.MODEL_CATALOG_REPORT_PATH || path.join(os.tmpdir(), 'model-catalog-sync-report.md')`. `formatReport` emits Markdown sections for added IDs, price changes, limit changes, retained/removed source IDs, unsupported fields, and warnings; it never includes credentials.

- [ ] **Step 2: Add the root npm script without changing dependencies.**

Modify `package.json` scripts by adding:

```json
"sync:model-catalog": "node scripts/sync-model-catalog.js"
```

Do not add a package or modify `package-lock.json`; Node 22 already provides the required fetch implementation.

- [ ] **Step 3: Run the synchronizer fixture tests.**

```bash
npx vitest run tests/unit/scripts/model-catalog-sync.test.js
```

Expected result: all synchronizer tests pass, including direct/compatible IDs, provider metadata, cost mapping, source filtering, retained models, and invalid payload rejection.

- [ ] **Step 4: Generate the first repository snapshot from the live source.**

```bash
npm run sync:model-catalog
```

Expected result: exit code 0; `src/config/model-metadata.json` is valid JSON, has `source: "models.dev"`, has a current `lastUpdated`, and the command reports either a generated diff or no changes. Any warning about unsupported upstream fields is printed in the report rather than silently discarded.

- [ ] **Step 5: Commit the generator, policy wiring, and generated snapshot.**

```bash
git add scripts/sync-model-catalog.js package.json src/config/model-metadata.json
git commit -m "feat: sync model catalog from models.dev"
```

Expected result: one commit containing the generator, npm entry point, and generated snapshot.

## Task 3: Expose provenance and tool-aware metadata through the runtime/API

**Files:**

- Modify: `src/config/model-metadata.js`
- Modify: `src/server/api/settings.js`
- Modify: `tests/unit/config/model-metadata.test.js`
- Modify: `tests/unit/api/settings.test.js`
- Verify without modification: `tests/unit/services/model-definition-schema.test.js` (existing explicit-over-builtin precedence tests)

- [ ] **Step 1: Add failing runtime/API assertions.**

Extend `tests/unit/config/model-metadata.test.js` to import `METADATA_SOURCE` and `getModelIdsByToolType`, then add assertions with this behavior:

```js
expect(METADATA_SOURCE).toMatchObject({
  name: 'models.dev',
  url: 'https://models.dev/api.json'
});
expect(getModelIdsByToolType('claude').every((id) => {
  const meta = MODEL_METADATA[id];
  return meta.toolTypes?.includes('claude') || id.startsWith('claude-');
})).toBe(true);
expect(getModelIdsByToolType('omp').some((id) => MODEL_METADATA[id].provider === 'deepseek')).toBe(true);
```

Update the `modelMetaStub` in `tests/unit/api/settings.test.js` with `METADATA_SOURCE` and `getModelIdsByToolType`, then assert that `GET /model-settings` returns `metadataSource` and `toolModels` while retaining `lastUpdated` and `builtinModelIds`.

- [ ] **Step 2: Run the focused tests and verify they fail for the missing exports/fields.**

```bash
npx vitest run tests/unit/config/model-metadata.test.js tests/unit/api/settings.test.js
```

Expected result: failures identify the missing provenance export, tool-aware lookup, or response fields. Preserve the existing assertions while adding the new contract.

- [ ] **Step 3: Implement provenance and dynamic lookup in `model-metadata.js`.**

Add:

```js
const METADATA_SOURCE = Object.freeze({
  name: metadataConfig.source || 'models.dev',
  url: metadataConfig.sourceUrl || 'https://models.dev/api.json',
  lastUpdated: metadataConfig.lastUpdated || 'unknown'
});

function getModelIdsByToolType(toolType) {
  const key = String(toolType || '').trim().toLowerCase();
  return Object.entries(MODEL_METADATA)
    .filter(([modelId, meta]) => {
      if (Array.isArray(meta?.toolTypes)) return meta.toolTypes.includes(key);
      const normalizedId = modelId.toLowerCase();
      return key === 'claude' ? normalizedId.startsWith('claude-')
        : key === 'codex' ? /^(gpt-|o[134](?:-|$))/.test(normalizedId)
        : key === 'gemini' ? normalizedId.startsWith('gemini-')
        : false;
    })
    .map(([modelId]) => modelId);
}
```

Export `METADATA_SOURCE` and `getModelIdsByToolType`. Keep `getDefaultModelsByToolType` backward compatible for existing `claude`, `codex`, `gemini`, and `openai_compatible` callers. Do not remove existing aliases or generic Claude fallback.

- [ ] **Step 4: Return the metadata source and tool groups from `settings.js`.**

Import the new exports and add these fields to the existing `GET /model-settings` response:

```js
metadataSource: METADATA_SOURCE,
toolModels: {
  claude: getModelIdsByToolType('claude'),
  codex: getModelIdsByToolType('codex'),
  gemini: getModelIdsByToolType('gemini'),
  opencode: getModelIdsByToolType('opencode'),
  omp: getModelIdsByToolType('omp')
}
```

Leave `models`, `overrides`, `definitions`, `resolvedModels`, `provenance`, `warnings`, `builtinModelIds`, `lastUpdated`, and `defaultSpeedTestModels` unchanged.

- [ ] **Step 5: Run the focused runtime/API tests.**

```bash
npx vitest run tests/unit/config/model-metadata.test.js tests/unit/api/settings.test.js tests/unit/services/model-definition-schema.test.js
```

Expected result: all existing and new tests pass, including user override merging, explicit model-definition precedence, and the new source/tool-group fields.

- [ ] **Step 6: Commit the runtime/API contract.**

```bash
git add src/config/model-metadata.js src/server/api/settings.js tests/unit/config/model-metadata.test.js tests/unit/api/settings.test.js
git commit -m "feat: expose model catalog provenance"
```

Expected result: one commit containing only the runtime/API metadata contract and its tests.

## Task 4: Remove duplicate proxy pricing tables

**Files:**

- Modify: `src/platforms/drivers/codex/proxy-implementation.js`
- Modify: `src/platforms/drivers/gemini/proxy-implementation.js`
- Modify: `src/platforms/drivers/gemini/sessions-implementation.js`
- Modify: `src/platforms/drivers/opencode/proxy-implementation.js`
- Modify: `tests/unit/services/proxy-cost.test.js`

- [ ] **Step 1: Add regression assertions for unknown model fallback behavior.**

Extend `tests/unit/services/proxy-cost.test.js` with these tests before removing the tables:

```js
test('Codex unknown family uses configured base pricing instead of a stale o1 table', () => {
  expect(calculateCodexCost('o1-custom', {
    input: 1000000,
    output: 1000000
  })).toBeCloseTo(17.5, 8);
});

test('OpenCode unknown family uses configured base pricing instead of a stale gpt-4 table', () => {
  expect(calculateOpenCodeCost('gpt-4-custom', {
    input: 1000000,
    output: 1000000
  })).toBeCloseTo(17.5, 8);
});

test('Gemini unknown family uses configured base pricing instead of a stale family table', () => {
  expect(calculateGeminiCost('gemini-new-custom', {
    input: 1000000,
    output: 1000000
  })).toBeCloseTo(11.25, 8);
});
```

- [ ] **Step 2: Run the pricing tests and verify the new assertions are red.**

```bash
npx vitest run tests/unit/services/proxy-cost.test.js
```

Expected result: the existing tests pass, while the new unknown-family assertions fail because the current proxy tables still intercept `o1`, `gpt-4`, or Gemini family names.

- [ ] **Step 3: Delete the three duplicate model tables and family branches.**

In the Codex proxy, remove the `PRICING` object and replace the `calculateCost` body with:

```js
function calculateCost(model, tokens) {
  const pricing = resolveModelPricing('codex', model, {}, CODEX_BASE_PRICING);
  return calculateTokenCost(pricing, tokens, CODEX_BASE_PRICING);
}
```

In the OpenCode proxy, remove its `PRICING` object and use the corresponding tool key and base constant:

```js
function calculateCost(model, tokens) {
  const pricing = resolveModelPricing('opencode', model, {}, OPENCODE_BASE_PRICING);
  return calculateTokenCost(pricing, tokens, OPENCODE_BASE_PRICING);
}
```

In Gemini, remove the `PRICING` object and replace its fallback lookup with:

```js
function calculateCost(model, tokens) {
  const pricing = resolveModelPricing('gemini', model, {}, GEMINI_BASE_PRICING);
  return calculateTokenCost(pricing, tokens, GEMINI_BASE_PRICING);
}
```

- [ ] **Step 4: Remove literal Gemini session rates while preserving the existing aggregation.**

In `src/platforms/drivers/gemini/sessions-implementation.js`, import `DEFAULT_CONFIG` and `calculateTokenCost`, then replace the manual two-rate calculation with:

```js
const pricing = resolveModelPricing('gemini', msg.model, {}, DEFAULT_CONFIG.pricing.gemini);
totalCost += calculateTokenCost(pricing, msg.tokens, DEFAULT_CONFIG.pricing.gemini);
```

This preserves cache-aware metadata pricing and the configured Gemini base fallback without duplicating numeric rates.

- [ ] **Step 5: Run pricing and existing proxy tests.**

```bash
npx vitest run tests/unit/services/proxy-cost.test.js tests/unit/utils/pricing.test.js tests/unit/platforms/drivers/codex-proxy.test.js tests/unit/platforms/drivers/gemini-proxy.test.js tests/unit/platforms/drivers/opencode-proxy.test.js
```

Expected result: all tests pass; known metadata models still use snapshot prices, and unknown families use provider base pricing rather than removed family tables.

- [ ] **Step 6: Commit the pricing cutover.**

```bash
git add src/platforms/drivers/codex/proxy-implementation.js src/platforms/drivers/gemini/proxy-implementation.js src/platforms/drivers/gemini/sessions-implementation.js src/platforms/drivers/opencode/proxy-implementation.js tests/unit/services/proxy-cost.test.js
git commit -m "refactor: centralize proxy model pricing"
```

Expected result: one commit with no duplicate model-specific pricing tables in those proxy implementations.

## Task 5: Add offline OMP catalog-metadata operation

**Files:**

- Create: `tests/unit/services/omp-catalog-metadata.test.js`
- Modify: `src/platforms/drivers/omp/channels-implementation.js`
- Modify: `src/platforms/drivers/omp/channels.js`
- Modify: `tests/unit/platforms/drivers/omp-channels.test.js`

- [ ] **Step 1: Write the driver/service tests first.**

Add a driver contract test to `tests/unit/platforms/drivers/omp-channels.test.js`:

```js
test('exposes local catalog metadata without a provider key', async () => {
  const catalogMetadata = vi.fn().mockReturnValue({
    models: [{ id: 'deepseek/deepseek-v4-pro' }],
    warnings: []
  });
  const { createDriver } = require('../../../../src/platforms/drivers/omp/channels');
  const driver = createDriver({ requireImpl: () => ({ catalogMetadata }) });
  const result = await driver.catalogMetadata({ body: { providerKey: '' } });

  expect(catalogMetadata).toHaveBeenCalledWith({ providerKey: '' });
  expect(result).toEqual({ models: [{ id: 'deepseek/deepseek-v4-pro' }], warnings: [] });
});
```

Create `tests/unit/services/omp-catalog-metadata.test.js` with the real service module:

'use strict';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('child_process', async () => ({
  ...(await vi.importActual('child_process')),
  execFileSync
}));

const channels = require('../../../src/platforms/drivers/omp/channels-implementation');

describe('offline OMP catalog metadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network must not be used'))));
    process.env.OMP_COMMAND = '__missing_omp_command__';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete process.env.OMP_COMMAND;
  });

  test('returns the packaged OMP catalog with no provider key', () => {
    const result = channels.getCatalogMetadata({ providerKey: '' });
    expect(Array.isArray(result.models)).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('filters a known provider from the packaged catalog', () => {
    const result = channels.getCatalogMetadata({ providerKey: 'deepseek' });
    expect(result.models.every(model => (
      model.provider === 'deepseek'
      || model.sourceId?.startsWith('deepseek/')
    ))).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused OMP tests and verify the operation is missing.**

```bash
npx vitest run tests/unit/platforms/drivers/omp-channels.test.js tests/unit/services/omp-catalog-metadata.test.js
```

Expected result: the new tests fail because the OMP driver/service does not yet expose `catalogMetadata`/`getCatalogMetadata`.

- [ ] **Step 3: Implement local selection in `channels-implementation.js`.**

Import `MODEL_METADATA` and `METADATA_SOURCE` from `src/config/model-metadata.js`. Do not import the model-definition schema: this operation returns the same metadata shape already used by the settings API and must not normalize or persist user definitions. Add:

```js
function getCatalogMetadata({ providerKey = '', model = '', speedTestModel = '', allowedModels = [], models = [] } = {}) {
  const requestedIds = new Set([
    model,
    speedTestModel,
    ...(Array.isArray(allowedModels) ? allowedModels : []),
    ...(Array.isArray(models) ? models.map(item => item?.id || item?.name) : [])
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
  const provider = String(providerKey || '').trim().toLowerCase();
  const allEntries = Object.entries(MODEL_METADATA)
    .filter(([, meta]) => Array.isArray(meta?.toolTypes) && meta.toolTypes.includes('omp'))
    .map(([id, meta]) => ({ ...structuredClone(meta), id }));
  const providerEntries = provider
    ? allEntries.filter(({ id, provider: entryProvider, sourceId }) => (
      requestedIds.has(id.toLowerCase())
      || String(entryProvider || '').toLowerCase() === provider
      || String(sourceId || '').toLowerCase().startsWith(`${provider}/`)
    ))
    : allEntries;
  const entries = provider && providerEntries.length > 0 ? providerEntries : allEntries;

  return {
    models: entries,
    warnings: [],
    source: METADATA_SOURCE
  };
}

```
Do not alter `getOmpCatalogModels` or `buildCatalogIndex` in `src/platforms/drivers/omp/native-config-implementation.js`; `catalogFromCli: true` remains the separate explicit `omp models --json` discovery path.

Return cloned model objects so callers cannot mutate the imported JSON. If a non-empty provider has no local match, return the full eligible OMP list rather than an empty offline directory; requested IDs are always retained. Never call `fetch`, `omp`, `spawnSync`, or a channel probe from this method. Export `getCatalogMetadata` alongside the existing channel methods.

- [ ] **Step 4: Expose the operation through the OMP descriptor driver.**

In `src/platforms/drivers/omp/channels.js`, add:

```js
driver.catalogMetadata = ({ body = {} } = {}) => (
  driver._service().getCatalogMetadata(body)
);
```

Keep the existing `createChannelDriver` methods and the manifest route unchanged. The existing descriptor route already maps `POST /omp/channels/catalog-metadata` to operation `catalogMetadata`.

- [ ] **Step 5: Run the OMP tests.**

```bash
npx vitest run tests/unit/platforms/drivers/omp-channels.test.js tests/unit/services/omp-catalog-metadata.test.js tests/unit/services/omp-settings-manager.test.js
```

Expected result: the driver forwards the request body, the real method returns packaged OMP models with no network/command lookup, and existing native OMP synchronization tests remain green.

- [ ] **Step 6: Commit the offline OMP operation.**

```bash
git add src/platforms/drivers/omp/channels-implementation.js src/platforms/drivers/omp/channels.js tests/unit/platforms/drivers/omp-channels.test.js tests/unit/services/omp-catalog-metadata.test.js
git commit -m "feat: provide offline OMP model metadata"
```

Expected result: one commit containing the local OMP metadata operation and focused tests.

- Create: `src/web/src/composables/__tests__/useDefaultModels.test.js`
- Modify: `src/web/src/composables/useDefaultModels.js`
- Modify: `src/web/src/components/SettingsDrawer.vue`
- Modify: `src/web/src/components/channel/BaseChannelPanel.vue`
- Modify: `src/web/src/components/channel/channelPanelFactories.js`

- [ ] **Step 1: Add the front-end grouping test.**

Create `src/web/src/composables/__tests__/useDefaultModels.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { buildAllModelsFromMetadata, useDefaultModels } from '../useDefaultModels'

describe('buildAllModelsFromMetadata', () => {
  it('uses toolTypes instead of model-name prefixes', () => {
    const grouped = buildAllModelsFromMetadata({
      'claude-sonnet-4-6': { limit: {}, pricing: {}, toolTypes: ['claude', 'opencode', 'omp'] },
      'gpt-5.5': { limit: {}, pricing: {}, toolTypes: ['codex', 'opencode', 'omp'] },
      'deepseek/deepseek-v4-pro': { limit: {}, pricing: {}, toolTypes: ['opencode', 'omp'] }
    })

    expect(grouped.claude).toEqual(['claude-sonnet-4-6'])
    expect(grouped.codex).toEqual(['gpt-5.5'])
    expect(grouped.gemini).toEqual([])
    expect(grouped.omp).toEqual(['claude-sonnet-4-6', 'deepseek/deepseek-v4-pro', 'gpt-5.5'])
    expect(grouped.opencode).toEqual(['claude-sonnet-4-6', 'deepseek/deepseek-v4-pro', 'gpt-5.5'])
  })

  it('loads compatible models into the offline selector groups', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
      ok: true,
      json: async () => String(url).includes('/api/config/')
        ? { defaultModels: { claude: [], codex: [], gemini: [] } }
        : {
            models: {
              'deepseek/deepseek-v4-pro': {
                limit: { context: 1000000, output: 384000 },
                pricing: { input: 0.435, output: 0.87 },
                toolTypes: ['opencode', 'omp']
              }
            }
          }
    })))

    const { loadDefaultModels, getAllModelsByToolType, getDefaultModels } = useDefaultModels()
    try {
      await loadDefaultModels({ forceRefresh: true })

      expect(getAllModelsByToolType('omp')).toContain('deepseek/deepseek-v4-pro')
      expect(getDefaultModels('omp')).toContain('deepseek/deepseek-v4-pro')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
```

- [ ] **Step 2: Run the web test before implementation.**

```bash
cd src/web
npm run test:unit -- src/composables/__tests__/useDefaultModels.test.js
```

Expected result: the test fails because `buildAllModelsFromMetadata` is private and does not yet create dynamic `omp`/`opencode` groups.

- [ ] **Step 3: Update `useDefaultModels.js` to use `toolTypes`.**

Export the pure `buildAllModelsFromMetadata` helper. Initialize groups dynamically from each metadata entry's `toolTypes`; require `limit` and `pricing` as the current selectable-model contract does. If an entry lacks `toolTypes`, use the existing Claude/Codex/Gemini prefix fallback only for backward-compatible snapshots. Keep `FALLBACK_MODELS` for the three native tools. Make `getAllModelsByToolType(toolType)` return any dynamic group before falling back, and make `getDefaultModels(toolType)` return an explicit server default first, then the matching dynamic group, then the three native fallback arrays.

The returned group shape must be:

```js
{
  claude: [...],
  codex: [...],
  gemini: [...],
  opencode: [...],
  omp: [...]
}
```

Sort each group in the source order emitted by the synchronizer; do not alphabetically reorder the preferred default arrays.

- [ ] **Step 4: Update the model settings page to use metadata fields and show provenance.**

In `SettingsDrawer.vue`:

1. Add `const modelMetadataSource = ref({ name: 'Models.dev', url: '', lastUpdated: '' })`.
2. In the template under the existing model settings subtitle, render `价格来源：Models.dev 参考价格 · {{ modelMetadataSource.lastUpdated }}`.
3. Add an `OMP/OpenCode` filter radio with value `compatible`.
4. Make `filteredModelMeta` inspect `meta.toolTypes` first; for `compatible`, require `omp` or `opencode` and exclude models already classified as native-only; retain the current prefix checks only when the field is absent.
5. Make `speedTestModelOptions` group only entries whose `toolTypes` include `claude`, `codex`, or `gemini`, with the old prefix helper as fallback.
6. Store `data.metadataSource` in `loadModelMetadata()` and leave the current override edit/save/reset flow untouched.

- [ ] **Step 5: Add offline catalog fallbacks to the OpenCode and OMP model selectors and keep metadata retrieval separate.**

In the OpenCode factory, compute offline options from `getAllModelsByToolType('opencode')` for an `openai_compatible` preset and from the existing `claude`/`codex`/`gemini` group when the gateway source explicitly selects one of those native adapters. Merge offline options after live probe results, so live provider IDs remain first while popular curated IDs remain selectable when the provider omits a list endpoint.

In the OMP factory, compute offline options from `getAllModelsByToolType('omp')`. For a new channel with no `baseUrl`, return those options instead of an empty list. When a live probe returns no models or fails, retain the offline options and set the existing error hint to explain that the packaged `Models.dev` reference catalog is being used. Do not remove the live `probeOmpChannelModels`/`fetchOmpChannelModels` calls.

For the existing `fetchModelMetadataForChannel`, remove the early `if (!providerKey) throw` so it can call `fetchOmpCatalogMetadata('', ...)`. Continue sending `providerKey` when present, together with `model`, `speedTestModel`, `allowedModels`, and existing definitions. Set the status message from the returned `source` and model count, for example:

```js
const sourceName = result.source?.name === 'models.dev'
  ? 'Models.dev'
  : (result.source?.name || 'Models.dev')
form.modelMetadataStatus = `已读取 ${result.models?.length || 0} 个模型（${sourceName} 离线快照）${warningCount ? `，${warningCount} 条兼容提示` : ''}`
```

Update the OMP Metadata status fallback in `BaseChannelPanel.vue` from `仅在点击时调用 OMP；普通保存不会启动 OMP 命令。` to `Metadata 读取 Models.dev 离线快照；模型列表按钮才探测渠道，普通保存不会启动网络或 OMP 命令。` Keep the save path free of both network calls and OMP command execution.

- [ ] **Step 6: Run the web unit suite and build the web bundle.**
```bash
npm run test:unit
cd ../..
npm run build:web
```

Expected result: all existing web tests, the new grouping test, and the production Vite build pass. The settings page still saves and resets user overrides, while OMP's Metadata button can be used before a Provider Key is entered.

- [ ] **Step 7: Commit the front-end contract.**

```bash
git add src/web/src/composables/useDefaultModels.js src/web/src/composables/__tests__/useDefaultModels.test.js src/web/src/components/SettingsDrawer.vue src/web/src/components/channel/BaseChannelPanel.vue src/web/src/components/channel/channelPanelFactories.js
```

Expected result: one commit containing dynamic tool filtering, source labeling, and offline OMP UI integration.

## Task 7: Add the daily GitHub Actions PR workflow

**Files:**

- Create: `.github/workflows/sync-model-catalog.yml`

- [ ] **Step 1: Add the workflow with explicit permissions and a temporary report path.**

Create `.github/workflows/sync-model-catalog.yml`:

```yaml
name: Sync model catalog

on:
  schedule:
    - cron: '17 3 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22.13.0'
          cache: npm

      - name: Install root dependencies
        run: npm ci --ignore-scripts

      - name: Generate model catalog
        env:
          MODEL_CATALOG_REPORT_PATH: ${{ runner.temp }}/model-catalog-sync-report.md
        run: npm run sync:model-catalog

      - name: Open catalog update PR
        uses: peter-evans/create-pull-request@v7
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          add-paths: src/config/model-metadata.json
          branch: automation/model-catalog-sync
          delete-branch: true
          commit-message: 'chore: refresh model catalog'
          title: 'chore: refresh model catalog'
          body-path: ${{ runner.temp }}/model-catalog-sync-report.md
```

The synchronizer must return success when there is no diff; `create-pull-request` then has no changed path to commit and creates no PR. The workflow must never add the temporary report to the repository.

- [ ] **Step 2: Parse the workflow locally.**

```bash
node -e "const fs=require('fs'); const yaml=require('js-yaml'); const value=yaml.load(fs.readFileSync('.github/workflows/sync-model-catalog.yml','utf8')); if (!value.jobs?.sync || !value.on || !value.permissions?.contents || !value.permissions?.['pull-requests']) process.exit(1); console.log('workflow valid')"
```

Expected result: `workflow valid`.

- [ ] **Step 3: Commit the automation workflow.**

```bash
git add .github/workflows/sync-model-catalog.yml
git commit -m "ci: refresh model catalog daily"
```

Expected result: one commit containing only the scheduled/manual catalog workflow.

## Task 8: Run end-to-end verification and finish the implementation

**Files:**

- Modify only files required by failing verification; do not broaden the feature or restore duplicate pricing tables.

- [ ] **Step 1: Regenerate once from the live Models.dev source.**

```bash
npm run sync:model-catalog
```

Expected result: exit code 0, deterministic JSON output, no secret values, and a report listing source changes or stating that the snapshot is unchanged.

- [ ] **Step 2: Run all focused root tests.**

```bash
npx vitest run \
  tests/unit/scripts/model-catalog-sync.test.js \
  tests/unit/config/model-metadata.test.js \
  tests/unit/api/settings.test.js \
  tests/unit/utils/pricing.test.js \
  tests/unit/services/proxy-cost.test.js \
  tests/unit/platforms/drivers/omp-channels.test.js \
  tests/unit/services/omp-catalog-metadata.test.js
```

Expected result: all listed tests pass.

- [ ] **Step 3: Run the complete web tests and production build.**

```bash
cd src/web
npm run test:unit
cd ../..
npm run build:web
```

Expected result: all web tests pass and the production bundle builds successfully.

- [ ] **Step 4: Run the complete root regression suite.**

```bash
npm test
```

Expected result: the existing basic, API, Codex-agent, skill, plugin-market, and unit suites pass with the new catalog behavior.

- [ ] **Step 5: Execute an offline OMP smoke test against the packaged snapshot.**

```bash
node -e "const service=require('./src/platforms/drivers/omp/channels-implementation'); const result=service.getCatalogMetadata({providerKey:''}); if(!Array.isArray(result.models)||result.models.length===0) throw new Error('offline OMP catalog is empty'); if(result.source?.name!=='models.dev') throw new Error('unexpected catalog source'); console.log('offline OMP catalog:', result.models.length)"
```

Expected result: the command prints a positive model count without contacting Models.dev or starting `omp`.

- [ ] **Step 6: Check the generated snapshot for stale duplicate price declarations.**

```bash
node -e "const fs=require('fs'); const text=['src/platforms/drivers/codex/proxy-implementation.js','src/platforms/drivers/gemini/proxy-implementation.js','src/platforms/drivers/opencode/proxy-implementation.js'].map(file=>fs.readFileSync(file,'utf8')).join('\\n'); if(/const PRICING\\s*=/.test(text)) process.exit(1); console.log('duplicate proxy price tables absent')"
```

Expected result: `duplicate proxy price tables absent`.

- [ ] **Step 7: Commit any final verification-only fixes.**

```bash
git add scripts src/config/model-metadata.json src/server src/platforms/drivers src/web package.json .github tests
 git commit -m "feat: complete offline model catalog sync"
```

Expected result: the final implementation commit contains only the approved model catalog synchronization, pricing consolidation, OMP offline metadata, UI filtering, workflow, and tests. No LiteLLM/OpenRouter integration, runtime network refresh, or unrelated refactor is present.
