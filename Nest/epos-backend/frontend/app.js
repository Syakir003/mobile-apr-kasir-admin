// ============================================================================
// E-POS AC — frontend uji-coba siklus (retail sale -> instalasi -> QR ->
// servis teknisi -> pembayaran). SENGAJA sederhana / minim styling — cuma
// buat memverifikasi endpoint NestJS jalan end-to-end. Referensi alur &
// istilah diambil dari app Flutter (frontend/mobile) punya rekan tim.
// ============================================================================

const $ = (id) => document.getElementById(id);

const state = {
  apiBase: localStorage.getItem('epos_api_base') || 'http://localhost:3000',
  token: localStorage.getItem('epos_token') || '',
  user: JSON.parse(localStorage.getItem('epos_user') || 'null'),
  master: { products: [], spareparts: [], services: [], users: [], voucherCampaigns: [] },
  cart: [], // { kind, refId, name, unit, unitPrice, qty, withInstallation, roomLocation, technicianId }
  currentJobId: null,
  currentInvoiceId: null,
  socket: null,
  opnameItems: [], // { kind, refId, name, physicalQty } — batch draft sebelum submit ke POST /stock/opname
  currentShiftId: null,
  voucherOfferMembers: [], // hasil GET /members/search terakhir (Siklus 6 — tawarkan voucher)
  voucherOfferSelectedIds: new Set(), // memberId yang dicentang buat ditawarkan
  currentVoucherClaims: [], // hasil GET /vouchers/my-claims buat member yang lagi checkout
};

function formatRupiah(n) {
  n = Number(n) || 0;
  return 'Rp ' + n.toLocaleString('id-ID');
}

// ---------------------------------------------------------------------------
// API helper — semua panggilan lewat sini biar Authorization & debug log konsisten.
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

  let res, json;
  try {
    res = await fetch(state.apiBase + path, {
      method,
      headers,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    logDebug(method, path, body, { networkError: String(err) });
    throw new Error(`Gagal menghubungi API (${state.apiBase}): ${err}`);
  }

  logDebug(method, path, body, json, res.status);

  if (!res.ok) {
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : (json?.message || res.statusText);
    throw new Error(`[${res.status}] ${msg}`);
  }
  return json;
}

function logDebug(method, path, body, response, status) {
  const entry = {
    at: new Date().toLocaleTimeString('id-ID'),
    request: `${method} ${path}`,
    body,
    status,
    response,
  };
  const pre = $('debugLog');
  pre.textContent = JSON.stringify(entry, null, 2) + '\n\n' + pre.textContent;
}

function alertError(err) {
  alert(err.message || String(err));
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Login / sesi
// ---------------------------------------------------------------------------
function renderWhoami() {
  if (state.user) {
    $('whoami').innerHTML = `<b>${state.user.displayName}</b> <span class="muted">(${state.user.email} · ${state.user.role})</span>`;
  } else {
    $('whoami').innerHTML = '<span class="muted">belum login</span>';
  }
}

$('apiBase').value = state.apiBase;
$('apiBase').addEventListener('change', () => {
  state.apiBase = $('apiBase').value.trim().replace(/\/$/, '');
  localStorage.setItem('epos_api_base', state.apiBase);
});

$('btnLogin').addEventListener('click', async () => {
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: { email: $('loginEmail').value.trim(), password: $('loginPassword').value },
    });
    state.token = result.accessToken;
    state.user = result.user;
    localStorage.setItem('epos_token', state.token);
    localStorage.setItem('epos_user', JSON.stringify(state.user));
    renderWhoami();
    alert(`Login sukses sebagai ${state.user.displayName} (${state.user.role})`);
  } catch (err) {
    alertError(err);
  }
});

$('btnLogout').addEventListener('click', () => {
  state.token = '';
  state.user = null;
  localStorage.removeItem('epos_token');
  localStorage.removeItem('epos_user');
  renderWhoami();
});

renderWhoami();

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------
$('btnAddUser').addEventListener('click', async () => {
  try {
    await api('/users', {
      method: 'POST',
      body: {
        email: $('u_email').value.trim(),
        password: $('u_password').value,
        displayName: $('u_displayName').value.trim(),
        role: $('u_role').value,
      },
    });
    alert('User dibuat');
    await refreshMaster();
  } catch (err) {
    alertError(err);
  }
});

$('btnAddProduct').addEventListener('click', async () => {
  try {
    await api('/products', {
      method: 'POST',
      body: {
        name: $('p_name').value.trim(),
        brand: $('p_brand').value.trim() || undefined,
        type: $('p_type').value.trim() || undefined,
        pk: $('p_pk').value ? Number($('p_pk').value) : undefined,
        btu: $('p_btu').value ? Number($('p_btu').value) : undefined,
        watt: $('p_watt').value ? Number($('p_watt').value) : undefined,
        sellPrice: Number($('p_sellPrice').value || 0),
        stock: Number($('p_stock').value || 0),
      },
    });
    alert('Produk disimpan');
    await refreshMaster();
  } catch (err) {
    alertError(err);
  }
});

$('btnAddSparepart').addEventListener('click', async () => {
  try {
    await api('/spareparts', {
      method: 'POST',
      body: {
        name: $('sp_name').value.trim(),
        unit: $('sp_unit').value.trim() || 'pcs',
        sellPrice: Number($('sp_sellPrice').value || 0),
        stock: Number($('sp_stock').value || 0),
      },
    });
    alert('Sparepart disimpan');
    await refreshMaster();
  } catch (err) {
    alertError(err);
  }
});

$('btnAddService').addEventListener('click', async () => {
  try {
    await api('/services', {
      method: 'POST',
      body: {
        name: $('sv_name').value.trim(),
        basePrice: Number($('sv_basePrice').value || 0),
      },
    });
    alert('Jasa disimpan');
    await refreshMaster();
  } catch (err) {
    alertError(err);
  }
});

$('btnRefreshMaster').addEventListener('click', refreshMaster);

async function refreshMaster() {
  const [products, spareparts, services] = await Promise.all([
    api('/products').catch(() => []),
    api('/spareparts').catch(() => []),
    api('/services').catch(() => []),
  ]);
  state.master.products = products || [];
  state.master.spareparts = spareparts || [];
  state.master.services = services || [];
  try {
    state.master.users = (await api('/users')) || [];
  } catch {
    state.master.users = []; // butuh role admin
  }
  try {
    state.master.voucherCampaigns = (await api('/vouchers/campaigns')) || [];
  } catch {
    state.master.voucherCampaigns = []; // butuh role admin/kasir
  }

  renderTable('tbl_products', state.master.products, (p) => [p.name, formatRupiah(p.sellPrice), p.stock]);
  renderTable('tbl_spareparts', state.master.spareparts, (p) => [p.name, formatRupiah(p.sellPrice), p.stock]);
  renderTable('tbl_services', state.master.services, (p) => [p.name, formatRupiah(p.basePrice)]);
  renderTable('tbl_users', state.master.users, (u) => [u.email, u.displayName, u.role, u.active ? 'ya' : 'tidak']);
  renderVoucherCampaignsTable();
  fillVoucherCampaignOptions();

  fillCartItemOptions();
  fillTechnicianOptions();
  fillStockItemOptions();
}

