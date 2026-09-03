'use strict';

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizeQuery(query) {
  return cloneObject(query);
}

function normalizeBody(body) {
  return body === undefined ? undefined : body;
}

function requestContext(request, manifest, route, config) {
  const params = { ...request.params };
  delete params.platform;
  if (params.projectHash && !params.projectName) {
    params.projectName = params.projectHash;
    delete params.projectHash;
  }
  return {
    platform: manifest.key,
    manifest,
    config,
    params,
    query: normalizeQuery(request.query),
    body: normalizeBody(request.body),
    remoteAddress: request.ip || request.socket?.remoteAddress
  };
}

function projectPayload(data, context) {
  if (Array.isArray(data)) {
    return { projects: data, currentProject: null, meta: {} };
  }
  const payload = cloneObject(data);
  if (!Array.isArray(payload.projects)) payload.projects = [];
  if (!Object.prototype.hasOwnProperty.call(payload, 'currentProject')) payload.currentProject = null;
  if (!payload.meta || typeof payload.meta !== 'object' || Array.isArray(payload.meta)) payload.meta = {};
  return payload;
}

function sessionPayload(data) {
  if (Array.isArray(data)) return { sessions: data, meta: {} };
  const payload = cloneObject(data);
  if (!Array.isArray(payload.sessions)) payload.sessions = [];
  if (!payload.meta || typeof payload.meta !== 'object' || Array.isArray(payload.meta)) payload.meta = {};
  return payload;
}

const requestCodecs = Object.freeze({
  default: requestContext,
  'projects-list': requestContext,
  'sessions-list': requestContext,
  json: requestContext
});

const responseCodecs = Object.freeze({
  default: value => value,
  'projects-list': projectPayload,
  projects: projectPayload,
  'sessions-list': sessionPayload,
  sessions: sessionPayload
});

function applyRequestCodec(request, manifest, route, config) {
  const codec = typeof route.request === 'function' ? route.request : requestCodecs[route.request] || requestCodecs.default;
  return codec(request, manifest, route, config);
}

function applyResponseCodec(value, manifest, route, context) {
  const codec = typeof route.response === 'function' ? route.response : responseCodecs[route.response] || responseCodecs.default;
  return codec(value, manifest, route, context);
}

function emptyPayload(route) {
  if (route.response === 'projects-list' || route.response === 'projects') return { projects: [], currentProject: null, meta: {} };
  if (route.response === 'sessions-list' || route.response === 'sessions') return { sessions: [], meta: {} };
  return {};
}

module.exports = {
  requestCodecs,
  responseCodecs,
  applyRequestCodec,
  applyResponseCodec,
  emptyPayload,
  createRequestContext: requestContext
};
