'use strict';

const semver = require('semver');

const current = semver.parse(require('../package.json').version);
if (!current) {
  throw new Error('package.json contains an invalid npm version');
}

let next;
if (current.prerelease.length === 1 && Number.isInteger(Number(current.prerelease[0]))) {
  next = `${current.major}.${current.minor}.${current.patch}-${Number(current.prerelease[0]) + 1}`;
} else {
  next = `${current.major}.${current.minor}.${current.patch + 1}-1`;
}

process.stdout.write(`${next}\n`);
