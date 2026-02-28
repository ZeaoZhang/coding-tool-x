const zlib = require('zlib');

function createDecodedStream(res) {
  const encoding = String(res.headers['content-encoding'] || '').toLowerCase();

  if (encoding.includes('gzip')) {
    return res.pipe(zlib.createGunzip());
  }
  if (encoding.includes('deflate')) {
    return res.pipe(zlib.createInflate());
  }
  if (encoding.includes('br') && typeof zlib.createBrotliDecompress === 'function') {
    return res.pipe(zlib.createBrotliDecompress());
  }

  return res;
}

module.exports = {
  createDecodedStream
};
