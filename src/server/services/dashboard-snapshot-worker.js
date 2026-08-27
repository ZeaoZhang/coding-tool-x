'use strict';

const childProcess = require('child_process');
const platformRuntime = require('../../platforms/runtime');

const DASHBOARD_SNAPSHOT_WORKER_TIMEOUT_MS = 180 * 1000;
const MAX_SERIALIZED_ERROR_TEXT_LENGTH = 4096;

function _safeErrorText(value, fallback = '') {
  const text = value == null || value === '' ? fallback : String(value);
  return text.length > MAX_SERIALIZED_ERROR_TEXT_LENGTH
    ? `${text.slice(0, MAX_SERIALIZED_ERROR_TEXT_LENGTH)}…`
    : text;
}

function _safeCode(value) {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}


function sortClaudeProjects(projects, order = []) {
  if (!Array.isArray(order) || order.length === 0) {
    return projects;
  }
  const orderMap = new Map(order.map((name, idx) => [name, idx]));
  return [...projects].sort((a, b) => {
    const aIdx = orderMap.has(a.name) ? orderMap.get(a.name) : 999999;
    const bIdx = orderMap.has(b.name) ? orderMap.get(b.name) : 999999;
    if (aIdx === bIdx) {
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    }
    return aIdx - bIdx;
  });
}

function _isTypedPayload(value) {
  return !!value && typeof value === 'object' && (
    (typeof value.status === 'string' && value.status !== 'ok') ||
    typeof value.type === 'string'
  );
}

function _isTypedFailurePayload(value) {
  return !!value && typeof value === 'object'
    && value.status === 'failed'
    && typeof value.platform === 'string'
    && typeof value.capability === 'string'
    && typeof value.operation === 'string';
}

function _serializeCause(cause) {
  if (!cause) {
    return null;
  }
  const serialized = {
    name: _safeErrorText(cause.name, 'Error'),
    message: _safeErrorText(cause && cause.message ? cause.message : cause, 'Error')
  };
  const code = _safeCode(cause.code);
  if (code !== undefined) {
    serialized.code = code;
  }
  return serialized;
}

function _serializeError(error) {
  if (!error || typeof error !== 'object') {
    return { message: _safeErrorText(error, 'Dashboard snapshot refresh failed') };
  }
  const serialized = {
    message: _safeErrorText(error.message ? error.message : error, 'Dashboard snapshot refresh failed')
  };
  if (typeof error.platform === 'string') serialized.platform = _safeErrorText(error.platform);
  if (typeof error.capability === 'string') serialized.capability = _safeErrorText(error.capability);
  if (typeof error.operation === 'string') serialized.operation = _safeErrorText(error.operation);
  const code = _safeCode(error.code);
  if (code !== undefined) serialized.code = code;
  const cause = _serializeCause(error.cause);
  if (cause) {
    serialized.cause = cause;
  }
  return serialized;
}

function _deserializeCause(cause) {
  if (!cause) {
    return null;
  }
  if (cause instanceof Error) {
    return cause;
  }
  const error = new Error(_safeErrorText(cause.message ? cause.message : cause, 'Error'));
  if (cause.name) {
    error.name = _safeErrorText(cause.name, 'Error');
  }
  const code = _safeCode(cause.code);
  if (code !== undefined) {
    error.code = code;
  }
  return error;
}

function _deserializeError(payload, fallbackMessage) {
  if (payload instanceof Error) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return new Error(_safeErrorText(payload, fallbackMessage));
  }
  const error = new Error(_safeErrorText(payload.message ? payload.message : fallbackMessage, fallbackMessage));
  if (typeof payload.platform === 'string') error.platform = _safeErrorText(payload.platform);
  if (typeof payload.capability === 'string') error.capability = _safeErrorText(payload.capability);
  if (typeof payload.operation === 'string') error.operation = _safeErrorText(payload.operation);
  const code = _safeCode(payload.code);
  if (code !== undefined) error.code = code;
  const cause = _deserializeCause(payload.cause);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function _serializeWorkerValue(value) {
  if (!_isTypedFailurePayload(value)) {
    return value;
  }
  const serialized = {
    status: value.status,
    platform: _safeErrorText(value.platform),
    capability: _safeErrorText(value.capability),
    operation: _safeErrorText(value.operation),
    error: value.error instanceof Error
      ? _safeErrorText(value.error.message, 'dashboard snapshot failed')
      : _safeErrorText(value.error, 'dashboard snapshot failed')
  };
  const code = _safeCode(value.code);
  if (code !== undefined) serialized.code = code;
  const cause = value.cause || (value.error instanceof Error ? value.error : null);
  const serializedCause = _serializeCause(cause);
  if (serializedCause) {
    serialized.cause = serializedCause;
  }
  return serialized;
}

