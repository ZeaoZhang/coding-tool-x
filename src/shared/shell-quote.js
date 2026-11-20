'use strict';

function quoteShellArgument(value) {
  const text = String(value);
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text)
    ? text
    : `"${text.replace(/(["\\$`])/g, '\\$1')}"`;
}

module.exports = { quoteShellArgument };
