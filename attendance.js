// =====================================================================
// تبويب «الحضور» — من حضر اجتماع العائلة ومن لم يحضر
// المصدر: تسليم البطاقات في تبويب «الاستقبال»، المحفوظ في meta/attendance_YYYY-MM-DD
// «لم يحضر» = الأحياء الذين لم يُسجَّل تسليم بطاقتهم في ذلك اليوم.
// يعتمد على دوال لوحة المدير في admin.js.
// =====================================================================
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(String(s == null ? '' : s));
  let dates = [];            // ['2026-11-05', ...] الأحدث أولاً
  let checked = {};          // displayId -> { at(ms), by }
  let view = 'absent', gender = 'all', phoneF = 'all';
  let unsub = null, wired = false, currentRows = [];

  // يحوّل رقم الجوال إلى صيغة واتساب الدولية (05xxxxxxxx → 9665xxxxxxxx)
  function waNumber(phone) {
    let d = String(phone || '').replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660)).replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('966')) return d;
    if (d.startsWith('0')) return '966' + d.slice(1);
    if (d.length === 9 && d.startsWith('5')) return '966' + d;
    return d.length >= 8 ? d : '';
  }
  const fullName = p => [p.firstName].concat(ancestorsOfAdmin(p).map(a => a.firstName)).filter(Boolean).join(' ');
  const fmtDate = d => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  async function loadDates() {
    const sel = $('at-date');
    try {
      const snap = await db.collection('meta').get();
      dates = [];
      snap.forEach(d => { const m = /^attendance_(\d{4}-\d{2}-\d{2})$/.exec(d.id); if (m) dates.push(m[1]); });
    } catch (e) { console.warn('تعذّر قراءة تواريخ الاجتماعات:', e); }
    const today = new Date().toLocaleDateString('en-CA');
    if (!dates.includes(today)) dates.push(today);
    dates.sort().reverse();
    const prev = sel.value;
    sel.innerHTML = dates.map(d => `<option value="${d}">${esc(fmtDate(d))}${d === today ? ' (اليوم)' : ''}</option>`).join('');
    sel.value = prev && dates.includes(prev) ? prev : dates[0];
    listen(sel.value);
  }

  function listen(dateKey) {
    if (unsub) { unsub(); unsub = null; }
    checked = {};
    render();
    unsub = db.collection('meta').doc('attendance_' + dateKey).onSnapshot(snap => {
      const data = snap.exists ? (snap.data().checked || {}) : {};
      checked = {};
      Object.keys(data).forEach(k => {
        const v = data[k] || {};
        checked[k] = { at: v.at && v.at.toDate ? v.at.toDate().getTime() : null, by: v.by || '' };
      });
      render();
    }, err => { console.warn('تعذّر قراءة الحضور:', err); });
  }

  function rowsFor(which) {
    const q = ($('at-search').value || '').trim();
    let list = which === 'present'
      ? allPersonsAdmin.filter(p => checked[p.displayId])
      : allPersonsAdmin.filter(p => p.status !== 'death' && !checked[p.displayId]);
    if (gender !== 'all') list = list.filter(p => p.gender === gender);
    if (phoneF !== 'all') list = list.filter(p => (phoneF === 'yes') === hasPhoneAdmin(p));
    if (q) {
      if (/^\d+$/.test(q)) list = list.filter(p => String(p.displayId) === q);
      else { const t = normalizeArabic(q).split(' ').filter(Boolean).slice(0, 3); list = list.filter(p => p.firstName && matchNameTokensAdmin(p, t)); }
    }
    return which === 'present'
      ? list.sort((a, b) => (checked[a.displayId].at || 0) - (checked[b.displayId].at || 0))
      : list.sort((a, b) => Number(a.displayId) - Number(b.displayId));
  }

  function render() {
    if (!$('at-list')) return;
    const living = allPersonsAdmin.filter(p => p.status !== 'death');
    const present = allPersonsAdmin.filter(p => checked[p.displayId]);
    const absentAll = living.filter(p => !checked[p.displayId]);
    const pct = living.length ? Math.round(present.length * 100 / living.length) : 0;
    const males = present.filter(p => p.gender === 'male').length;
    $('at-stats').innerHTML = `
      <div class="at-stat ok"><b>${present.length}</b><span>حضروا</span></div>
      <div class="at-stat no"><b>${absentAll.length}</b><span>لم يحضروا (من الأحياء)</span></div>
      <div class="at-stat"><b>${pct}%</b><span>نسبة الحضور</span></div>
      <div class="at-stat"><b>${males} / ${present.length - males}</b><span>الحاضرون: ذكور / إناث</span></div>
      <div class="at-bar"><i style="width:${pct}%"></i></div>`;
    $('at-n-absent').textContent = absentAll.length;
    $('at-n-present').textContent = present.length;

    currentRows = rowsFor(view);
    const box = $('at-list');
    if (!currentRows.length) {
      box.innerHTML = `<div class="empty-state">${view === 'present' ? 'لم يُسجَّل حضور أحد في هذا الاجتماع بعد (أو لا يوجد مطابق للتصفية).' : 'لا يوجد غائبون مطابقون للتصفية.'}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="at-count">عرض ${currentRows.length}</div>
      <table class="persons-table at-table">
        <thead><tr><th>المعرّف</th><th>الاسم</th><th>الجنس</th><th>الجوال</th>${view === 'present' ? '<th>وقت الاستلام</th>' : '<th>تواصل</th>'}<th></th></tr></thead>
        <tbody>${currentRows.map(p => {
          const wa = waNumber(p.phone);
          const c = checked[p.displayId];
          return `<tr>
            <td>#${Number(p.displayId)}</td>
            <td><b>${esc(p.firstName)}</b> <span class="pf-lineage">${esc(ancestorsOfAdmin(p, 2).map(a => a.firstName).filter(Boolean).join(' '))}</span></td>
            <td>${esc(GENDER_LABELS_AR[p.gender] || '')}</td>
            <td dir="ltr" style="text-align:right;">${esc(p.phone || '—')}</td>
            ${view === 'present'
              ? `<td>${c && c.at ? esc(new Date(c.at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })) : '—'}</td>`
              : `<td>${wa ? `<a class="at-wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">واتساب</a>` : '<span style="color:var(--muted);">—</span>'}</td>`}
            <td><button type="button" class="btn btn-secondary btn-sm" data-open="${Number(p.displayId)}">فتح في الاستقبال</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      switchTab('reception');
      if (window.Reception && window.Reception.open) window.Reception.open(b.dataset.open);
    }));
  }

  async function exportXlsx(btn) {
    const rows = currentRows;
    if (!rows.length) { alert('لا يوجد أشخاص في القائمة لتصديرهم.'); return; }
    const original = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ التجهيز...';
    try {
      await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const XLSX = window.XLSX;
      const header = ['المعرّف', 'الاسم الكامل', 'الجنس', 'رقم الجوال', view === 'present' ? 'وقت الاستلام' : 'الحالة'];
      const data = rows.map(p => ({
        'المعرّف': p.displayId,
        'الاسم الكامل': fullName(p),
        'الجنس': GENDER_LABELS_AR[p.gender] || '',
        'رقم الجوال': p.phone || '',
        [header[4]]: view === 'present'
          ? (checked[p.displayId] && checked[p.displayId].at ? new Date(checked[p.displayId].at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' }) : '')
          : 'لم يحضر'
      }));
      const ws = XLSX.utils.json_to_sheet(data, { header });
      ws['!cols'] = [{ wch: 8 }, { wch: 40 }, { wch: 7 }, { wch: 15 }, { wch: 14 }];
      ws['!views'] = [{ RTL: true }];
      const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, view === 'present' ? 'الحاضرون' : 'لم يحضروا');
      const d = $('at-date').value;
      XLSX.writeFile(wb, `almajed-attendance_${d}_${view === 'present' ? 'present' : 'absent'}.xlsx`);
      logAdminAction('export', `تصدير قائمة ${view === 'present' ? 'الحاضرين' : 'الغائبين'} لاجتماع ${d} (${rows.length})`);
    } catch (e) { console.error(e); alert('تعذّر إنشاء ملف Excel: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = original; }
  }

  function seg(attr, setter) {
    document.querySelectorAll(`[${attr}]`).forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll(`[${attr}]`).forEach(x => x.classList.toggle('active', x === b));
      setter(b.getAttribute(attr)); render();
    }));
  }

  window.Attendance = {
    onShow() {
      if (!wired) {
        wired = true;
        $('at-date').addEventListener('change', e => listen(e.target.value));
        $('at-search').addEventListener('input', render);
        $('at-export').addEventListener('click', e => exportXlsx(e.currentTarget));
        seg('data-at-view', v => { view = v; });
        seg('data-at-gender', v => { gender = v; });
        seg('data-at-phone', v => { phoneF = v; });
      }
      loadDates();
    },
    onPersonsUpdated() { if ($('tab-panel-attendance') && $('tab-panel-attendance').classList.contains('active')) render(); }
  };
})();