function renderTable(tableId, rows, mapRow) {
  const tbody = $(tableId).querySelector('tbody');
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = mapRow(row).map((c) => `<td>${c}</td>`).join('');
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------------
// Voucher & Diskon Campaign (Siklus 6) — bikin campaign, tawarkan ke member
// tertentu (targeted, bukan broadcast). Pemakaian voucher sendiri terjadi di
// tab POS/Checkout (lihat bagian "Cek Voucher" di bawah).
// ---------------------------------------------------------------------------
function renderVoucherCampaignsTable() {
  renderTable('tbl_voucher_campaigns', state.master.voucherCampaigns, (c) => [
    c.name,
    c.discountType === 'percentage' ? `${c.discountValue}%` : formatRupiah(c.discountValue),
    c.category || '<span class="muted">semua</span>',
    c.firstPurchaseOnly ? 'ya' : 'tidak',
    `${new Date(c.startDate).toLocaleDateString('id-ID')} – ${new Date(c.endDate).toLocaleDateString('id-ID')}`,
    c.active ? 'ya' : 'tidak',
  ]);
}

function fillVoucherCampaignOptions() {
  const sel = $('vo_campaign');
  sel.innerHTML = (state.master.voucherCampaigns || [])
    .filter((c) => c.active)
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join('');
}

$('btnAddVoucherCampaign').addEventListener('click', async () => {
  try {
    await api('/vouchers/campaigns', {
      method: 'POST',
      body: {
        name: $('v_name').value.trim(),
        discountType: $('v_discountType').value,
        discountValue: Number($('v_discountValue').value || 0),
        category: $('v_category').value.trim() || undefined,
        firstPurchaseOnly: $('v_firstPurchaseOnly').checked || undefined,
        termsAndConditions: $('v_terms').value.trim() || undefined,
        startDate: $('v_startDate').value || undefined,
        endDate: $('v_endDate').value || undefined,
      },
    });
    alert('Campaign voucher disimpan');
    $('v_name').value = '';
    $('v_discountValue').value = '';
    $('v_category').value = '';
    $('v_firstPurchaseOnly').checked = false;
    $('v_terms').value = '';
    await refreshMaster();
  } catch (err) {
    alertError(err);
  }
});

$('btnSearchMembersForVoucher').addEventListener('click', async () => {
  const q = $('vo_memberSearch').value.trim();
  if (!q) return alert('Isi nama/no HP yang mau dicari dulu');
  try {
    state.voucherOfferMembers = (await api(`/members/search?q=${encodeURIComponent(q)}`)) || [];
    state.voucherOfferSelectedIds = new Set();
    renderVoucherMemberResults();
  } catch (err) {
    alertError(err);
  }
});

function renderVoucherMemberResults() {
  const box = $('vo_memberResults');
  if (!state.voucherOfferMembers.length) {
    box.innerHTML = '<p class="muted">tidak ada member cocok — pastikan member sudah pernah checkout minimal sekali</p>';
    return;
  }
  box.innerHTML = state.voucherOfferMembers
    .map(
      (m) => `
        <label class="muted" style="display:block">
          <input type="checkbox" data-member-id="${m.id}" ${state.voucherOfferSelectedIds.has(m.id) ? 'checked' : ''} />
          ${m.name} — ${m.phone}
        </label>
      `,
    )
    .join('');
  box.querySelectorAll('input[data-member-id]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.memberId;
      if (e.target.checked) state.voucherOfferSelectedIds.add(id);
      else state.voucherOfferSelectedIds.delete(id);
    });
  });
}

