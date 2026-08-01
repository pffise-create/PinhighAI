describe('supportService', () => {
  const loadService = () => {
    jest.resetModules();
    return require('../../src/services/supportService');
  };

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
  });

  it('builds a support email draft with user and app context', () => {
    const { buildSupportEmail } = loadService();

    const draft = buildSupportEmail({
      category: 'Bug report',
      message: 'The swing upload failed after processing.',
      user: { id: 'user-123', email: 'golfer@example.com' },
      appEnv: 'staging',
      revenueCatUserId: 'rc-user-123',
      entitlementActive: true,
      platform: 'ios',
    });

    expect(draft.to).toBe('support@divotlab.ai');
    expect(draft.subject).toBe('Alki DivotLab Support: Bug report');
    expect(draft.body).toContain('The swing upload failed after processing.');
    expect(draft.body).toContain('User email: golfer@example.com');
    expect(draft.body).toContain('User id: user-123');
    expect(draft.body).toContain('Environment: staging');
    expect(draft.body).toContain('Platform: ios');
    expect(draft.body).toContain('RevenueCat user: rc-user-123');
    expect(draft.body).toContain('Entitlement active: yes');
    expect(draft.url).toContain('mailto:support@divotlab.ai?');
    expect(draft.url).toContain('subject=Alki+DivotLab+Support%3A+Bug+report');
  });

  it('allows the support email address to be overridden by environment', () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'qa-support@example.com';
    const { buildSupportEmail } = loadService();

    const draft = buildSupportEmail({
      category: 'Account',
      message: 'I need help signing in.',
      platform: 'ios',
    });

    expect(draft.to).toBe('qa-support@example.com');
    expect(draft.url).toContain('mailto:qa-support@example.com?');
  });
});
