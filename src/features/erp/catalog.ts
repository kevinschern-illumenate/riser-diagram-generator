import { z } from 'zod';
import { CatalogItemSchema, ProductLibrarySchema, type CatalogItem } from '../../schemas/catalog';

/** The ERP catalog contract this release reads (`engine_contract_version`). */
export const SUPPORTED_CONTRACT = 'catalog-1';

export const CatalogPayloadSchema = z
  .object({
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    engine_contract_version: z.string(),
    items: z.array(z.unknown()),
  })
  .passthrough();
export type CatalogPayload = z.infer<typeof CatalogPayloadSchema>;

export type CatalogRow = {
  id: string;
  status: 'added' | 'updated' | 'unchanged' | 'retired' | 'conflict' | 'invalid';
  item?: CatalogItem;
  errors: string[];
};

export const READ_ONLY_MESSAGE =
  'ilLumenate catalog products are read-only. Duplicate one to make a local variant.';

/** Products loaded from the ilLumenate catalog carry the snapshot hash they came from. */
export function isCatalogItem(item: unknown): boolean {
  const data = (item as { sourceData?: Record<string, unknown> } | null)?.sourceData;
  return typeof data?.catalogSnapshot === 'string';
}

/** A local, editable copy of a catalog product (Duplicate). */
export function localCopy<T extends CatalogItem>(item: T): T {
  const copy = structuredClone(item);
  if (copy.sourceData) {
    delete copy.sourceData.catalogSnapshot;
    if (!Object.keys(copy.sourceData).length) delete copy.sourceData;
  }
  copy.localOverrides = [];
  return copy;
}

function toLibraryItem(raw: unknown, hash: string): CatalogItem {
  const record = z.record(z.string(), z.unknown()).parse(raw);
  // The supply preference order is for the System Designer's planner only.
  const item = { ...record };
  delete item.rank;
  if (item.isExample !== false) throw new Error('The catalog sent an example product.');
  const sourceData = z.record(z.string(), z.json()).optional().parse(item.sourceData);
  return CatalogItemSchema.parse({
    ...item,
    localOverrides: [],
    sourceData: { ...sourceData, catalogSnapshot: hash },
  });
}

const withoutSnapshot = (item: CatalogItem) =>
  JSON.stringify({ ...item, sourceData: { ...item.sourceData, catalogSnapshot: null } });

/**
 * Compare a catalog snapshot with the library. Catalog products replace their earlier copies
 * whole; local products are never touched, so one with the same ID or SKU is a conflict.
 * Catalog products missing from the snapshot are kept so existing projects still open.
 */
export function previewCatalog(payload: unknown, existing: CatalogItem[]) {
  const data = CatalogPayloadSchema.parse(payload);
  if (data.engine_contract_version !== SUPPORTED_CONTRACT)
    throw new Error(
      `This catalog uses contract ${data.engine_contract_version}; this release reads ${SUPPORTED_CONTRACT}. Use the ilLumenate System Designer.`,
    );
  const local = existing.filter((p) => !isCatalogItem(p));
  const loaded = new Map(existing.filter(isCatalogItem).map((p) => [p.id, p]));
  const seen = new Set<string>();
  const rows: CatalogRow[] = data.items.map((raw) => {
    const id = String((raw as { id?: unknown } | null)?.id ?? '');
    try {
      const item = toLibraryItem(raw, data.hash);
      if (seen.has(item.id)) throw new Error('The catalog lists this product twice.');
      seen.add(item.id);
      const clash = local.find((p) => p.id === item.id || p.sku === item.sku);
      if (clash)
        return {
          id: item.id,
          status: 'conflict',
          errors: [`Local product ${clash.id} uses this ID or SKU. Rename or delete it first.`],
        };
      const old = loaded.get(item.id);
      return {
        id: item.id,
        status: !old
          ? 'added'
          : withoutSnapshot(old) === withoutSnapshot(item)
            ? 'unchanged'
            : 'updated',
        item,
        errors: [],
      };
    } catch (e) {
      const message =
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join('.') || 'item'}: ${i.message}`).join('; ')
          : e instanceof Error
            ? e.message
            : 'Invalid catalog product';
      return { id, status: 'invalid', errors: [message] };
    }
  });
  for (const old of loaded.values())
    if (!seen.has(old.id))
      rows.push({
        id: old.id,
        status: 'retired',
        item: old,
        errors: ['No longer in the ilLumenate catalog. Kept read-only for existing projects.'],
      });
  return { hash: data.hash, rows };
}

/** Apply a preview: valid catalog products are added or replaced; conflicts and invalid rows are skipped. */
export function commitCatalog(existing: CatalogItem[], rows: CatalogRow[]): CatalogItem[] {
  const incoming = new Map(
    rows
      .filter((r) => r.item && ['added', 'updated', 'unchanged'].includes(r.status))
      .map((r) => [r.id, r.item!]),
  );
  const next = existing.map((p) => incoming.get(p.id) ?? p);
  for (const [id, item] of incoming) if (!existing.some((p) => p.id === id)) next.push(item);
  return ProductLibrarySchema.parse(next);
}

/**
 * Library edits may delete catalog products but never change or add them; only
 * {@link commitCatalog} writes them.
 */
export function assertCatalogItemsUnchanged(previous: CatalogItem[], next: CatalogItem[]) {
  const before = new Map(previous.map((p) => [p.id, JSON.stringify(p)]));
  for (const item of next)
    if (isCatalogItem(item) && before.get(item.id) !== JSON.stringify(item))
      throw new Error(READ_ONLY_MESSAGE);
}
