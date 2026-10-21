import { checkWebhookUrl, isPrivateAddress } from './url-safety';

describe('webhooks: SSRF guard', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.0.0.1', true],
    ['172.16.5.4', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['93.184.215.14', false],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['2606:4700::1111', false],
    ['not-an-ip', true],
  ])('isPrivateAddress(%s) = %s', (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected));

  const resolveTo = (address: string) => async () => [{ address, family: 4 }] as any;
  const unresolvable = async () => {
    throw new Error('ENOTFOUND');
  };

  beforeEach(() => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'mock-billing';
  });

  it('accepts a public https URL', async () => {
    expect((await checkWebhookUrl('https://hooks.example.com/x', resolveTo('93.184.215.14') as any)).ok).toBe(true);
  });
  it('rejects a hostname that resolves to a private address (DNS-based SSRF)', async () => {
    expect((await checkWebhookUrl('https://internal.example.com/x', resolveTo('10.0.0.7') as any)).ok).toBe(false);
  });
  it('rejects a hostname that does not resolve', async () => {
    expect((await checkWebhookUrl('https://nope.invalid/x', unresolvable as any)).ok).toBe(false);
  });
  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'gopher://x', 'not a url'])('rejects %s', async (url) => {
    expect((await checkWebhookUrl(url, resolveTo('93.184.215.14') as any)).ok).toBe(false);
  });
  it('rejects embedded credentials', async () => {
    expect((await checkWebhookUrl('https://u:p@hooks.example.com/', resolveTo('93.184.215.14') as any)).ok).toBe(false);
  });
  it('allows hosts on the operator allowlist', async () => {
    expect((await checkWebhookUrl('http://mock-billing:4010/_webhook', unresolvable as any)).ok).toBe(true);
  });
});