$('btnOfferVoucher').addEventListener('click', async () => {
  const campaignId = $('vo_campaign').value;
  if (!campaignId) return alert('Belum ada campaign — simpan campaign dulu di atas');
  const memberIds = [...state.voucherOfferSelectedIds];
  if (!memberIds.length) return alert('Centang minimal 1 member dari hasil pencarian dulu');
  try {
    const result = await api(`/vouchers/campaigns/${campaignId}/offer`, {
      method: 'POST',
      body: { memberIds },
    });
    $('vo_offerResult').innerHTML = `
      Ditawarkan ke ${result.offered.length} member.
      ${result.skipped.length ? `<br/>Dilewati: ${result.skipped.map((s) => s.reason).join('; ')}` : ''}
    `;
    state.voucherOfferSelectedIds = new Set();
    renderVoucherMemberResults();
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// POS / Checkout
// ---------------------------------------------------------------------------
$('cartKind').addEventListener('change', fillCartItemOptions);

function fillCartItemOptions() {
  const kind = $('cartKind').value;
  const list = kind === 'product' ? state.master.products : kind === 'sparepart' ? state.master.spareparts : state.master.services;
  const sel = $('cartItemRef');
  sel.innerHTML = (list || [])
    .map((i) => `<option value="${i.id}">${i.name} — ${formatRupiah(i.sellPrice ?? i.basePrice)}</option>`)
    .join('');

  const mrSel = $('mrItemRef');
  if (mrSel) {
    const mrKind = $('mrKind').value;
    const mrList = mrKind === 'product' ? state.master.products : state.master.spareparts;
    mrSel.innerHTML = (mrList || []).map((i) => `<option value="${i.id}">${i.name}</option>`).join('');
  }
}
$('mrKind')?.addEventListener('change', fillCartItemOptions);

function fillTechnicianOptions() {
  const technicians = (state.master.users || []).filter((u) => u.role === 'teknisi' && u.active);
  const opts = ['<option value="">Belum ditentukan</option>']
    .concat(technicians.map((t) => `<option value="${t.id}">${t.displayName}</option>`))
    .join('');
  ['assignTechnician', 'sm_technician'].forEach((id) => {
    const sel = $(id);
    if (sel) sel.innerHTML = opts;
  });
}

$('btnAddToCart').addEventListener('click', () => {
  const kind = $('cartKind').value;
  const refId = $('cartItemRef').value;
  const qty = Number($('cartQty').value || 1);
  if (!refId) return alert('Muat master data dulu (tab Master Data > Refresh)');

  const list = kind === 'product' ? state.master.products : kind === 'sparepart' ? state.master.spareparts : state.master.services;
  const item = list.find((i) => i.id === refId);
  if (!item) return;

  const existing = state.cart.find((l) => l.kind === kind && l.refId === refId);
  if (existing) {
    existing.qty += qty;
  } else {
    state.cart.push({
      kind,
      refId,
      name: item.name,
      unit: kind === 'service' ? 'jasa' : item.unit || 'unit',
      unitPrice: Number(item.sellPrice ?? item.basePrice ?? 0),
      qty,
      withInstallation: false,
      roomLocation: '',
      technicianId: '',
    });
  }
  renderCart();
});

function renderCart() {
  const tbody = $('tbl_cart').querySelector('tbody');
  tbody.innerHTML = '';
  state.cart.forEach((line, idx) => {
    const tr = document.createElement('tr');
    const lineTotal = Math.round(line.qty * line.unitPrice);
    const canInstall = line.kind === 'product';
    tr.innerHTML = `
      <td>${line.name}</td>
      <td><input type="number" min="0.01" step="0.01" value="${line.qty}" style="width:70px" data-role="qty" /></td>
      <td>${formatRupiah(line.unitPrice)}</td>
      <td>${formatRupiah(lineTotal)}</td>
      <td>${canInstall ? `<input type="checkbox" data-role="install" ${line.withInstallation ? 'checked' : ''} />` : '-'}</td>
      <td>${canInstall && line.withInstallation ? `<input data-role="room" value="${line.roomLocation}" placeholder="Kamar Utama" style="width:120px" />` : '-'}</td>
      <td>${canInstall && line.withInstallation ? technicianSelectHtml(line.technicianId) : '-'}</td>
      <td><button data-role="remove" class="danger">Hapus</button></td>
    `;
    tr.querySelector('[data-role="qty"]').addEventListener('change', (e) => {
      line.qty = Number(e.target.value || 1);
      renderCart();
    });
    tr.querySelector('[data-role="install"]')?.addEventListener('change', (e) => {
      line.withInstallation = e.target.checked;
      renderCart();
    });
    tr.querySelector('[data-role="room"]')?.addEventListener('input', (e) => {
      line.roomLocation = e.target.value;
    });
    tr.querySelector('[data-role="technician"]')?.addEventListener('change', (e) => {
      line.technicianId = e.target.value;
    });
    tr.querySelector('[data-role="remove"]').addEventListener('click', () => {
      state.cart.splice(idx, 1);
      renderCart();
    });
    tbody.appendChild(tr);
  });
  renderCartTotals();
}

function technicianSelectHtml(selectedId) {
  const technicians = (state.master.users || []).filter((u) => u.role === 'teknisi' && u.active);
  const opts = ['<option value="">Belum ditentukan</option>']
    .concat(technicians.map((t) => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.displayName}</option>`))
    .join('');
  return `<select data-role="technician">${opts}</select>`;
}

function computeCartTotalsPreview() {
  const subtotal = state.cart.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);
  const discount = Number($('c_discount').value || 0);
  const taxPercent = Number($('c_taxPercent').value || 0);
  const transportFee = Number($('c_transportFee').value || 0);
  const taxBase = subtotal - discount;
  const taxAmount = Math.round((taxBase * taxPercent) / 100);
  const grandTotal = taxBase + taxAmount + transportFee;
  return { subtotal, discount, taxAmount, transportFee, grandTotal };
}

function renderCartTotals() {
  const t = computeCartTotalsPreview();
  $('cartTotals').innerHTML = `
    Subtotal: ${formatRupiah(t.subtotal)} &nbsp;|&nbsp;
    Diskon: -${formatRupiah(t.discount)} &nbsp;|&nbsp;
    Pajak: ${formatRupiah(t.taxAmount)} &nbsp;|&nbsp;
    Transport: ${formatRupiah(t.transportFee)} &nbsp;|&nbsp;
    <b>Total: ${formatRupiah(t.grandTotal)}</b>
  `;
}
['c_discount', 'c_taxPercent', 'c_transportFee'].forEach((id) => $(id).addEventListener('input', renderCartTotals));

// Port kecil dari MembersService.normalizePhone (members.service.ts) — biar
// "08xxx" yang diketik kasir bisa nemu member yang phone-nya kesimpen "+62xxx"
// lewat GET /members/search (yang nyari pakai `contains`, bukan exact match).
function normalizePhoneForSearch(raw) {
  let cleaned = raw.replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('+62')) return cleaned.slice(1);
  if (cleaned.startsWith('628')) return cleaned;
  if (cleaned.startsWith('08')) return '62' + cleaned.slice(1);
  if (cleaned.startsWith('8')) return '62' + cleaned;
  return cleaned;
}

// "Cek Voucher" — cari member by no HP (harus SUDAH pernah checkout minimal
// sekali, karena member baru dibuat otomatis pas checkout pertama), lalu muat
// voucher yang bisa dipakai (GET /vouchers/my-claims). Wajib dilakukan
// SEBELUM klik "Buat Transaksi" kalau mau pakai voucher di transaksi ini.
$('btnCheckVoucher').addEventListener('click', async () => {
  const phone = $('c_phone').value.trim();
  if (!phone) return alert('Isi No HP pelanggan dulu');
  try {
    const members = await api(`/members/search?q=${encodeURIComponent(normalizePhoneForSearch(phone))}`);
    if (!members?.length) {
      $('c_voucherClaim').innerHTML = '<option value="">tidak pakai voucher</option>';
      state.currentVoucherClaims = [];
      return alert('Member belum terdaftar (belum pernah checkout sebelumnya) — belum ada voucher yang bisa dicek. Checkout dulu tanpa voucher, campaign bisa ditawarkan buat transaksi berikutnya.');
    }
    const member = members[0];
    const claims = (await api(`/vouchers/my-claims?memberId=${member.id}`)) || [];
    state.currentVoucherClaims = claims;
    const options = claims.map((c) => {
      const label = c.campaign.discountType === 'percentage' ? `${c.campaign.discountValue}%` : formatRupiah(c.campaign.discountValue);
      return `<option value="${c.id}">${c.campaign.name} (${label})</option>`;
    });
    $('c_voucherClaim').innerHTML = '<option value="">tidak pakai voucher</option>' + options.join('');
    if (!claims.length) alert(`Member ${member.name} ditemukan, tapi belum ada voucher aktif yang ditawarkan ke dia.`);
  } catch (err) {
    alertError(err);
  }
});

$('btnCheckout').addEventListener('click', async () => {
  if (state.cart.length === 0) return alert('Keranjang masih kosong');
  const discount = Number($('c_discount').value || 0);
  if (discount > 0 && !$('c_discountReason').value.trim()) {
    return alert('Alasan diskon wajib diisi kalau ada diskon');
  }

  const items = state.cart.map((l) => ({ kind: l.kind, refId: l.refId, qty: l.qty }));
  const installations = [];
  state.cart.forEach((l, idx) => {
    if (l.kind === 'product' && l.withInstallation) {
      installations.push({
        itemIndex: idx,
        roomLocation: l.roomLocation || undefined,
        technicianId: l.technicianId || undefined,
      });
    }
  });

  const payload = {
    customer: {
      name: $('c_name').value.trim(),
      phone: $('c_phone').value.trim(),
      address: $('c_address').value.trim() || undefined,
    },
    items,
    discount: discount || undefined,
    discountReason: $('c_discountReason').value.trim() || undefined,
    taxPercent: Number($('c_taxPercent').value || 0) || undefined,
    transportFee: Number($('c_transportFee').value || 0) || undefined,
    notes: $('c_notes').value.trim() || undefined,
    installations: installations.length ? installations : undefined,
    voucherClaimId: $('c_voucherClaim').value || undefined,
  };

  try {
    const result = await api('/pos/checkout', { method: 'POST', body: payload });
    const voucherMsg = result.voucherDiscountAmount ? `\nDiskon voucher: ${formatRupiah(result.voucherDiscountAmount)}` : '';
    alert(`Transaksi dibuat: ${result.invoiceNumber}\nInvoice ID: ${result.invoiceId}${voucherMsg}`);
    state.cart = [];
    renderCart();
    $('c_voucherClaim').innerHTML = '<option value="">tidak pakai voucher</option>';
    state.currentVoucherClaims = [];
    // Lompat ke tab invoice, langsung muat invoice yang baru dibuat.
    document.querySelector('.tab-btn[data-tab="invoice"]').click();
    $('invoiceIdInput').value = result.invoiceId;
    await loadInvoice(result.invoiceId);
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Job Board
// ---------------------------------------------------------------------------
$('btnRefreshJobs').addEventListener('click', refreshJobs);
$('jobOnlyMine').addEventListener('change', refreshJobs);

async function refreshJobs() {
  try {
    let jobs;
    if ($('jobOnlyMine').checked) {
      jobs = await api('/technician-jobs/queue');
    } else {
      const status = $('jobStatusFilter').value;
      jobs = await api('/technician-jobs' + (status ? `?status=${status}` : ''));
    }
    renderJobsTable(jobs || []);
  } catch (err) {
    alertError(err);
  }
}

function renderJobsTable(jobs) {
  const tbody = $('tbl_jobs').querySelector('tbody');
  tbody.innerHTML = '';
  jobs.forEach((job) => {
    const tr = document.createElement('tr');
    const unitLabel = job.unit ? `${job.unit.brand ?? ''} ${job.unit.model ?? ''} <br/><code>${job.unit.barcodeValue}</code>` : '-';
    tr.innerHTML = `
      <td>${unitLabel}</td>
      <td>${job.member?.name ?? '-'}</td>
      <td>${job.type}</td>
      <td><span class="badge">${job.status}</span></td>
      <td>${job.technician?.displayName ?? '-'}</td>
      <td><button data-role="detail">Detail</button></td>
    `;
    tr.querySelector('[data-role="detail"]').addEventListener('click', () => loadJobDetail(job.id));
    tbody.appendChild(tr);
  });
}

async function loadJobDetail(jobId) {
  try {
    const job = await api(`/technician-jobs/${jobId}`);
    state.currentJobId = jobId;
    $('jobDetailCard').style.display = 'block';
    $('jobDetailId').textContent = jobId;
    $('jobNotes').value = job.notes || '';

    $('jobDetailBody').innerHTML = `
      <p><b>Status:</b> <span class="badge">${job.status}</span> &nbsp;
         <b>Tipe:</b> ${job.type} &nbsp;
         <b>Teknisi:</b> ${job.technician?.displayName ?? '-'}</p>
      <p><b>Member:</b> ${job.member?.name ?? '-'} (${job.member?.phone ?? '-'})</p>
      <p><b>Unit:</b> ${job.unit ? `${job.unit.brand ?? ''} ${job.unit.model ?? ''} — barcode <code>${job.unit.barcodeValue}</code>` : '-'}</p>
      ${job.reviewNote ? `<p class="hint"><b>Catatan dikembalikan admin:</b> ${job.reviewNote}</p>` : ''}
      ${job.unit ? `
        <div id="unitQrCard" class="qr-card">
          <div id="unitQrImg"></div>
          <div>
            <div class="qr-label">${job.unit.barcodeValue}</div>
            <button id="btnPrintQr" class="secondary">Cetak Label</button>
            <button id="btnDownloadQr" class="secondary">Download PNG</button>
          </div>
        </div>
      ` : ''}
    `;

    if (job.unit) {
      const qrBox = $('unitQrImg');
      qrBox.innerHTML = '';
      new QRCode(qrBox, { text: job.unit.barcodeValue, width: 120, height: 120 });
      $('btnPrintQr').addEventListener('click', () => printUnitLabel(job.unit, job.member));
      $('btnDownloadQr').addEventListener('click', () => downloadUnitQr(job.unit.barcodeValue));
    }

    renderFindings(job.findings || []);
    renderMaterialRequests(job.materialRequests || []);
  } catch (err) {
    alertError(err);
  }
}

// Checklist dinamis (Siklus 5 revisi) — daftar temuan masalah per job, BUKAN
// template tetap. Tiap temuan: judul (dari kategori baku/ketik bebas) + foto
// sebelum/sesudah (boleh banyak per kind).
function renderFindings(findings) {
  const listBox = $('findingsList');
  const select = $('findingSelect');
  select.innerHTML = '';

  if (!findings.length) {
    listBox.innerHTML = '<p class="muted">belum ada temuan — tambahkan di atas</p>';
    return;
  }

  listBox.innerHTML = findings
    .map((f) => {
      const before = f.photos.filter((p) => p.kind === 'sebelum');
      const after = f.photos.filter((p) => p.kind === 'sesudah');
      const photoLink = (p) => `<a href="${state.apiBase}${p.path}" target="_blank">foto</a>`;
      return `
        <div class="finding-card">
          <p><b>${f.title}</b> <span class="muted">(${f.origin === 'komplain_awal' ? 'dari komplain awal' : 'ditambah teknisi'})</span></p>
          ${f.note ? `<p class="muted">${f.note}</p>` : ''}
          <p>Sebelum (${before.length}): ${before.map(photoLink).join(', ') || '<span class="muted">belum ada</span>'}</p>
          <p>Sesudah (${after.length}): ${after.map(photoLink).join(', ') || '<span class="muted">belum ada</span>'}</p>
        </div>
      `;
    })
    .join('');

  findings.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.title;
    select.appendChild(opt);
  });
}

// Autocomplete kategori temuan — ketik minimal 1 huruf, munculin datalist dari
// GET /technician-jobs/categories/search. state.categorySuggestions menyimpan
// map nama(lowercase) -> id, dipakai saat submit buat nentuin categoryId vs
// categoryName (ketik bebas = auto-create kategori baru).
state.categorySuggestions = state.categorySuggestions || {};
let categorySearchTimer = null;
$('findingCategory').addEventListener('input', () => {
  clearTimeout(categorySearchTimer);
  const q = $('findingCategory').value.trim();
  categorySearchTimer = setTimeout(async () => {
    try {
      const results = await api(`/technician-jobs/categories/search?q=${encodeURIComponent(q)}`);
      state.categorySuggestions = {};
      const datalist = $('findingCategoryList');
      datalist.innerHTML = '';
      (results || []).forEach((c) => {
        state.categorySuggestions[c.name.toLowerCase()] = c.id;
        const opt = document.createElement('option');
        opt.value = c.name;
        datalist.appendChild(opt);
      });
    } catch (err) {
      // Autocomplete gagal bukan error fatal — biarin teknisi tetap bisa ketik bebas.
    }
  }, 250);
});

$('btnAddFinding').addEventListener('click', async () => {
  const text = $('findingCategory').value.trim();
  if (!text) return alert('Isi judul temuan dulu (ketik masalah/jenis servis)');
  const knownId = state.categorySuggestions[text.toLowerCase()];
  try {
    await api(`/technician-jobs/${state.currentJobId}/findings`, {
      method: 'POST',
      body: knownId
        ? { categoryId: knownId, note: $('findingNote').value.trim() || undefined }
        : { categoryName: text, note: $('findingNote').value.trim() || undefined },
    });
    $('findingCategory').value = '';
    $('findingNote').value = '';
    await loadJobDetail(state.currentJobId);
  } catch (err) {
    alertError(err);
  }
});

$('btnUploadFindingPhoto').addEventListener('click', async () => {
  const findingId = $('findingSelect').value;
  if (!findingId) return alert('Belum ada temuan — tambah temuan dulu sebelum upload foto');
  const file = $('findingPhotoFile').files[0];
  if (!file) return alert('Pilih file foto dulu');
  const form = new FormData();
  form.append('photo', file);
  form.append('kind', $('findingPhotoKind').value);
  try {
    await api(`/technician-jobs/${state.currentJobId}/findings/${findingId}/photos`, {
      method: 'POST',
      body: form,
      isForm: true,
    });
    await loadJobDetail(state.currentJobId);
  } catch (err) {
    alertError(err);
  }
});

function printUnitLabel(unit, member) {
  const qrBox = $('unitQrImg');
  const canvas = qrBox.querySelector('canvas');
  const img = qrBox.querySelector('img');
  const src = canvas ? canvas.toDataURL('image/png') : img ? img.src : '';

  const win = window.open('', '_blank', 'width=320,height=420');
  win.document.write(`
    <html>
      <head><title>Label ${unit.barcodeValue}</title></head>
      <body style="font-family: sans-serif; text-align:center; padding:16px;">
        <img src="${src}" width="180" height="180" />
        <p style="font-weight:bold; font-size:14px;">${unit.barcodeValue}</p>
        <p style="font-size:12px;">${unit.brand ?? ''} ${unit.model ?? ''}</p>
        <p style="font-size:12px;">${member?.name ?? ''}</p>
        <script>window.print();</script>
      </body>
    </html>
  `);
  win.document.close();
}

function downloadUnitQr(barcodeValue) {
  const qrBox = $('unitQrImg');
  const canvas = qrBox.querySelector('canvas');
  const img = qrBox.querySelector('img');
  const src = canvas ? canvas.toDataURL('image/png') : img ? img.src : '';
  if (!src) return;
  const a = document.createElement('a');
  a.href = src;
  a.download = `${barcodeValue}.png`;
  a.click();
}

// "Scan Unit" — simulasi teknisi scan QR fisik yang nempel di unit AC.
// GET /ac-units/lookup/:barcodeValue WAJIB bawa token (JwtAuthGuard) — orang
// yang gak login gak bisa buka data apa-apa walau tau kode QR-nya persis.
$('btnScanUnit').addEventListener('click', async () => {
  const barcode = $('scanBarcode').value.trim();
  if (!barcode) return alert('Isi/scan barcode dulu');
  try {
    const result = await api(`/ac-units/lookup/${encodeURIComponent(barcode)}`);
    if (result.activeJob) {
      $('scanResult').innerHTML = `<p class="hint">Unit ditemukan, job servis aktif ditemukan — membuka detail job...</p>`;
      await loadJobDetail(result.activeJob.id);
    } else {
      $('scanResult').innerHTML = `
        <p class="hint">
          Unit ditemukan: <b>${result.unit.brand ?? ''} ${result.unit.model ?? ''}</b>
          milik <b>${result.member?.name ?? '-'}</b> — tapi belum ada job servis aktif
          untuk unit ini (mungkin sudah selesai/dibatalkan semua, atau memang belum
          pernah ada job).
        </p>
      `;
    }
  } catch (err) {
    $('scanResult').innerHTML = '';
    alertError(err);
  }
});

function renderMaterialRequests(requests) {
  const tbody = $('tbl_material_requests').querySelector('tbody');
  tbody.innerHTML = '';
  requests.forEach((req) => {
    const tr = document.createElement('tr');
    const itemNames = (req.items || []).map((i) => `${i.name} x${i.qty}`).join(', ');
    let actions = '';
    if (req.status === 'pending') {
      actions = `
        <button data-role="approve">Approve</button>
        <button data-role="reject" class="danger">Reject</button>
      `;
    } else if (req.status === 'approved' && !req.usedAt) {
      actions = `<button data-role="markused">Tandai Dipakai</button>`;
    } else if (req.usedAt) {
      actions = '<span class="muted">sudah dipakai</span>';
    }
    tr.innerHTML = `<td>${itemNames}</td><td>${formatRupiah(req.total)}</td><td><span class="badge">${req.status}</span></td><td>${actions}</td>`;
    tr.querySelector('[data-role="approve"]')?.addEventListener('click', () => decideMaterialRequest(req.id, 'approve'));
    tr.querySelector('[data-role="reject"]')?.addEventListener('click', () => decideMaterialRequest(req.id, 'reject'));
    tr.querySelector('[data-role="markused"]')?.addEventListener('click', () => markMaterialUsed(req.id));
    tbody.appendChild(tr);
  });
}

async function decideMaterialRequest(id, decision) {
  try {
    await api(`/material-requests/${id}/decide`, { method: 'PATCH', body: { decision } });
    await loadJobDetail(state.currentJobId);
  } catch (err) {
    alertError(err);
  }
}

async function markMaterialUsed(id) {
  try {
    await api(`/material-requests/${id}/mark-used`, { method: 'PATCH' });
    await loadJobDetail(state.currentJobId);
  } catch (err) {
    alertError(err);
  }
}

$('btnAssign').addEventListener('click', async () => {
  const technicianId = $('assignTechnician').value;
  if (!technicianId) return alert('Pilih teknisi dulu');
  try {
    await api(`/technician-jobs/${state.currentJobId}/assign`, { method: 'PATCH', body: { technicianId } });
    await loadJobDetail(state.currentJobId);
    await refreshJobs();
  } catch (err) {
    alertError(err);
  }
});

$('btnStart').addEventListener('click', async () => {
  try {
    await api(`/technician-jobs/${state.currentJobId}/start`, {
      method: 'PATCH',
      body: { scannedBarcode: $('startBarcode').value.trim() },
    });
    await loadJobDetail(state.currentJobId);
    await refreshJobs();
  } catch (err) {
    alertError(err);
  }
});

$('btnUpdateNotes').addEventListener('click', async () => {
  try {
    await api(`/technician-jobs/${state.currentJobId}/notes`, { method: 'PATCH', body: { notes: $('jobNotes').value } });
    alert('Catatan disimpan');
  } catch (err) {
    alertError(err);
  }
});

$('btnCreateMaterialRequest').addEventListener('click', async () => {
  try {
    await api(`/technician-jobs/${state.currentJobId}/materials`, {
      method: 'POST',
      body: {
        items: [{ kind: $('mrKind').value, refId: $('mrItemRef').value, qty: Number($('mrQty').value || 1) }],
        note: $('mrNote').value.trim() || undefined,
      },
    });
    await loadJobDetail(state.currentJobId);
  } catch (err) {
    alertError(err);
  }
});

$('btnSubmitForReview').addEventListener('click', async () => {
  try {
    await api(`/technician-jobs/${state.currentJobId}/submit-for-review`, { method: 'PATCH' });
    await loadJobDetail(state.currentJobId);
    await refreshJobs();
    alert('Job diajukan selesai — menunggu review admin');
  } catch (err) {
    alertError(err);
  }
});

$('btnApproveComplete').addEventListener('click', async () => {
  try {
    await api(`/technician-jobs/${state.currentJobId}/approve-complete`, { method: 'PATCH' });
    await loadJobDetail(state.currentJobId);
    await refreshJobs();
    alert('Job disetujui — selesai');
  } catch (err) {
    alertError(err);
  }
});

$('btnSendBack').addEventListener('click', async () => {
  const note = $('sendBackNote').value.trim();
  if (!note) return alert('Isi catatan dulu — wajib diisi saat mengembalikan job');
  try {
    await api(`/technician-jobs/${state.currentJobId}/send-back`, { method: 'PATCH', body: { note } });
    $('sendBackNote').value = '';
    await loadJobDetail(state.currentJobId);
    await refreshJobs();
  } catch (err) {
    alertError(err);
  }
});

$('btnCancel').addEventListener('click', async () => {
  if (!confirm('Yakin batalkan job ini?')) return;
  try {
    await api(`/technician-jobs/${state.currentJobId}/cancel`, { method: 'PATCH' });
    await loadJobDetail(state.currentJobId);
    await refreshJobs();
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Mode Offline Teknisi (Siklus 9) — tes manual. Simulasi: muat today-bundle
// (data yang harusnya di-cache Flutter sebelum berangkat), susun beberapa
// aksi di "antrian" (seolah dibuat offline), baru kirim SEKALIGUS lewat
// sync-batch. clientActionId di-generate sekali per aksi (crypto.randomUUID)
// dan dipakai lagi kalau tombol "Kirim Ulang" dipencet — itu yang bikin
// idempotensi bisa dites (retry beneran, bukan bikin aksi baru).
// ---------------------------------------------------------------------------
state.todayBundle = { jobs: [], topSpareparts: [] };
state.syncQueue = []; // aksi yang belum dikirim: { clientActionId, type, jobId, clientUpdatedAt, payload }
state.lastSentBatch = []; // batch terakhir yang BENERAN dikirim — dipakai tombol "Kirim Ulang"

$('sync_type').addEventListener('change', () => {
  const type = $('sync_type').value;
  $('sync_field_finding').style.display = type === 'finding_add' ? 'flex' : 'none';
  $('sync_field_material').style.display = type === 'material_add' ? 'flex' : 'none';
  $('sync_field_notes').style.display = type === 'notes_update' ? 'flex' : 'none';
});

$('btnLoadTodayBundle').addEventListener('click', async () => {
  try {
    const bundle = await api('/technician-jobs/queue/today-bundle');
    state.todayBundle = bundle;
    $('sync_job').innerHTML = bundle.jobs
      .map((j) => `<option value="${j.id}">${j.unit ? `${j.unit.brand ?? ''} ${j.unit.model ?? ''}` : j.type} — ${j.status} (${j.member?.name ?? '-'})</option>`)
      .join('') || '<option value="">tidak ada job aktif hari ini</option>';

    const sparepartOptions = (bundle.topSpareparts.length ? bundle.topSpareparts : state.master.spareparts) || [];
    $('sync_sparepart').innerHTML = sparepartOptions.map((sp) => `<option value="${sp.id}">${sp.name}</option>`).join('');

    $('todayBundleResult').innerHTML = `
      Dimuat ${new Date(bundle.generatedAt).toLocaleTimeString('id-ID')} —
      <b>${bundle.jobs.length}</b> job aktif, <b>${bundle.topSpareparts.length}</b> sparepart terlaris (30 hari terakhir)
      ${!bundle.jobs.length ? '<br/><span class="muted">Belum ada job aktif buat teknisi ini — assign dulu dari tab Job Board.</span>' : ''}
    `;
  } catch (err) {
    alertError(err);
  }
});

$('btnQueueAction').addEventListener('click', () => {
  const jobId = $('sync_job').value;
  if (!jobId) return alert('Muat today-bundle dulu & pilih job');
  const job = state.todayBundle.jobs.find((j) => j.id === jobId);
  if (!job) return alert('Job gak ketemu di bundle yang dimuat — muat ulang today-bundle');

  const type = $('sync_type').value;
  let payload;
  if (type === 'finding_add') {
    const categoryName = $('sync_categoryName').value.trim();
    if (!categoryName) return alert('Isi nama temuan dulu');
    payload = { categoryName, note: $('sync_findingNote').value.trim() || undefined };
    $('sync_categoryName').value = '';
    $('sync_findingNote').value = '';
  } else if (type === 'material_add') {
    const refId = $('sync_sparepart').value;
    if (!refId) return alert('Muat today-bundle / master data dulu biar ada pilihan sparepart');
    payload = { items: [{ kind: 'sparepart', refId, qty: Number($('sync_qty').value || 1) }] };
  } else if (type === 'notes_update') {
    const notes = $('sync_notes').value.trim();
    if (!notes) return alert('Isi catatan dulu');
    payload = { notes };
    $('sync_notes').value = '';
  } else {
    payload = {};
  }

  state.syncQueue.push({
    clientActionId: crypto.randomUUID(),
    type,
    jobId,
    // clientUpdatedAt = updatedAt job SAAT today-bundle dimuat tadi — persis
    // simulasi "snapshot yang di-cache offline pagi ini".
    clientUpdatedAt: job.updatedAt,
    payload,
  });
  renderSyncQueue();
});

function renderSyncQueue() {
  const tbody = $('tbl_sync_queue').querySelector('tbody');
  tbody.innerHTML = '';
  state.syncQueue.forEach((action, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${action.clientActionId.slice(0, 8)}…</code></td>
      <td>${action.type}</td>
      <td><code>${action.jobId.slice(0, 8)}…</code></td>
      <td><code>${JSON.stringify(action.payload)}</code></td>
      <td><button data-role="remove" class="danger">Hapus</button></td>
    `;
    tr.querySelector('[data-role="remove"]').addEventListener('click', () => {
      state.syncQueue.splice(idx, 1);
      renderSyncQueue();
    });
    tbody.appendChild(tr);
  });
}

function renderSyncResults(results) {
  const tbody = $('tbl_sync_result').querySelector('tbody');
  tbody.innerHTML = '';
  results.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${r.clientActionId.slice(0, 8)}…</code></td>
      <td><span class="badge">${r.status}</span></td>
      <td><code>${JSON.stringify(r.detail)}</code></td>
    `;
    tbody.appendChild(tr);
  });
}

$('btnSendSyncBatch').addEventListener('click', async () => {
  if (!state.syncQueue.length) return alert('Antrian masih kosong — tambah aksi dulu di atas');
  const actions = state.syncQueue.map((a) => ({
    clientActionId: a.clientActionId,
    type: a.type,
    jobId: a.jobId,
    clientUpdatedAt: a.clientUpdatedAt,
    payload: a.payload,
  }));
  try {
    const results = await api('/technician-jobs/sync-batch', { method: 'POST', body: { actions } });
    state.lastSentBatch = actions;
    renderSyncResults(results);
    state.syncQueue = [];
    renderSyncQueue();
  } catch (err) {
    alertError(err);
  }
});

$('btnResendSyncBatch').addEventListener('click', async () => {
  if (!state.lastSentBatch.length) return alert('Belum ada batch yang beneran dikirim — kirim dulu sekali lewat "Kirim Sync-Batch"');
  try {
    // clientActionId PERSIS SAMA kayak pengiriman sebelumnya — simulasi
    // Flutter yang retry karena ragu apakah pengiriman tadi sukses atau
    // putus di tengah jalan. Hasil yang diharapkan: semua skipped_duplicate.
    const results = await api('/technician-jobs/sync-batch', { method: 'POST', body: { actions: state.lastSentBatch } });
    renderSyncResults(results);
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Invoice & Pembayaran
// ---------------------------------------------------------------------------
$('btnLoadInvoice').addEventListener('click', () => loadInvoice($('invoiceIdInput').value.trim()));
$('btnRefreshInvoiceList').addEventListener('click', refreshInvoiceHistory);

async function refreshInvoiceHistory() {
  try {
    const invoices = await api('/invoices');
    const tbody = $('tbl_invoice_history').querySelector('tbody');
    tbody.innerHTML = '';
    (invoices || []).forEach((inv) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><a href="#" data-role="open">${inv.number}</a></td><td>${inv.member?.name ?? inv.customerName ?? '-'}</td><td><span class="badge">${inv.status}</span></td><td>${formatRupiah(inv.grandTotal)}</td>`;
      tr.querySelector('[data-role="open"]').addEventListener('click', (e) => {
        e.preventDefault();
        $('invoiceIdInput').value = inv.id;
        loadInvoice(inv.id);
      });
      tbody.appendChild(tr);
    });
  } catch (err) {
    alertError(err);
  }
}

