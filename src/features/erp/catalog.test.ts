import { describe, expect, it } from 'vitest';
import { seedProducts } from '../../data/seeds';
import type { CatalogItem } from '../../schemas/catalog';
import {
  assertCatalogItemsUnchanged,
  commitCatalog,
  isCatalogItem,
  localCopy,
  previewCatalog,
  READ_ONLY_MESSAGE,
} from './catalog';
// Copied from the ERP repository's tools/system_designer/packages/core-schemas/fixtures/catalog
// (TEST records only); the endpoint adds the snapshot hash.
import fixture from './fixtures/catalog-payload.json';

const HASH = 'a'.repeat(64);
const payload = (changes: Record<string, unknown> = {}) => ({
  ...structuredClone(fixture),
  hash: HASH,
  ...changes,
});
const counts = (rows: { status: string }[]) =>
  rows.reduce<Record<string, number>>(
    (all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }),
    {},
  );

describe('ilLumenate catalog', () => {
  it('loads every catalog product read-only, without the planner rank, next to local products', () => {
    const { hash, rows } = previewCatalog(payload(), seedProducts);
    expect(hash).toBe(HASH);
    expect(counts(rows)).toEqual({ added: fixture.items.length });
    const next = commitCatalog(seedProducts, rows);
    expect(next).toHaveLength(seedProducts.length + fixture.items.length);
    const supply = next.find((p) => p.id === 'drv:TEST-PSU-96')!;
    expect(isCatalogItem(supply)).toBe(true);
    expect(supply).not.toHaveProperty('rank');
    expect(supply.localOverrides).toEqual([]);
    expect(supply.sourceData).toMatchObject({ catalogSnapshot: HASH, doctype: 'ilL-Spec-Driver' });
    expect(supply.specs).toMatchObject({ kind: 'psu', usableLoadFactor: 0.8 });
    expect(next.filter((p) => !isCatalogItem(p))).toEqual(seedProducts);
  });

  it('replaces catalog products on reload and keeps retired ones for existing projects', () => {
    const first = commitCatalog([], previewCatalog(payload(), []).rows);
    const items = structuredClone(fixture.items);
    items[0]!.description = 'Revised description';
    const removed = items.pop()!;
    const { rows } = previewCatalog(payload({ items, hash: 'b'.repeat(64) }), first);
    expect(counts(rows)).toEqual({ updated: 1, unchanged: items.length - 1, retired: 1 });
    expect(rows.find((r) => r.status === 'retired')?.id).toBe(removed.id);
    const next = commitCatalog(first, rows);
    expect(next.find((p) => p.id === items[0]!.id)?.description).toBe('Revised description');
    expect(next.find((p) => p.id === removed.id)?.sourceData?.catalogSnapshot).toBe(HASH);
    expect(next.find((p) => p.id === items[1]!.id)?.sourceData?.catalogSnapshot).toBe(
      'b'.repeat(64),
    );
  });

  it('never overwrites a local product and skips invalid or example products', () => {
    const local: CatalogItem = {
      ...structuredClone(seedProducts[0]!),
      id: 'mine',
      sku: 'TEST-PSU-60',
    };
    const items = structuredClone(fixture.items) as Record<string, unknown>[];
    items.push({ ...items[0], id: 'ctl:EXAMPLE', sku: 'EXAMPLE', isExample: true });
    items.push({ ...items[0], id: 'ctl:BROKEN', sku: 'BROKEN', specs: { kind: 'controller' } });
    items.push(items[1]!);
    const { rows } = previewCatalog(payload({ items }), [local]);
    expect(counts(rows)).toEqual({ added: fixture.items.length - 1, conflict: 1, invalid: 3 });
    expect(rows.find((r) => r.status === 'conflict')?.errors[0]).toContain('Local product mine');
    expect(rows.find((r) => r.id === 'ctl:EXAMPLE')?.errors).toEqual([
      'The catalog sent an example product.',
    ]);
    const next = commitCatalog([local], rows);
    expect(next[0]).toEqual(local);
    expect(next.filter(isCatalogItem).some((p) => p.id === 'drv:TEST-PSU-60' || p.isExample)).toBe(
      false,
    );
  });

  it('refuses another catalog contract and a malformed response', () => {
    expect(() => previewCatalog(payload({ engine_contract_version: 'catalog-2' }), [])).toThrow(
      /System Designer/,
    );
    expect(() => previewCatalog({ items: [] }, [])).toThrow();
  });

  it('allows deleting catalog products but not editing or adding them outside a catalog load', () => {
    const library = commitCatalog([], previewCatalog(payload(), []).rows);
    const [first, ...rest] = library;
    expect(() => assertCatalogItemsUnchanged(library, rest)).not.toThrow();
    expect(() =>
      assertCatalogItemsUnchanged(library, [{ ...first!, model: 'Edited' }, ...rest]),
    ).toThrow(READ_ONLY_MESSAGE);
    expect(() => assertCatalogItemsUnchanged(rest, library)).toThrow(READ_ONLY_MESSAGE);
    const copy = localCopy(first!);
    expect(isCatalogItem(copy)).toBe(false);
    expect(copy.sourceData).toMatchObject({ doctype: first!.sourceData?.doctype });
    expect(() =>
      assertCatalogItemsUnchanged(library, [...library, { ...copy, id: 'x', sku: 'X' }]),
    ).not.toThrow();
  });
});
