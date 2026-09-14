'use strict';

const { createOmpUsageEventCursor, getOmpSessionPaths } = require('./sessions-implementation');
const { getEnabledChannels } = require('./channels-implementation');
const { getManagedProviderId, normalizeProviderId } = require('./native-config-implementation');
const { normalizeCost, normalizeUsage } = require('../native-log-utils');
const { calculateUsageCost } = require('../../../server/services/usage-log-utils');

function resolveChannel(provider) {
  const normalized = normalizeProviderId(provider || '');
  const channel = getEnabledChannels().find(item => [
    getManagedProviderId(item), item.providerKey, item.provider, item.name, item.id
  ].map(normalizeProviderId).includes(normalized));
  return channel ? { channelId: channel.id, channel: channel.name } : {};
}

function createDriver() {
  return {
    platform: 'omp',
    capability: 'nativeLogs',
    createNativeLogCursor() {
      const native = createOmpUsageEventCursor(getOmpSessionPaths().sessions);
      return {
        initialize() { native.read(); },
        readNewEvents() {
          return native.read().map(event => ({
            id: event.id,
            source: 'omp',
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            provider: event.provider,
            model: event.model,
            tokens: normalizeUsage(event.usage),
            cost: normalizeCost(event.usage?.cost)
              || calculateUsageCost('omp', event.model || '', normalizeUsage(event.usage)),
            ...resolveChannel(event.provider)
          }));
        },
        read() { return this.readNewEvents(); },
        reset() { native.reset(); },
        close() { native.reset(); }
      };
    },
    createCursor(options) { return this.createNativeLogCursor(options); }
  };
}

module.exports = { createDriver };
