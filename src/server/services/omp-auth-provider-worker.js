'use strict';

const { getOmpAuthProviderSnapshot } = require('./omp-auth-providers');

function attachWorkerHandler() {
  process.on('message', (options = {}) => {
    try {
      const value = getOmpAuthProviderSnapshot(options);
      if (process.send) {
        process.send({ ok: true, value }, () => process.exit(0));
        return;
      }
    } catch (error) {
      if (process.send) {
        process.send({ ok: false, error: error?.message || String(error) }, () => process.exit(1));
        return;
      }
    }
    process.exit(1);
  });
}

if (process.env.CC_TOOL_OMP_AUTH_PROVIDER_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = {
  attachWorkerHandler
};
