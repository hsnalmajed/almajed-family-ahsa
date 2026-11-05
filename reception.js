// =====================================================================
// تبويب «الاستقبال» — لاجتماعات العائلة
// عند وصول الشخص: ابحث عنه برقمه أو اسمه، سلّمه بطاقته، وأكمل بياناته وبيانات أسرته:
//   • بياناته: الجوال، الميلاد، الحالة، الزوجات (من العائلة أو من خارجها)، الأم
//   • أبناؤه وبناته (مع تحديد أمّهم)
//   • والده وزوجات والده، وإخوانه وأخواته
// كل تعديل يُحفظ مباشرة في الشجرة (المدير فقط حسب قواعد الحماية) ويُسجَّل في سجل النشاط.
// يعتمد على دوال لوحة المدير في admin.js.
// =====================================================================
(function () {
  let currentId = null;              // المعرّف المعروض حالياً
  let birthPicker = null;
  let attendance = {};               // displayId -> { at, by } لتسليم البطاقات اليوم
  let attendanceUnsub = null;
  // تعديلات الزوجات غير المحفوظة لكل شخص (حتى لا تضيع عند إعادة الرسم)
  const pendingSpouses = {};         // displayId -> { links: [{id,name}], fams: [name] }

  const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD بتوقيت الجهاز
  const attendanceRef = () => db.collection('meta').doc('attendance_' + todayKey());
  const $ = id => document.getElementById(id);
  const byId = id => (typeof personsByDisplayIdAdmin !== 'undefined' ? personsByDisplayIdAdmin[String(id)] : null);
  const fullName = p => [p.firstName].concat(ancestorsOfAdmin(p).map(a => a.firstName)).filter(Boolean).join(' ');
  const shortName = p => [p.firstName].concat(ancestorsOfAdmin(p, 2).map(a => a.firstName)).filter(Boolean).join(' ');
  const fatherOf = p => (p && p.parentKey && /^\d+$/.test(String(p.parentKey))) ? byId(p.parentKey) : null;
  const childrenOf = p => allPersonsAdmin
    .filter(c => String(c.parentKey) === String(p.displayId))
    .sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));
  const isFemale = p => p && p.gender === 'female';
  const esc = s => escapeHtml(String(s == null ? '' : s));

  // ------------------------------------------------------------------
  // البحث عن الأشخاص
  // ------------------------------------------------------------------
  function search(q, opts) {
    opts = opts || {};
    q = String(q || '').trim();
    if (!q) return [];
    let list;
    if (/^\d+$/.test(q)) list = allPersonsAdmin.filter(p => String(p.displayId) === q);
    else {
      const tokens = normalizeArabic(q).split(' ').filter(Boolean).slice(0, 3);
      const rank = p => { const n = normalizeArabic(p.firstName); return n === tokens[0] ? 0 : (n.startsWith(tokens[0]) ? 1 : 2); };
      list = allPersonsAdmin
        .filter(p => p.firstName && matchNameTokensAdmin(p, tokens))
        .sort((a, b) => rank(a) - rank(b) || (Number(a.displayId) - Number(b.displayId)));
    }
    if (opts.gender) list = list.filter(p => p.gender === opts.gender);
    if (opts.exclude) list = list.filter(p => String(p.displayId) !== String(opts.exclude));
    return list.slice(0, opts.limit || 40);
  }

  function renderResults() {
    const box = $('rc-results');
    const q = $('rc-search').value;
    if (!q.trim()) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const list = search(q);
    if (!list.length) {
      box.innerHTML = '<div class="rc-noresult">لا يوجد شخص بهذا الرقم أو الاسم</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = list.map(p => `
      <button type="button" class="rc-item" data-id="${Number(p.displayId)}">
        <img src="${safeImgSrc(p.photoURL, defaultAvatarAdmin(p.gender))}" alt="">
        <span class="rc-item-name"><b>${esc(p.firstName)}</b> ${esc(ancestorsOfAdmin(p, 2).map(a => a.firstName).filter(Boolean).join(' '))}</span>
        ${attendance[p.displayId] ? '<span class="rc-item-done" title="استلم بطاقته">✅</span>' : ''}
        ${p.status === 'death' ? '<span class="rc-item-dead">متوفى</span>' : ''}
        <span class="rc-item-id">${Number(p.displayId)}</span>
      </button>`).join('');
    box.style.display = 'block';
    box.querySelectorAll('.rc-item').forEach(b => b.addEventListener('click', () => select(b.dataset.id)));
  }

  function select(id) {
    if (currentId && String(id) !== currentId) {
      const cur = byId(currentId);
      if (cur && drafts[currentId] && step !== 'done') {
        syncFromDom();
        const n = changesOf(cur, drafts[currentId]).length;
        if (n && !confirm(`لديك ${n} تغيير غير محفوظ لـ ${cur.firstName}.\nسيبقى محفوظاً مؤقتاً وتجده إذا رجعت إليه.\n\nالانتقال إلى الشخص الآخر؟`)) return;
      }
    }
    if (String(id) !== currentId) step = 'self';
    currentId = String(id);
    $('rc-results').style.display = 'none';
    $('rc-search').value = '';
    renderPanel();
    $('rc-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------------
  // محرّر الزوجات/الزوج: كل زوجة إما من العائلة (ربط بمعرّف) أو من خارجها (اسم العائلة)
  // ------------------------------------------------------------------
  function spouseState(p) {
    const k = String(p.displayId);
    if (!pendingSpouses[k]) {
      pendingSpouses[k] = {
        links: (Array.isArray(p.spouseLinks) ? p.spouseLinks : []).map(l => ({ id: Number(l.id), name: l.name || '' })),
        fams: personFamiliesAdmin(p).slice()
      };
    }
    return pendingSpouses[k];
  }

  function spouseEditorHtml(p, key) {
    const female = isFemale(p);
    const st = spouseState(p);
    const total = st.links.length + st.fams.length;
    const full = female && total >= 1;
    const chips = [
      ...st.links.map((l, i) => `<span class="rc-sp-chip in"><button type="button" class="rc-linkname" data-goto="${Number(l.id)}">${esc(l.name || (byId(l.id) ? byId(l.id).firstName : ''))} <i>${Number(l.id)}</i></button><small>من العائلة</small><button type="button" class="rc-x" data-del-link="${i}" aria-label="حذف">✕</button></span>`),
      ...st.fams.map((f, i) => `<span class="rc-sp-chip out">من عائلة <b>${esc(f)}</b><button type="button" class="rc-x" data-del-fam="${i}" aria-label="حذف">✕</button></span>`)
    ].join('');
    return `
      <div class="rc-sp" data-sp="${key}" data-pid="${Number(p.displayId)}">
        <div class="rc-sp-chips">${chips || `<span class="rc-note" style="margin:0;">${female ? 'لا يوجد زوج مسجّل.' : 'لا توجد زوجات مسجّلات.'}</span>`}</div>
        ${full ? '<div class="rc-note">للأنثى زوج واحد فقط. احذف الحالي لتغييره.</div>' : `
        <div class="rc-sp-add">
          <div class="rc-toggle rc-sp-origin">
            <button type="button" data-v="out" class="on">من خارج العائلة</button>
            <button type="button" data-v="in">من عائلة الماجد</button>
          </div>
          <div class="rc-sp-out">
            <input type="text" class="rc-input rc-sp-fam" placeholder="اسم عائلة ${female ? 'الزوج' : 'الزوجة'} — مثال: العفالق">
            <button type="button" class="rc-btn rc-sp-addfam">➕ إضافة</button>
          </div>
          <div class="rc-sp-in" style="display:none;">
            <div class="rc-sp-search-wrap">
              <input type="text" class="rc-input rc-sp-q" placeholder="ابحث عن ${female ? 'الزوج' : 'الزوجة'} بالرقم أو الاسم" autocomplete="off">
              <div class="rc-sp-sug"></div>
            </div>
          </div>
        </div>`}
      </div>`;
  }

  function wireSpouseEditor(root) {
    const p = byId(root.dataset.pid); if (!p) return;
    const st = spouseState(p);
    const rerender = (focusSel) => {
      const tmp = document.createElement('div'); tmp.innerHTML = spouseEditorHtml(p, root.dataset.sp);
      const fresh = tmp.firstElementChild; root.replaceWith(fresh); wireSpouseEditor(fresh);
      refreshMotherSelects();
      if (focusSel) { const el = fresh.querySelector(focusSel); if (el) el.focus(); }
    };
    root.querySelectorAll('[data-del-link]').forEach(b => b.addEventListener('click', () => { st.links.splice(Number(b.dataset.delLink), 1); rerender(); }));
    root.querySelectorAll('[data-del-fam]').forEach(b => b.addEventListener('click', () => { st.fams.splice(Number(b.dataset.delFam), 1); rerender(); }));
    root.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => select(b.dataset.goto)));
    const origin = root.querySelector('.rc-sp-origin');
    if (!origin) return;
    origin.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      origin.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      root.querySelector('.rc-sp-out').style.display = b.dataset.v === 'out' ? '' : 'none';
      root.querySelector('.rc-sp-in').style.display = b.dataset.v === 'in' ? '' : 'none';
      (b.dataset.v === 'in' ? root.querySelector('.rc-sp-q') : root.querySelector('.rc-sp-fam')).focus();
    });
    const famInput = root.querySelector('.rc-sp-fam');
    const addFam = () => {
      const v = famInput.value.trim(); if (!v) { famInput.focus(); return; }
      if (!st.fams.some(f => normalizeArabic(f) === normalizeArabic(v))) st.fams.push(v);
      rerender('.rc-sp-fam');
    };
    root.querySelector('.rc-sp-addfam').addEventListener('click', addFam);
    famInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFam(); } });
    const q = root.querySelector('.rc-sp-q'), sug = root.querySelector('.rc-sp-sug');
    q.addEventListener('input', () => {
      if (!q.value.trim()) { sug.style.display = 'none'; return; }
      const list = search(q.value, { gender: isFemale(p) ? 'male' : 'female', exclude: p.displayId, limit: 12 })
        .filter(x => !st.links.some(l => Number(l.id) === Number(x.displayId)));
      sug.innerHTML = list.length ? list.map(x => `<button type="button" class="rc-item" data-id="${Number(x.displayId)}">
          <span class="rc-item-name"><b>${esc(x.firstName)}</b> ${esc(ancestorsOfAdmin(x, 2).map(a => a.firstName).join(' '))}</span>
          <span class="rc-item-id">${Number(x.displayId)}</span></button>`).join('')
        : '<div class="rc-noresult">لا توجد نتائج</div>';
      sug.style.display = 'block';
      sug.querySelectorAll('.rc-item').forEach(b => b.addEventListener('click', () => {
        const w = byId(b.dataset.id); if (!w) return;
        st.links.push({ id: Number(w.displayId), name: w.firstName || '' }); rerender();
      }));
    });
  }

  // ------------------------------------------------------------------
  // اختيار الأم: من زوجات الأب (المحفوظة أو المعدّلة حالياً)
  // ------------------------------------------------------------------
  function motherOptionsFor(father) {
    if (!father) return [];
    const st = spouseState(father);
    return [
      ...st.links.map(l => {
        const nm = l.name || (byId(l.id) ? byId(l.id).firstName : '');
        return { value: 'id:' + l.id, mid: Number(l.id), mname: nm, label: `${nm} (${l.id}) — من العائلة` };
      }),
      ...st.fams.map(f => ({ value: 'fam:' + f, mid: null, mname: 'من عائلة ' + f, label: 'من عائلة ' + f }))
    ];
  }
  function motherSelectHtml(id, father, curId, curName, emptyLabel) {
    const opts = motherOptionsFor(father);
    let cur = '';
    if (curId != null) cur = 'id:' + curId;
    else if (curName) cur = (opts.find(o => o.mname === curName) || {}).value || '';
    return `<select id="${id}" class="rc-input rc-select" ${opts.length ? '' : 'disabled'} aria-label="الأم">
      <option value="">${esc(opts.length ? (emptyLabel || '— غير محددة —') : 'لا توجد زوجات مسجّلات للأب')}</option>
      ${opts.map(o => `<option value="${esc(o.value)}" data-mid="${o.mid == null ? '' : o.mid}" data-mname="${esc(o.mname)}" ${o.value === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  }
  function readMother(id) {
    const opt = $(id) && $(id).selectedOptions[0];
    if (!opt || !opt.value) return { motherId: null, motherName: '' };
    return { motherId: opt.dataset.mid ? Number(opt.dataset.mid) : null, motherName: opt.dataset.mname || '' };
  }
  function refreshMotherSelects() {
    const p = byId(currentId); if (!p) return;
    const father = fatherOf(p);
    [['rc-mother', father, '— غير محددة —'], ['rc-sib-mother', father, 'الأم غير محددة'], ['rc-kid-mother', isFemale(p) ? null : p, 'الأم غير محددة']].forEach(([id, f, lbl]) => {
      const el = $(id); if (!el) return;
      const keep = el.value;
      const tmp = document.createElement('div'); tmp.innerHTML = motherSelectHtml(id, f, null, '', lbl);
      const fresh = tmp.firstElementChild;
      if (keep && Array.from(fresh.options).some(o => o.value === keep)) fresh.value = keep;
      el.replaceWith(fresh);
    });
    updatePendingBadge();
  }

  // ------------------------------------------------------------------
  // لوحة الشخص — خطوات متتالية ومسودة واحدة تُحفظ مرة واحدة في النهاية
  // ------------------------------------------------------------------
  const drafts = {};          // displayId -> مسودة التعديلات غير المحفوظة
  let step = 'self';          // الخطوة الحالية
  let saving = false;

  function missingHints(p) {
    const out = [];
    if (!hasPhoneAdmin(p)) out.push('📞 بدون رقم جوال');
    if (!hasBirthAdmin(p)) out.push('🎂 بدون تاريخ ميلاد');
    if (isMarriedAdmin(p) && !personFamiliesAdmin(p).length && !(p.spouseLinks || []).length) {
      out.push(isFemale(p) ? '💍 الزوج غير مسجّل' : '💍 الزوجة غير مسجّلة');
    }
    if (fatherOf(p) && p.motherId == null && !p.motherName) out.push('👩 الأم غير محددة');
    if (isMarriedAdmin(p) && !isFemale(p) && !childrenOf(p).length) out.push('👶 لا يوجد أبناء مسجّلون');
    return out;
  }

  function kidChips(list) {
    return list.map(k => `<button type="button" class="rc-chip" data-goto="${Number(k.displayId)}">${k.gender === 'female' ? '👧' : '👦'} ${esc(k.firstName)} <i>${Number(k.displayId)}</i>${k.status === 'death' ? ' <small>(متوفى)</small>' : ''}</button>`).join('');
  }

  // قيمة الأم الحالية بصيغة القائمة: id:رقم أو fam:اسم العائلة
  function motherValueOf(p, father) {
    if (p.motherId != null && p.motherId !== '') return 'id:' + Number(p.motherId);
    if (p.motherName) { const o = motherOptionsFor(father).find(x => x.mname === p.motherName); return o ? o.value : ''; }
    return '';
  }
  function resolveMother(father, val) {
    if (!val) return { motherId: null, motherName: '' };
    const o = motherOptionsFor(father).find(x => x.value === val);
    if (o) return { motherId: o.mid, motherName: o.mname };
    if (val.startsWith('id:')) { const w = byId(val.slice(3)); return { motherId: Number(val.slice(3)), motherName: w ? w.firstName : '' }; }
    return { motherId: null, motherName: 'من عائلة ' + val.slice(4) };
  }
  function motherLabel(father, val) {
    if (!val) return 'الأم غير محددة';
    const o = motherOptionsFor(father).find(x => x.value === val);
    return o ? o.label : resolveMother(father, val).motherName;
  }

  function draftOf(p) {
    const k = String(p.displayId);
    if (!drafts[k]) {
      const f = fatherOf(p);
      const sst = spouseState(p);
      drafts[k] = {
        phone: String(p.phone || ''),
        birth: (p.birthDate || p.birthDateHijri) ? { birthDate: p.birthDate || '', birthDateHijri: p.birthDateHijri || '', birthDateCal: p.birthDateCal || '' } : null,
        status: p.status === 'death' ? 'death' : 'alive',
        married: isMarriedAdmin(p) || sst.links.length + sst.fams.length > 0,
        mother: motherValueOf(p, f),
        kids: [], sibs: [],
        fPhone: f ? String(f.phone || '') : '',
        fStatus: f && f.status === 'death' ? 'death' : 'alive',
        checkin: true
      };
    }
    return drafts[k];
  }

  function stepsFor(p, d) {
    const female = isFemale(p), father = fatherOf(p);
    const s = [{ key: 'self', label: 'بياناته', ico: '📝' }];
    if (d.married) s.push({ key: 'family', label: female ? 'زوجها' : 'زوجاته وأبناؤه', ico: female ? '💍' : '👨‍👩‍👧' });
    if (father) { s.push({ key: 'father', label: 'والده', ico: '👤' }); s.push({ key: 'sibs', label: 'أمه وإخوته', ico: '👪' }); }
    s.push({ key: 'review', label: 'مراجعة وحفظ', ico: '💾' });
    return s;
  }

  // يقرأ كل ما في الخطوة المعروضة إلى المسودة
  function syncFromDom() {
    const p = currentId ? byId(currentId) : null; if (!p || !drafts[String(p.displayId)]) return;
    const d = drafts[String(p.displayId)];
    const on = id => { const b = $(id) && $(id).querySelector('.on'); return b ? b.dataset.v : null; };
    if ($('rc-phone')) d.phone = $('rc-phone').value.trim();
    if (birthPicker && $('rc-birth-mount')) { const v = birthPicker.getValue(); d.birth = v && (v.birthDate || v.birthDateHijri) ? v : d.birth; }
    if (on('rc-status')) d.status = on('rc-status');
    if (on('rc-marital')) d.married = on('rc-marital') === 'married';
    if ($('rc-mother')) d.mother = $('rc-mother').value;
    if ($('rc-father-phone')) d.fPhone = $('rc-father-phone').value.trim();
    if (on('rc-father-status')) d.fStatus = on('rc-father-status');
    if ($('rc-do-checkin')) d.checkin = $('rc-do-checkin').checked;
  }

  // قائمة التغييرات مقارنةً بالبيانات المحفوظة
  function changesOf(p, d) {
    const out = [];
    const female = isFemale(p), father = fatherOf(p);
    const sst = spouseState(p);
    if (d.phone !== String(p.phone || '')) out.push({ g: 'self', t: `الجوال: ${d.phone || '(حذف الرقم)'}` });
    if (d.birth && d.birth.birthDate && d.birth.birthDate !== (p.birthDate || '')) out.push({ g: 'self', t: 'تاريخ الميلاد: ' + (window.Birthdate && Birthdate.formatBoth ? Birthdate.formatBoth(d.birth) : d.birth.birthDate) });
    if (d.status !== (p.status === 'death' ? 'death' : 'alive')) out.push({ g: 'self', t: 'الحالة: ' + (d.status === 'death' ? (female ? 'متوفاة' : 'متوفى') : 'على قيد الحياة') });
    if (d.married !== isMarriedAdmin(p)) out.push({ g: 'self', t: 'الحالة الاجتماعية: ' + (d.married ? (female ? 'متزوجة' : 'متزوج') : (female ? 'غير متزوجة' : 'غير متزوج')) });
    const newSp = d.married ? describeSpouses(sst.links, sst.fams) : '';
    if (newSp !== describeSpouses(Array.isArray(p.spouseLinks) ? p.spouseLinks : [], personFamiliesAdmin(p))) out.push({ g: 'self', t: (female ? 'الزوج: ' : 'الزوجات: ') + (newSp || '—') });
    if (father && d.mother !== motherValueOf(p, father)) out.push({ g: 'self', t: 'الأم: ' + motherLabel(father, d.mother) });
    d.kids.forEach(k => out.push({ g: 'kids', t: `إضافة ${k.gender === 'female' ? 'ابنة' : 'ابن'}: ${k.name}${k.mother ? ' — ' + motherLabel(p, k.mother) : ''}` }));
    if (father) {
      const fst = spouseState(father);
      if (d.fPhone !== String(father.phone || '')) out.push({ g: 'father', t: `جوال الأب: ${d.fPhone || '(حذف الرقم)'}` });
      if (d.fStatus !== (father.status === 'death' ? 'death' : 'alive')) out.push({ g: 'father', t: 'حالة الأب: ' + (d.fStatus === 'death' ? 'متوفى' : 'على قيد الحياة') });
      const fNew = describeSpouses(fst.links, fst.fams);
      if (fNew !== describeSpouses(Array.isArray(father.spouseLinks) ? father.spouseLinks : [], personFamiliesAdmin(father))) out.push({ g: 'father', t: 'زوجات الأب: ' + (fNew || '—') });
      d.sibs.forEach(k => out.push({ g: 'sibs', t: `إضافة ${k.gender === 'female' ? 'أخت' : 'أخ'}: ${k.name}${k.mother ? ' — ' + motherLabel(father, k.mother) : ''}` }));
    }
    return out;
  }

  function queuedChips(list, father, kind) {
    return list.map((k, i) => `<span class="rc-chip rc-chip-new">${k.gender === 'female' ? '👧' : '👦'} ${esc(k.name)} <small>${esc(k.mother ? motherLabel(father, k.mother) : 'جديد')}</small><button type="button" class="rc-x" data-del-${kind}="${i}" aria-label="حذف">✕</button></span>`).join('');
  }

  function addRowHtml(prefix, placeholder, mLabel, fLabel, father, defMother) {
    const opts = motherOptionsFor(father);
    return `
      <div class="rc-addrow">
        <input type="text" id="${prefix}-name" class="rc-input" placeholder="${placeholder}" autocomplete="off">
        <div class="rc-toggle" id="${prefix}-gender">
          <button type="button" data-v="male" class="on">${mLabel}</button>
          <button type="button" data-v="female">${fLabel}</button>
        </div>
        ${motherSelectHtml(prefix + '-mother', father, null, '', 'الأم غير محددة')}
        <button type="button" class="rc-btn rc-btn-primary" id="${prefix}-add">➕ أضف للقائمة</button>
      </div>
      ${opts.length > 1 ? '<div class="rc-note">له أكثر من زوجة — اختر أمّ كل واحد قبل إضافته.</div>' : ''}
      ${defMother ? `<script type="text/x-default" data-for="${prefix}-mother">${esc(defMother)}</script>` : ''}`;
  }

  function stepHtml(p, d, key) {
    const female = isFemale(p), father = fatherOf(p), name = esc(p.firstName);
    if (key === 'self') return `
      <h3>📝 بيانات ${name}</h3>
      <div class="rc-form">
        <div class="rc-field"><label class="rc-label" for="rc-phone">رقم الجوال</label>
          <input type="tel" id="rc-phone" class="rc-input" dir="ltr" placeholder="05xxxxxxxx" value="${esc(d.phone)}"></div>
        <div class="rc-field"><label class="rc-label">الحالة</label>
          <div class="rc-toggle" id="rc-status">
            <button type="button" data-v="alive" class="${d.status === 'death' ? '' : 'on'}">على قيد الحياة</button>
            <button type="button" data-v="death" class="${d.status === 'death' ? 'on' : ''}">${female ? 'متوفاة' : 'متوفى'}</button>
          </div></div>
        <div class="rc-field rc-field-wide"><label class="rc-label">تاريخ الميلاد</label><div id="rc-birth-mount"></div></div>
        <div class="rc-field"><label class="rc-label">الحالة الاجتماعية</label>
          <div class="rc-toggle" id="rc-marital">
            <button type="button" data-v="single" class="${d.married ? '' : 'on'}">${female ? 'غير متزوجة' : 'غير متزوج'}</button>
            <button type="button" data-v="married" class="${d.married ? 'on' : ''}">${female ? 'متزوجة' : 'متزوج'}</button>
          </div>
          <div class="rc-note" id="rc-marital-note">${d.married ? `في الخطوة التالية: ${female ? 'الزوج' : 'الزوجات والأبناء'}.` : ''}</div></div>
      </div>`;

    if (key === 'family') {
      if (female) return `
        <h3>💍 زوج ${name}</h3>
        <div class="rc-note" style="margin-top:0;">إذا كان من عائلة الماجد ابحث عنه بالاسم أو الرقم ليتم الربط بينهما، وإلا اكتب اسم عائلته.</div>
        ${spouseEditorHtml(p, 'self')}`;
      const kids = childrenOf(p);
      return `
        <h3>💍 زوجات ${name} <small>(يمكن إضافة أكثر من زوجة)</small></h3>
        ${spouseEditorHtml(p, 'self')}
        <h3 class="rc-h-gap">👨‍👩‍👧 أبناء ${name} وبناته <small>(${kids.length + d.kids.length})</small></h3>
        <div class="rc-kids">${kidChips(kids)}${queuedChips(d.kids, p, 'kid')}${kids.length + d.kids.length ? '' : '<span class="rc-note" style="margin:0;">لا يوجد أبناء مسجّلون بعد.</span>'}</div>
        ${addRowHtml('rc-kid', 'اسم الابن أو البنت', 'ابن', 'ابنة', p, '')}`;
    }

    if (key === 'father') {
      const fst = spouseState(father);
      return `
        <h3>👤 والد ${name}: <button type="button" class="rc-chip" data-goto="${Number(father.displayId)}">${esc(shortName(father))} <i>${Number(father.displayId)}</i></button></h3>
        <div class="rc-form">
          <div class="rc-field"><label class="rc-label">حالة الأب</label>
            <div class="rc-toggle" id="rc-father-status">
              <button type="button" data-v="alive" class="${d.fStatus === 'death' ? '' : 'on'}">على قيد الحياة</button>
              <button type="button" data-v="death" class="${d.fStatus === 'death' ? 'on' : ''}">متوفى</button>
            </div></div>
          <div class="rc-field" id="rc-father-phone-wrap" style="${d.fStatus === 'death' ? 'display:none;' : ''}"><label class="rc-label" for="rc-father-phone">جوال الأب</label>
            <input type="tel" id="rc-father-phone" class="rc-input" dir="ltr" placeholder="05xxxxxxxx" value="${esc(d.fPhone)}"></div>
        </div>
        <h3 class="rc-h-gap">💍 زوجات الأب <small>(${fst.links.length + fst.fams.length})</small></h3>
        <div class="rc-note" style="margin-top:0;">أضِف كل زوجاته (من العائلة بالبحث، أو من خارجها باسم العائلة) — ستختار منهنّ أمّ ${name} وإخوته في الخطوة التالية.</div>
        ${spouseEditorHtml(father, 'father')}`;
    }

    if (key === 'sibs') {
      const siblings = childrenOf(father).filter(s => String(s.displayId) !== String(p.displayId));
      return `
        <h3>👩 أم ${name}</h3>
        ${motherSelectHtml('rc-mother', father, null, '', '— غير محددة —')}
        <div class="rc-note">القائمة من زوجات الأب ${esc(father.firstName)}. إن لم تجدها فارجع للخطوة السابقة وأضِفها.</div>
        <h3 class="rc-h-gap">👪 إخوان ${name} وأخواته <small>(${siblings.length + d.sibs.length})</small></h3>
        <div class="rc-kids">${kidChips(siblings)}${queuedChips(d.sibs, father, 'sib')}${siblings.length + d.sibs.length ? '' : '<span class="rc-note" style="margin:0;">لا يوجد إخوة مسجّلون.</span>'}</div>
        ${addRowHtml('rc-sib', 'اسم الأخ أو الأخت', 'أخ', 'أخت', father, d.mother)}`;
    }

    // المراجعة
    const ch = changesOf(p, d);
    const groups = [['self', `📝 ${name}`], ['kids', '👨‍👩‍👧 الأبناء الجدد'], ['father', '👤 الأب'], ['sibs', '👪 الإخوة الجدد']];
    const checked = !!attendance[p.displayId];
    return `
      <h3>💾 مراجعة التغييرات قبل الحفظ</h3>
      ${ch.length ? groups.filter(([g]) => ch.some(c => c.g === g)).map(([g, title]) => `
        <div class="rc-rev-group"><div class="rc-rev-title">${title}</div>
          <ul>${ch.filter(c => c.g === g).map(c => `<li>${esc(c.t)}</li>`).join('')}</ul></div>`).join('')
        : '<div class="rc-empty-mini">لا توجد تغييرات بعد. ارجع للخطوات السابقة لإضافة البيانات.</div>'}
      ${checked ? '<div class="rc-note">✅ استلم بطاقته مسبقاً اليوم.</div>' : `
      <label class="rc-check"><input type="checkbox" id="rc-do-checkin" ${d.checkin ? 'checked' : ''}> تسجيل تسليم البطاقة الآن (حضور الاجتماع)</label>`}
      <button type="button" class="rc-btn rc-btn-primary rc-save" id="rc-save-all" ${ch.length || !checked ? '' : 'disabled'}>💾 حفظ الكل${checked ? '' : ' وتسليم البطاقة'}</button>
      <div class="rc-note" style="text-align:center;">كل ما يُحفظ هنا يظهر في شجرة العائلة مباشرة.</div>`;
  }

  function renderPanel() {
    const panel = $('rc-panel');
    const p = currentId ? byId(currentId) : null;
    if (!p) return;
    const female = isFemale(p);
    const hints = missingHints(p);
    const head = `
      <div class="rc-person">
        <img class="rc-photo" src="${safeImgSrc(p.photoURL, defaultAvatarAdmin(p.gender))}" alt="">
        <div class="rc-person-info">
          <div class="rc-name">${esc(fullName(p))}</div>
          <div class="rc-meta">
            <span class="rc-id">${Number(p.displayId)}</span>
            <span>${female ? 'أنثى' : 'ذكر'}</span>
            <span>${p.status === 'death' ? (female ? 'متوفاة' : 'متوفى') : 'على قيد الحياة'}</span>
            <span>${isMarriedAdmin(p) ? (female ? 'متزوجة' : 'متزوج') : (female ? 'غير متزوجة' : 'غير متزوج')}</span>
          </div>
          ${hints.length
            ? `<div class="rc-hints">${hints.map(h => `<span class="rc-hint">${h}</span>`).join('')}</div>`
            : '<div class="rc-hints"><span class="rc-hint ok">✔ البيانات الأساسية مكتملة</span></div>'}
        </div>
      </div>
      <div class="rc-actions">
        <button type="button" class="rc-btn" id="rc-checkin"></button>
        <button type="button" class="rc-btn" id="rc-print">🖨️ طباعة بطاقته</button>
        <button type="button" class="rc-btn" id="rc-full-edit">✏️ تعديل كامل</button>
      </div>`;

    if (step === 'done') {
      panel.innerHTML = head + `
        <div class="rc-box rc-done">
          <div class="rc-done-ico">✅</div>
          <div><b>تم حفظ كل التغييرات</b></div>
          <div class="rc-note">ظهرت الآن في شجرة العائلة.</div>
          <div class="rc-done-actions">
            <button type="button" class="rc-btn rc-btn-primary" id="rc-next-person">🔍 الشخص التالي</button>
            <button type="button" class="rc-btn" id="rc-continue">✏️ متابعة تعديل ${esc(p.firstName)}</button>
          </div>
        </div>`;
      wireHead(p);
      $('rc-next-person').addEventListener('click', () => { currentId = null; $('rc-panel').innerHTML = ''; $('rc-search').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      $('rc-continue').addEventListener('click', () => { step = 'self'; renderPanel(); });
      return;
    }

    const d = draftOf(p);
    const steps = stepsFor(p, d);
    if (!steps.some(s => s.key === step)) step = 'self';
    const idx = steps.findIndex(s => s.key === step);
    const nCh = changesOf(p, d).length;

    panel.innerHTML = head + `
      <nav class="rc-steps" aria-label="خطوات الإدخال">
        ${steps.map((s, i) => `<button type="button" class="rc-step${i === idx ? ' on' : ''}${i < idx ? ' done' : ''}" data-step="${s.key}">
          <span class="rc-step-n">${i < idx ? '✓' : i + 1}</span><span class="rc-step-l">${s.label}</span></button>`).join('')}
      </nav>
      <section class="rc-box rc-stepbox" id="rc-stepbox">${stepHtml(p, d, step)}</section>
      <div class="rc-nav">
        <button type="button" class="rc-btn" id="rc-prev" ${idx === 0 ? 'disabled' : ''}>→ السابق</button>
        <button type="button" class="rc-pending${nCh ? '' : ' none'}" id="rc-pending">${nCh ? `${nCh} تغيير غير محفوظ` : 'لا تغييرات'}</button>
        ${step === 'review' ? '<span></span>' : `<button type="button" class="rc-btn rc-btn-primary" id="rc-next">التالي: ${steps[idx + 1].label} ←</button>`}
      </div>`;

    wireHead(p);
    wireStep(p, d);
    panel.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => go(b.dataset.step)));
    $('rc-prev').addEventListener('click', () => go(steps[idx - 1].key));
    if ($('rc-next')) $('rc-next').addEventListener('click', () => go(steps[idx + 1].key));
    $('rc-pending').addEventListener('click', () => go('review'));
  }

  function go(key) {
    syncFromDom();
    step = key;
    renderPanel();
    const box = $('rc-steps-anchor') || document.querySelector('.rc-steps');
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const first = document.querySelector('#rc-stepbox input[type=text], #rc-stepbox input[type=tel]');
    if (first && key !== 'review' && window.matchMedia('(min-width: 861px)').matches) first.focus();
  }

  function wireHead(p) {
    $('rc-checkin').addEventListener('click', toggleCheckin);
    $('rc-print').addEventListener('click', () => printCard(p));
    $('rc-full-edit').addEventListener('click', () => openAdminEditModal(p));
    updateCheckinButton();
  }

  function updatePendingBadge() {
    const p = byId(currentId); const el = $('rc-pending'); if (!p || !el || !drafts[String(p.displayId)]) return;
    syncFromDom();
    const n = changesOf(p, drafts[String(p.displayId)]).length;
    el.textContent = n ? `${n} تغيير غير محفوظ` : 'لا تغييرات';
    el.classList.toggle('none', !n);
  }

  function wireStep(p, d) {
    const box = $('rc-stepbox');
    if ($('rc-birth-mount')) {
      birthPicker = window.Birthdate ? window.Birthdate.create('rc-birth-mount') : null;
      if (birthPicker && d.birth) birthPicker.setValue(d.birth);
      $('rc-birth-mount').addEventListener('change', updatePendingBadge);
      $('rc-birth-mount').addEventListener('click', () => setTimeout(updatePendingBadge, 0));
    } else birthPicker = null;
    box.querySelectorAll('.rc-toggle:not(.rc-sp-origin)').forEach(t => t.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      t.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (t.id === 'rc-marital') { syncFromDom(); renderPanel(); return; }
      if (t.id === 'rc-father-status' && $('rc-father-phone-wrap')) $('rc-father-phone-wrap').style.display = b.dataset.v === 'death' ? 'none' : '';
      updatePendingBadge();
    }));
    box.querySelectorAll('input[type=tel], select').forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', updatePendingBadge));
    box.querySelectorAll('.rc-sp').forEach(wireSpouseEditor);
    box.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => select(b.dataset.goto)));
    if ($('rc-mother')) {
      const sel = $('rc-mother');
      if (d.mother && !Array.from(sel.options).some(o => o.value === d.mother)) {
        const o = document.createElement('option'); o.value = d.mother; o.textContent = resolveMother(fatherOf(p), d.mother).motherName || 'الأم الحالية';
        const m = resolveMother(fatherOf(p), d.mother); o.dataset.mid = m.motherId == null ? '' : m.motherId; o.dataset.mname = m.motherName;
        sel.appendChild(o); sel.disabled = false;
      }
      sel.value = d.mother;
      // أم الإخوة الجدد افتراضياً = نفس أمه
      sel.addEventListener('change', () => { const sm = $('rc-sib-mother'); if (sm && Array.from(sm.options).some(o => o.value === sel.value)) sm.value = sel.value; });
    }
    box.querySelectorAll('script[type="text/x-default"]').forEach(s => { const sel = $(s.dataset.for); if (sel && Array.from(sel.options).some(o => o.value === s.textContent)) sel.value = s.textContent; });
    box.querySelectorAll('[data-del-kid]').forEach(b => b.addEventListener('click', () => { d.kids.splice(Number(b.dataset.delKid), 1); syncFromDom(); renderPanel(); }));
    box.querySelectorAll('[data-del-sib]').forEach(b => b.addEventListener('click', () => { d.sibs.splice(Number(b.dataset.delSib), 1); syncFromDom(); renderPanel(); }));
    if ($('rc-kid-add')) wireQueue('rc-kid', p, d.kids);
    if ($('rc-sib-add')) wireQueue('rc-sib', fatherOf(p), d.sibs);
    if ($('rc-save-all')) $('rc-save-all').addEventListener('click', saveAll);
    if ($('rc-do-checkin')) $('rc-do-checkin').addEventListener('change', () => {
      d.checkin = $('rc-do-checkin').checked;
      const n = changesOf(p, d).length; const b = $('rc-save-all');
      b.disabled = !n && !d.checkin; b.textContent = '💾 حفظ الكل' + (d.checkin ? ' وتسليم البطاقة' : '');
    });
  }

  // إضافة ابن/أخ إلى القائمة (لا يُحفظ إلا مع «حفظ الكل»)
  function wireQueue(prefix, parent, list) {
    const add = () => {
      const nameEl = $(prefix + '-name'); const name = nameEl.value.trim();
      if (!name) { nameEl.focus(); return; }
      if (list.some(k => normalizeArabic(k.name) === normalizeArabic(name))) { alert('هذا الاسم موجود في القائمة.'); return; }
      if (!confirmNotDuplicateAdmin(String(parent.displayId), name)) return;
      const gender = $(prefix + '-gender').querySelector('.on')?.dataset.v === 'female' ? 'female' : 'male';
      const mother = $(prefix + '-mother') ? $(prefix + '-mother').value : '';
      list.push({ name, gender, mother });
      syncFromDom(); renderPanel();
      const fresh = $(prefix + '-name'); if (fresh) fresh.focus();
      const g = $(prefix + '-gender'); if (g) g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === gender));
      const m = $(prefix + '-mother'); if (m && Array.from(m.options).some(o => o.value === mother)) m.value = mother;
    };
    $(prefix + '-add').addEventListener('click', add);
    $(prefix + '-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }

  // ------------------------------------------------------------------
  // الحفظ — كل التغييرات مرة واحدة
  // ------------------------------------------------------------------
  // الربط التبادلي: إضافة/إزالة هذا الشخص من سجلّ الزوجة المرتبطة من العائلة
  async function syncReciprocal(person, oldLinks, newLinks) {
    const oldIds = new Set(oldLinks.map(l => Number(l.id)));
    const newIds = new Set(newLinks.map(l => Number(l.id)));
    const added = newLinks.filter(l => !oldIds.has(Number(l.id)));
    const removed = oldLinks.filter(l => !newIds.has(Number(l.id)));
    if (added.length) await applyReciprocalSpouse(person.displayId, person.firstName, added);
    for (const l of removed) {
      const w = byId(l.id); if (!w) continue;
      const rest = (Array.isArray(w.spouseLinks) ? w.spouseLinks : []).filter(s => Number(s.id) !== Number(person.displayId));
      try { await db.collection('persons').doc(w.id).update({ spouseLinks: rest }); } catch (e) { console.error('تعذّر فك الربط', e); }
    }
  }

  function describeSpouses(links, fams) {
    return [...links.map(l => `${l.name || ''} (#${l.id})`), ...fams.map(f => 'من ' + f)].join('، ');
  }

  async function createPerson(name, gender, parent, mother) {
    let createdId = null;
    const counterRef = db.collection('meta').doc('counter');
    await db.runTransaction(async tx => {
      const snap = await tx.get(counterRef);
      const newId = (snap.exists ? (snap.data().lastId || 0) : 0) + 1;
      createdId = newId;
      const ref = db.collection('persons').doc();
      setPrivatePhone(tx, ref.id, '');
      tx.set(ref, {
        displayId: newId, firstName: name, gender, phoneLast4: '', birthDate: '', birthDateHijri: '', birthDateCal: '',
        status: 'alive', photoURL: '', maritalStatus: 'single', spouseFamilies: [], spouseLinks: [],
        motherId: mother.motherId, motherName: mother.motherName, parentKey: String(parent.displayId),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.set(counterRef, { lastId: newId }, { merge: true });
    });
    return createdId;
  }

  async function saveAll() {
    syncFromDom();
    const p = byId(currentId); if (!p) return;
    const d = draftOf(p), father = fatherOf(p), female = isFemale(p);
    const ch = changesOf(p, d);
    const btn = $('rc-save-all');
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    saving = true;
    try {
      // تُحسب الأمهات قبل الحفظ (من الزوجات كما هي في المسودة)
      const selfMother = father ? resolveMother(father, d.mother) : null;
      const kids = d.kids.map(k => ({ ...k, m: resolveMother(p, k.mother) }));
      const sibs = d.sibs.map(k => ({ ...k, m: resolveMother(father, k.mother) }));

      // 1) الأب
      if (father && ch.some(c => c.g === 'father')) {
        const fst = spouseState(father);
        const links = fst.links.slice(), fams = fst.fams.slice();
        const oldLinks = Array.isArray(father.spouseLinks) ? father.spouseLinks : [];
        const upd = { spouseLinks: links, spouseFamilies: fams, status: d.fStatus, phoneLast4: phoneLast4Of(d.fPhone), phone: firebase.firestore.FieldValue.delete() };
        if (links.length + fams.length > 0) upd.maritalStatus = 'married';
        const batch = db.batch();
        batch.update(db.collection('persons').doc(father.id), upd);
        setPrivatePhone(batch, father.id, d.fPhone);
        await batch.commit();
        await syncReciprocal(father, oldLinks, links);
        delete pendingSpouses[String(father.displayId)];
        logAdminAction('edit', `الاستقبال: تحديث بيانات الأب ${father.firstName || ''} (#${father.displayId}) — ${ch.filter(c => c.g === 'father').map(c => c.t).join('، ')}`);
      }

      // 2) الشخص نفسه
      if (ch.some(c => c.g === 'self')) {
        const st = spouseState(p);
        const links = d.married ? st.links.slice() : [];
        const fams = d.married ? st.fams.slice() : [];
        const oldLinks = Array.isArray(p.spouseLinks) ? p.spouseLinks : [];
        const upd = {
          phoneLast4: phoneLast4Of(d.phone), status: d.status,
          maritalStatus: d.married ? 'married' : 'single',
          spouseFamilies: fams, spouseLinks: links,
          phone: firebase.firestore.FieldValue.delete()
        };
        if (d.birth && d.birth.birthDate) { upd.birthDate = d.birth.birthDate; upd.birthDateHijri = d.birth.birthDateHijri || ''; upd.birthDateCal = d.birth.birthDateCal || ''; }
        if (selfMother) { upd.motherId = selfMother.motherId; upd.motherName = selfMother.motherName; }
        const batch = db.batch();
        batch.update(db.collection('persons').doc(p.id), upd);
        setPrivatePhone(batch, p.id, d.phone);
        await batch.commit();
        await syncReciprocal(p, oldLinks, links);
        delete pendingSpouses[String(p.displayId)];
        logAdminAction('edit', `الاستقبال: تحديث بيانات ${p.firstName || ''} (#${p.displayId}) — ${ch.filter(c => c.g === 'self').map(c => c.t).join('، ')}`);
      }

      // 3) الأبناء والإخوة الجدد (يُحذف كل واحد من القائمة بعد إضافته)
      for (const [list, parent, rel] of [[kids, p, ['ابن', 'ابنة']], [sibs, father, ['أخ', 'أخت']]]) {
        while (list.length && parent) {
          const k = list[0];
          const id = await createPerson(k.name, k.gender, parent, k.m);
          logAdminAction('add', `الاستقبال: إضافة ${k.gender === 'female' ? rel[1] : rel[0]} «${k.name}» (#${id}) — تحت ${parent.firstName || ''} (#${parent.displayId})${k.m.motherName ? '، الأم: ' + k.m.motherName : ''}`);
          list.shift();
          (parent === p ? d.kids : d.sibs).shift();
        }
      }

      // 4) تسليم البطاقة
      if (d.checkin && !attendance[p.displayId]) await checkin(p);

      delete drafts[String(p.displayId)];
      if (father) Object.keys(drafts).forEach(k => { const o = byId(k); if (o && fatherOf(o) === father) { drafts[k].fPhone = d.fPhone; drafts[k].fStatus = d.fStatus; } });
      saving = false;
      step = 'done';
      renderPanel();
      flash('✅ تم حفظ كل التغييرات');
    } catch (err) {
      console.error(err); alert('تعذّر الحفظ: ' + err.message);
      saving = false;
      renderPanel();
    }
  }

  // ------------------------------------------------------------------
  // تسليم البطاقات (يُحفظ في meta/attendance_YYYY-MM-DD — للمدير فقط)
  // ------------------------------------------------------------------
  function listenAttendance() {
    if (attendanceUnsub) return;
    attendanceUnsub = attendanceRef().onSnapshot(snap => {
      const data = snap.exists ? (snap.data().checked || {}) : {};
      attendance = {};
      Object.keys(data).forEach(k => {
        const v = data[k] || {};
        attendance[k] = { at: v.at && v.at.toDate ? v.at.toDate().getTime() : Date.now(), by: v.by || '' };
      });
      $('rc-count').textContent = Object.keys(attendance).length;
      if (currentId) updateCheckinButton();
      if ($('rc-search').value.trim()) renderResults();
    }, err => console.warn('تعذّر قراءة الحضور:', err));
  }

  function updateCheckinButton() {
    const p = byId(currentId); const btn = $('rc-checkin'); if (!p || !btn) return;
    const done = attendance[p.displayId];
    btn.className = 'rc-btn ' + (done ? 'rc-btn-done' : 'rc-btn-primary');
    btn.textContent = done
      ? `✅ استلم بطاقته (${new Date(done.at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}) — إلغاء`
      : '🎫 تم تسليم البطاقة';
  }

  async function checkin(p) {
    await attendanceRef().set({
      date: todayKey(),
      checked: { [Number(p.displayId)]: { at: firebase.firestore.FieldValue.serverTimestamp(), by: (auth.currentUser && auth.currentUser.email) || '' } }
    }, { merge: true });
    logAdminAction('checkin', `الاستقبال: تسليم بطاقة ${p.firstName || ''} (#${p.displayId})`);
  }

  async function toggleCheckin() {
    const p = byId(currentId); if (!p) return;
    const key = 'checked.' + Number(p.displayId);
    const btn = $('rc-checkin'); btn.disabled = true;
    try {
      if (attendance[p.displayId]) {
        if (!confirm('إلغاء تسجيل استلام البطاقة؟')) { btn.disabled = false; return; }
        await attendanceRef().update({ [key]: firebase.firestore.FieldValue.delete() });
        logAdminAction('checkin', `الاستقبال: إلغاء تسليم بطاقة ${p.firstName || ''} (#${p.displayId})`);
      } else {
        await checkin(p);
        flash('🎫 تم تسجيل الاستلام');
      }
    } catch (err) {
      console.error(err); alert('تعذّر الحفظ: ' + err.message);
    } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------------
  // طباعة بطاقة واحدة (نفس تصميم تبويب البطاقات)
  // ------------------------------------------------------------------
  function printCard(p) {
    const box = $('id-cards-print'); if (!box) return;
    const name = idCardName(p);
    const dead = p.status === 'death';
    const photo = (p.gender === 'male') ? safeImgSrc(p.photoURL) : '';
    box.innerHTML = `<div class="idc-page"><div class="id-card${dead ? ' dead' : ''}${photo ? ' with-photo' : ''}">
      <div class="idc-top"></div>
      <img class="idc-logo" src="logo-header.webp?v=1" alt="">
      ${photo ? `<img class="idc-photo" src="${photo}" alt="">` : '<div class="idc-family">عائلة الماجد</div>'}
      <div class="idc-name"><span>${esc(name)}</span>${dead ? `<small>${p.gender === 'female' ? 'رحمها الله' : 'رحمه الله'}</small>` : ''}</div>
      <div class="idc-id">الرقم التعريفي<b>${Number(p.displayId)}</b></div>
      <div class="idc-bottom"></div>
    </div></div>`;
    const restore = () => { window.removeEventListener('afterprint', restore); renderIdCards(); };
    window.addEventListener('afterprint', restore);
    const imgs = Array.from(box.querySelectorAll('img'));
    Promise.all(imgs.map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => window.print());
  }

  // ------------------------------------------------------------------
  function flash(msg) {
    let el = document.getElementById('rc-flash');
    if (!el) { el = document.createElement('div'); el.id = 'rc-flash'; el.className = 'rc-flash'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(flash._t); flash._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // إعادة الرسم مع الحفاظ على ما كُتب ولم يُحفظ (كل شيء في المسودة)
  function renderPanelKeepInputs() {
    if (saving) return;
    const extra = {};
    ['rc-kid-name', 'rc-sib-name'].forEach(i => { if ($(i)) extra[i] = $(i).value; });
    const focusedId = document.activeElement && document.activeElement.id;
    const scroll = window.scrollY;
    syncFromDom();
    renderPanel();
    Object.keys(extra).forEach(i => { if ($(i)) $(i).value = extra[i]; });
    if (focusedId && $(focusedId)) $(focusedId).focus();
    window.scrollTo(0, scroll);
  }

  let wired = false;
  window.Reception = {
    onShow() {
      if (!wired) {
        wired = true;
        const s = $('rc-search');
        s.addEventListener('input', renderResults);
        s.addEventListener('focus', renderResults);
        s.addEventListener('keydown', e => {
          if (e.key === 'Enter') { const first = $('rc-results').querySelector('.rc-item'); if (first) { e.preventDefault(); select(first.dataset.id); } }
          if (e.key === 'Escape') $('rc-results').style.display = 'none';
        });
        document.addEventListener('click', e => {
          if (!e.target.closest('.rc-search-wrap')) $('rc-results').style.display = 'none';
          document.querySelectorAll('.rc-sp-sug').forEach(sg => { if (!sg.parentElement.contains(e.target)) sg.style.display = 'none'; });
        });
      }
      listenAttendance();
      setTimeout(() => $('rc-search').focus(), 50);
    },
    // فتح شخص مباشرة (من تبويب الحضور مثلاً)
    open(id) { this.onShow(); select(id); },
    onPersonsUpdated() {
      if (currentId && $('tab-panel-reception') && $('tab-panel-reception').classList.contains('active')) renderPanelKeepInputs();
    }
  };
})();