async function loadInvoice(id) {
  if (!id) return alert('Isi invoice id dulu, atau pilih dari riwayat');
  try {
    const inv = await api(`/invoices/${id}`);
    state.currentInvoiceId = id;
    $('invoiceDetailCard').style.display = 'block';
    $('invNumber').textContent = inv.number;
    $('invStatus').textContent = inv.status;

    const tbody = $('tbl_invoice_items').querySelector('tbody');
    tbody.innerHTML = '';
    (inv.items || []).forEach((it) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${it.name}</td><td>${it.qty}</td><td>${formatRupiah(it.unitPrice)}</td><td>${formatRupiah(it.lineTotal)}</td>`;
      tbody.appendChild(tr);
    });

    const remaining = Number(inv.grandTotal) - Number(inv.totalPaid);
    $('invTotals').innerHTML = `
      Subtotal: ${formatRupiah(inv.subtotal)} &nbsp;|&nbsp;
      Total Tagihan: ${formatRupiah(inv.grandTotal)} &nbsp;|&nbsp;
      Sudah Dibayar: ${formatRupiah(inv.totalPaid)} &nbsp;|&nbsp;
      <b>Sisa: ${formatRupiah(remaining)}</b>
    `;

    const payTbody = $('tbl_payments').querySelector('tbody');
    payTbody.innerHTML = '';
    (inv.manualPayments || []).forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.method}</td><td>${formatRupiah(p.amount)}</td><td>${p.note ?? '-'}</td><td>${new Date(p.createdAt).toLocaleString('id-ID')}</td>`;
      payTbody.appendChild(tr);
    });
  } catch (err) {
    alertError(err);
  }
}

