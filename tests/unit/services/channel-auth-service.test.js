const {
  matchChannel,
  resolveChannelAuthRef
} = require('../../../src/platforms/channel-auth-service');

describe('channel OAuth usage reference resolution', () => {
  test('recovers a stale credential id by provider account identity', () => {
    const channel = {
      authMode: 'oauth',
      authRef: {
        credentialId: 'stale-credential',
        providerId: 'openai',
        accountId: 'chatgpt-account-1'
      }
    };
    const candidate = {
      authRef: {
        credentialId: 'synced-credential',
        providerId: 'openai',
        accountId: 'chatgpt-account-1'
      }
    };

    expect(matchChannel(channel, candidate)).toBe(true);
    expect(resolveChannelAuthRef({ scan: () => ({ candidates: [candidate] }) }, channel)).toMatchObject(candidate.authRef);
  });

  test('selects a sole scanned OAuth credential when the channel has no reference', () => {
    const candidate = {
      authRef: {
        credentialId: 'only-credential',
        providerId: 'anthropic',
        accountId: 'account-1'
      }
    };

    expect(resolveChannelAuthRef({ scan: () => ({ candidates: [candidate] }) }, {
      authMode: 'oauth',
      authRef: {}
    })).toMatchObject(candidate.authRef);
  });

  test('does not guess between multiple accounts', () => {
    const channel = { authMode: 'oauth', authRef: {} };
    const candidates = [
      { authRef: { credentialId: 'credential-1', providerId: 'google', accountId: 'account-1' } },
      { authRef: { credentialId: 'credential-2', providerId: 'google', accountId: 'account-2' } }
    ];

    expect(resolveChannelAuthRef({ scan: () => ({ candidates }) }, channel)).toEqual({
      credentialId: '',
      providerId: '',
      accountId: '',
      identityKey: '',
      accountEmail: ''
    });
  });
});
