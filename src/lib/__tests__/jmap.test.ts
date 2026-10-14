import {
  assertHttps,
  failedIds,
  fetchSession,
  jmapCall,
  JmapHttpError,
  type JmapSession,
} from 'src/lib/jmap';
import { afterEach, describe, expect, it, vi } from 'vitest';

const creds = { login: 'u@example.test', password: 'synthetic-secret' };
const session: JmapSession = {
  apiUrl: 'https://mail.example.test/jmap/',
  accountId: 'r',
  maxObjectsInSet: 500,
  maxCallsInRequest: 16,
};

const mockFetch = (res: { ok: boolean; status?: number; json?: () => unknown }) =>
  vi.stubGlobal('fetch', vi.fn(async () => res as Response));

afterEach(() => vi.unstubAllGlobals());

describe('assertHttps', () => {
  it.each(['http://mail.example.test', 'ftp://x', '', undefined, 'not a url'])(
    'rejects %j',
    (v) => expect(() => assertHttps(v)).toThrow(),
  );

  it('accepts https', () => {
    expect(assertHttps('https://mail.example.test').hostname).toBe('mail.example.test');
  });
});

describe('bearer credentials', () => {
  it('sends a Bearer header', async () => {
    mockFetch({ ok: true, json: () => ({ methodResponses: [] }) });
    await jmapCall(session, { token: 'synthetic-token' }, []);
    expect((fetch as any).mock.calls[0][1].headers.Authorization).toBe(
      'Bearer synthetic-token',
    );
  });
});

describe('fetchSession', () => {
  it('reads account and limits, sends Basic auth', async () => {
    mockFetch({
      ok: true,
      json: () => ({
        apiUrl: session.apiUrl,
        primaryAccounts: { 'urn:ietf:params:jmap:contacts': 'r' },
        capabilities: {
          'urn:ietf:params:jmap:core': { maxObjectsInSet: 500, maxCallsInRequest: 16 },
        },
      }),
    });
    const s = await fetchSession(new URL('https://mail.example.test'), creds);
    expect(s).toEqual(session);
    const init = (fetch as any).mock.calls[0][1];
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('u@example.test:synthetic-secret').toString('base64')}`,
    );
  });

  it('throws JmapHttpError on 401 without leaking the secret', async () => {
    mockFetch({ ok: false, status: 401 });
    const err = await fetchSession(new URL('https://mail.example.test'), creds).catch((e) => e);
    expect(err).toBeInstanceOf(JmapHttpError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain('synthetic-secret');
  });

  it('throws when there is no contacts account', async () => {
    mockFetch({ ok: true, json: () => ({ apiUrl: 'x', primaryAccounts: {}, capabilities: {} }) });
    await expect(fetchSession(new URL('https://mail.example.test'), creds)).rejects.toThrow(
      'no contacts account',
    );
  });
});

describe('jmapCall', () => {
  it('returns methodResponses', async () => {
    mockFetch({ ok: true, json: () => ({ methodResponses: [['X/get', {}, 'a']] }) });
    expect(await jmapCall(session, creds, [['X/get', {}, 'a']])).toEqual([['X/get', {}, 'a']]);
  });

  it('throws on HTTP error', async () => {
    mockFetch({ ok: false, status: 503 });
    await expect(jmapCall(session, creds, [])).rejects.toBeInstanceOf(JmapHttpError);
  });
});

describe('failedIds', () => {
  it('collects notCreated, notUpdated, notDestroyed', () => {
    expect(
      failedIds({ notCreated: { a: {} }, notUpdated: { b: {} }, notDestroyed: { c: {} } }),
    ).toEqual(['a', 'b', 'c']);
  });

  it.each([undefined, null, {}])('is empty for %j', (r) => expect(failedIds(r)).toEqual([]));
});
