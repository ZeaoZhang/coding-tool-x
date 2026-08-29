'use strict';

function createUnsupportedDriver({ platform, capability } = {}) {
  return { status: 'unsupported', platform, capability };
}

module.exports = { createUnsupportedDriver };
