'use strict';

const { _test } = require('../../../src/commands/cli-type');

describe('cli-type registry integration', () => {
  it('derives selectable types and colors from platform metadata', () => {
    const registry = {
      list: () => [{
        key: 'demo-cli',
        label: 'Demo CLI',
        terminalColor: 'yellow',
        cliSelectable: true
      }, {
        key: 'managed-cli',
        label: 'Managed CLI',
        terminalColor: 'magenta',
        cliSelectable: false
      }]
    };

    expect(_test.getCliTypes(registry)).toEqual({
      'demo-cli': { name: 'Demo CLI', color: 'yellow' }
    });
  });
});
