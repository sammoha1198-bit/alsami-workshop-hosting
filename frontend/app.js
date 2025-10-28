/* =========================================================
   Alsami Workshop - Frontend App (FINAL, stable)
   ========================================================= */
(() => {
  /* ------------------ إعداد عام ------------------ */
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || 'https://alsami-app-cuop.onrender.com';

  ? (window.__ALSAMI_API__ || 'https://alsami-backend.onrender.com')
  : 'http://localhost:9000';


  // جلب قالب بالـ id (مع رسالة واضحة إن كان مفقودًا)
  const T = (id) => {
    const t = document.getElementById(id);
    if (!t || !t.content) {
      console.error('Missing <template> with id:', id);
      const frag = document.createDocumentFragment();
      const warn = document.createElement('div');
      warn.className = 'card';
      warn.style.cssText = 'margin:24px;padding:16px;border:1px solid #fecaca;background:#fff1f2';
      warn.textContent = '⚠️ المكوّن مفقود: ' + id;
      frag.appendChild(warn);
      return frag;
    }
    return t.content.cloneNode(true);
  };

  const app = document.getElementById('app');
  const show = (node) => { app.replaceChildren(node); };
  const $ = (sel, root = document) => root.querySelector(sel);

  // ربط روابط داخلية
  const wireLinks = (root) =>
    root.querySelectorAll('[data-link]').forEach((el) =>
      el.addEventListener('click', () => { location.hash = el.getAttribute('data-link'); })
    );

  // زر رجوع ثابت أسفل الشاشة
function wireBack() {
  document.querySelector('.back-bar')?.remove();
  const back = T('backBtnTpl');

  back.querySelector('[data-back]').addEventListener('click', () => {
    // إن لم توجد صفحات تاريخ داخل التطبيق، ارجع للصفحة الرئيسية
    const prev = document.referrer || '';
    const sameOrigin = prev.startsWith(location.origin);
    if (history.length > 1 && sameOrigin) {
      history.back();
    } else {
      location.hash = '#/';
    }
  });

  document.body.appendChild(back);
}


  /* ------------------ مؤشّر الاتصال ------------------ */
  const onlineDot = document.getElementById('onlineDot');
  const onlineText = document.getElementById('onlineText');
  function updateOnlineUI() {
    const on = navigator.onLine;
    onlineDot?.classList.toggle('online', on);
    onlineDot?.classList.toggle('offline', !on);
    if (onlineText) onlineText.textContent = on ? 'متصل' : 'غير متصل';
  }
  window.addEventListener('online', () => { updateOnlineUI(); trySync(); });
  window.addEventListener('offline', updateOnlineUI);
  updateOnlineUI();

  /* ------------------ Toast ------------------ */
  const toastTpl = document.getElementById('toastTpl');
  let toastEl, toastTimer;
  function toast(msg, type = 'info') {
    try { toastEl?.remove(); } catch (_) {}
    const tplRoot = toastTpl?.content?.firstElementChild;
    if (!tplRoot) { alert(msg); return; }
    toastEl = tplRoot.cloneNode(true);
    toastEl.textContent = msg;
    if (type === 'warn') toastEl.style.background = '#f59e0b';
    if (type === 'error') toastEl.style.background = '#ef4444';
    if (type === 'success') toastEl.style.background = '#10b981';
    document.body.appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.remove(), 3200);
  }

  /* ------------------ طلبات API ------------------ */
  async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} GET ${path}`);
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} POST ${path}: ${txt}`);
    }
    return res;
  }

  /* ------------------ IndexedDB + مزامنة ------------------ */
  const DB_NAME = 'alsami_workshop_db';
  const DB_VER = 2;
  let dbp;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        const stores = [
          'eng_supply', 'eng_issue', 'eng_rehab', 'eng_check',
          'eng_upload', 'eng_lathe', 'eng_pump', 'eng_electrical',
          'gen_supply', 'gen_issue', 'gen_inspect',
          'spares', 'sync_queue', 'meta'
        ];
        stores.forEach((n) => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' }); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function tx(db, store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      const r = fn(st);
      t.oncomplete = () => res(r?.result);
      t.onerror = () => rej(t.error);
    });
  }
  async function put(store, obj) {
    const db = await openDB();
    return tx(db, store, 'readwrite', (s) => s.put(obj));
  }
  async function all(store) {
    const db = await openDB();
    return tx(db, store, 'readonly', (s) => s.getAll());
  }
  const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const iso = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

  async function trySync(limit = 100) {
    if (!navigator.onLine) return 0;
    const pending = (await all('sync_queue')).filter((i) => !i.synced).sort((a, b) => a.ts - b.ts);
    if (!pending.length) return 0;
    const batch = pending.slice(0, limit).map((i) => ({
      id: i.id, store: i.store, payload: i.payload, ts: i.ts, synced: false
    }));
    try {
      const res = await apiPost('/api/sync/batch', { items: batch });
      if (res.ok || res.status === 200) {
        const db = await openDB();
        await new Promise((resolve) => {
          const t = db.transaction('sync_queue', 'readwrite');
          const st = t.objectStore('sync_queue');
          pending.slice(0, limit).forEach((i) => st.put({ ...i, synced: true, syncTs: Date.now() }));
          t.oncomplete = resolve;
        });
        toast(`تمت مزامنة ${batch.length} عنصرًا`, 'success');
        return batch.length;
      }
    } catch (e) {
      console.warn('Sync failed:', e.message);
    }
    return 0;
  }

  async function saveOp(store, data, formEl) {
    const saveBtn = formEl?.querySelector('[data-save]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.dataset.old = saveBtn.textContent; saveBtn.textContent = '... جارِ الحفظ'; }
    const record = { id: uid(), ts: Date.now(), ...data };
    await put(store, record);
    await put('sync_queue', { id: record.id, store, payload: record, ts: record.ts, synced: false }).catch(() => {});
    if (navigator.onLine) {
      await trySync(50);
      toast('✅ تم الحفظ والمزامنة', 'success');
    } else {
      toast('⚠️ لا يوجد اتصال. تم التخزين محليًا وسيُزامَن لاحقًا.', 'warn');
    }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset.old || 'حفظ'; }
  }

  /* ------------------ عناصر مساعدة للواجهات ------------------ */
  function formRow(label, name, type = 'text', opts = {}) {
    const required = opts.required ? 'required' : '';
    const extra = opts.extra || '';
    if (type === 'select') {
      const options = (opts.options || []).map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return `<option value="${v}">${l}</option>`;
      }).join('');
      return `<div class="row"><label>${label}</label><select name="${name}" ${required}>${options}</select></div>`;
    }
    if (type === 'textarea') {
      return `<div class="row"><label>${label}</label><textarea name="${name}" ${required}></textarea></div>`;
    }
    return `<div class="row"><label>${label}</label><input name="${name}" type="${type}" ${required} ${extra}/></div>`;
  }
  function focusFirst(form) {
    const f = form.querySelector('input,select,textarea');
    f?.focus();
  }
  function buildTable(rows) {
    const table = document.createElement('table');
    table.className = 'table card';
    const thead = document.createElement('thead');
    const tb = document.createElement('tbody');
    const [h, ...rest] = rows;
    const trh = document.createElement('tr');
    h.forEach((c) => { const th = document.createElement('th'); th.textContent = c; trh.appendChild(th); });
    thead.appendChild(trh);
    rest.forEach((r) => {
      const tr = document.createElement('tr');
      r.forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    table.appendChild(thead); table.appendChild(tb); return table;
  }

  /* ------------------ تصدير Excel من السيرفر ------------------ */
  async function exportViaServer(headers, rows, filename) {
    const body = { headers, rows, sheet: 'تقرير', filename, rtl: true };
    const res = await fetch(`${API_BASE}/api/export/xlsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'alsami.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ------------------ النماذج: المحركات/المولدات/القطع ------------------ */
  function renderEngineForm(kind) {
    const map = {
      supply: {
        title: '📥 التوريد (محركات)', store: 'eng_supply',
        fields: [
          () => `<div class="row"><label>اسم الصنف</label><input name="itemName" value="محرك" readonly/></div>`,
          () => formRow('نوع المحرك', 'engineType', 'text', { required: true }),
          () => formRow('مودل المحرك', 'model'),
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('الموقع السابق', 'prevSite'),
          () => formRow('تاريخ التوريد', 'supDate', 'date', { required: true, extra: `value="${iso()}"` }),
          () => formRow('المورد', 'supplier'),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      issue: {
        title: '📤 الصرف (محركات)', store: 'eng_issue',
        fields: [
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('الموقع الحالي', 'currSite'),
          () => formRow('الشخص المستلم', 'receiver'),
          () => formRow('جهة الطلب', 'requester'),
          () => formRow('تاريخ الصرف', 'issueDate', 'date', { required: true, extra: `value="${iso()}"` }),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      rehab: {
        title: '🔧 التأهيل (محركات)', store: 'eng_rehab',
        fields: [
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('المؤهِّل (الفني)', 'rehabber'),
          () => formRow('نوع التأهيل', 'rehabType'),
          () => formRow('تاريخ التأهيل', 'rehabDate', 'date', { required: true, extra: `value="${iso()}"` }),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      check: {
        title: '🧪 الفحص (محركات)', store: 'eng_check',
        fields: [
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('الفاحص', 'inspector'),
          () => formRow('وصف الفحص', 'desc', 'textarea'),
          () => formRow('تاريخ الفحص', 'checkDate', 'date', { required: true, extra: `value="${iso()}"` }),
          () => formRow('ملاحظات الفحص', 'notes', 'textarea'),
        ],
      },
      upload: {
        title: '⬆️ الرفع (محركات)', store: 'eng_upload',
        fields: [
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('رفع المؤهل', 'rehabUp', 'select', { options: ['نعم', 'لا'] }),
          () => formRow('رفع الفحص', 'checkUp', 'select', { options: ['نعم', 'لا'] }),
          () => formRow('تاريخ رفع المؤهل', 'rehabUpDate', 'date', { extra: `value="${iso()}"` }),
          () => formRow('تاريخ رفع الفحص', 'checkUpDate', 'date', { extra: `value="${iso()}"` }),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      lathe: {
        title: '⚙️ المخرطة (محركات)', store: 'eng_lathe',
        fields: [
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('تأهيل/تفاصيل المخرطة', 'lathe', 'textarea'),
          () => formRow('تاريخ التوريد للمخرطة', 'latheDate', 'date', { extra: `value="${iso()}"` }),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      pump: {
        title: '💧 البمبات والنوزلات (محركات)', store: 'eng_pump',
        fields: [
          () => formRow('الرقم التسلسلي للمحرك', 'serial', 'text', { required: true }),
          () => formRow('الرقم التسلسلي للبمب', 'pumpSerial'),
          () => formRow('تأهيل البمب', 'pumpRehab', 'textarea'),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      electrical: {
        title: '⚡ الصريمي (محركات)', store: 'eng_electrical',
        fields: [
          () => formRow('الرقم التسلسلي', 'serial', 'text', { required: true }),
          () => formRow('النوع', 'etype'),
          () => formRow('سلف', 'starter', 'select', { options: ['نعم', 'لا'] }),
          () => formRow('دينمو', 'alternator', 'select', { options: ['نعم', 'لا'] }),
          () => formRow('تاريخ العملية', 'edate', 'date', { extra: `value="${iso()}"` }),
        ],
      },
    };

    const cfg = map[kind];
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    const title = document.createElement('h2'); title.textContent = cfg.title;
    const form = document.createElement('form'); form.className = 'card form'; form.dataset.form = `eng_${kind}`; form.setAttribute('data-smart-submit', '');
    form.innerHTML = cfg.fields.map((f) => f()).join('') + `<div class="actions"><button class="btn primary" type="submit" data-save>حفظ</button></div>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      await saveOp(cfg.store, data, form);
      form.reset(); focusFirst(form);
    });
    wrap.appendChild(title); wrap.appendChild(form);
    show(wrap); wireBack(); focusFirst(form);
  }

  function renderGeneratorForm(kind) {
    const map = {
      supply: {
        title: '📥 التوريد (مولدات)', store: 'gen_supply',
        fields: [
          () => `<div class="row"><label>اسم الصنف</label><input name="itemName" value="مولد" readonly/></div>`,
          () => formRow('نوع المولد', 'gType', 'text', { required: true }),
          () => formRow('مودل المولد', 'model'),
          () => formRow('الترميز (Code)', 'code', 'text', { required: true }),
          () => formRow('الموقع السابق', 'prevSite'),
          () => formRow('تاريخ التوريد', 'supDate', 'date', { required: true, extra: `value="${iso()}"` }),
          () => formRow('اسم المورد', 'supplier'),
          () => formRow('الجهة الموردة', 'vendor'),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      issue: {
        title: '📤 الصرف (مولدات)', store: 'gen_issue',
        fields: [
          () => `<div class="row"><label>اسم الصنف</label><input name="itemName" value="مولد" readonly/></div>`,
          () => formRow('الترميز', 'code', 'text', { required: true }),
          () => formRow('تاريخ الصرف', 'issueDate', 'date', { required: true, extra: `value="${iso()}"` }),
          () => formRow('المستلم', 'receiver'),
          () => formRow('الجهة الطالبة', 'requester'),
          () => formRow('الموقع الحالي', 'currSite'),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
      inspect: {
        title: '🧾 الرفع والفحص (مولدات)', store: 'gen_inspect',
        fields: [
          () => formRow('الترميز', 'code', 'text', { required: true }),
          () => formRow('الفاحص', 'inspector'),
          () => formRow('المؤهل الكهربائي', 'elecRehab'),
          () => formRow('تاريخ التأهيل', 'rehabDate', 'date', { extra: `value="${iso()}"` }),
          () => formRow('رفع المؤهل', 'rehabUp', 'select', { options: ['نعم', 'لا'] }),
          () => formRow('رفع الفحص', 'checkUp', 'select', { options: ['نعم', 'لا'] }),
          () => formRow('ملاحظات', 'notes', 'textarea'),
        ],
      },
    };

    const cfg = map[kind];
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    const title = document.createElement('h2'); title.textContent = cfg.title;
    const form = document.createElement('form'); form.className = 'card form'; form.dataset.form = `gen_${kind}`; form.setAttribute('data-smart-submit', '');
    form.innerHTML = cfg.fields.map((f) => f()).join('') + `<div class="actions"><button class="btn primary" type="submit" data-save>حفظ</button></div>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      await saveOp(cfg.store, data, form);
      form.reset(); focusFirst(form);
    });
    wrap.appendChild(title); wrap.appendChild(form);
    show(wrap); wireBack(); focusFirst(form);
  }

  // قطع الغيار
  function renderSpares() {
    const v = T('sparesTpl');
    const f = v.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f); const data = Object.fromEntries(fd.entries());
      await saveOp('spares', data, f);
      f.reset(); focusFirst(f);
    });
    show(v); wireBack(); focusFirst(f);
  }

  /* ------------------ البحث السردي + Barcode/QR + تصدير ------------------ */
  function drawSimpleQR(canvas, text) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.font = '12px Tajawal'; ctx.textAlign = 'center';
    ctx.fillText('QR', canvas.width / 2, canvas.height / 2);
    ctx.fillText((text || '').slice(0, 16) + '…', canvas.width / 2, canvas.height / 2 + 16);
  }

  async function doSearchAndRender(key) {
    if (!key) return;
    const v = await apiGet(`/api/search/${encodeURIComponent(key)}`);
    const hasEngine = Object.values(v.engines).some((a) => (a || []).length > 0);
    const isEngine = hasEngine;

    const infoBox = document.getElementById('infoList');
    const panel = document.getElementById('searchTwoCols');
    const barcodeSvg = document.getElementById('barcode');
    const qrCanvas = document.getElementById('qrCanvas');

    const latest = (arr) => (arr && arr.length ? arr[0] : null);
    const E = v.engines, G = v.generators;
    let info = [];

    if (isEngine) {
      const s = latest(E.supply), i = latest(E.issue), r = latest(E.rehab),
            c = latest(E.check), u = latest(E.upload), l = latest(E.lathe),
            p = latest(E.pump), e = latest(E.electrical);

      info.push(['الرقم التسلسلي', key]);
      if (s) {
        info.push(['نوع المحرك', s.engineType || '']);
        info.push(['المودل', s.model || '']);
        info.push(['الموقع السابق', s.prevSite || '']);
        info.push(['المورد', s.supplier || '']);
        info.push(['تاريخ التوريد', s.supDate || '']);
        if (s.notes) info.push(['ملاحظات التوريد', s.notes]);
      }
      if (i) {
        info.push(['الموقع الحالي', i.currSite || '']);
        info.push(['المستلم', i.receiver || '']);
        info.push(['جهة الطلب', i.requester || '']);
        info.push(['تاريخ الصرف', i.issueDate || '']);
        if (i.notes) info.push(['ملاحظات الصرف', i.notes]);
      }
      if (r) {
        info.push(['المؤهِّل', r.rehabber || '']);
        info.push(['نوع التأهيل', r.rehabType || '']);
        info.push(['تاريخ التأهيل', r.rehabDate || '']);
        if (r.notes) info.push(['ملاحظات التأهيل', r.notes]);
      }
      if (c) {
        info.push(['الفاحص', c.inspector || '']);
        info.push(['وصف الفحص', c.desc || '']);
        info.push(['تاريخ الفحص', c.checkDate || '']);
        if (c.notes) info.push(['ملاحظات الفحص', c.notes]);
      }
      if (u) {
        info.push(['رفع المؤهل', u.rehabUp || '']);
        info.push(['رفع الفحص', u.checkUp || '']);
        info.push(['تاريخ رفع المؤهل', u.rehabUpDate || '']);
        info.push(['تاريخ رفع الفحص', u.checkUpDate || '']);
        if (u.notes) info.push(['ملاحظات الرفع', u.notes]);
      }
      if (l) {
        info.push(['تفاصيل المخرطة', l.lathe || '']);
        info.push(['تاريخ المخرطة', l.latheDate || '']);
        if (l.notes) info.push(['ملاحظات المخرطة', l.notes]);
      }
      if (p) {
        info.push(['رقم بمب', p.pumpSerial || '']);
        info.push(['تأهيل بمب', p.pumpRehab || '']);
        if (p.notes) info.push(['ملاحظات بمب', p.notes]);
      }
      if (e) {
        info.push(['النوع (كهرباء)', e.etype || '']);
        info.push(['سلف', e.starter || '']);
        info.push(['دينمو', e.alternator || '']);
        info.push(['تاريخ العملية', e.edate || '']);
      }
    } else {
      const s = latest(G.supply), i = latest(G.issue), n = latest(G.inspect);
      info.push(['الترميز', key]);
      if (s) {
        info.push(['نوع المولد', s.gType || '']);
        info.push(['المودل', s.model || '']);
        info.push(['الموقع السابق', s.prevSite || '']);
        info.push(['اسم المورد', s.supplier || '']);
        info.push(['الجهة الموردة', s.vendor || '']);
        info.push(['تاريخ التوريد', s.supDate || '']);
        if (s.notes) info.push(['ملاحظات التوريد', s.notes]);
      }
      if (i) {
        info.push(['تاريخ الصرف', i.issueDate || '']);
        info.push(['المستلم', i.receiver || '']);
        info.push(['الجهة الطالبة', i.requester || '']);
        info.push(['الموقع الحالي', i.currSite || '']);
        if (i.notes) info.push(['ملاحظات الصرف', i.notes]);
      }
      if (n) {
        info.push(['الفاحص', n.inspector || '']);
        info.push(['المؤهل الكهربائي', n.elecRehab || '']);
        info.push(['تاريخ التأهيل', n.rehabDate || '']);
        info.push(['رفع المؤهل', n.rehabUp || '']);
        info.push(['رفع الفحص', n.checkUp || '']);
        if (n.notes) info.push(['ملاحظات', n.notes]);
      }
    }

    infoBox.innerHTML = '';
    info.forEach(([k, v]) => {
      const item = document.createElement('div');
      item.className = 'info-item';
      item.innerHTML = `<div>${k}</div><div>${v || ''}</div>`;
      infoBox.appendChild(item);
    });

    const text = `${isEngine ? 'engine' : 'generator'}:${key}|${location.origin}#/report/${isEngine ? 'engine' : 'generator'}/${encodeURIComponent(key)}`;
    if (window.JsBarcode && barcodeSvg) {
      JsBarcode('#barcode', text, { format: 'code128', displayValue: true, font: 'Tajawal', textMargin: 2, margin: 8, fontSize: 16 });
    }
    if (qrCanvas?.getContext) drawSimpleQR(qrCanvas, text);

    panel.hidden = false;

    const headers = isEngine
      ? ['الرقم التسلسلي', 'نوع المحرك', 'مودل', 'الموقع السابق', 'المورد', 'تاريخ التوريد', 'ملاحظات التوريد', 'الموقع الحالي', 'المستلم', 'جهة الطلب', 'تاريخ الصرف', 'ملاحظات الصرف', 'المؤهل', 'نوع التأهيل', 'تاريخ التأهيل', 'ملاحظات التأهيل', 'الفاحص', 'وصف الفحص', 'تاريخ الفحص', 'ملاحظات الفحص', 'رفع المؤهل', 'رفع الفحص', 'تاريخ رفع المؤهل', 'تاريخ رفع الفحص', 'ملاحظات الرفع', 'تفاصيل المخرطة', 'تاريخ المخرطة', 'ملاحظات المخرطة', 'رقم بمب', 'تأهيل بمب', 'ملاحظات بمب', 'النوع (كهرباء)', 'سلف', 'دينمو', 'تاريخ العملية (كهرباء)']
      : ['الترميز', 'نوع المولد', 'مودل', 'الموقع السابق', 'اسم المورد', 'الجهة الموردة', 'تاريخ التوريد', 'ملاحظات التوريد', 'تاريخ الصرف', 'المستلم', 'الجهة الطالبة', 'الموقع الحالي', 'ملاحظات الصرف', 'الفاحص', 'المؤهل الكهربائي', 'تاريخ التأهيل', 'رفع المؤهل', 'رفع الفحص', 'ملاحظات'];
    const map = {}; info.forEach(([k, v]) => map[k] = v);

    const btnPrint = document.querySelector('[data-print]');
    const btnExport = document.querySelector('[data-export]');
    const btnShare = document.querySelector('[data-share]');

    if (btnPrint) { btnPrint.hidden = false; btnPrint.onclick = () => window.print(); }
    if (btnShare) {
      btnShare.hidden = false;
      btnShare.onclick = () => navigator.clipboard.writeText(text).then(() => toast('تم نسخ رابط التقرير', 'success'));
    }
    if (btnExport) {
      btnExport.hidden = false;
      btnExport.onclick = async () => {
        try {
          const cleanHeaders = Object.keys(map).filter(k => !['id', 'ts'].includes(k));
          await exportViaServer(cleanHeaders, [map], `تقرير_${key}.xlsx`);
          toast('تم تصدير التقرير بنجاح ✅');
        } catch (e) {
          toast('فشل التصدير: ' + e.message, 'error');
          console.error('Export error:', e);
        }
      };
    }
  }

  function renderSearch() {
    const v = T('searchTpl');
    const form = v.querySelector('[data-search-form]');
    const btnScan = v.querySelector('[data-scan]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = form.q.value.trim();
      doSearchAndRender(key).catch((err) => toast('خطأ: ' + err.message, 'error'));
    });
    btnScan.addEventListener('click', () => openScanner((text) => {
      const parsed = parseScanned(text);
      form.q.value = parsed.key || text;
      form.requestSubmit();
    }));
    show(v); wireBack();
    setTimeout(() => form.q.focus(), 50);
  }

  function parseScanned(text) {
    const m = String(text || '').match(/(engine|generator):([^|]+)(?:\|(.+))?/i);
    if (m) return { type: m[1].toLowerCase(), key: m[2], url: m[3] || null };
    return { type: null, key: null, url: null };
  }

  /* ------------------ ماسح ZXing ------------------ */
  let codeReader = null;
  let activeControls = null;

  function bindModalClose() {
    const modal = document.getElementById('scanModal');
    const closeBtn = document.getElementById('closeScan');
    if (closeBtn) closeBtn.onclick = () => stopScanner();
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) stopScanner(); });
    }
  }
  async function openScanner(onDetected) {
    const modal = document.getElementById('scanModal');
    const video = document.getElementById('preview');
    modal?.removeAttribute('hidden'); bindModalClose();

    if (!window.ZXing || !ZXing.BrowserMultiFormatReader) {
      toast('المتصفح لا يدعم الماسح. أدخل الرقم يدويًا.', 'warn');
      return;
    }
    try {
      codeReader = new ZXing.BrowserMultiFormatReader();
      const devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
      if (!devices.length) { toast('لا توجد كاميرات متاحة على هذا الجهاز.', 'error'); return; }
      const rear = devices.find((d) => /back|rear|environment|خلف/i.test(d.label));
      const deviceId = (rear || devices[0]).deviceId;
      activeControls = codeReader.decodeFromVideoDevice(deviceId, video, (result, err, controls) => {
        if (result) {
          const text = result.getText ? result.getText() : String(result);
          controls.stop(); stopScanner(); onDetected(text);
        }
      });
    } catch (e) {
      console.error(e);
      toast('تعذر فتح الكاميرا. تحقّق من الأذونات.', 'error');
    }
  }
  function stopScanner() {
    try { activeControls?.stop?.(); codeReader?.reset?.(); } catch (_) {}
    const modal = document.getElementById('scanModal');
    modal?.setAttribute('hidden', '');
  }

  /* ------------------ آخر 3 ------------------ */
  async function renderLast(kind) {
    const v = T('last3Tpl');
    const title = v.getElementById('lastTitle');
    const host = v.getElementById('lastTable');
    if (kind === 'engines') {
      title.textContent = '📈 آخر 3 محركات';
      const data = await apiGet('/api/last3/engines');
      const rows = [['الرقم التسلسلي', 'الموقع السابق'], ...data.items.map((x) => [x.serial, x.prevSite || ''])];
      host.appendChild(buildTable(rows));
    } else {
      title.textContent = '📈 آخر 3 مولدات';
      const data = await apiGet('/api/last3/generators');
      const rows = [['الترميز', 'الموقع السابق'], ...data.items.map((x) => [x.code, x.prevSite || ''])];
      host.appendChild(buildTable(rows));
    }
    show(v); wireBack();
  }

  /* ------------------ التصدير العام (شهر إلى شهر) ------------------ */
  async function renderExport() {
    const v = T('exportTpl');
    const form = v.querySelector('[data-export-form]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = form.querySelector('[data-save]');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.dataset.old = saveBtn.textContent; saveBtn.textContent = '... تجهيز'; }

      const fd = new FormData(form);
      const type = fd.get('type');
      const from = fd.get('from'); const to = fd.get('to');
      const [y1, m1] = String(from).split('-').map(Number);
      const [y2, m2] = String(to).split('-').map(Number);
      const t1 = new Date(y1, m1 - 1).getTime();
      const t2 = new Date(y2, m2).getTime();

      const recs = await collectByType(type);
      const f = recs.filter((r) => r.ts >= t1 && r.ts < t2);

      const keyField = String(type).startsWith('generators') ? 'code' : 'serial';
      const headers = keyField === 'serial'
        ? ['الرقم التسلسلي', 'نوع المحرك', 'مودل', 'الموقع السابق', 'المورد', 'تاريخ التوريد', 'ملاحظات التوريد', 'الموقع الحالي', 'المستلم', 'جهة الطلب', 'تاريخ الصرف', 'ملاحظات الصرف', 'المؤهل', 'نوع التأهيل', 'تاريخ التأهيل', 'ملاحظات التأهيل', 'الفاحص', 'وصف الفحص', 'تاريخ الفحص', 'ملاحظات الفحص', 'رفع المؤهل', 'رفع الفحص', 'تاريخ رفع المؤهل', 'تاريخ رفع الفحص', 'ملاحظات الرفع', 'تفاصيل المخرطة', 'تاريخ المخرطة', 'ملاحظات المخرطة', 'رقم بمب', 'تأهيل بمب', 'ملاحظات بمب', 'النوع (كهرباء)', 'سلف', 'دينمو', 'تاريخ العملية (كهرباء)']
        : ['الترميز', 'نوع المولد', 'مودل', 'الموقع السابق', 'اسم المورد', 'الجهة الموردة', 'تاريخ التوريد', 'ملاحظات التوريد', 'تاريخ الصرف', 'المستلم', 'الجهة الطالبة', 'الموقع الحالي', 'ملاحظات الصرف', 'الفاحص', 'المؤهل الكهربائي', 'تاريخ التأهيل', 'رفع المؤهل', 'رفع الفحص', 'ملاحظات'];

      const rows = groupByKeyLatest(f, keyField, headers);
      const file = `تصدير_${type}_${from}_${to}.xlsx`;

      try {
        await exportViaServer(headers, rows, file);
        toast('✅ تم إنشاء ملف Excel بنجاح!');
      } catch (e) {
        toast('⚠️ حدث خطأ أثناء التصدير: ' + e.message, 'error');
        console.error('Export failed:', e);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = saveBtn.dataset.old || 'تصدير';
        }
      }
    });
    show(v); wireBack();
  }

  /* ------------------ Helpers للتصدير العام ------------------ */
  function groupByKeyLatest(list, keyField, headers) {
    const map = new Map();
    const merge = (dst, src) => { Object.keys(src).forEach((k) => { if (src[k]) dst[k] = src[k]; }); };
    list.slice().sort((a, b) => a.ts - b.ts).forEach((r) => {
      const k = r[keyField]; if (!k) return;
      if (!map.has(k)) map.set(k, Object.fromEntries(headers.map((h) => [h, ''])));
      const row = map.get(k);
      if (keyField === 'serial') {
        merge(row, {
          'الرقم التسلسلي': r.serial, 'نوع المحرك': r.engineType, 'مودل': r.model, 'الموقع السابق': r.prevSite, 'المورد': r.supplier, 'تاريخ التوريد': r.supDate, 'ملاحظات التوريد': r.notes,
          'الموقع الحالي': r.currSite, 'المستلم': r.receiver, 'جهة الطلب': r.requester, 'تاريخ الصرف': r.issueDate, 'ملاحظات الصرف': r.notes,
          'المؤهل': r.rehabber, 'نوع التأهيل': r.rehabType, 'تاريخ التأهيل': r.rehabDate, 'ملاحظات التأهيل': r.notes,
          'الفاحص': r.inspector, 'وصف الفحص': r.desc, 'تاريخ الفحص': r.checkDate, 'ملاحظات الفحص': r.notes,
          'رفع المؤهل': r.rehabUp, 'رفع الفحص': r.checkUp, 'تاريخ رفع المؤهل': r.rehabUpDate, 'تاريخ رفع الفحص': r.checkUpDate, 'ملاحظات الرفع': r.notes,
          'تفاصيل المخرطة': r.lathe, 'تاريخ المخرطة': r.latheDate, 'ملاحظات المخرطة': r.notes,
          'رقم بمب': r.pumpSerial, 'تأهيل بمب': r.pumpRehab, 'ملاحظات بمب': r.notes,
          'النوع (كهرباء)': r.etype, 'سلف': r.starter, 'دينمو': r.alternator, 'تاريخ العملية (كهرباء)': r.edate
        });
      } else {
        merge(row, {
          'الترميز': r.code, 'نوع المولد': r.gType, 'مودل': r.model, 'الموقع السابق': r.prevSite, 'اسم المورد': r.supplier, 'الجهة الموردة': r.vendor, 'تاريخ التوريد': r.supDate, 'ملاحظات التوريد': r.notes,
          'تاريخ الصرف': r.issueDate, 'المستلم': r.receiver, 'الجهة الطالبة': r.requester, 'الموقع الحالي': r.currSite, 'ملاحظات الصرف': r.notes,
          'الفاحص': r.inspector, 'المؤهل الكهربائي': r.elecRehab, 'تاريخ التأهيل': r.rehabDate, 'رفع المؤهل': r.rehabUp, 'رفع الفحص': r.checkUp, 'ملاحظات': r.notes
        });
      }
    });
    return Array.from(map.values());
  }

  async function collectByType(type) {
    switch (type) {
      case 'engines_all': {
        const s = await all('eng_supply'); const i = await all('eng_issue'); const r = await all('eng_rehab'); const c = await all('eng_check'); const u = await all('eng_upload'); const l = await all('eng_lathe'); const p = await all('eng_pump'); const e = await all('eng_electrical');
        return [...s, ...i, ...r, ...c, ...u, ...l, ...p, ...e];
      }
      case 'generators_all': {
        const s = await all('gen_supply'); const i = await all('gen_issue'); const n = await all('gen_inspect');
        return [...s, ...i, ...n];
      }
      case 'engines_lathe': return await all('eng_lathe');
      case 'engines_electrical': return await all('eng_electrical');
      case 'engines_pump': return await all('eng_pump');
      case 'engines_issue': return await all('eng_issue');
      case 'generators_issue': return await all('gen_issue');
    }
    return [];
  }

  /* ------------------ قوائم رئيسية ------------------ */
  function navHome() {
    const v = T('homeTpl'); wireLinks(v); show(v);
  }

  /* ------------------ الراوتر ------------------ */
  const routes = {
    '#/': navHome,
    '#/engines': () => { const v = T('enginesMenuTpl'); wireLinks(v); show(v); wireBack(); },
    '#/engines/supply': () => renderEngineForm('supply'),
    '#/engines/issue': () => renderEngineForm('issue'),
    '#/engines/rehab': () => renderEngineForm('rehab'),
    '#/engines/check': () => renderEngineForm('check'),
    '#/engines/upload': () => renderEngineForm('upload'),
    '#/engines/lathe': () => renderEngineForm('lathe'),
    '#/engines/pump': () => renderEngineForm('pump'),
    '#/engines/electrical': () => renderEngineForm('electrical'),

    '#/generators': () => { const v = T('generatorsMenuTpl'); wireLinks(v); show(v); wireBack(); },
    '#/generators/supply': () => renderGeneratorForm('supply'),
    '#/generators/issue': () => renderGeneratorForm('issue'),
    '#/generators/inspect': () => renderGeneratorForm('inspect'),

    '#/spares': renderSpares,
    '#/search': renderSearch,
    '#/export': renderExport,
    '#/last-engines': () => renderLast('engines'),
    '#/last-generators': () => renderLast('generators'),
  };

  function router() {
    const h = location.hash || '#/';
    if (h.startsWith('#/report/')) {
      const parts = h.split('/');
      const type = parts[2];
      const key = decodeURIComponent(parts.slice(3).join('/'));
      const v = T('searchTpl');
      v.querySelector('[data-search-form]')?.remove();
      show(v); wireBack();
      doSearchAndRender(key).catch((e) => toast(e.message, 'error'));
      return;
    }
    (routes[h] || navHome)();
  }
  window.addEventListener('hashchange', router);
  router();

  // ضمان الإقلاع للصفحة الرئيسية إن لم يُرسم شيء
  setTimeout(() => { if (!app.children.length) location.hash = '#/'; }, 300);
})();
