// =====================================================================
// تبويب «الاستقبال» — لاجتماعات العائلة
// عند وصول الشخص: ابحث عنه برقمه أو اسمه، أكمل بياناته وبيانات أسرته، ثم سلّمه بطاقته:
//   • بياناته: الجوال، الميلاد، الحالة الاجتماعية، الزوجات (من العائلة أو من خارجها)
//   • أبناؤه وبناته (للذكر المتزوج) مع تحديد أمّهم
//   • والده: الحالة، الجوال، الزوجات، وأم الشخص
//   • إخوانه وأخواته: الحالة، الجوال، الميلاد، الزواج، الأم، وأبناؤهم
// كل التعديلات تُحفظ مرة واحدة بزر «حفظ كل التعديلات» وتنعكس على الشجرة (المدير فقط حسب قواعد الحماية).
// يعتمد على دوال لوحة المدير في admin.js.
// =====================================================================
(function () {
  let currentId = null;              // المعرّف المعروض حالياً
  let attendance = {};               // displayId -> { at, by } لتسليم البطاقات اليوم
  let attendanceUnsub = null;
  // كل التعديلات غير المحفوظة (تُحفظ كلها بزر واحد في الأسفل):
  const ov = {};                     // displayId -> { phone, birth, status, married, mother } الحقول المعدّلة فقط
  const pendingSpouses = {};         // displayId -> { links: [{id,name}], fams: [name] } بعد أي تعديل على الزوجات
  const queue = {};                  // displayId للأب -> [{ name, gender, mother }] أبناء جدد يُضافون عند الحفظ
  const pickers = {};                // displayId -> منتقي تاريخ الميلاد
  let saving = false;

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
    if (currentId && String(id) !== currentId && !saving) {
      const n = pendingCount();
      if (n && !confirm(`لديك ${n} تعديل غير محفوظ.\nإذا انتقلت الآن ستُلغى هذه التعديلات.\n\nالانتقال بدون حفظ؟`)) return;
      if (n) clearAllPending();
    }
    currentId = String(id);
    $('rc-results').style.display = 'none';
    $('rc-search').value = '';
    renderPanel();
    $('rc-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearAllPending() {
    [ov, pendingSpouses, queue].forEach(o => Object.keys(o).forEach(k => delete o[k]));
  }

  // ------------------------------------------------------------------
  // القيم: المعدّلة (غير محفوظة) أو المحفوظة في الشجرة
  // ------------------------------------------------------------------
  function savedSpouses(p) {
    return {
      links: (Array.isArray(p.spouseLinks) ? p.spouseLinks : []).map(l => ({ id: Number(l.id), name: l.name || '' })),
      fams: personFamiliesAdmin(p).slice()
    };
  }
  // للقراءة: التعديل إن وُجد، وإلا المحفوظ
  function spouseState(p) { return pendingSpouses[String(p.displayId)] || savedSpouses(p); }
  // للتعديل: يُنشئ نسخة قابلة للتعديل
  function editSpouses(p) {
    const k = String(p.displayId);
    if (!pendingSpouses[k]) pendingSpouses[k] = savedSpouses(p);
    return pendingSpouses[k];
  }

  function base(p, f) {
    switch (f) {
      case 'phone': return String(p.phone || '');
      case 'birth': return (p.birthDate || p.birthDateHijri) ? { birthDate: p.birthDate || '', birthDateHijri: p.birthDateHijri || '', birthDateCal: p.birthDateCal || '' } : null;
      case 'status': return p.status === 'death' ? 'death' : 'alive';
      case 'married': { const s = savedSpouses(p); return isMarriedAdmin(p) || s.links.length + s.fams.length > 0; }
      case 'mother': return motherValueOf(p, fatherOf(p));
    }
  }
  function val(p, f) {
    const o = ov[String(p.displayId)];
    return o && f in o ? o[f] : base(p, f);
  }
  function setVal(p, f, v) {
    const k = String(p.displayId);
    (ov[k] = ov[k] || {})[f] = v;
  }

  // ------------------------------------------------------------------
  // الأم: من زوجات الأب (المحفوظة أو المعدّلة حالياً)
  // ------------------------------------------------------------------
  function motherOptionsFor(father) {
    if (!father) return [];
    const st = spouseState(father);
    return [
      ...st.links.map(l => {
        const nm = l.name || (byId(l.id) ? byId(l.id).firstName : '');
        return { value: 'id:' + l.id, mid: Number(l.id), mname: nm, label: `${nm} (${l.id})` };
      }),
      ...st.fams.map(f => ({ value: 'fam:' + f, mid: null, mname: 'من عائلة ' + f, label: 'من عائلة ' + f }))
    ];
  }
  function motherValueOf(p, father) {
    if (p.motherId != null && p.motherId !== '') return 'id:' + Number(p.motherId);
    if (p.motherName) {
      const o = motherOptionsFor(father).find(x => x.mname === p.motherName);
      if (o) return o.value;
      const m = /^من عائلة (.+)$/.exec(p.motherName);
      return m ? 'fam:' + m[1] : '';
    }
    return '';
  }
  function resolveMother(father, v) {
    if (!v) return { motherId: null, motherName: '' };
    const o = motherOptionsFor(father).find(x => x.value === v);
    if (o) return { motherId: o.mid, motherName: o.mname };
    if (v.startsWith('id:')) { const w = byId(v.slice(3)); return { motherId: Number(v.slice(3)), motherName: w ? w.firstName : '' }; }
    return { motherId: null, motherName: 'من عائلة ' + v.slice(4) };
  }
  function motherLabel(father, v) {
    if (!v) return 'الأم غير محددة';
    const o = motherOptionsFor(father).find(x => x.value === v);
    return o ? o.label : resolveMother(father, v).motherName;
  }
  // قائمة اختيار الأم؛ القيمة الحالية تُضاف للقائمة إن لم تكن من زوجات الأب المسجّلات
  function motherSelect(attrs, father, cur, emptyLabel) {
    const opts = motherOptionsFor(father);
    if (cur && !opts.some(o => o.value === cur)) opts.push({ value: cur, label: motherLabel(father, cur) });
    return `<select class="rc-input rc-select" ${attrs} ${opts.length ? '' : 'disabled'} aria-label="الأم">
      <option value="">${esc(opts.length ? (emptyLabel || 'الأم غير محددة') : 'أضف زوجات الأب أولاً')}</option>
      ${opts.map(o => `<option value="${esc(o.value)}" ${o.value === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  }

  // ------------------------------------------------------------------
  // محرّر الزوجات/الزوج: كل زوجة إما من العائلة (ربط بمعرّف) أو من خارجها (اسم العائلة)
  // ------------------------------------------------------------------
  function spouseEditorHtml(p) {
    const female = isFemale(p);
    const st = spouseState(p);
    const total = st.links.length + st.fams.length;
    const chips = [
      ...st.links.map((l, i) => `<span class="rc-sp-chip in"><button type="button" class="rc-linkname" data-goto="${Number(l.id)}">${esc(l.name || (byId(l.id) ? byId(l.id).firstName : ''))} <i>${Number(l.id)}</i></button><small>من العائلة</small><button type="button" class="rc-x" data-del-link="${i}" aria-label="حذف">✕</button></span>`),
      ...st.fams.map((f, i) => `<span class="rc-sp-chip out">من عائلة <b>${esc(f)}</b><button type="button" class="rc-x" data-del-fam="${i}" aria-label="حذف">✕</button></span>`)
    ].join('');
    return `
      <div class="rc-sp" data-pid="${Number(p.displayId)}">
        ${chips ? `<div class="rc-sp-chips">${chips}</div>` : ''}
        ${female && total >= 1 ? '' : `
        <div class="rc-sp-add">
          <div class="rc-toggle rc-sp-origin">
            <button type="button" data-v="out" class="on">خارج العائلة</button>
            <button type="button" data-v="in">من الماجد</button>
          </div>
          <div class="rc-sp-out">
            <input type="text" class="rc-input rc-sp-fam" placeholder="اسم العائلة">
            <button type="button" class="rc-btn rc-sp-addfam">➕</button>
          </div>
          <div class="rc-sp-in" style="display:none;">
            <div class="rc-sp-search-wrap">
              <input type="text" class="rc-input rc-sp-q" placeholder="ابحث بالاسم أو الرقم" autocomplete="off">
              <div class="rc-sp-sug"></div>
            </div>
          </div>
        </div>`}
      </div>`;
  }

  function wireSpouseEditor(root) {
    const p = byId(root.dataset.pid); if (!p) return;
    const after = () => rerender();
    root.querySelectorAll('[data-del-link]').forEach(b => b.addEventListener('click', () => { editSpouses(p).links.splice(Number(b.dataset.delLink), 1); after(); }));
    root.querySelectorAll('[data-del-fam]').forEach(b => b.addEventListener('click', () => { editSpouses(p).fams.splice(Number(b.dataset.delFam), 1); after(); }));
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
      const st = editSpouses(p);
      if (!st.fams.some(f => normalizeArabic(f) === normalizeArabic(v))) st.fams.push(v);
      famInput.value = '';
      after();
    };
    root.querySelector('.rc-sp-addfam').addEventListener('click', addFam);
    famInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFam(); } });
    const q = root.querySelector('.rc-sp-q'), sug = root.querySelector('.rc-sp-sug');
    q.addEventListener('input', () => {
      if (!q.value.trim()) { sug.style.display = 'none'; return; }
      const cur = spouseState(p);
      const list = search(q.value, { gender: isFemale(p) ? 'male' : 'female', exclude: p.displayId, limit: 12 })
        .filter(x => !cur.links.some(l => Number(l.id) === Number(x.displayId)));
      sug.innerHTML = list.length ? list.map(x => `<button type="button" class="rc-item" data-id="${Number(x.displayId)}">
          <span class="rc-item-name"><b>${esc(x.firstName)}</b> ${esc(ancestorsOfAdmin(x, 2).map(a => a.firstName).join(' '))}</span>
          <span class="rc-item-id">${Number(x.displayId)}</span></button>`).join('')
        : '<div class="rc-noresult">لا توجد نتائج</div>';
      sug.style.display = 'block';
      sug.querySelectorAll('.rc-item').forEach(b => b.addEventListener('click', () => {
        const w = byId(b.dataset.id); if (!w) return;
        editSpouses(p).links.push({ id: Number(w.displayId), name: w.firstName || '' }); after();
      }));
    });
  }

  // ------------------------------------------------------------------
  // أجزاء الواجهة
  // ------------------------------------------------------------------
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

  const toggleHtml = (p, f, opts) => `<div class="rc-toggle" data-p="${Number(p.displayId)}" data-f="${f}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(val(p, f)) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const statusToggle = p => toggleHtml(p, 'status', [['alive', 'حي'], ['death', isFemale(p) ? 'متوفاة' : 'متوفى']]);
  const maritalToggle = p => toggleHtml(p, 'married', [['false', isFemale(p) ? 'غير متزوجة' : 'غير متزوج'], ['true', isFemale(p) ? 'متزوجة' : 'متزوج']]);
  const phoneInput = (p, ph) => `<input type="tel" class="rc-input" dir="ltr" data-p="${Number(p.displayId)}" data-f="phone" placeholder="${ph || '05xxxxxxxx'}" value="${esc(val(p, 'phone'))}">`;
  const birthMount = p => `<div class="rc-bd" data-bd="${Number(p.displayId)}"></div>`;

  // الأبناء (المسجّلون + الجدد في القائمة) وسطر الإضافة — للأب p
  function kidsBlock(p, relWords) {
    const pid = Number(p.displayId);
    const q = queue[pid] || [];
    const existing = relWords.existing || [];
    const chips = kidChips(existing) + q.map((k, i) => `<span class="rc-chip rc-chip-new">${k.gender === 'female' ? '👧' : '👦'} ${esc(k.name)} <small>جديد${k.mother ? ' · ' + esc(motherLabel(p, k.mother)) : ''}</small><button type="button" class="rc-x" data-unq="${pid}:${i}" aria-label="حذف">✕</button></span>`).join('');
    const opts = motherOptionsFor(p);
    return `
      ${chips ? `<div class="rc-kids">${chips}</div>` : ''}
      <div class="rc-addkid">
        <input type="text" class="rc-input" data-addname="${pid}" placeholder="${relWords.ph}">
        <div class="rc-toggle" data-addg="${pid}">
          <button type="button" data-v="male" class="on">${relWords.m}</button>
          <button type="button" data-v="female">${relWords.f}</button>
        </div>
        <button type="button" class="rc-btn rc-btn-primary" data-add="${pid}">➕ إضافة</button>
        ${opts.length > 1 ? motherSelect(`data-addm="${pid}"`, p, relWords.defMother || '', 'اختر الأم') : ''}
      </div>`;
  }

  function siblingCard(sb, father) {
    const id = Number(sb.displayId);
    const female = isFemale(sb);
    const married = val(sb, 'married');
    const dead = val(sb, 'status') === 'death';
    return `
      <div class="rc-sib-card">
        <div class="rc-sib-top">
          ${kidChips([sb])}
          ${statusToggle(sb)}
          ${motherSelect(`data-p="${id}" data-f="mother"`, father, val(sb, 'mother'), 'الأم غير محددة')}
        </div>
        <div class="rc-sib-grid">
          <div style="${dead ? 'display:none;' : ''}"><label class="rc-label">الجوال</label>${phoneInput(sb)}</div>
          <div><label class="rc-label">الحالة الاجتماعية</label>${maritalToggle(sb)}</div>
          <div class="rc-field-wide"><label class="rc-label">تاريخ الميلاد</label>${birthMount(sb)}</div>
          ${married ? `<div class="rc-field-wide"><label class="rc-label">${female ? 'الزوج' : 'الزوجة / الزوجات'}</label>${spouseEditorHtml(sb)}</div>` : ''}
          ${married && !female ? `<div class="rc-field-wide"><label class="rc-label">أبناء ${esc(sb.firstName)} <small>(${childrenOf(sb).length + (queue[id] || []).length})</small></label>
            ${kidsBlock(sb, { existing: childrenOf(sb), ph: 'اسم الابن أو البنت', m: 'ابن', f: 'ابنة' })}</div>` : ''}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------
  // لوحة الشخص
  // ------------------------------------------------------------------
  function renderPanel() {
    const panel = $('rc-panel');
    const p = currentId ? byId(currentId) : null;
    if (!p) return;
    const female = isFemale(p);
    const married = val(p, 'married');
    const father = fatherOf(p);
    const siblings = father ? childrenOf(father).filter(s => String(s.displayId) !== String(p.displayId)) : [];
    const hints = missingHints(p);

    panel.innerHTML = `
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

      <div class="rc-grid" id="rc-grid">
        <section class="rc-box">
          <h3>📝 إكمال البيانات</h3>
          <label class="rc-label">رقم الجوال</label>
          ${phoneInput(p)}
          <label class="rc-label">تاريخ الميلاد</label>
          ${birthMount(p)}
          <label class="rc-label">الحالة الاجتماعية</label>
          ${maritalToggle(p)}
          ${married ? `<label class="rc-label">${female ? 'الزوج' : 'الزوجة / الزوجات'}</label>${spouseEditorHtml(p)}` : ''}
        </section>

        <div class="rc-col">
          ${!female && married ? `
          <section class="rc-box">
            <h3>👨‍👩‍👧 الأبناء والبنات <small>(${childrenOf(p).length + (queue[p.displayId] || []).length})</small></h3>
            ${kidsBlock(p, { existing: childrenOf(p), ph: 'اسم الابن أو البنت', m: 'ابن', f: 'ابنة' })}
          </section>` : ''}

          <section class="rc-box">
            ${father ? `
            <h3>👤 الأب: <button type="button" class="rc-chip" data-goto="${Number(father.displayId)}">${esc(shortName(father))} <i>${Number(father.displayId)}</i></button></h3>
            <div class="rc-row2">
              ${statusToggle(father)}
              ${val(father, 'status') === 'death' ? '' : phoneInput(father, 'جوال الأب')}
            </div>
            <label class="rc-label">زوجات الأب</label>
            ${spouseEditorHtml(father)}
            <label class="rc-label">أم ${esc(p.firstName)}</label>
            ${motherSelect(`data-p="${Number(p.displayId)}" data-f="mother"`, father, val(p, 'mother'), '— غير محددة —')}
            ` : '<h3>👤 الأب</h3><div class="rc-note">رأس فرع — لا يوجد أب مسجّل له في الشجرة.</div>'}
          </section>
        </div>
      </div>

      ${father ? `
      <section class="rc-box rc-sibs">
        <h3>👪 الإخوان والأخوات <small>(${siblings.length + (queue[father.displayId] || []).length})</small></h3>
        ${siblings.length ? `<div class="rc-sib-list">${siblings.map(sb => siblingCard(sb, father)).join('')}</div>` : '<div class="rc-note">لا يوجد إخوة مسجّلون.</div>'}
        <div class="rc-label" style="margin-top:14px;">إضافة أخ أو أخت</div>
        ${kidsBlock(father, { existing: [], ph: 'اسم الأخ أو الأخت', m: 'أخ', f: 'أخت', defMother: val(p, 'mother') })}
      </section>` : ''}

      <div class="rc-savebar">
        <span class="rc-pending" id="rc-pending"></span>
        <button type="button" class="rc-btn rc-btn-primary" id="rc-save-all">💾 حفظ كل التعديلات</button>
      </div>

      <div class="rc-actions">
        <button type="button" class="rc-btn" id="rc-checkin"></button>
        <button type="button" class="rc-btn" id="rc-print">🖨️ طباعة بطاقته</button>
        <button type="button" class="rc-btn" id="rc-full-edit">📷 الصورة وتصحيح الاسم</button>
      </div>
    `;
    wirePanel(p);
  }

  function wirePanel(p) {
    const panel = $('rc-panel');
    // منتقيات تاريخ الميلاد
    panel.querySelectorAll('.rc-bd').forEach(m => {
      const per = byId(m.dataset.bd); if (!per || !window.Birthdate) return;
      m.id = 'rc-bd-' + m.dataset.bd;
      const picker = window.Birthdate.create(m.id);
      pickers[m.dataset.bd] = picker;
      const v = val(per, 'birth'); if (v) picker.setValue(v);
      const read = () => { const g = picker.getValue(); if (g && (g.birthDate || g.birthDateHijri)) { setVal(per, 'birth', g); updateBar(); } };
      m.addEventListener('change', read);
      m.addEventListener('click', () => setTimeout(read, 0));
    });
    // الحقول المرتبطة بالأشخاص
    panel.querySelectorAll('input[data-f="phone"]').forEach(i => i.addEventListener('input', () => { setVal(byId(i.dataset.p), 'phone', i.value.trim()); updateBar(); }));
    panel.querySelectorAll('select[data-f="mother"]').forEach(s => s.addEventListener('change', () => { setVal(byId(s.dataset.p), 'mother', s.value); updateBar(); }));
    panel.querySelectorAll('.rc-toggle[data-f]').forEach(t => t.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const per = byId(t.dataset.p);
      const v = t.dataset.f === 'married' ? b.dataset.v === 'true' : b.dataset.v;
      setVal(per, t.dataset.f, v);
      rerender();
    }));
    // أزرار الاختيار المحلية (ابن/ابنة)
    panel.querySelectorAll('.rc-toggle[data-addg]').forEach(t => t.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      t.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    }));
    // إضافة ابن/أخ إلى القائمة (يُحفظ مع «حفظ كل التعديلات»)
    panel.querySelectorAll('[data-add]').forEach(btn => {
      const pid = btn.dataset.add;
      const nameEl = panel.querySelector(`[data-addname="${pid}"]`);
      const add = () => {
        const parent = byId(pid); const name = nameEl.value.trim();
        if (!parent) return;
        if (!name) { nameEl.focus(); return; }
        const list = queue[pid] = queue[pid] || [];
        if (list.some(k => normalizeArabic(k.name) === normalizeArabic(name))) { alert('هذا الاسم مضاف في القائمة.'); return; }
        if (!confirmNotDuplicateAdmin(String(pid), name)) return;
        const g = panel.querySelector(`[data-addg="${pid}"] .on`);
        const ms = panel.querySelector(`[data-addm="${pid}"]`);
        const opts = motherOptionsFor(parent);
        const mother = ms ? ms.value : (opts.length === 1 ? opts[0].value : '');
        list.push({ name, gender: g && g.dataset.v === 'female' ? 'female' : 'male', mother });
        nameEl.value = '';
        rerender(`[data-addname="${pid}"]`);
      };
      btn.addEventListener('click', add);
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    });
    panel.querySelectorAll('[data-unq]').forEach(b => b.addEventListener('click', () => {
      const [pid, i] = b.dataset.unq.split(':'); (queue[pid] || []).splice(Number(i), 1); rerender();
    }));
    panel.querySelectorAll('.rc-sp').forEach(wireSpouseEditor);
    panel.querySelectorAll('.rc-kids [data-goto], .rc-sib-top [data-goto], .rc-box h3 [data-goto]').forEach(b => b.addEventListener('click', () => select(b.dataset.goto)));
    $('rc-save-all').addEventListener('click', saveAll);
    $('rc-checkin').addEventListener('click', toggleCheckin);
    $('rc-print').addEventListener('click', () => printCard(p));
    $('rc-full-edit').addEventListener('click', () => openAdminEditModal(p));
    updateCheckinButton();
    updateBar();
  }

  // إعادة الرسم مع الحفاظ على مكان الشاشة والنصوص المكتوبة في خانات الإضافة
  function rerender(focusSel) {
    if (saving || !currentId) return;
    const typed = {};
    document.querySelectorAll('#rc-panel [data-addname]').forEach(i => { if (i.value) typed[i.dataset.addname] = i.value; });
    const scroll = window.scrollY;
    renderPanel();
    Object.keys(typed).forEach(k => { const i = document.querySelector(`#rc-panel [data-addname="${k}"]`); if (i && !focusSel) i.value = typed[k]; });
    window.scrollTo(0, scroll);
    if (focusSel) { const el = document.querySelector('#rc-panel ' + focusSel); if (el) el.focus({ preventScroll: true }); }
  }

  // ------------------------------------------------------------------
  // التغييرات والحفظ
  // ------------------------------------------------------------------
  function describeSpouses(links, fams) {
    return [...links.map(l => `${l.name || ''} (#${l.id})`), ...fams.map(f => 'من ' + f)].join('، ');
  }

  // الأشخاص المعروضون في الصفحة: الشخص، أبوه، إخوته
  function peopleInView() {
    const p = byId(currentId); if (!p) return [];
    const f = fatherOf(p);
    const sibs = f ? childrenOf(f).filter(s => String(s.displayId) !== String(p.displayId)) : [];
    return [p, f, ...sibs].filter(Boolean);
  }

  // تغييرات شخص واحد: { upd, texts, phone(إن تغيّر), spouses: {old,new} }
  function changesOf(per) {
    const out = { upd: {}, texts: [], phone: null, spouses: null };
    const female = isFemale(per);
    const phone = val(per, 'phone');
    if (phone !== base(per, 'phone')) {
      out.phone = phone; out.upd.phoneLast4 = phoneLast4Of(phone); out.upd.phone = firebase.firestore.FieldValue.delete();
      out.texts.push('الجوال' + (phone ? '' : ' (حذف)'));
    }
    const b = val(per, 'birth');
    if (b && b.birthDate && b.birthDate !== (per.birthDate || '')) {
      Object.assign(out.upd, { birthDate: b.birthDate, birthDateHijri: b.birthDateHijri || '', birthDateCal: b.birthDateCal || '' });
      out.texts.push('الميلاد');
    }
    const status = val(per, 'status');
    if (status !== base(per, 'status')) { out.upd.status = status; out.texts.push('الحالة: ' + (status === 'death' ? (female ? 'متوفاة' : 'متوفى') : 'حي')); }
    const sp = spouseState(per), old = savedSpouses(per);
    let married = val(per, 'married');
    if (sp.links.length + sp.fams.length > 0 && !('married' in (ov[String(per.displayId)] || {}))) married = true;
    const links = married ? sp.links.slice() : [], fams = married ? sp.fams.slice() : [];
    if (married !== base(per, 'married')) { out.upd.maritalStatus = married ? 'married' : 'single'; out.texts.push(married ? (female ? 'متزوجة' : 'متزوج') : (female ? 'غير متزوجة' : 'غير متزوج')); }
    if (describeSpouses(links, fams) !== describeSpouses(old.links, old.fams)) {
      Object.assign(out.upd, { spouseLinks: links, spouseFamilies: fams, maritalStatus: married ? 'married' : 'single' });
      out.spouses = { old: old.links, links };
      out.texts.push((female ? 'الزوج: ' : 'الزوجات: ') + (describeSpouses(links, fams) || '—'));
    }
    const father = fatherOf(per);
    if (father) {
      const m = val(per, 'mother');
      if (m !== base(per, 'mother')) {
        const r = resolveMother(father, m);
        out.upd.motherId = r.motherId; out.upd.motherName = r.motherName;
        out.texts.push('الأم: ' + (r.motherName || 'غير محددة'));
      }
    }
    return out;
  }

  function pendingCount() {
    if (!currentId) return 0;
    let n = 0;
    peopleInView().forEach(per => { n += changesOf(per).texts.length; });
    Object.keys(queue).forEach(k => { n += (queue[k] || []).length; });
    return n;
  }

  function updateBar() {
    const el = $('rc-pending'), btn = $('rc-save-all'); if (!el || !btn) return;
    const n = pendingCount();
    el.textContent = n ? `${n} تعديل غير محفوظ` : 'لا توجد تعديلات';
    el.classList.toggle('none', !n);
    btn.disabled = !n;
  }

  // الربط التبادلي: إضافة/إزالة هذا الشخص من سجلّ الزوجة المرتبطة من العائلة
  async function syncReciprocal(person, oldLinks, newLinks) {
    const oldIds = new Set(oldLinks.map(l => Number(l.id)));
    const newIds = new Set(newLinks.map(l => Number(l.id)));
    const added = newLinks.filter(l => !oldIds.has(Number(l.id)));
    const removed = oldLinks.filter(l => !newIds.has(Number(l.id)));
    for (const l of added) {
      const w = byId(l.id); if (!w) continue;
      const cur = Array.isArray(w.spouseLinks) ? w.spouseLinks : [];
      if (cur.some(s => Number(s.id) === Number(person.displayId))) continue;
      try { await db.collection('persons').doc(w.id).update({ maritalStatus: 'married', spouseLinks: cur.concat([{ id: Number(person.displayId), name: person.firstName || '' }]) }); }
      catch (e) { console.error('تعذّر الربط التبادلي', e); }
    }
    for (const l of removed) {
      const w = byId(l.id); if (!w) continue;
      const rest = (Array.isArray(w.spouseLinks) ? w.spouseLinks : []).filter(s => Number(s.id) !== Number(person.displayId));
      try { await db.collection('persons').doc(w.id).update({ spouseLinks: rest }); } catch (e) { console.error('تعذّر فك الربط', e); }
    }
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
    const btn = $('rc-save-all');
    const people = peopleInView();
    // تُحسب كل التغييرات والأمهات قبل أي حفظ (من الزوجات كما هي الآن)
    const plan = people.map(per => ({ per, ch: changesOf(per) })).filter(x => x.ch.texts.length);
    const adds = [];
    Object.keys(queue).forEach(pid => (queue[pid] || []).forEach(k => {
      const parent = byId(pid); if (parent) adds.push({ pid, parent, k, m: resolveMother(parent, k.mother) });
    }));
    if (!plan.length && !adds.length) return;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    saving = true;
    let done = 0;
    try {
      for (const { per, ch } of plan) {
        const batch = db.batch();
        batch.update(db.collection('persons').doc(per.id), ch.upd);
        if (ch.phone !== null) setPrivatePhone(batch, per.id, ch.phone);
        await batch.commit();
        if (ch.spouses) await syncReciprocal(per, ch.spouses.old, ch.spouses.links);
        delete ov[String(per.displayId)]; delete pendingSpouses[String(per.displayId)];
        logAdminAction('edit', `الاستقبال: تحديث بيانات ${per.firstName || ''} (#${per.displayId}) — ${ch.texts.join('، ')}`);
        done++;
      }
      for (const a of adds) {
        const id = await createPerson(a.k.name, a.k.gender, a.parent, a.m);
        const isSib = String(a.pid) === String(fatherOf(byId(currentId)) && fatherOf(byId(currentId)).displayId);
        const rel = isSib ? (a.k.gender === 'female' ? 'أخت' : 'أخ') : (a.k.gender === 'female' ? 'ابنة' : 'ابن');
        logAdminAction('add', `الاستقبال: إضافة ${rel} «${a.k.name}» (#${id}) — تحت ${a.parent.firstName || ''} (#${a.parent.displayId})${a.m.motherName ? '، الأم: ' + a.m.motherName : ''}`);
        const list = queue[a.pid]; const i = list ? list.indexOf(a.k) : -1; if (i >= 0) list.splice(i, 1);
        done++;
      }
      flash(`✅ تم حفظ ${done} تعديل — ظهرت في الشجرة`);
    } catch (err) {
      console.error(err); alert('تعذّر حفظ بعض التعديلات: ' + err.message + '\nما لم يُحفظ ما زال في الصفحة، جرّب الحفظ مرة أخرى.');
    } finally {
      saving = false;
      rerender();
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

  async function toggleCheckin() {
    const p = byId(currentId); if (!p) return;
    const n = pendingCount();
    if (n && !attendance[p.displayId] && confirm(`لديك ${n} تعديل غير محفوظ.\nهل تريد حفظها الآن مع تسليم البطاقة؟`)) await saveAll();
    const key = 'checked.' + Number(p.displayId);
    const btn = $('rc-checkin'); btn.disabled = true;
    try {
      if (attendance[p.displayId]) {
        if (!confirm('إلغاء تسجيل استلام البطاقة؟')) { btn.disabled = false; return; }
        await attendanceRef().update({ [key]: firebase.firestore.FieldValue.delete() });
        logAdminAction('checkin', `الاستقبال: إلغاء تسليم بطاقة ${p.firstName || ''} (#${p.displayId})`);
      } else {
        await attendanceRef().set({
          date: todayKey(),
          checked: { [Number(p.displayId)]: { at: firebase.firestore.FieldValue.serverTimestamp(), by: (auth.currentUser && auth.currentUser.email) || '' } }
        }, { merge: true });
        logAdminAction('checkin', `الاستقبال: تسليم بطاقة ${p.firstName || ''} (#${p.displayId})`);
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
        // تنبيه عند إغلاق الصفحة مع تعديلات غير محفوظة
        window.addEventListener('beforeunload', e => { if (pendingCount()) { e.preventDefault(); e.returnValue = ''; } });
      }
      listenAttendance();
      setTimeout(() => $('rc-search').focus(), 50);
    },
    // فتح شخص مباشرة (من تبويب الحضور مثلاً)
    open(id) { this.onShow(); select(id); },
    onPersonsUpdated() {
      if (currentId && $('tab-panel-reception') && $('tab-panel-reception').classList.contains('active')) {
        const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#rc-panel') && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
        if (!typing) rerender();
      }
    }
  };
})();
