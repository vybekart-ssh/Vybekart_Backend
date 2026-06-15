import * as https from 'node:https';

/**
 * Corporate networks sometimes MITM HTTPS (self-signed cert in chain).
 * Set RESEND_INSECURE_TLS=true locally only — never on production Render.
 */
export function isResendInsecureTlsEnabled(): boolean {
  const flag = String(process.env.RESEND_INSECURE_TLS || '').toLowerCase();
  return flag === 'true' || flag === '1';
}

export async function resendFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!isResendInsecureTlsEnabled()) {
    return fetch(url, init);
  }

  const parsed = new URL(url);
  const body =
    typeof init.body === 'string'
      ? init.body
      : init.body
        ? String(init.body)
        : undefined;
  const headers = Object.fromEntries(new Headers(init.headers).entries());

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? 'GET',
        headers: body
          ? { ...headers, 'Content-Length': Buffer.byteLength(body) }
          : headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          resolve(
            new Response(responseBody, {
              status: res.statusCode ?? 500,
              headers: res.headers as HeadersInit,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
