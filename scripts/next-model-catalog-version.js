'use strict';

const semver = require('semver');

function getNextModelCatalogVersion(version, date) {
  const current = semver.parse(version);
  if (!current) {
    throw new Error('package.json contains an invalid npm version');
  }

  const existingDateSuffix = current.prerelease.length === 1
    && /^\d{6}$/.test(String(current.prerelease[0]));
  const sameDateSuffix = existingDateSuffix && String(current.prerelease[0]) === date;
  const patch = current.patch + (existingDateSuffix && !sameDateSuffix ? 0 : 1);
  return `${current.major}.${current.minor}.${patch}-${date}`;
}

function getShanghaiDateStamp(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map(type => dateParts.find(part => part.type === type).value)
    .join('');
}

if (require.main === module) {
  const currentVersion = require('../package.json').version;
  process.stdout.write(`${getNextModelCatalogVersion(currentVersion, getShanghaiDateStamp())}\n`);
}

module.exports = { getNextModelCatalogVersion, getShanghaiDateStamp };
