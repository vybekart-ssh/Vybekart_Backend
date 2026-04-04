import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type VariantOption = { optionName: string; optionValues: string[] };
export type VariantItem = {
  id: string;
  label: string;
  selection: Record<string, string>;
  sellingPrice: number;
  mrp?: number;
  discountPercent?: number;
  stock: number;
  sku?: string;
};

export type NormalizedVariants = {
  json: Prisma.InputJsonValue;
  minPrice: number;
  totalStock: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseVariantOptions(raw: unknown): VariantOption[] {
  if (!isRecord(raw)) return [];
  const options = raw['options'];
  if (!Array.isArray(options)) return [];
  const out: VariantOption[] = [];
  for (const o of options) {
    if (!isRecord(o)) continue;
    const name = String(o['optionName'] ?? '').trim();
    const valsRaw = o['optionValues'];
    const optionValues = Array.isArray(valsRaw)
      ? valsRaw.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (name && optionValues.length) out.push({ optionName: name, optionValues });
  }
  return out;
}

export function parseVariantItems(raw: unknown): VariantItem[] {
  if (!isRecord(raw)) return [];
  const items = raw['items'];
  if (!Array.isArray(items)) return [];
  const out: VariantItem[] = [];
  for (const row of items) {
    if (!isRecord(row)) continue;
    const id = String(row['id'] ?? '').trim();
    const label = String(row['label'] ?? '').trim();
    const sellingPrice = Number(row['sellingPrice']);
    const stock = Number(row['stock']);
    const selRaw = row['selection'];
    const selection: Record<string, string> = {};
    if (isRecord(selRaw)) {
      for (const [k, v] of Object.entries(selRaw)) {
        selection[k] = String(v);
      }
    }
    const mrp = row['mrp'] != null ? Number(row['mrp']) : undefined;
    const discountPercent =
      row['discountPercent'] != null ? Number(row['discountPercent']) : undefined;
    const sku = row['sku'] != null ? String(row['sku']).trim() : undefined;
    if (!id || !label || Number.isNaN(sellingPrice) || sellingPrice < 0 || Number.isNaN(stock) || stock < 0) {
      continue;
    }
    out.push({
      id,
      label,
      selection,
      sellingPrice,
      mrp: mrp != null && !Number.isNaN(mrp) ? mrp : undefined,
      discountPercent:
        discountPercent != null && !Number.isNaN(discountPercent)
          ? discountPercent
          : undefined,
      stock: Math.floor(stock),
      sku: sku || undefined,
    });
  }
  return out;
}

/** Cartesian product of option value lists in option order */
export function expectedCombinationCount(options: VariantOption[]): number {
  if (!options.length) return 0;
  return options.reduce((acc, o) => acc * o.optionValues.length, 1);
}

function combinations(options: VariantOption[]): Array<Record<string, string>> {
  if (!options.length) return [];
  let rows: Array<Record<string, string>> = [{}];
  for (const opt of options) {
    const next: Array<Record<string, string>> = [];
    for (const row of rows) {
      for (const val of opt.optionValues) {
        next.push({ ...row, [opt.optionName]: val });
      }
    }
    rows = next;
  }
  return rows;
}

function selectionKey(sel: Record<string, string>, optionNames: string[]): string {
  return optionNames.map((n) => `${n}=${sel[n] ?? ''}`).join('|');
}

/**
 * Validates seller payload: options + items matrix; returns JSON + min price + total stock.
 */
export function validateAndNormalizeSellerVariants(
  variants: unknown,
): NormalizedVariants {
  if (variants == null) {
    throw new BadRequestException('variants payload is required');
  }
  const options = parseVariantOptions(variants);
  if (!options.length) {
    throw new BadRequestException('At least one variant option with values is required');
  }
  for (const o of options) {
    if (!o.optionName.trim()) {
      throw new BadRequestException('Each variant option must have a name');
    }
    if (!o.optionValues.length) {
      throw new BadRequestException(`Option "${o.optionName}" needs at least one value`);
    }
  }

  const items = parseVariantItems(variants);
  const expected = expectedCombinationCount(options);
  if (items.length !== expected) {
    throw new BadRequestException(
      `Variant rows must match all combinations (${expected} rows, got ${items.length})`,
    );
  }

  const optionNames = options.map((o) => o.optionName);
  const combos = combinations(options);
  const comboKeys = new Set(combos.map((c) => selectionKey(c, optionNames)));

  const seenIds = new Set<string>();
  let minPrice = Number.POSITIVE_INFINITY;
  let totalStock = 0;

  for (const item of items) {
    if (seenIds.has(item.id)) {
      throw new BadRequestException(`Duplicate variant id: ${item.id}`);
    }
    seenIds.add(item.id);
    const key = selectionKey(item.selection, optionNames);
    if (!comboKeys.has(key)) {
      throw new BadRequestException(`Variant selection does not match options: ${item.label}`);
    }
    comboKeys.delete(key);
    minPrice = Math.min(minPrice, item.sellingPrice);
    totalStock += item.stock;
  }

  if (comboKeys.size > 0) {
    throw new BadRequestException('Missing variant rows for some option combinations');
  }

  if (!Number.isFinite(minPrice)) minPrice = 0;

  const json = {
    options: options.map((o) => ({
      optionName: o.optionName,
      optionValues: o.optionValues,
    })),
    items: items.map((i) => ({
      id: i.id,
      label: i.label,
      selection: i.selection,
      sellingPrice: i.sellingPrice,
      ...(i.mrp != null ? { mrp: i.mrp } : {}),
      ...(i.discountPercent != null ? { discountPercent: i.discountPercent } : {}),
      stock: i.stock,
      ...(i.sku ? { sku: i.sku } : {}),
    })),
  } as Prisma.InputJsonValue;

  return { json, minPrice, totalStock };
}

export function findVariantItem(
  variants: unknown,
  variantId: string,
): VariantItem | null {
  const items = parseVariantItems(variants);
  return items.find((i) => i.id === variantId) ?? null;
}

export function applyVariantStockDelta(
  variants: unknown,
  variantId: string,
  delta: number,
): { variants: Prisma.InputJsonValue; totalStock: number } {
  const opts = parseVariantOptions(variants);
  const items = parseVariantItems(variants);
  const idx = items.findIndex((i) => i.id === variantId);
  if (idx < 0) throw new BadRequestException('Invalid variant');
  const next = items.map((it, i) =>
    i === idx ? { ...it, stock: it.stock + delta } : it,
  );
  if (next[idx].stock < 0) {
    throw new BadRequestException('Insufficient stock for this variant');
  }
  const totalStock = next.reduce((s, it) => s + it.stock, 0);
  const json = {
    options: opts.map((o) => ({
      optionName: o.optionName,
      optionValues: o.optionValues,
    })),
    items: next.map((i) => ({
      id: i.id,
      label: i.label,
      selection: i.selection,
      sellingPrice: i.sellingPrice,
      ...(i.mrp != null ? { mrp: i.mrp } : {}),
      ...(i.discountPercent != null ? { discountPercent: i.discountPercent } : {}),
      stock: i.stock,
      ...(i.sku ? { sku: i.sku } : {}),
    })),
  } as Prisma.InputJsonValue;
  return { variants: json, totalStock };
}

export function productHasVariantItems(variants: unknown): boolean {
  return parseVariantItems(variants).length > 0;
}
