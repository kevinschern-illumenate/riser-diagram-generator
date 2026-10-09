import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_METHOD, createProxy } from './proxy.mjs';
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});
async function start(options) {
  const server = createProxy(options).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}`;
}
const env = {
  ERPNEXT_BASE_URL: 'https://erp.example.invalid',
  ERPNEXT_API_KEY: 'local-test-key',
  ERPNEXT_API_SECRET: 'local-test-secret',
};
const catalog = {
  hash: 'c'.repeat(64),
  engine_contract_version: 'catalog-1',
  code_tables_version: 'nec-2023-1',
  items: [{ id: 'drv:TEST' }],
  wires: [],
};
const envelope = (message, init) => Response.json({ message }, init);
const get = (url, headers = {}) => fetch(url + '/api/erp/catalog', { headers });
describe('local ilLumenate catalog proxy', () => {
  it('reads the desktop catalog with the token and keeps credentials out of the response', async () => {
    const upstream = vi.fn().mockResolvedValue(envelope({ success: true, data: catalog }));
    const url = await start({ env, fetchImpl: upstream });
    const response = await get(url);
    const body = await response.json();
    expect(body).toEqual(catalog);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [target, options] = upstream.mock.calls[0];
    expect(target.href).toBe(`https://erp.example.invalid/api/method/${CATALOG_METHOD}`);
    expect(options.headers.Authorization).toBe('token local-test-key:local-test-secret');
    expect(options.method).toBeUndefined();
    expect(options.redirect).toBe('error');
    expect(JSON.stringify(body)).not.toContain('local-test-secret');
  });
  it('explains contract failures and a rejected key', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(envelope({ success: false, code: 'FORBIDDEN', error: 'x' }))
      .mockResolvedValueOnce(envelope({ success: false, code: 'NOT_FOUND', error: 'x' }))
      .mockResolvedValueOnce(envelope({ success: false, code: 'INTERNAL', error: 'trace' }))
      .mockResolvedValueOnce(new Response('denied', { status: 401 }));
    const url = await start({ env, fetchImpl: upstream });
    const forbidden = await get(url);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toContain('engineering access');
    expect((await get(url)).status).toBe(404);
    const internal = await get(url);
    expect(internal.status).toBe(502);
    expect(await internal.text()).not.toContain('trace');
    expect((await get(url)).status).toBe(403);
  });
  it('rejects external origins, unconfigured credentials and the retired item pull', async () => {
    const upstream = vi.fn();
    const url = await start({ env: {}, fetchImpl: upstream });
    expect((await get(url, { Origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await get(url)).status).toBe(503);
    expect((await fetch(url + '/api/erp/items', { method: 'POST' })).status).toBe(404);
    expect(await (await fetch(url + '/api/erp/status')).json()).toEqual({
      configured: false,
      direction: 'pull-only',
      source: 'ilLumenate catalog',
    });
    expect(upstream).not.toHaveBeenCalled();
  });
  it('redacts upstream errors, malformed bodies and remote plaintext requests', async () => {
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(new Error('local-test-secret upstream traceback'))
      .mockResolvedValueOnce(envelope({ success: true, data: { ...catalog, hash: 'short' } }));
    const url = await start({ env, fetchImpl: upstream });
    const response = await get(url);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('local-test-secret');
    expect((await get(url)).status).toBe(502);
    const unsafe = await start({
      env: { ...env, ERPNEXT_BASE_URL: 'http://erp.example.invalid' },
      fetchImpl: upstream,
    });
    expect((await get(unsafe)).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
