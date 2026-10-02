// Uji alur manual (stok QR -> POS -> kasir scan -> data lampau -> label/koreksi -> reminder -> laporan).
// Butuh backend jalan di DB uji berisi admin/kasir/teknisi@uji.test (Password123).
// Jalankan: PGURL=postgresql://user:pw@127.0.0.1:5432/epos_web_test node test/alur-dennis.mjs
import { execSync } from 'node:child_process';
const PG = process.env.PGURL;
const unitsDb = (bid) => execSync(`psql "${PG}" -At -F, -c "select qr_token,status from stock_units where item_cost_id='${bid}' order by unit_code"`).toString().trim().split(String.fromCharCode(10)).map((l) => { const [qrToken, status] = l.trim().split(','); return { qrToken, status }; });
const B = process.env.API_URL ?? 'http://localhost:3100';
const tok = {};
let pass = 0, fail = 0;
const log = (ok, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${extra ? ' | ' + extra : ''}`); };
async function api(role, method, path, body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(tok[role] ? { authorization: 'Bearer ' + tok[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; }
  return { s: r.status, j };
}
const msg = (r) => JSON.stringify(r.j?.message ?? r.j).slice(0, 160);
for (const role of ['admin', 'kasir', 'teknisi']) {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${role}@uji.test`, password: 'Password123' }) });
  tok[role] = (await r.json()).accessToken;
}
log(!!tok.admin && !!tok.kasir && !!tok.teknisi, 'login 3 role');

// --- master produk + stok masuk (QR per unit)
let r = await api('admin', 'POST', '/products', { name: 'AC Uji 1PK', brand: 'Daikin', type: 'split', pk: 1, category: 'ac', sellPrice: 3000000 });
log(r.s === 201, 'buat produk', `${r.s} ${r.s !== 201 ? msg(r) : ''}`);
const prod = r.j;
r = await api('admin', 'POST', '/stock/in', { kind: 'product', refId: prod?.id, qty: 3, buyPrice: 2000000, supplierName: 'Supplier Uji' });
log(r.s === 201, 'stok masuk 3 unit', `${r.s} ${r.s !== 201 ? msg(r) : ''}`);
r = await api('admin', 'GET', `/products/${prod.id}/batches`);
log(r.s === 200 && r.j?.length >= 1, 'GET batches produk', `${r.s} batches=${r.j?.length}`);
const batch = r.j?.[0];
r = await api('admin', 'GET', `/stock/batches/${batch?.id}/units`);
const units = r.j?.items ?? r.j;
log(r.s === 200 && Array.isArray(units) && units.length === 3, 'daftar unit QR batch (3)', `${r.s} n=${units?.length} keys=${Object.keys(units?.[0] ?? {}).join(',')}`);
r = await api('admin', 'GET', `/products/${prod.id}`);
log(r.s === 200, 'detail produk', `stok=${JSON.stringify(r.j?.stock ?? r.j?.stockAvailable ?? r.j?.available)}`);

// --- POS checkout oleh kasir
const co = { customer: { name: 'Budi Uji', phone: '081234567890', address: 'Jl. Uji 1' }, items: [{ kind: 'product', refId: prod.id, qty: 2 }] };
r = await api('kasir', 'POST', '/pos/checkout', co);
log(r.s === 201 && r.j?.status === 'ok', 'checkout POS 2 unit', `${r.s} ${r.j?.status} ${r.s !== 201 ? msg(r) : ''}`);
const inv = r.j;
r = await api('kasir', 'POST', '/pos/checkout', { ...co, items: [{ kind: 'product', refId: prod.id, qty: 5 }] });
log(r.s >= 400, 'checkout melebihi stok ditolak', `${r.s} ${msg(r)}`);

