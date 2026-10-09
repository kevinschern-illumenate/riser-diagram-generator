import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useLibraryStore } from '../../state/library-store';
import { commitCatalog, previewCatalog, type CatalogRow } from './catalog';

const STATUSES = ['added', 'updated', 'unchanged', 'retired', 'conflict', 'invalid'] as const;

async function fetchCatalog() {
  const response = await fetch('/api/erp/catalog', { headers: { Accept: 'application/json' } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(
      typeof error === 'string'
        ? error
        : 'The local proxy is not running. Start npm run proxy and try again.',
    );
  }
  return body;
}

export function CatalogPanel() {
  const library = useLibraryStore((s) => s.library),
    update = useLibraryStore((s) => s.update);
  const [rows, setRows] = useState<CatalogRow[]>([]),
    [hash, setHash] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [snapshot, setSnapshot] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const preview = previewCatalog(await fetchCatalog(), library.products);
      setRows(preview.rows);
      setHash(preview.hash);
      setSnapshot(JSON.stringify(library.products));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the catalog');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }
  const stale = snapshot !== JSON.stringify(library.products);
  const problems = rows.filter((r) => r.status !== 'unchanged' && r.errors.length);
  return (
    <section className="panel library-panel">
      <h2>ilLumenate catalog</h2>
      <p className="editor-help">
        Loads the product catalog ilLumenate publishes for the System Designer through the local
        proxy. Catalog products are read-only here; duplicate one to make a local variant. The proxy
        only reads from ERPNext.
      </p>
      <p className="reference-note" role="note">
        This is the last standalone release. New designs belong in the ilLumenate System Designer,
        which opens your fixture schedules directly.
      </p>
      <div className="action-bar">
        <Button disabled={busy} onClick={() => void load()}>
          {busy ? 'Loading…' : 'Load ilLumenate catalog'}
        </Button>
      </div>
      {!!rows.length && (
        <>
          <p>
            Snapshot {hash.slice(0, 12)}:{' '}
            {STATUSES.map((s) => `${rows.filter((r) => r.status === s).length} ${s}`).join(' · ')}
          </p>
          {!!problems.length && (
            <div className="wide-table">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Result</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((r, i) => (
                    <tr key={`${r.id}-${i}`}>
                      <td>{r.id || '—'}</td>
                      <td>{r.status}</td>
                      <td>{r.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button
            disabled={stale}
            onClick={() => {
              try {
                update('products', commitCatalog(library.products, rows));
                setMessage('Catalog applied. Undo restores the previous library.');
                setRows([]);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Apply catalog
          </Button>
          {stale && (
            <p className="editor-help">
              The library changed after loading. Load the catalog again.
            </p>
          )}
        </>
      )}
      {error && (
        <pre role="alert" className="inline-error">
          {error}
        </pre>
      )}
      {message && (
        <p role="status" className="inline-success">
          {message}
        </p>
      )}
    </section>
  );
}
