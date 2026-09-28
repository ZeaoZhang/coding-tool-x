'use strict';

const semver = require('semver');

const current = semver.parse(require('../package.json').version);
if (!current) {
  throw new Error('package.json contains an invalid npm version');
}

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  year: '2-digit',
  month: '2-digit',
  day: '2-digit'
}).formatToParts(new Date());
const date = ['year', 'month', 'day']
  .map(type => dateParts.find(part => part.type === type).value)
  .join('');

const existingDateSuffix = current.prerelease.length === 1
  && /^\d{6}$/.test(String(current.prerelease[0]));
const patch = current.patch + (existingDateSuffix ? 0 : 1);
const next = `${current.major}.${current.minor}.${patch}-${date}`;

process.stdout.write(`${next}\n`);