$('btnRecordPayment').addEventListener('click', async () => {
  if (!state.currentInvoiceId) return alert('Muat invoice dulu');
  try {
    await api(`/invoices/${state.currentInvoiceId}/payments`, {
      method: 'POST',
      body: {
        method: $('payMethod').value,
        amount: Number($('payAmount').value || 0),
        note: $('payNote').value.trim() || undefined,
      },
    });
    $('payAmount').value = '';
    $('payNote').value = '';
    await loadInvoice(state.currentInvoiceId);
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Servis Mandiri (Siklus 2) — intake servis yang BUKAN dari pos/checkout.
// ---------------------------------------------------------------------------
let smExistingUnit = null; // { id, barcodeValue, ... } hasil scan, kalau mode "existing"

document.querySelectorAll('input[name="sm_unit_mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="sm_unit_mode"]:checked').value;
    $('sm_unit_new').style.display = mode === 'new' ? 'block' : 'none';
    $('sm_unit_existing').style.display = mode === 'existing' ? 'block' : 'none';
  });
});

$('btnSmScan').addEventListener('click', async () => {
  const barcode = $('sm_scan_barcode').value.trim();
  if (!barcode) return alert('Isi/scan barcode dulu');
  try {
    const result = await api(`/ac-units/lookup/${encodeURIComponent(barcode)}`);
    smExistingUnit = result.unit;
    $('sm_scan_result').innerHTML = `
      Ditemukan: <b>${result.unit.brand ?? ''} ${result.unit.model ?? ''}</b>
      milik <b>${result.member?.name ?? '-'}</b> (${result.member?.phone ?? '-'}).
      Pastikan nama/HP pelanggan di form atas SAMA PERSIS dengan pemilik unit ini,
      atau server akan menolak (unit terdaftar atas nama member lain).
    `;
  } catch (err) {
    smExistingUnit = null;
    $('sm_scan_result').innerHTML = '';
    alertError(err);
  }
});