function _typedFailurePayloadToError(payload) {
  const cause = payload.cause instanceof Error
    ? payload.cause
    : payload.cause && typeof payload.cause === 'object'
      ? _deserializeCause(payload.cause)
      : payload.cause != null
        ? new Error(String(payload.cause))
        : payload.error instanceof Error
          ? payload.error
          : new Error(String(payload.error || 'dashboard snapshot failed'));
  const error = new Error(`Dashboard snapshot ${payload.capability} ${payload.operation} failed on ${payload.platform}: ${cause.message}`);
  error.platform = payload.platform;
  error.capability = payload.capability;
  error.operation = payload.operation;
  error.cause = cause;
  error.failure = payload;
  return error;
}

function _unsupportedPayload(source, capability) {
  return { status: 'unsupported', platform: source, capability };
}

function _driverFailurePayload(source, capability, error) {
  const result = {
    status: 'failed',
    platform: source,
    capability,
    operation: 'resolve-driver',
    error: error && error.message ? error.message : String(error)
  };
  if (error) {
    Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  }
  return result;
}

function _capabilityInvocationError(source, capability, operation, error) {
  const cause = error instanceof Error ? error : new Error(_safeErrorText(error, 'unknown error'));
  const wrapped = new Error(cause.message);
  wrapped.platform = source;
  wrapped.capability = capability;
  wrapped.operation = operation;
  wrapped.cause = cause;
  const code = _safeCode(cause.code);
  if (code !== undefined) {
    wrapped.code = code;
  }
  return wrapped;
}

async function _invokeCapabilityGetter(source, capability, operation, getter, options) {
  try {
    return await getter(options);
  } catch (error) {
    throw _capabilityInvocationError(source, capability, operation, error);
  }
}

function _configProjectOrder(config = {}) {
  if (Array.isArray(config.projectOrder)) {
    return config.projectOrder;
  }
  if (Array.isArray(config.order)) {
    return config.order;
  }
  return [];
}


function _getRuntimeDriver(runtime, source, capability) {
  if (!runtime || typeof runtime.getDriver !== 'function') {
    return null;
  }
  try {
    return runtime.getDriver(source, capability);
  } catch (error) {
    return _driverFailurePayload(source, capability, error);
  }
}

function _getProjectsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.listProjects === 'function') return driver.listProjects.bind(driver);
  if (typeof driver.getProjects === 'function') return driver.getProjects.bind(driver);
  return null;
}

function _getProjectOrderGetter(driver) {
  if (!driver || typeof driver.getProjectOrder !== 'function') return null;
  return driver.getProjectOrder.bind(driver);
}

async function _getClaudeProjectOrder(driver, config, options) {
  const getter = _getProjectOrderGetter(driver);
  if (!getter) {
    return _configProjectOrder(config);
  }
  const order = await _invokeCapabilityGetter(
    'claude',
    'project-order',
    'get',
    getter,
    { force: options.force === true, config }
  );
  if (_isTypedFailurePayload(order)) {
    throw _typedFailurePayloadToError(order);
  }
  return Array.isArray(order) ? order : _configProjectOrder(config);
}

function _getCountsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.getProjectAndSessionCounts === 'function') return driver.getProjectAndSessionCounts.bind(driver);
  if (typeof driver.counts === 'function') return driver.counts.bind(driver);
  return null;
}

function _getTodayStatsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.getTodayStatistics === 'function') return driver.getTodayStatistics.bind(driver);
  if (typeof driver.today === 'function') return driver.today.bind(driver);
  return null;
}

function _getChannelsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.list === 'function') return driver.list.bind(driver);
  if (typeof driver.getChannels === 'function') return driver.getChannels.bind(driver);
  return null;
}

function _isPlainSuccessProjectPayload(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return !('status' in value) && !('type' in value) && !('error' in value);
}

function _normalizeProjectPayload(source, projects, config = {}) {
  if (Array.isArray(projects)) {
    const ordered = source === 'claude'
      ? sortClaudeProjects(projects, config.projectOrder || config.order || [])
      : projects;

    return {
      projects: ordered,
      currentProject: config.currentProject ?? (ordered[0] ? ordered[0].name : null)
    };
  }

  if (_isPlainSuccessProjectPayload(projects) && Array.isArray(projects.projects)) {
    const ordered = source === 'claude'
      ? sortClaudeProjects(projects.projects, config.projectOrder || config.order || [])
      : projects.projects;

    return {
      ...projects,
      projects: ordered,
      currentProject: projects.currentProject ?? config.currentProject ?? (ordered[0] ? ordered[0].name : null)
    };
  }

  return projects;
}

function _normalizeChannelsPayload(source, value) {
  if (source === 'claude') {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && Array.isArray(value.channels)) {
      return value.channels;
    }
    return [];
  }

  if (Array.isArray(value)) {
    return { channels: value };
  }
  if (value && typeof value === 'object' && Array.isArray(value.channels)) {
    return value;
  }
  if (value == null) {
    return { channels: [] };
  }
  return value;
}

async function buildProjectsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'projects');
  const getter = _getProjectsGetter(driver);
  if (getter) {
    const driverOptions = { force: options.force === true, config };
    const projects = await _invokeCapabilityGetter(source, 'projects', 'list', getter, driverOptions);
    if (source === 'claude') {
      const order = await _getClaudeProjectOrder(driver, config, options);
      return _normalizeProjectPayload(source, projects, { projectOrder: order, currentProject: config.currentProject });
    }
    return _normalizeProjectPayload(source, projects, config);
  }

  if (_isTypedPayload(driver)) {
    return driver;
  }

  return _unsupportedPayload(source, 'projects');
}

