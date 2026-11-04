// =====================================================================
// «إضافات أخرى» للعلامات التجارية — ملف مشترك بين الموقع ولوحة المدير
//
// كل علامة تجارية يمكن أن تحمل قائمة اختيارية extras، وكل عنصر فيها:
//   { type: 'location', label: 'اسم الفرع (اختياري)', value: 'رابط خرائط Google' }
//   { type: 'store',    label: '',                     value: 'رابط المتجر الإلكتروني' }
//   { type: 'other',    label: 'اسم المعلومة',          value: 'القيمة' }
// يمكن تكرار أي نوع (عدة فروع، عدة متاجر، عدة معلومات أخرى).
// =====================================================================
(function () {
  const MAX_ITEMS = 20;
  const MAX_LABEL = 60;
  const MAX_VALUE = 500;

  const TYPES = {
    location: { icon: '📍', title: 'موقع المحل', addText: '📍 موقع المحل' },
    store:    { icon: '🛒', title: 'المتجر الإلكتروني', addText: '🛒 موقع المتجر' },
    other:    { icon: '📝', title: 'أخرى', addText: '➕ أخرى' }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // يقبل الروابط التي تبدأ بـ http/https فقط (يمنع javascript: وغيرها).
  // ويضيف https:// تلقائياً لرابط مكتوب بدونها مثل www.example.com أو maps.app.goo.gl/xyz
  function normalizeUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) {
      if (/^[^\s/]+\.[^\s]+/.test(u)) u = 'https://' + u; else return '';
    }
    try {
      const p = new URL(u);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') return '';
      return p.href;
    } catch (e) { return ''; }
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  // تنظيف القائمة قبل الحفظ أو العرض (البيانات قد تأتي من أي زائر)
  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const it of list) {
      if (!it || !TYPES[it.type]) continue;
      const label = String(it.label || '').trim().slice(0, MAX_LABEL);
      let value = String(it.value || '').trim().slice(0, MAX_VALUE);
      if (it.type === 'location' || it.type === 'store') {
        value = normalizeUrl(value);
        if (!value) continue;
      } else {
        if (!label || !value) continue;
      }
      out.push({ type: it.type, label, value });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }

  // -------------------------------------------------------------------
  // المحرّر: أزرار إضافة + صفوف قابلة للحذف
  // -------------------------------------------------------------------
  function createEditor(container) {
    container.classList.add('bx-editor');
    container.innerHTML = `
      <div class="bx-rows"></div>
      <div class="bx-add-btns">
        <button type="button" class="bx-add" data-bx-add="location">${TYPES.location.addText}</button>
        <button type="button" class="bx-add" data-bx-add="store">${TYPES.store.addText}</button>
        <button type="button" class="bx-add" data-bx-add="other">${TYPES.other.addText}</button>
      </div>`;
    const rowsEl = container.querySelector('.bx-rows');

    function addRow(type, data) {
      if (rowsEl.children.length >= MAX_ITEMS) {
        alert('الحد الأقصى ' + MAX_ITEMS + ' إضافة.');
        return;
      }
      data = data || {};
      const row = document.createElement('div');
      row.className = 'bx-row';
      row.dataset.type = type;
      let fields = '';
      if (type === 'location') {
        fields = `
          <input type="text" class="bx-label" maxlength="${MAX_LABEL}" placeholder="اسم الفرع (اختياري) — مثال: فرع الهفوف">
          <input type="text" class="bx-value" inputmode="url" dir="ltr" maxlength="${MAX_VALUE}" placeholder="https://maps.app.goo.gl/...">
          <button type="button" class="bx-geo">📡 استخدم موقعي الحالي</button>`;
      } else if (type === 'store') {
        fields = `
          <input type="text" class="bx-value" inputmode="url" dir="ltr" maxlength="${MAX_VALUE}" placeholder="https://example.com">`;
      } else {
        fields = `
          <input type="text" class="bx-label" maxlength="${MAX_LABEL}" placeholder="اسم المعلومة — مثال: حساب إنستقرام">
          <input type="text" class="bx-value" dir="auto" maxlength="${MAX_VALUE}" placeholder="القيمة — رقم أو رابط أو اسم حساب">`;
      }
      row.innerHTML = `
        <div class="bx-row-head">
          <span class="bx-row-title">${TYPES[type].icon} ${TYPES[type].title}</span>
          <button type="button" class="bx-remove" title="حذف" aria-label="حذف">✕</button>
        </div>
        <div class="bx-fields">${fields}</div>`;
      const lbl = row.querySelector('.bx-label');
      const val = row.querySelector('.bx-value');
      if (lbl) lbl.value = data.label || '';
      if (val) val.value = data.value || '';
      row.querySelector('.bx-remove').addEventListener('click', () => row.remove());
      const geo = row.querySelector('.bx-geo');
      if (geo) geo.addEventListener('click', () => fillCurrentLocation(geo, val));
      rowsEl.appendChild(row);
      if (!data.value && val) (lbl && type === 'other' ? lbl : val).focus();
    }

    container.querySelectorAll('[data-bx-add]').forEach(btn => {
      btn.addEventListener('click', () => addRow(btn.dataset.bxAdd));
    });

    return {
      // يُرجع { values, error } — error نص عربي إن كان هناك صف غير مكتمل أو رابط غير صحيح
      read() {
        const values = [];
        for (const row of rowsEl.querySelectorAll('.bx-row')) {
          const type = row.dataset.type;
          const label = (row.querySelector('.bx-label')?.value || '').trim();
          const raw = (row.querySelector('.bx-value')?.value || '').trim();
          if (!label && !raw) continue; // صف فارغ تماماً: يُتجاهل
          if (type === 'location' || type === 'store') {
            const url = normalizeUrl(raw);
            if (!url) {
              return { values: [], error: 'رابط «' + TYPES[type].title + '» غير صحيح. الصق رابطاً كاملاً يبدأ بـ https:// أو احذف الحقل.' };
            }
            values.push({ type, label: type === 'location' ? label : '', value: url });
          } else {
            if (!label || !raw) {
              return { values: [], error: 'في «أخرى»: اكتب اسم المعلومة وقيمتها معاً، أو احذف الحقل.' };
            }
            values.push({ type, label, value: raw });
          }
        }
        return { values: sanitize(values), error: '' };
      },
      setValues(list) {
        rowsEl.innerHTML = '';
        sanitize(list).forEach(it => addRow(it.type, it));
      },
      clear() { rowsEl.innerHTML = ''; }
    };
  }

  function fillCurrentLocation(btn, input) {
    if (!navigator.geolocation) { alert('متصفحك لا يدعم تحديد الموقع.'); return; }
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ تحديد الموقع...';
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude.toFixed(6), lng = pos.coords.longitude.toFixed(6);
      input.value = 'https://www.google.com/maps?q=' + lat + ',' + lng;
      btn.disabled = false; btn.textContent = original;
    }, () => {
      alert('تعذّر تحديد الموقع. تأكد من السماح للموقع باستخدام موقعك، أو الصق رابط خرائط Google يدوياً.');
      btn.disabled = false; btn.textContent = original;
    }, { enableHighAccuracy: true, timeout: 15000 });
  }

  // -------------------------------------------------------------------
  // العرض: صفوف داخل تفاصيل العلامة (للزوار وللمدير)
  // -------------------------------------------------------------------
  function renderRows(list) {
    const items = sanitize(list);
    if (!items.length) return '';
    const locs = items.filter(i => i.type === 'location');
    return items.map(it => {
      if (it.type === 'location') {
        const name = it.label || (locs.length > 1 ? 'فرع ' + (locs.indexOf(it) + 1) : '');
        return `<div class="biz-detail-row"><span class="biz-detail-label">📍 الموقع</span>
          <span class="bx-val">${name ? `<span class="bx-branch">${esc(name)}</span>` : ''}
          <a class="bx-chip" href="${esc(it.value)}" target="_blank" rel="noopener noreferrer">فتح في الخرائط</a></span></div>`;
      }
      if (it.type === 'store') {
        return `<div class="biz-detail-row"><span class="biz-detail-label">🛒 المتجر</span>
          <span class="bx-val"><a class="bx-chip" href="${esc(it.value)}" target="_blank" rel="noopener noreferrer" dir="ltr">${esc(hostOf(it.value))}</a></span></div>`;
      }
      const url = /^https?:\/\//i.test(it.value) ? normalizeUrl(it.value) : '';
      const valHtml = url
        ? `<a class="bx-chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer" dir="ltr">${esc(hostOf(url))}</a>`
        : `<span class="bx-text" dir="auto">${esc(it.value)}</span>`;
      return `<div class="biz-detail-row"><span class="biz-detail-label">${esc(it.label)}</span><span class="bx-val">${valHtml}</span></div>`;
    }).join('');
  }

  // ملخّص نصي قصير (لسطر في قائمة المدير)
  function summary(list) {
    const items = sanitize(list);
    if (!items.length) return '';
    const n = t => items.filter(i => i.type === t).length;
    const parts = [];
    if (n('location')) parts.push('📍 ' + n('location'));
    if (n('store')) parts.push('🛒 ' + n('store'));
    if (n('other')) parts.push('📝 ' + n('other'));
    return parts.join('  ');
  }

  window.BizExtras = { createEditor, renderRows, summary, sanitize, normalizeUrl };
})();