$('btnIntake').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="sm_unit_mode"]:checked').value;
  if (mode === 'existing' && !smExistingUnit) return alert('Cari/scan unit-nya dulu');

  const payload = {
    customer: {
      name: $('sm_name').value.trim(),
      phone: $('sm_phone').value.trim(),
      address: $('sm_address').value.trim() || undefined,
    },
    complaint: $('sm_complaint').value.trim(),
    technicianId: $('sm_technician').value || undefined,
    scheduledDate: $('sm_scheduled').value ? new Date($('sm_scheduled').value).toISOString() : undefined,
  };
  if (mode === 'existing') {
    payload.existingUnitId = smExistingUnit.id;
  } else {
    payload.newUnit = {
      brand: $('sm_brand').value.trim() || undefined,
      model: $('sm_model').value.trim() || undefined,
      pk: $('sm_pk').value ? Number($('sm_pk').value) : undefined,
      roomLocation: $('sm_room').value.trim() || undefined,
      serialNumber: $('sm_serial').value.trim() || undefined,
    };
  }

  try {
    const result = await api('/service-orders/intake', { method: 'POST', body: payload });
    $('sm_intake_result').innerHTML = `
      <p class="hint">Servis diterima. Job teknisi dibuat, status: <b>${result.jobStatus}</b>,
      barcode unit: <code>${result.barcodeValue}</code>.
      Buka tab <b>Job Board</b> untuk assign teknisi / lanjutkan pengerjaan.</p>
    `;
  } catch (err) {
    alertError(err);
  }
});

