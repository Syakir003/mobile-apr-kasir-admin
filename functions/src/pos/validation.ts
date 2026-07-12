export type CheckoutItemKind = "product" | "sparepart" | "service";

export type CheckoutCustomer = {
  name: string;
  phone: string;
  address?: string;
};

export type CheckoutItem = {
  kind: CheckoutItemKind;
  refId: string;
  qty: number;
};

export type CheckoutInstallation = {
  itemIndex: number;
  roomLocation?: string;
  technicianId?: string;
};

export type CheckoutInput = {
  customer: CheckoutCustomer;
  items: CheckoutItem[];
  discount?: number;
  taxPercent?: number;
  transportFee?: number;
  notes?: string;
  installations?: CheckoutInstallation[];
};

export type CheckoutValidationResult =
  | { ok: true; value: CheckoutInput }
  | { ok: false; error: string };

const KINDS: CheckoutItemKind[] = ["product", "sparepart", "service"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Validasi payload `checkoutTransaction`. Tidak menyentuh Firestore —
 * harga/stok/keberadaan master data divalidasi di dalam transaksi (server
 * side), karena butuh baca master data yang tidak tersedia di sini.
 */
export function validateCheckoutInput(input: unknown): CheckoutValidationResult {
  if (!isRecord(input)) return { ok: false, error: "Input kosong" };

  const customerRaw = input.customer;
  if (!isRecord(customerRaw)) return { ok: false, error: "Data pelanggan wajib diisi" };
  const nameRaw = customerRaw.name;
  const phoneRaw = customerRaw.phone;
  const addressRaw = customerRaw.address;
  if (typeof nameRaw !== "string" || !nameRaw.trim())
    return { ok: false, error: "Nama pelanggan wajib diisi" };
  if (typeof phoneRaw !== "string" || !phoneRaw.trim())
    return { ok: false, error: "Nomor telepon wajib diisi" };
  if (addressRaw !== undefined && typeof addressRaw !== "string")
    return { ok: false, error: "Alamat tidak valid" };

  const itemsRaw = input.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length < 1)
    return { ok: false, error: "Minimal 1 item wajib diisi" };

  const items: CheckoutItem[] = [];
  const seen = new Set<string>();
  for (const raw of itemsRaw) {
    if (!isRecord(raw)) return { ok: false, error: "Item tidak valid" };
    const kind = raw.kind;
    const refId = raw.refId;
    const qty = raw.qty;
    if (typeof kind !== "string" || !KINDS.includes(kind as CheckoutItemKind))
      return { ok: false, error: "Jenis item tidak dikenal" };
    if (typeof refId !== "string" || !refId)
      return { ok: false, error: "refId item wajib diisi" };
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0)
      return { ok: false, error: "Qty item harus lebih dari 0" };
    const dupKey = `${kind}:${refId}`;
    if (seen.has(dupKey)) return { ok: false, error: "Item duplikat" };
    seen.add(dupKey);
    items.push({ kind: kind as CheckoutItemKind, refId, qty });
  }

  const discountRaw = input.discount;
  if (discountRaw !== undefined && (typeof discountRaw !== "number" || discountRaw < 0))
    return { ok: false, error: "Diskon tidak valid" };

  const taxPercentRaw = input.taxPercent;
  if (
    taxPercentRaw !== undefined &&
    (typeof taxPercentRaw !== "number" || taxPercentRaw < 0 || taxPercentRaw > 100)
  )
    return { ok: false, error: "Pajak harus di rentang 0-100%" };

  const transportFeeRaw = input.transportFee;
  if (
    transportFeeRaw !== undefined &&
    (typeof transportFeeRaw !== "number" || transportFeeRaw < 0)
  )
    return { ok: false, error: "Ongkos transport tidak valid" };

  const notesRaw = input.notes;
  if (notesRaw !== undefined && typeof notesRaw !== "string")
    return { ok: false, error: "Catatan tidak valid" };

  const installationsRaw = input.installations;
  let installations: CheckoutInstallation[] | undefined;
  if (installationsRaw !== undefined) {
    if (!Array.isArray(installationsRaw))
      return { ok: false, error: "Data pemasangan tidak valid" };
    installations = [];
    const countByIndex = new Map<number, number>();
    for (const raw of installationsRaw) {
      if (!isRecord(raw)) return { ok: false, error: "Data pemasangan tidak valid" };
      const itemIndex = raw.itemIndex;
      const roomLocation = raw.roomLocation;
      const technicianId = raw.technicianId;
      if (
        typeof itemIndex !== "number" ||
        !Number.isInteger(itemIndex) ||
        itemIndex < 0 ||
        itemIndex >= items.length
      )
        return { ok: false, error: "itemIndex pemasangan tidak valid" };
      if (items[itemIndex].kind !== "product")
        return { ok: false, error: "Pemasangan hanya berlaku untuk item produk AC" };
      if (roomLocation !== undefined && typeof roomLocation !== "string")
        return { ok: false, error: "Lokasi ruangan tidak valid" };
      if (technicianId !== undefined && typeof technicianId !== "string")
        return { ok: false, error: "technicianId tidak valid" };
      countByIndex.set(itemIndex, (countByIndex.get(itemIndex) ?? 0) + 1);
      installations.push({ itemIndex, roomLocation, technicianId });
    }
    for (const [idx, count] of countByIndex) {
      if (count > items[idx].qty)
        return { ok: false, error: "Jumlah pemasangan melebihi qty item" };
    }
  }

  return {
    ok: true,
    value: {
      customer: { name: nameRaw, phone: phoneRaw, address: addressRaw },
      items,
      discount: discountRaw,
      taxPercent: taxPercentRaw,
      transportFee: transportFeeRaw,
      notes: notesRaw,
      installations,
    },
  };
}
