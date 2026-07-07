const { PATHS } = require('../../config/paths');
const BaseChannelService = require('./base/base-channel-service');
const {
  writeManagedOmpProviders,
  removeManagedOmpProviders,
  isManagedOmpProvidersActive,
  getLastManagedOmpSyncResult
} = require('./pi-settings-manager');

class PiChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'pi',
      channelsFilePath: PATHS.channels.pi,
      defaultGatewaySource: 'codex',
      isProxyRunning: () => isManagedOmpProvidersActive()
    });
  }

  _applyDefaults(channel) {
    const normalized = super._applyDefaults(channel);
    normalized.providerKey = normalized.providerKey || normalized.provider || normalized.name || normalized.id;
    normalized.providerApi = normalized.providerApi || normalized.api || normalized.wireApi || 'openai-completions';
    normalized.model = normalized.model || null;
    normalized.models = Array.isArray(normalized.models) ? normalized.models : [];
    normalized.allowedModels = Array.isArray(normalized.allowedModels) ? normalized.allowedModels : [];
    normalized.speedTestModel = normalized.speedTestModel || null;
    normalized.modelRedirects = Array.isArray(normalized.modelRedirects) ? normalized.modelRedirects : [];
    return normalized;
  }

  _applyToNativeSettings(channel) {
    writeManagedOmpProviders([channel]);
  }

  _onAfterCreate(_channel, allChannels) {
    this.syncManagedOmpProviders(allChannels);
  }

  _onAfterUpdate(_oldChannel, _newChannel, allChannels) {
    this.syncManagedOmpProviders(allChannels);
  }

  _onAfterDelete(_channel, allChannels) {
    this.syncManagedOmpProviders(allChannels);
  }

  syncManagedOmpProviders(channels = this.getChannels().channels) {
    const enabledChannels = (channels || []).filter(channel => channel.enabled !== false);
    if (enabledChannels.length === 0) {
      removeManagedOmpProviders();
      return getLastManagedOmpSyncResult();
    }
    writeManagedOmpProviders(enabledChannels);
    return getLastManagedOmpSyncResult();
  }

  disableManagedOmpProviders() {
    removeManagedOmpProviders();
    return getLastManagedOmpSyncResult();
  }

  syncManagedProviderExtension(channels = this.getChannels().channels) {
    return this.syncManagedOmpProviders(channels);
  }

  disableManagedProviderExtension() {
    this.disableManagedOmpProviders();
  }
}

const service = new PiChannelService();

module.exports = {
  getChannels: () => service.getChannels(),
  createChannel: (name, baseUrl, apiKey, extra = {}) => service.createChannel({
    name,
    baseUrl,
    apiKey,
    ...extra
  }),
  updateChannel: (id, updates) => service.updateChannel(id, updates),
  markChannelAsRecentlyUsed: (id) => service.updateChannel(id, {}),
  deleteChannel: (id) => service.deleteChannel(id),
  getEnabledChannels: () => service.getEnabledChannels(),
  saveChannelOrder: (order) => service.saveChannelOrder(order),
  applyChannelToSettings: (id) => service.applyChannelToSettings(id),
  disableAllChannels: () => service.disableAllChannels(),
  getEffectiveApiKey: (channel) => channel?.apiKey || null,
  syncManagedOmpProviders: (channels) => service.syncManagedOmpProviders(channels),
  disableManagedOmpProviders: () => service.disableManagedOmpProviders(),
  syncManagedProviderExtension: (channels) => service.syncManagedProviderExtension(channels),
  disableManagedProviderExtension: () => service.disableManagedProviderExtension()
};
