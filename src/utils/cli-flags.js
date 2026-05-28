function hasHostFlag(argv = process.argv) {
  return Array.isArray(argv) && (argv.includes('--host') || argv.includes('--hosts'));
}

module.exports = {
  hasHostFlag
};
