const { getNextModelCatalogVersion } = require('../../../scripts/next-model-catalog-version');

describe('model catalog release versions', () => {
  it('keeps the current patch for the first release on a new date', () => {
    expect(getNextModelCatalogVersion('3.9.5-261013', '261014')).toBe('3.9.5-261014');
  });

  it('increments the patch when another release is requested on the same date', () => {
    expect(getNextModelCatalogVersion('3.9.5-261014', '261014')).toBe('3.9.6-261014');
  });

  it('keeps the patch when moving to the next date', () => {
    expect(getNextModelCatalogVersion('3.9.5-261014', '261015')).toBe('3.9.5-261015');
  });

  it('increments the patch when the current version has no date suffix', () => {
    expect(getNextModelCatalogVersion('3.9.5', '261014')).toBe('3.9.6-261014');
  });
});
