// Minimal JMAP client (RFC 8620 / 9610). Never logs credentials or contact data.

export const JMAP_USING = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:contacts',
];

export type JmapSession = {
  apiUrl: string;
  accountId: string;
  maxObjectsInSet: number;
  maxCallsInRequest: number;
};

// Basic (app password) or Bearer (OAuth access token from the member's own connection).
export type JmapCredentials =
  | { login: string; password: string }
  | { token: string };

export const assertHttps = (raw: string | undefined): URL => {
  let url: URL;

  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Error('STALWART_JMAP_URL is missing or not a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('STALWART_JMAP_URL must use https');
  }

  return url;
};

const authHeader = (creds: JmapCredentials): string =>
  'token' in creds
    ? `Bearer ${creds.token}`
    : `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString('base64')}`;

export class JmapHttpError extends Error {
  constructor(public readonly status: number, where: string) {
    super(`JMAP ${where} failed with HTTP ${status}`);
  }
}

export const fetchSession = async (
  baseUrl: URL,
  creds: JmapCredentials,
): Promise<JmapSession> => {
  // /.well-known/jmap answers 307; fetch follows it (same host keeps the header)
  const res = await fetch(new URL('/.well-known/jmap', baseUrl), {
    headers: { Authorization: authHeader(creds) },
    redirect: 'follow',
  });

  if (!res.ok) throw new JmapHttpError(res.status, 'session');

  const s = (await res.json()) as any;
  const accountId = s.primaryAccounts?.['urn:ietf:params:jmap:contacts'];
  const core = s.capabilities?.['urn:ietf:params:jmap:core'] ?? {};

  if (!s.apiUrl || !accountId) {
    throw new Error('JMAP session has no contacts account');
  }

  return {
    apiUrl: s.apiUrl,
    accountId,
    maxObjectsInSet: core.maxObjectsInSet ?? 100,
    maxCallsInRequest: core.maxCallsInRequest ?? 8,
  };
};

export const jmapCall = async (
  session: JmapSession,
  creds: JmapCredentials,
  methodCalls: unknown[],
): Promise<any[]> => {
  const res = await fetch(session.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ using: JMAP_USING, methodCalls }),
  });

  if (!res.ok) throw new JmapHttpError(res.status, 'call');

  return ((await res.json()) as any).methodResponses;
};

// Keeps ids of rejected objects; HTTP 200 does not mean success.
export const failedIds = (response: any): string[] => [
  ...Object.keys(response?.notCreated ?? {}),
  ...Object.keys(response?.notUpdated ?? {}),
  ...Object.keys(response?.notDestroyed ?? {}),
];
