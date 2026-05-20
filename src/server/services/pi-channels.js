const { PATHS } = require('../../config/paths');
const BaseChannelService = require('./base/base-channel-service');
const {
  writeManagedProviderExtension,
  removeManagedProviderExtension,
  isManagedProviderExtensionActive
} = require('./pi-settings-manager');

class PiChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'pi',
      channelsFilePath: PATHS.channels.pi,
      defaultGatewaySource: 'codex',
      isProxyRunning: () => isManagedProviderExtensionActive()
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
    writeManagedProviderExtension([channel]);
  }

  _onAfterCreate(_channel, allChannels) {
    this.syncManagedProviderExtension(allChannels);
  }

  _onAfterUpdate(_oldChannel, _newChannel, allChannels) {
    this.syncManagedProviderExtension(allChannels);
  }

  _onAfterDelete(_channel, allChannels) {
    this.syncManagedProviderExtension(allChannels);
  }

  syncManagedProviderExtension(channels = this.getChannels().channels) {
    const enabledChannels = (channels || []).filter(channel => channel.enabled !== false);
    if (enabledChannels.length === 0) {
      removeManagedProviderExtension();
      return null;
    }
    return writeManagedProviderExtension(enabledChannels);
  }

  disableManagedProviderExtension() {
    removeManagedProviderExtension();
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
  syncManagedProviderExtension: (channels) => service.syncManagedProviderExtension(channels),
  disableManagedProviderExtension: () => service.disableManagedProviderExtension()
};
