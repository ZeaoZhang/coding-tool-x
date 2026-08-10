'use strict';

function optionalAdapter(name) {
  try {
    return require(`./${name}`);
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
