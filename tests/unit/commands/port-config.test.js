'use strict';

const { _test } = require('../../../src/commands/port-config');

describe('port config helpers', () => {
  test('includes OMP proxy port question with configured default', () => {
    const questions = _test.buildPortQuestions({ ports: { ompProxy: 29992 } });
    const ompQuestion = questions.find(question => question.name === 'ompProxy');

    expect(ompQuestion).toEqual(expect.objectContaining({
      message: 'OMP 代理服务端口:',
      default: 29992
    }));
  });

  test('builds persisted ports config including ompProxy', () => {
    expect(_test.buildPortsConfig({
      webUI: '19999',
      proxy: '20088',
      codexProxy: '20089',
      geminiProxy: '20090',
      opencodeProxy: '20091',
      ompProxy: '20092'
    })).toEqual({
      webUI: 19999,
      proxy: 20088,
      codexProxy: 20089,
      geminiProxy: 20090,
      opencodeProxy: 20091,
      ompProxy: 20092
    });
  });

  test('validates allowed port range', () => {
    expect(_test.validatePort('1024')).toBe(true);
    expect(_test.validatePort('65535')).toBe(true);
    expect(_test.validatePort('1023')).toBe('端口必须是 1024-65535 之间的数字');
    expect(_test.validatePort('bad')).toBe('端口必须是 1024-65535 之间的数字');
  });
});