async function buildCountsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const countsDriver = _getRuntimeDriver(runtime, source, 'counts');
  const countsGetter = _getCountsGetter(countsDriver);
  if (countsGetter) {
    return _invokeCapabilityGetter(source, 'counts', 'count', countsGetter, { force: options.force === true, config });
  }
  if (_isTypedPayload(countsDriver)) {
    return countsDriver;
  }

  const projectsDriver = _getRuntimeDriver(runtime, source, 'projects');
  const projectsGetter = _getCountsGetter(projectsDriver);
  if (projectsGetter) {
    return _invokeCapabilityGetter(source, 'counts', 'count', projectsGetter, { force: options.force === true, config });
  }
  if (_isTypedPayload(projectsDriver)) {
    return projectsDriver;
  }

  return _unsupportedPayload(source, 'counts');
}

async function buildTodayStatsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'statistics');
  const getter = _getTodayStatsGetter(driver);
  if (getter) {
    return _invokeCapabilityGetter(source, 'statistics', 'get', getter, { force: options.force === true, config });
  }

  if (_isTypedPayload(driver)) {
    return driver;
  }

  return _unsupportedPayload(source, 'statistics');
}

async function buildChannelsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'channels');
  const getter = _getChannelsGetter(driver);
  if (getter) {
    const value = await _invokeCapabilityGetter(source, 'channels', 'list', getter, { force: options.force === true, config });
    return _normalizeChannelsPayload(source, value);
  }

  if (_isTypedPayload(driver)) {
    return driver;
  }

  return _unsupportedPayload(source, 'channels');
}

async function buildPayload({ kind, source, config, options, runtime } = {}) {
  const snapshotOptions = options || {};
  const effectiveOptions = runtime ? { ...snapshotOptions, runtime } : snapshotOptions;
  switch (kind) {
    case 'projects':
      return buildProjectsPayload(source, config || {}, effectiveOptions);
    case 'counts':
      return buildCountsPayload(source, config || {}, effectiveOptions);
    case 'todayStats':
      return buildTodayStatsPayload(source, config || {}, effectiveOptions);
    case 'channels':
      return buildChannelsPayload(source, config || {}, effectiveOptions);
    default:
      throw new Error(`Unsupported dashboard snapshot kind: ${kind}`);
  }
}

function _getSerializableWorkerOptions(options = {}) {
  if (!options || typeof options !== 'object') {
    return {};
  }
  return typeof options.force === 'boolean' ? { force: options.force } : {};
}

function runDashboardSnapshotWorker(kind, source, config = {}, options = {}) {
  const workerOptions = _getSerializableWorkerOptions(options);
  const runtime = options.runtime;

  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(buildPayload({ kind, source, config, options: workerOptions, runtime }))
      .then((value) => {
        if (_isTypedFailurePayload(value)) {
          throw _typedFailurePayloadToError(value);
        }
        return value;
      });
  }

  return new Promise((resolve, reject) => {
    const child = childProcess.fork(__filename, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        CC_TOOL_DASHBOARD_SNAPSHOT_WORKER: '1'
      }
    });

    let settled = false;
    let stderr = '';
    let timeout = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    timeout = setTimeout(() => {
      finish(new Error(`Dashboard snapshot refresh timed out for ${kind}/${source}`));
    }, DASHBOARD_SNAPSHOT_WORKER_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.ok) {
        if (_isTypedFailurePayload(message.value)) {
          finish(_typedFailurePayloadToError(message.value));
          return;
        }
        finish(null, message.value);
      } else {
        finish(_deserializeError(message.error, `Dashboard snapshot refresh failed for ${kind}/${source}`));
      }
    });

    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) => {
      if (settled) return;
      const suffix = stderr ? `: ${stderr.trim()}` : '';
      finish(new Error(`Dashboard snapshot worker exited (${code || signal || 'unknown'})${suffix}`));
    });

    try {
      child.send({ kind, source, config, options: workerOptions });
    } catch (error) {
      finish(error);
    }
  });
}

function attachWorkerHandler() {
  process.on('message', async (message) => {
    try {
      const value = await buildPayload(message || {});
      if (process.send) {
        process.send({ ok: true, value: _serializeWorkerValue(value) }, () => process.exit(0));
        return;
      }
    } catch (error) {
      if (process.send) {
        process.send({ ok: false, error: _serializeError(error) }, () => process.exit(1));
        return;
      }
    }
    process.exit(0);
  });
}

if (process.env.CC_TOOL_DASHBOARD_SNAPSHOT_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = {
  buildPayload,
  runDashboardSnapshotWorker,
  _test: {
    getSerializableWorkerOptions: _getSerializableWorkerOptions,
    serializeError: _serializeError,
    deserializeError: _deserializeError,
    serializeWorkerValue: _serializeWorkerValue
  }
};