$('btnCheckServiceStatus').addEventListener('click', async () => {
  const phone = $('sm_check_phone').value.trim();
  if (!phone) return alert('Isi nomor HP dulu');
  try {
    const orders = await api(`/service-orders?phone=${encodeURIComponent(phone)}`);
    const tbody = $('tbl_service_orders').querySelector('tbody');
    tbody.innerHTML = '';
    (orders || []).forEach((order) => {
      const unit = order.serviceOrderUnits?.[0]?.unit;
      const job = order.units?.[0];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(order.createdAt).toLocaleString('id-ID')}</td>
        <td>${order.type}</td>
        <td>${order.note ?? '-'}</td>
        <td>${unit ? `${unit.brand ?? ''} ${unit.model ?? ''}` : '-'}</td>
        <td><span class="badge">${order.status}</span></td>
        <td>${job ? `<span class="badge">${job.status}</span> (${job.technician?.displayName ?? 'belum ditugaskan'})` : '-'}</td>
        <td>${job ? '<button data-role="open-job">Buka Job</button>' : ''}</td>
      `;
      tr.querySelector('[data-role="open-job"]')?.addEventListener('click', () => {
        document.querySelector('.tab-btn[data-tab="jobs"]').click();
        loadJobDetail(job.id);
      });
      tbody.appendChild(tr);
    });
    if (!orders?.length) tbody.innerHTML = '<tr><td colspan="7" class="muted">Belum ada riwayat servis untuk nomor ini.</td></tr>';
  } catch (err) {
    alertError(err);
  }
});

$('btnLoadHistory').addEventListener('click', async () => {
  try {
    const result = await api('/technician-jobs/history');
    const tbody = $('tbl_history').querySelector('tbody');
    tbody.innerHTML = '';
    (result.items || []).forEach((job) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${job.completedAt ? new Date(job.completedAt).toLocaleString('id-ID') : '-'}</td>
        <td>${job.type}</td>
        <td>${job.unit ? `${job.unit.brand ?? ''} ${job.unit.model ?? ''}` : '-'}</td>
        <td>${job.member?.name ?? '-'}</td>
      `;
      tbody.appendChild(tr);
    });
    if (!result.items?.length) tbody.innerHTML = '<tr><td colspan="4" class="muted">Belum ada job selesai.</td></tr>';
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Realtime log (Socket.IO) — opsional, buat verifikasi event admin-dashboard.
// ---------------------------------------------------------------------------
$('btnConnectRt').addEventListener('click', () => {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  const socket = io(state.apiBase, { transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect', () => {
    $('rtStatus').textContent = 'terhubung';
    socket.emit('join-admin-dashboard');
    appendRtLog('connected, joined admin-dashboard');
  });
  socket.on('disconnect', () => {
    $('rtStatus').textContent = 'terputus';
    appendRtLog('disconnected');
  });
  ['transaction.created', 'job.status_changed', 'invoice.updated', 'material_request.created', 'material_request.decided'].forEach((evt) => {
    socket.on(evt, (payload) => appendRtLog(`${evt}: ${JSON.stringify(payload)}`));
  });
});

function appendRtLog(line) {
  const pre = $('rtLog');
  pre.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${line}\n` + pre.textContent;
}

// ---------------------------------------------------------------------------
// Stok (Siklus 3) — barang masuk, stock opname, histori stock_movements.
// Semua endpoint admin-only.
// ---------------------------------------------------------------------------
function fillStockItemOptions() {
  ['st_in', 'st_op'].forEach((prefix) => {
    const kindSel = $(`${prefix}_kind`);
    const itemSel = $(`${prefix}_item`);
    if (!kindSel || !itemSel) return;
    const list = kindSel.value === 'product' ? state.master.products : state.master.spareparts;
    itemSel.innerHTML = (list || [])
      .map((i) => `<option value="${i.id}">${i.name} (stok: ${i.stock})</option>`)
      .join('');
  });
}
$('st_in_kind').addEventListener('change', fillStockItemOptions);
$('st_op_kind').addEventListener('change', fillStockItemOptions);

$('btnStockIn').addEventListener('click', async () => {
  const kind = $('st_in_kind').value;
  const refId = $('st_in_item').value;
  if (!refId) return alert('Muat master data dulu (tab Master Data > Refresh)');
  try {
    const result = await api('/stock/in', {
      method: 'POST',
      body: {
        kind,
        refId,
        qty: Number($('st_in_qty').value || 0),
        buyPrice: Number($('st_in_buyPrice').value || 0),
        note: $('st_in_note').value.trim() || undefined,
      },
    });
    $('st_in_result').innerHTML = `<b>${result.name}</b>: stok ${result.previousStock} &rarr; ${result.newStock}`;
    await refreshMaster(); // biar stok di tab Master Data & select ikut update
  } catch (err) {
    alertError(err);
  }
});

$('btnAddOpnameItem').addEventListener('click', () => {
  const kind = $('st_op_kind').value;
  const refId = $('st_op_item').value;
  const physicalQty = Number($('st_op_qty').value);
  if (!refId) return alert('Muat master data dulu (tab Master Data > Refresh)');
  if ($('st_op_qty').value === '' || Number.isNaN(physicalQty) || physicalQty < 0) {
    return alert('Isi physical qty (angka final hasil hitung fisik) dulu');
  }
  const list = kind === 'product' ? state.master.products : state.master.spareparts;
  const item = list.find((i) => i.id === refId);
  if (!item) return;

  const existing = state.opnameItems.find((o) => o.kind === kind && o.refId === refId);
  if (existing) {
    existing.physicalQty = physicalQty;
  } else {
    state.opnameItems.push({ kind, refId, name: item.name, physicalQty });
  }
  renderOpnameItems();
});

function renderOpnameItems() {
  const tbody = $('tbl_opname_items').querySelector('tbody');
  tbody.innerHTML = '';
  state.opnameItems.forEach((o, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${o.kind}</td>
      <td>${o.name}</td>
      <td>${o.physicalQty}</td>
      <td><button data-role="remove" class="danger">Hapus</button></td>
    `;
    tr.querySelector('[data-role="remove"]').addEventListener('click', () => {
      state.opnameItems.splice(idx, 1);
      renderOpnameItems();
    });
    tbody.appendChild(tr);
  });
}

$('btnSubmitOpname').addEventListener('click', async () => {
  if (state.opnameItems.length === 0) return alert('Tambah minimal 1 item ke daftar opname dulu');
  try {
    const results = await api('/stock/opname', {
      method: 'POST',
      body: {
        items: state.opnameItems.map((o) => ({ kind: o.kind, refId: o.refId, physicalQty: o.physicalQty })),
        note: $('st_op_note').value.trim() || undefined,
      },
    });
    $('st_opname_result').innerHTML = `
      <table>
        <thead><tr><th>Item</th><th>Stok Sistem</th><th>Physical Qty</th><th>Delta</th></tr></thead>
        <tbody>
          ${(results || []).map((r) => `<tr><td>${r.name}</td><td>${r.systemQty}</td><td>${r.physicalQty}</td><td>${r.delta > 0 ? '+' : ''}${r.delta}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
    state.opnameItems = [];
    renderOpnameItems();
    await refreshMaster();
  } catch (err) {
    alertError(err);
  }
});

$('btnLoadMovements').addEventListener('click', async () => {
  const params = new URLSearchParams();
  if ($('st_mv_kind').value) params.set('itemKind', $('st_mv_kind').value);
  if ($('st_mv_refId').value.trim()) params.set('refId', $('st_mv_refId').value.trim());
  if ($('st_mv_reason').value) params.set('reason', $('st_mv_reason').value);
  if ($('st_mv_from').value) params.set('from', $('st_mv_from').value);
  if ($('st_mv_to').value) params.set('to', $('st_mv_to').value);

  try {
    const movements = await api(`/stock/movements?${params.toString()}`);
    const tbody = $('tbl_stock_movements').querySelector('tbody');
    tbody.innerHTML = '';
    (movements || []).forEach((m) => {
      const tr = document.createElement('tr');
      const qty = Number(m.qtyChange);
      tr.innerHTML = `
        <td>${new Date(m.createdAt).toLocaleString('id-ID')}</td>
        <td>${m.itemKind}</td>
        <td>${m.name}</td>
        <td>${qty > 0 ? '+' : ''}${qty}</td>
        <td><span class="badge">${m.reason}</span></td>
      `;
      tbody.appendChild(tr);
    });
    if (!movements?.length) tbody.innerHTML = '<tr><td colspan="5" class="muted">Belum ada data buat filter ini.</td></tr>';
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Kas & Shift Kasir (Siklus 4) — buka/tutup shift, laporan per metode bayar.
// ---------------------------------------------------------------------------
function renderMyShift(shift) {
  state.currentShiftId = shift ? shift.id : null;
  if (shift) {
    $('myShiftInfo').innerHTML = `Shift aktif: <code>${shift.id}</code> — modal awal ${formatRupiah(shift.openingBalance)}, dibuka ${new Date(shift.openedAt).toLocaleString('id-ID')}`;
    $('openShiftForm').style.display = 'none';
    $('closeShiftForm').style.display = 'block';
  } else {
    $('myShiftInfo').innerHTML = 'Belum ada shift aktif — buka shift dulu di bawah.';
    $('openShiftForm').style.display = 'block';
    $('closeShiftForm').style.display = 'none';
  }
}

$('btnCheckMyShift').addEventListener('click', async () => {
  try {
    const shift = await api('/shifts/current');
    renderMyShift(shift);
  } catch (err) {
    alertError(err);
  }
});

$('btnOpenShift').addEventListener('click', async () => {
  try {
    const shift = await api('/shifts/open', {
      method: 'POST',
      body: { openingBalance: Number($('sh_openingBalance').value || 0) },
    });
    renderMyShift(shift);
  } catch (err) {
    alertError(err);
  }
});

$('btnCloseShift').addEventListener('click', async () => {
  if (!state.currentShiftId) return alert('Gak ada shift aktif — cek shift dulu');
  try {
    const result = await api(`/shifts/${state.currentShiftId}/close`, {
      method: 'POST',
      body: {
        closingBalance: Number($('sh_closingBalance').value || 0),
        notes: $('sh_closeNotes').value.trim() || undefined,
      },
    });
    const label = result.selisih === 0 ? '(pas)' : result.selisih > 0 ? '(lebih)' : '(kurang)';
    $('closeShiftResult').innerHTML = `
      Shift ditutup. Expected cash (dari pembayaran tunai): ${formatRupiah(result.expectedCash)} —
      Uang fisik akhir: ${formatRupiah(result.closingBalance)} —
      <b>Selisih: ${formatRupiah(result.selisih)} ${label}</b>
    `;
    const shift = await api('/shifts/current');
    renderMyShift(shift);
  } catch (err) {
    alertError(err);
  }
});

$('btnLoadShiftReport').addEventListener('click', async () => {
  let id = $('sh_reportId').value.trim();
  if (!id) {
    if (!state.currentShiftId) return alert('Gak ada shift aktif — isi shift id manual, atau cek shift aktif dulu');
    id = state.currentShiftId;
  }
  try {
    const report = await api(`/shifts/${id}/report`);
    const rows = Object.entries(report.perMethod)
      .map(([method, v]) => `<tr><td>${method}</td><td>${formatRupiah(v.totalAmount)}</td><td>${v.jumlahTransaksi}</td></tr>`)
      .join('');
    $('shiftReportResult').innerHTML = `
      <p>Shift <code>${report.shift.id}</code> — modal awal ${formatRupiah(report.shift.openingBalance)}
      ${report.shift.closedAt
        ? `, ditutup ${new Date(report.shift.closedAt).toLocaleString('id-ID')} (uang fisik akhir ${formatRupiah(report.shift.closingBalance)})`
        : ' (masih terbuka)'}
      </p>
      <table>
        <thead><tr><th>Metode</th><th>Total</th><th>Jumlah Transaksi</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">Belum ada pembayaran di shift ini.</td></tr>'}</tbody>
      </table>
      <p>Total transaksi: ${report.totalTransaksi} &nbsp;|&nbsp; Invoice dilayani: ${report.jumlahInvoiceDilayani}</p>
    `;
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Laporan & Dashboard (Siklus 8) — semua endpoint admin-only kecuali
// GET /app-config (semua role login boleh baca).
// ---------------------------------------------------------------------------
$('btnRefreshDashboard').addEventListener('click', async () => {
  try {
    const d = await api('/dashboard/summary');
    const jobRows = d.jobAktifPerStatus.map((j) => `<tr><td>${j.status}</td><td>${j.count}</td></tr>`).join('');
    const invRows = d.invoiceBelumLunas.map((i) => `<tr><td>${i.status}</td><td>${i.count}</td></tr>`).join('');
    $('dashboardResult').innerHTML = `
      <p>Transaksi hari ini: <b>${d.transaksiHariIni}</b> &nbsp;|&nbsp; Omzet hari ini: <b>${formatRupiah(d.omzetHariIni)}</b></p>
      <div class="grid-2">
        <div>
          <h4>Job Aktif per Status</h4>
          <table><thead><tr><th>Status</th><th>Jumlah</th></tr></thead><tbody>${jobRows || '<tr><td colspan="2" class="muted">tidak ada job aktif</td></tr>'}</tbody></table>
        </div>
        <div>
          <h4>Invoice Belum Lunas</h4>
          <table><thead><tr><th>Status</th><th>Jumlah</th></tr></thead><tbody>${invRows || '<tr><td colspan="2" class="muted">semua lunas</td></tr>'}</tbody></table>
        </div>
      </div>
    `;
  } catch (err) {
    alertError(err);
  }
});

async function loadAppConfig() {
  const config = await api('/app-config');
  const tbody = $('tbl_app_config').querySelector('tbody');
  tbody.innerHTML = '';
  Object.entries(config).forEach(([key, value]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${key}</code></td>
      <td>${value === '' ? '<span class="muted">(kosong)</span>' : value}</td>
      <td><input data-role="newvalue" placeholder="value baru" style="width:160px" /></td>
      <td><button data-role="save">Simpan</button></td>
    `;
    tr.querySelector('[data-role="save"]').addEventListener('click', async () => {
      const newValue = tr.querySelector('[data-role="newvalue"]').value;
      if (newValue === '') return alert('Isi value baru dulu (boleh spasi kalau emang mau kosong)');
      try {
        await api(`/app-config/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: newValue } });
        await loadAppConfig();
      } catch (err) {
        alertError(err);
      }
    });
    tbody.appendChild(tr);
  });
}
$('btnLoadAppConfig').addEventListener('click', () => loadAppConfig().catch(alertError));

