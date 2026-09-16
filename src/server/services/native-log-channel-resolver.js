'use strict';

const CHANNEL_PLACEHOLDERS = new Set(['', 'unknown', 'unkonwn', 'n/a', 'na', 'none', '-']);

function text(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function normalizeIdentity(value) {
  return text(value).toLowerCase();
}

function isChannelPlaceholder(value) {
  return CHANNEL_PLACEHOLDERS.has(normalizeIdentity(value));
}

function meaningfulText(value) {
  const result = text(value);
  return isChannelPlaceholder(result) ? '' : result;
}

function identityAliases(value) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  if (normalized.startsWith('ctx-')) aliases.add(normalized.slice(4));
  if (normalized.startsWith('provider:')) aliases.add(normalized.slice('provider:'.length));
  return [...aliases].filter(Boolean);
}

function normalizeUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().toLowerCase().replace(/\/$/, '');
  } catch (_) {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

function unwrapChannels(value) {
  if (value && typeof value === 'object' && typeof value.status === 'string' && value.status !== 'ok') {
    return [];
  }
  const data = value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')
    ? value.data
    : value;
  const channels = Array.isArray(data) ? data : data?.channels;
  return Array.isArray(channels) ? channels.filter(channel => channel && typeof channel === 'object') : [];
}

function nestedValues(source, keys) {
  if (!source || typeof source !== 'object') return [];
  const values = [];
  for (const key of keys) {
    if (source[key] != null) values.push(source[key]);
  }
  return values;
}

function channelSources(channel) {
  return [channel, channel?.extra, channel?.providerConfig]
    .filter(source => source && typeof source === 'object');
}

function channelIdentityValues(channel) {
  const values = [];
  for (const source of channelSources(channel)) {
    values.push(...nestedValues(source, [
      'id', 'name', 'providerKey', 'provider', 'providerId', 'providerID',
      'managedProviderId', 'oauthProviderId', 'providerName'
    ]));
    if (source.authRef && typeof source.authRef === 'object') {
      values.push(...nestedValues(source.authRef, ['providerId', 'providerID', 'accountId', 'identityKey']));
    }
  }
  return values.flatMap(identityAliases);
}

function eventIdentityValues(event) {
  return nestedValues(event, [
    'provider', 'providerKey', 'providerId', 'providerID', 'managedProviderId', 'oauthProviderId'
  ]).flatMap(identityAliases);
}

function channelUrlValues(channel) {
  const values = [];
  for (const source of channelSources(channel)) {
    values.push(...nestedValues(source, ['baseUrl', 'baseURL', 'apiBaseUrl', 'apiBaseURL', 'endpoint', 'url']));
  }
  return values.map(normalizeUrl).filter(Boolean);
}

function eventUrlValues(event) {
  return nestedValues(event, [
    'baseUrl', 'baseURL', 'apiBaseUrl', 'apiBaseURL', 'endpoint', 'url', 'providerBaseUrl'
  ])
    .concat(event?.providerConfig && typeof event.providerConfig === 'object'
      ? nestedValues(event.providerConfig, ['baseUrl', 'baseURL', 'apiBaseUrl', 'apiBaseURL', 'endpoint', 'url'])
      : [])
    .map(normalizeUrl)
    .filter(Boolean);
}

function modelAliases(value) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex >= 0) aliases.add(normalized.slice(slashIndex + 1));
  return [...aliases].filter(Boolean);
}

function modelValues(value) {
  if (Array.isArray(value)) return value.flatMap(modelValues);
  if (value && typeof value === 'object') {
    return nestedValues(value, ['id', 'name', 'model', 'modelId', 'modelID']).flatMap(modelValues);
  }
  return modelAliases(value);
}

function channelModelValues(channel) {
  const values = [];
  for (const source of channelSources(channel)) {
    values.push(...nestedValues(source, [
      'model', 'models', 'allowedModels', 'modelConfig', 'modelRedirects', 'modelBindings'
    ]).flatMap(modelValues));
  }
  return values;
}

function eventModelValues(event) {
  return modelAliases(event?.model || event?.modelId || event?.modelID);
}

function matchesBy(channels, values, getValues) {
  const wanted = new Set(values);
  if (!wanted.size) return [];
  return channels.filter(channel => getValues(channel).some(value => wanted.has(value)));
}

function matchedChannel(channel) {
  const channelId = text(channel?.id);
  const channelName = text(channel?.name) || text(channel?.providerKey) || channelId;
  return {
    ...(channelId ? { channelId } : {}),
    ...(channelName ? { channel: channelName } : {})
  };
}

function fallbackChannel(event) {
  const channel = meaningfulText(event?.channel) || meaningfulText(event?.provider)
    || meaningfulText(event?.providerKey) || meaningfulText(event?.providerId)
    || meaningfulText(event?.channelId);
  return channel ? { channel } : {};
}

/**
 * Resolve the configured channel responsible for a native CLI usage event.
 * Native log formats do not agree on a channel field, so provider/model metadata
 * is matched against the channel registry at the observation boundary.
 */
function resolveNativeLogChannel(event = {}, channels = []) {
  const allChannels = unwrapChannels(channels);
  const enabledChannels = allChannels.filter(channel => channel.enabled !== false);

  const explicitId = normalizeIdentity(event.channelId);
  if (explicitId) {
    const match = allChannels.find(channel => normalizeIdentity(channel.id) === explicitId);
    if (match) return matchedChannel(match);
    return { channelId: text(event.channelId), channel: text(event.channel) || text(event.channelId) };
  }

  const explicitChannel = isChannelPlaceholder(event.channel) ? '' : normalizeIdentity(event.channel);
  if (explicitChannel) {
    const matches = matchesBy(allChannels, identityAliases(event.channel), channelIdentityValues);
    if (matches.length === 1) return matchedChannel(matches[0]);
    return { channel: meaningfulText(event.channel) };
  }

  const providerMatches = matchesBy(allChannels, eventIdentityValues(event), channelIdentityValues);
  if (providerMatches.length === 1) return matchedChannel(providerMatches[0]);

  const eventUrls = eventUrlValues(event);
  const eventModels = eventModelValues(event);
  if (providerMatches.length > 1 && eventModels.length) {
    const providerModelMatches = matchesBy(providerMatches, eventModels, channelModelValues);
    if (providerModelMatches.length === 1) return matchedChannel(providerModelMatches[0]);
  }
  if (providerMatches.length > 1 && eventUrls.length) {
    const providerUrlMatches = matchesBy(providerMatches, eventUrls, channelUrlValues);
    if (providerUrlMatches.length === 1) return matchedChannel(providerUrlMatches[0]);
  }

  if (eventUrls.length) {
    const urlMatches = matchesBy(allChannels, eventUrls, channelUrlValues);
    if (urlMatches.length === 1) return matchedChannel(urlMatches[0]);
  }
  if (eventModels.length) {
    const modelMatches = matchesBy(allChannels, eventModels, channelModelValues);
    if (modelMatches.length === 1) return matchedChannel(modelMatches[0]);
  }

  // A provider-less native format is still resolvable when only one channel is
  // currently enabled. Do not guess when several channels could have produced it.
  if (enabledChannels.length === 1) return matchedChannel(enabledChannels[0]);
  return fallbackChannel(event);
}

module.exports = { resolveNativeLogChannel, unwrapChannels, isChannelPlaceholder };
