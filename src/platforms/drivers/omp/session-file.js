'use strict';

const fs = require('fs');

/**
 * OMP session files store the canonical session id in the `type:"session"`
 * header line. Copying the file verbatim makes the index reuse the source id,
 * so the fork never appears as a new session. Rewrite only that header line.
 */
function rewriteSessionHeaderId(content, newSessionId) {
  if (!content || !newSessionId) return content;
  const lines = content.split('\n');
  let rewritten = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (entry && entry.type === 'session' && typeof entry.id === 'string') {
      entry.id = newSessionId;
      lines[i] = JSON.stringify(entry);
      rewritten = true;
      break;
    }
  }
  return rewritten ? lines.join('\n') : content;
}

function forkSessionFile({ sourcePath, targetPath, newSessionId }) {
  const content = fs.readFileSync(sourcePath, 'utf8');
  fs.writeFileSync(targetPath, rewriteSessionHeaderId(content, newSessionId), 'utf8');
  return { targetPath, newSessionId };
}

module.exports = { rewriteSessionHeaderId, forkSessionFile };
