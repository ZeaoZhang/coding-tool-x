'use strict';

const ADAPTER_PATHS = Object.freeze({
  claude: './drivers/claude/session-history-adapter',
  codex: './drivers/codex/session-history-adapter',
  gemini: './drivers/gemini/session-history-adapter',
  omp: './drivers/omp/session-history-adapter'
});

function optionalAdapter(name) {
  try {
    return require(ADAPTER_PATHS[name]);
  } catch (_) {
    return {
      inventory: async () => [],
      parse: async () => ({ session: null, messages: [] })
    };
  }
}

module.exports = {
  claude: optionalAdapter('claude'),
  codex: optionalAdapter('codex'),
  gemini: optionalAdapter('gemini'),
  omp: optionalAdapter('omp')
  // OpenCode uses its own native schema; not indexed via adapters
};