// --- kasir scan
r = await api('kasir', 'GET', '/kasir-scan/pending');
log(r.s === 200, 'kasir-scan pending', `${r.s} ${JSON.stringify(r.j).slice(0, 140)}`);
r = await api('kasir', 'GET', `/kasir-scan/invoices/${inv?.invoiceId}`);
log(r.s === 200, 'kasir-scan detail invoice', `${r.s} ${JSON.stringify(r.j).slice(0, 220)}`);
const fulfil = r.j;
// cari qr token unit reserved
r = await api('admin', 'GET', `/stock/batches/${batch.id}/units`);
const all = unitsDb(batch.id);
const reserved = all.filter((u) => u.status === 'reserved');
const free = all.filter((u) => u.status === 'di_gudang');
log(reserved.length === 2 && free.length === 1, 'status unit: 2 reserved + 1 di_gudang', `reserved=${reserved.length} gudang=${free.length}`);
const tokenOf = (u) => u.qrToken ?? u.token ?? u.code;
r = await api('kasir', 'POST', '/kasir-scan/scan', { invoiceId: inv.invoiceId, qrToken: tokenOf(free[0]) });
log(r.s === 201 && r.j?.swapped === true, 'scan unit di_gudang menukar unit reserved (swap)', `${r.s} swapped=${r.j?.swapped}`);
r = await api('kasir', 'POST', '/kasir-scan/scan', { invoiceId: inv.invoiceId, qrToken: tokenOf(reserved[0]) });
log(r.s === 201 || r.s === 200, 'scan unit reserved -> keluar', `${r.s} ${JSON.stringify(r.j).slice(0, 160)}`);
r = await api('kasir', 'POST', '/kasir-scan/scan', { invoiceId: inv.invoiceId, qrToken: tokenOf(reserved[0]) });
log(r.s >= 400, 'scan ulang unit yang sama ditolak', `${r.s} ${msg(r)}`);
r = await api('kasir', 'POST', '/kasir-scan/scan', { invoiceId: inv.invoiceId, qrToken: 'TOKEN-NGAWUR' });
log(r.s >= 400 && r.s < 500, 'qr tidak dikenal -> 4xx (bukan 500)', `${r.s} ${msg(r)}`);
r = await api('teknisi', 'GET', '/kasir-scan/pending');
log(r.s === 403, 'teknisi dilarang kasir-scan', `${r.s}`);
const itemRef = fulfil?.items?.[0]?.refId ?? prod.id;
r = await api('kasir', 'POST', '/kasir-scan/manual-fulfill', { invoiceId: inv.invoiceId, refId: itemRef });
log(r.s === 400, 'manual-fulfill saat semua unit sudah keluar ditolak', `${r.s} ${msg(r)}`);
r = await api('admin', 'GET', `/stock/batches/${batch.id}/units`);
const after = unitsDb(batch.id);
log(after.filter((u) => u.status === 'keluar').length === 2, 'akhir: 2 unit keluar', after.map((u) => u.status).join(','));

// --- laporan stok / pergerakan
r = await api('admin', 'GET', '/reports/stock-movements?from=2026-01-01&to=2099-12-31');
log(r.s === 200, 'laporan stock-movements', `${r.s} ${JSON.stringify(r.j).slice(0, 120)}`);
r = await api('kasir', 'GET', '/reports/stock-movements');
log([200, 403].includes(r.s), 'stock-movements untuk kasir', `${r.s}`);

// --- data lampau
r = await api('kasir', 'POST', '/legacy-import', { member: { name: 'X' }, units: [] });
log(r.s === 403, 'kasir dilarang data lampau', `${r.s}`);
const legacy = { member: { name: 'Pak Lampau', phone: '0822 1111 2222', address: 'Jl. Lama 5', customerType: 'rumah' },
  units: [ { mode: 'diketahui', brand: 'Panasonic', model: 'CS-X', pk: 1.5, roomLocation: 'Ruang Tamu', installationDate: '2024-01-10', lastServiceDate: '2026-06-01', serviceIntervalDays: 90, reminderEnabled: true },
           { mode: 'qr_dulu', roomLocation: 'Kamar' } ],
  invoice: { date: '2024-01-10', items: [{ name: 'Pasang AC lama', qty: 1, unitPrice: 500000 }], totalPaid: 500000 } };
