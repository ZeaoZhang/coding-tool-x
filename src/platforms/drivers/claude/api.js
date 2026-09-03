'use strict';

const express = require('express');
const channels = require('./api-channels');
const projects = require('./api-projects');
const sessions = require('./api-sessions');
const proxy = require('./api-proxy');
const statistics = require('./api-statistics');

function createRouter(config, options = {}) {
  const router = express.Router();
  const routes = new Set(options.routes || ['projects', 'sessions', 'channels', 'proxy', 'statistics']);
  if (routes.has('projects')) router.use('/projects', projects(config));
  if (routes.has('sessions')) router.use('/sessions', sessions(config));
  if (routes.has('channels')) router.use('/channels', channels);
  if (routes.has('proxy')) router.use('/proxy', proxy);
  if (routes.has('statistics')) router.use('/statistics', statistics);
  return router;
}

module.exports = { createRouter };
