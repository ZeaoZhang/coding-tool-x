'use strict';

const { createProjectAdapter } = require('./shared');

function createAdapter(options = {}) {
  return createProjectAdapter(options);
}

module.exports = { createAdapter };