r = await api('admin', 'POST', '/legacy-import', legacy);
log(r.s === 201, 'legacy-import member baru + 2 unit + invoice', `${r.s} ${r.s !== 201 ? msg(r) : JSON.stringify(r.j).slice(0, 200)}`);
const li = r.j;
r = await api('admin', 'POST', '/legacy-import', { ...legacy, units: [{ mode: 'qr_dulu' }], member: { name: 'Tanpa Alamat' } });
log(r.s >= 400 && r.s < 500, 'qr_dulu tanpa alamat ditolak (4xx)', `${r.s} ${msg(r)}`);
r = await api('admin', 'POST', '/legacy-import', { ...legacy, units: Array.from({ length: 51 }, () => ({ mode: 'diketahui', brand: 'A', pk: 1 })) });
log(r.s === 400, 'lebih dari 50 unit ditolak', `${r.s}`);

// --- label QR + koreksi
r = await api('kasir', 'GET', '/unit-labels?label=belum_dicetak&data=semua');
log(r.s === 200, 'daftar label belum dicetak', `${r.s} total=${r.j?.total ?? r.j?.items?.length}`);
const labels = r.j?.items ?? [];
const ids = labels.map((l) => l.id ?? l.unitId).filter(Boolean);
r = await api('kasir', 'GET', `/unit-labels/data?ids=${ids.join(',')}`);
log(r.s === 200, 'data label untuk cetak', `${r.s} ${JSON.stringify(r.j).slice(0, 140)}`);
r = await api('kasir', 'POST', '/unit-labels/mark-printed', { ids });
log(r.s === 201 || r.s === 200, 'tandai sudah dicetak', `${r.s}`);
r = await api('kasir', 'POST', '/unit-labels/mark-attached', { ids });
log(r.s === 403, 'kasir dilarang tandai ditempel (admin saja)', `${r.s}`);
r = await api('admin', 'POST', '/unit-labels/mark-attached', { ids });
log(r.s === 201 || r.s === 200, 'admin tandai ditempel', `${r.s}`);
const waiting = labels.find((l) => (l.status ?? l.unitStatus) === 'menunggu_data') ?? labels[1];
const uid = waiting?.id ?? waiting?.unitId;
r = await api('teknisi', 'POST', `/ac-units/${uid}/complete-data`, { brand: 'LG', pk: 1 });
log(r.s === 201 || r.s === 200, 'teknisi lengkapi data unit menunggu_data', `${r.s} ${r.s >= 400 ? msg(r) : ''}`);
r = await api('teknisi', 'POST', `/ac-units/${uid}/corrections`, { model: 'MODEL-BARU', note: 'salah ketik' });
log(r.s === 201 || r.s === 200, 'teknisi ajukan koreksi', `${r.s} ${r.s >= 400 ? msg(r) : ''}`);
const corr = r.j;
r = await api('teknisi', 'GET', `/ac-units/${uid}/corrections/pending`);
log(r.s === 200, 'koreksi pending terlihat', `${r.s} ${JSON.stringify(r.j).slice(0, 100)}`);
r = await api('admin', 'GET', '/unit-corrections?status=pending');
log(r.s === 200, 'admin lihat antrean koreksi', `${r.s} n=${r.j?.items?.length ?? r.j?.length}`);
r = await api('admin', 'POST', `/unit-corrections/${corr?.id}/approve`, { reviewNote: 'ok' });
log(r.s === 201 || r.s === 200, 'admin setujui koreksi', `${r.s} ${r.s >= 400 ? msg(r) : ''}`);
r = await api('admin', 'GET', `/ac-units/${uid}`);
log(r.s === 200 && (r.j?.unit?.model === 'MODEL-BARU'), 'koreksi tercermin di unit', `model=${r.j?.unit?.model}`);

// --- jadwal reminder
r = await api('kasir', 'GET', '/reminders/schedule');
log(r.s === 200, 'monitoring jadwal servis', `${r.s} total=${r.j?.total} sample=${JSON.stringify(r.j?.items?.[0] ?? {}).slice(0, 160)}`);
r = await api('kasir', 'POST', `/reminders/units/${uid}/send-now`);
log(r.s === 403, 'kasir dilarang send-now', `${r.s}`);

console.log(`\nRINGKAS: ${pass} OK, ${fail} GAGAL`);