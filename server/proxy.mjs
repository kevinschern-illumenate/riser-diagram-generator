import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

// The System Designer's desktop catalog endpoint (staff API key with the engineering capability).
export const CATALOG_METHOD =
  'illumenate_lighting.illumenate_lighting.system_design.api.get_catalog_for_desktop';

const envelopeSchema = z.object({
  message: z.union([
    z
      .object({
        success: z.literal(true),
        data: z
          .object({
            hash: z.string().regex(/^[0-9a-f]{64}$/),
            engine_contract_version: z.string(),
            items: z.array(z.record(z.string(), z.unknown())),
          })
          .passthrough(),
      })
      .strict(),
    z.object({ success: z.literal(false), code: z.string(), error: z.string() }).strict(),
  ]),
});

const failures = {
  FORBIDDEN: [403, 'The ERP API key needs an ilLumenate staff user with engineering access.'],
  NOT_FOUND: [404, 'ilLumenate has not published a design catalog yet.'],
};

export function createProxy({ env = process.env, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const host = req.hostname;
    const validOrigin = !origin || /^http:\/\/(127\.0\.0\.1|localhost):(5173|4173)$/.test(origin);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || !validOrigin)
      return res.status(403).json({ error: 'Loopback requests only' });
    res.set('Cache-Control', 'no-store');
    next();
  });
  const configured = () =>
    !!(env.ERPNEXT_BASE_URL && env.ERPNEXT_API_KEY && env.ERPNEXT_API_SECRET);
  app.get('/api/erp/status', (_req, res) =>
    res.json({ configured: configured(), direction: 'pull-only', source: 'ilLumenate catalog' }),
  );
  app.get('/api/erp/catalog', async (_req, res) => {
    if (!configured()) return res.status(503).json({ error: 'Configure the local .env first.' });
    try {
      const base = new URL(env.ERPNEXT_BASE_URL);
      if (
        base.protocol !== 'https:' &&
        !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))
      )
        throw new Error('Use HTTPS for remote ERPNext');
      if (base.username || base.password) throw new Error('Use token configuration');
      const upstream = await fetchImpl(new URL(`/api/method/${CATALOG_METHOD}`, base), {
        headers: {
          Authorization: `token ${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (upstream.status === 401 || upstream.status === 403)
        return res.status(403).json({ error: 'ERPNext rejected the API key.' });
      if (!upstream.ok) throw new Error('ERP request failed');
      const body = envelopeSchema.parse(await upstream.json()).message;
      if (body.success) return res.json(body.data);
      const [status, error] = failures[body.code] ?? [502, 'ERPNext could not build the catalog.'];
      return res.status(status).json({ error });
    } catch {
      return res.status(502).json({
        error: 'Catalog load failed. Check the ERPNext URL and API key in the local .env.',
      });
    }
  });
  app.use((err, _req, res, _next) =>
    res.status(err.status === 413 ? 413 : 400).json({ error: 'Invalid request' }),
  );
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PROXY_PORT || 8787);
  createProxy().listen(port, '127.0.0.1', () =>
    process.stdout.write(`ilLumenate catalog proxy listening on http://127.0.0.1:${port}\n`),
  );
}