$('btnLoadSalesReport').addEventListener('click', async () => {
  const from = $('rp_sales_from').value;
  const to = $('rp_sales_to').value;
  if (!from || !to) return alert('Isi rentang tanggal dulu');
  try {
    const r = await api(`/reports/sales?from=${from}&to=${to}`);
    const catRows = r.breakdownKategori.map((c) => `<tr><td>${c.category}</td><td>${c.qty}</td><td>${formatRupiah(c.totalLine)}</td></tr>`).join('');
    const dailyRows = r.grafikHarian.map((d) => `<tr><td>${new Date(d.date).toLocaleDateString('id-ID')}</td><td>${d.count}</td><td>${formatRupiah(d.total)}</td></tr>`).join('');
    $('rp_sales_result').innerHTML = `
      <p>Total Penjualan: <b>${formatRupiah(r.totalPenjualan)}</b> &nbsp;|&nbsp; Jumlah Invoice: ${r.totalInvoice}
         &nbsp;|&nbsp; Total Diskon: ${formatRupiah(r.totalDiskon)} &nbsp;|&nbsp; Total Pajak: ${formatRupiah(r.totalPajak)}</p>
      <div class="grid-2">
        <div>
          <h4>Breakdown per Kategori Produk</h4>
          <table><thead><tr><th>Kategori</th><th>Qty</th><th>Total</th></tr></thead><tbody>${catRows || '<tr><td colspan="3" class="muted">tidak ada data</td></tr>'}</tbody></table>
        </div>
        <div>
          <h4>Grafik Harian</h4>
          <table><thead><tr><th>Tanggal</th><th>Jumlah Invoice</th><th>Total</th></tr></thead><tbody>${dailyRows || '<tr><td colspan="3" class="muted">tidak ada data</td></tr>'}</tbody></table>
        </div>
      </div>
    `;
  } catch (err) {
    alertError(err);
  }
});

$('btnLoadServiceReport').addEventListener('click', async () => {
  const from = $('rp_service_from').value;
  const to = $('rp_service_to').value;
  if (!from || !to) return alert('Isi rentang tanggal dulu');
  try {
    const r = await api(`/reports/service?from=${from}&to=${to}`);
    const statusRows = r.jumlahPerStatus.map((s) => `<tr><td>${s.status}</td><td>${s.count}</td></tr>`).join('');
    const teknisiRows = r.performaTeknisi.map((t) => `<tr><td>${t.namaTeknisi}</td><td>${t.jobSelesai}</td></tr>`).join('');
    $('rp_service_result').innerHTML = `
      <p>Rata-rata Waktu Pengerjaan: <b>${r.rataRataWaktuPengerjaanMenit !== null ? r.rataRataWaktuPengerjaanMenit + ' menit' : '<span class="muted">belum ada job selesai di rentang ini</span>'}</b></p>
      <div class="grid-2">
        <div>
          <h4>Jumlah Job per Status</h4>
          <table><thead><tr><th>Status</th><th>Jumlah</th></tr></thead><tbody>${statusRows || '<tr><td colspan="2" class="muted">tidak ada data</td></tr>'}</tbody></table>
        </div>
        <div>
          <h4>Performa Teknisi (job selesai)</h4>
          <table><thead><tr><th>Teknisi</th><th>Job Selesai</th></tr></thead><tbody>${teknisiRows || '<tr><td colspan="2" class="muted">tidak ada data</td></tr>'}</tbody></table>
        </div>
      </div>
    `;
  } catch (err) {
    alertError(err);
  }
});

$('btnLoadProfitLossReport').addEventListener('click', async () => {
  const from = $('rp_pl_from').value;
  const to = $('rp_pl_to').value;
  if (!from || !to) return alert('Isi rentang tanggal dulu');
  try {
    const r = await api(`/reports/profit-loss?from=${from}&to=${to}`);
    const itemRows = r.detailPerItem
      .map(
        (it) => `
          <tr>
            <td>${it.name} <span class="muted">(${it.kind})</span></td>
            <td>${it.qtyTerjual}</td>
            <td>${formatRupiah(it.revenue)}</td>
            <td>${formatRupiah(it.hpp)}</td>
            <td class="muted">${it.catatan}</td>
          </tr>
        `,
      )
      .join('');
    $('rp_pl_result').innerHTML = `
      <p>
        Total Pendapatan: <b>${formatRupiah(r.ringkasan.totalPendapatan)}</b> &nbsp;|&nbsp;
        Total HPP: ${formatRupiah(r.ringkasan.totalHpp)} &nbsp;|&nbsp;
        Laba Kotor: <b>${formatRupiah(r.ringkasan.labaKotor)}</b> &nbsp;|&nbsp;
        Margin: ${r.ringkasan.marginPersen}%
      </p>
      <table>
        <thead><tr><th>Item</th><th>Qty Terjual</th><th>Revenue</th><th>HPP</th><th>Catatan</th></tr></thead>
        <tbody>${itemRows || '<tr><td colspan="5" class="muted">tidak ada data</td></tr>'}</tbody>
      </table>
    `;
  } catch (err) {
    alertError(err);
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
if (state.token) {
  refreshMaster().catch(() => {});
}
