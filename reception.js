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
        ${chips ? `<div class="rc-sp-chips">${chips}</div>` : ''}
        ${full ? '<div class="rc-note">للأنثى زوج واحد فقط. احذف الحالي لتغييره.</div>' : `
        <div class="rc-sp-add">
          <div class="rc-toggle rc-sp-origin">
            <button type="button" data-v="out" class="on">خارج العائلة</button>
            <button type="button" data-v="in">من الماجد</button>
          </div>
          <div class="rc-sp-out">
            <input type="text" class="rc-input rc-sp-fam" placeholder="اسم العائلة — مثال: العفالق">
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
        return { value: 'id:' + l.id, mid: Number(l.id), mname: nm, label: `${nm} (${l.id})` };
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
  // قائمة أم الأبناء/الإخوة: تظهر فقط إذا كان للأب أكثر من زوجة، وإن كانت زوجة واحدة تُختار تلقائياً
  function tidyMotherSelects() {
    ['rc-kid-mother', 'rc-sib-mother'].forEach(id => {
      const el = $(id); if (!el) return;
      const real = Array.from(el.options).filter(o => o.value);
      if (real.length === 1) el.value = real[0].value;
      el.style.display = real.length > 1 ? '' : 'none';
    });
  }
  function refreshMotherSelects() {
    const p = byId(currentId); if (!p) return;
    const father = fatherOf(p);
    [['rc-mother', father, p.motherId, p.motherName, null],
     ['rc-sib-mother', father, p.motherId, p.motherName, 'الأم غير محددة'],
     ['rc-kid-mother', isFemale(p) ? null : p, null, '', 'الأم غير محددة']].forEach(([id, f, cid, cname, lbl]) => {
      const el = $(id); if (!el) return;
      const keep = el.value;
      const tmp = document.createElement('div'); tmp.innerHTML = motherSelectHtml(id, f, cid, cname, lbl);
      const fresh = tmp.firstElementChild;
      if (keep && Array.from(fresh.options).some(o => o.value === keep)) fresh.value = keep;
      el.replaceWith(fresh);
    });
    document.querySelectorAll('select[id^="rc-sm-"]').forEach(el => {
      const sb = byId(el.id.slice(6)); if (!sb) return;
      const tmp = document.createElement('div'); tmp.innerHTML = motherSelectHtml(el.id, fatherOf(sb), sb.motherId, sb.motherName, 'الأم غير محددة');
      const fresh = tmp.firstElementChild; el.replaceWith(fresh); wireSibMother(fresh);
    });
    tidyMotherSelects();
  }

  // تغيير أم أحد الإخوة يُحفظ مباشرة
  function wireSibMother(el) {
    el.addEventListener('change', async () => {
      const sb = byId(el.id.slice(6)); if (!sb) return;
      const m = readMother(el.id);
      el.disabled = true;
      try {
        await db.collection('persons').doc(sb.id).update({ motherId: m.motherId, motherName: m.motherName });
        logAdminAction('edit', `الاستقبال: تحديد أم ${sb.firstName || ''} (#${sb.displayId}) — ${m.motherName || 'غير محددة'}`);
        flash(`✅ حُفظت أم ${sb.firstName}`);
      } catch (err) { console.error(err); alert('تعذّر الحفظ: ' + err.message); }
      finally { el.disabled = false; }
    });
  }

  // ------------------------------------------------------------------
  // لوحة الشخص
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

  function renderPanel() {
    const panel = $('rc-panel');
    const p = currentId ? byId(currentId) : null;
    if (!p) return;
    const female = isFemale(p);
    const sst = spouseState(p);
    const married = isMarriedAdmin(p) || sst.links.length + sst.fams.length > 0;
    const kids = childrenOf(p);
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

      <div class="rc-actions">
        <button type="button" class="rc-btn" id="rc-checkin"></button>
        <button type="button" class="rc-btn" id="rc-print">🖨️ طباعة بطاقته</button>
        <button type="button" class="rc-btn" id="rc-full-edit">✏️ تعديل كامل</button>
      </div>

      <div class="rc-grid" id="rc-grid">
        <section class="rc-box">
          <h3>📝 إكمال البيانات</h3>
          <label class="rc-label" for="rc-phone">رقم الجوال</label>
          <input type="tel" id="rc-phone" class="rc-input" dir="ltr" placeholder="05xxxxxxxx" value="${esc(p.phone || '')}">

          <label class="rc-label">تاريخ الميلاد</label>
          <div id="rc-birth-mount"></div>

          <label class="rc-label">الحالة الاجتماعية</label>
          <div class="rc-toggle" id="rc-marital">
            <button type="button" data-v="single" class="${married ? '' : 'on'}">${female ? 'غير متزوجة' : 'غير متزوج'}</button>
            <button type="button" data-v="married" class="${married ? 'on' : ''}">${female ? 'متزوجة' : 'متزوج'}</button>
          </div>
          <div id="rc-spouse-block" style="${married ? '' : 'display:none;'}">
            <label class="rc-label">${female ? 'الزوج' : 'الزوجة / الزوجات'}</label>
            ${spouseEditorHtml(p, 'self')}
          </div>

          <button type="button" class="rc-btn rc-btn-primary rc-save" id="rc-save">💾 حفظ البيانات</button>
        </section>

        <div class="rc-col">
          ${female ? '' : `
          <section class="rc-box" id="rc-kids-box" style="${married ? '' : 'display:none;'}">
            <h3>👨‍👩‍👧 الأبناء والبنات <small>(${kids.length})</small></h3>
            ${kids.length ? `<div class="rc-kids">${kidChips(kids)}</div>` : ''}
            <div class="rc-addkid">
              <input type="text" id="rc-kid-name" class="rc-input" placeholder="اسم الابن أو البنت">
              <div class="rc-toggle" id="rc-kid-gender">
                <button type="button" data-v="male" class="on">ابن</button>
                <button type="button" data-v="female">ابنة</button>
              </div>
              <button type="button" class="rc-btn rc-btn-primary" id="rc-kid-add">➕ إضافة</button>
              ${motherSelectHtml('rc-kid-mother', p, null, '', 'اختر الأم')}
            </div>
            <div class="rc-note">يُضاف مباشرة إلى الشجرة تحت ${esc(p.firstName)}.</div>
          </section>`}

          <section class="rc-box">
            ${father ? `
            <h3>👤 الأب: <button type="button" class="rc-chip" data-goto="${Number(father.displayId)}">${esc(shortName(father))} <i>${Number(father.displayId)}</i></button></h3>
            <div class="rc-row2">
              <div class="rc-toggle" id="rc-father-status">
                <button type="button" data-v="alive" class="${father.status === 'death' ? '' : 'on'}">حي</button>
                <button type="button" data-v="death" class="${father.status === 'death' ? 'on' : ''}">متوفى</button>
              </div>
              <input type="tel" id="rc-father-phone" class="rc-input" dir="ltr" placeholder="جوال الأب" value="${esc(father.phone || '')}" style="${father.status === 'death' ? 'visibility:hidden;' : ''}">
            </div>
            <label class="rc-label">زوجات الأب</label>
            ${spouseEditorHtml(father, 'father')}
            <label class="rc-label" for="rc-mother">أم ${esc(p.firstName)}</label>
            ${motherSelectHtml('rc-mother', father, p.motherId, p.motherName)}
            <button type="button" class="rc-btn rc-btn-primary rc-save" id="rc-father-save">💾 حفظ بيانات الأب</button>

            <h4 class="rc-sub">الإخوان والأخوات <small>(${siblings.length})</small></h4>
            ${siblings.length ? `<div class="rc-sib-list">${siblings.map(sb => `
              <div class="rc-sib-row">
                ${kidChips([sb])}
                ${motherSelectHtml('rc-sm-' + Number(sb.displayId), father, sb.motherId, sb.motherName, 'الأم غير محددة')}
              </div>`).join('')}</div>` : ''}
            <div class="rc-addkid">
              <input type="text" id="rc-sib-name" class="rc-input" placeholder="اسم الأخ أو الأخت">
              <div class="rc-toggle" id="rc-sib-gender">
                <button type="button" data-v="male" class="on">أخ</button>
                <button type="button" data-v="female">أخت</button>
              </div>
              <button type="button" class="rc-btn rc-btn-primary" id="rc-sib-add">➕ إضافة</button>
              ${motherSelectHtml('rc-sib-mother', father, p.motherId, p.motherName, 'اختر الأم')}
            </div>
            ` : '<h3>👤 الأب</h3><div class="rc-note">رأس فرع — لا يوجد أب مسجّل له في الشجرة.</div>'}
          </section>
        </div>
      </div>
    `;

    birthPicker = window.Birthdate ? window.Birthdate.create('rc-birth-mount') : null;
    if (birthPicker && (p.birthDate || p.birthDateHijri)) {
      birthPicker.setValue({ birthDate: p.birthDate, birthDateHijri: p.birthDateHijri, birthDateCal: p.birthDateCal });
    }
    panel.querySelectorAll('.rc-toggle:not(.rc-sp-origin)').forEach(t => t.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      t.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (t.id === 'rc-marital') applyMaritalVisibility(b.dataset.v === 'married');
      if (t.id === 'rc-father-status' && $('rc-father-phone')) $('rc-father-phone').style.visibility = b.dataset.v === 'death' ? 'hidden' : '';
    }));
    panel.querySelectorAll('.rc-sp').forEach(wireSpouseEditor);
    panel.querySelectorAll('.rc-kids [data-goto], .rc-sib-list [data-goto], .rc-box h3 [data-goto]').forEach(b => b.addEventListener('click', () => select(b.dataset.goto)));
    $('rc-save').addEventListener('click', saveSelf);
    $('rc-checkin').addEventListener('click', toggleCheckin);
    $('rc-print').addEventListener('click', () => printCard(p));
    $('rc-full-edit').addEventListener('click', () => openAdminEditModal(p));
    if ($('rc-father-save')) $('rc-father-save').addEventListener('click', saveFather);
    if ($('rc-kid-add')) wireAdd('rc-kid', () => ({ parent: byId(currentId), relation: 'child' }));
    if ($('rc-sib-add')) wireAdd('rc-sib', () => ({ parent: fatherOf(byId(currentId)), relation: 'sibling' }));
    panel.querySelectorAll('select[id^="rc-sm-"]').forEach(wireSibMother);
    tidyMotherSelects();
    updateCheckinButton();
  }

  // «متزوج» يُظهر الزوجات وقسم الأبناء (للذكور)، و«غير متزوج» يخفيهما
  function applyMaritalVisibility(married) {
    if ($('rc-spouse-block')) $('rc-spouse-block').style.display = married ? '' : 'none';
    const box = $('rc-kids-box');
    if (box) {
      box.style.display = married ? '' : 'none';
    }
  }

  function wireAdd(prefix, ctx) {
    $(prefix + '-add').addEventListener('click', () => addChild(prefix, ctx()));
    $(prefix + '-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addChild(prefix, ctx()); } });
  }

  // ------------------------------------------------------------------
  // الحفظ
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

  async function saveSelf() {
    const p = byId(currentId); if (!p) return;
    const btn = $('rc-save');
    const phone = $('rc-phone').value.trim();
    const married = $('rc-marital').querySelector('.on')?.dataset.v === 'married';
    const status = $('rc-status') ? ($('rc-status').querySelector('.on')?.dataset.v === 'death' ? 'death' : 'alive') : (p.status === 'death' ? 'death' : 'alive');
    const st = spouseState(p);
    const links = married ? st.links.slice() : [];
    const fams = married ? st.fams.slice() : [];
    const bd = birthPicker ? birthPicker.getValue() : null;
    const updates = {
      phoneLast4: phoneLast4Of(phone), status,
      maritalStatus: married ? 'married' : 'single',
      spouseFamilies: fams, spouseLinks: links,
      phone: firebase.firestore.FieldValue.delete()
    };
    if (bd && bd.birthDate) { updates.birthDate = bd.birthDate; updates.birthDateHijri = bd.birthDateHijri || ''; updates.birthDateCal = bd.birthDateCal || ''; }

    btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    try {
      const oldLinks = Array.isArray(p.spouseLinks) ? p.spouseLinks : [];
      const batch = db.batch();
      batch.update(db.collection('persons').doc(p.id), updates);
      setPrivatePhone(batch, p.id, phone);
      await batch.commit();
      await syncReciprocal(p, oldLinks, links);
      delete pendingSpouses[String(p.displayId)];
      const ch = [];
      if (String(p.phone || '') !== phone) ch.push('الجوال');
      if (bd && bd.birthDate && bd.birthDate !== p.birthDate) ch.push('الميلاد');
      if (status !== p.status) ch.push('الحالة');
      if (married !== isMarriedAdmin(p)) ch.push('الحالة الاجتماعية');
      if (describeSpouses(links, fams) !== describeSpouses(oldLinks, personFamiliesAdmin(p))) ch.push((isFemale(p) ? 'الزوج: ' : 'الزوجات: ') + (describeSpouses(links, fams) || '—'));
      logAdminAction('edit', `الاستقبال: تحديث بيانات ${p.firstName || ''} (#${p.displayId})${ch.length ? ' — ' + ch.join('، ') : ''}`);
      flash('✅ تم الحفظ');
    } catch (err) {
      console.error(err); alert('تعذّر الحفظ: ' + err.message);
    } finally {
      const b = $('rc-save'); if (b) { b.disabled = false; b.textContent = '💾 حفظ بيانات ' + (p.firstName || ''); }
    }
  }

  async function saveFather() {
    const p = byId(currentId); const f = fatherOf(p); if (!f) return;
    const btn = $('rc-father-save');
    const st = spouseState(f);
    const status = $('rc-father-status').querySelector('.on')?.dataset.v === 'death' ? 'death' : 'alive';
    const links = st.links.slice(), fams = st.fams.slice();
    const oldLinks = Array.isArray(f.spouseLinks) ? f.spouseLinks : [];
    const fPhone = $('rc-father-phone') ? $('rc-father-phone').value.trim() : String(f.phone || '');
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    try {
      const upd = { spouseLinks: links, spouseFamilies: fams, status, phoneLast4: phoneLast4Of(fPhone), phone: firebase.firestore.FieldValue.delete() };
      if (links.length + fams.length > 0) upd.maritalStatus = 'married';
      const batch = db.batch();
      batch.update(db.collection('persons').doc(f.id), upd);
      setPrivatePhone(batch, f.id, fPhone);
      await batch.commit();
      await syncReciprocal(f, oldLinks, links);
      delete pendingSpouses[String(f.displayId)];
      // أم الشخص (تُختار من زوجات الأب)
      const mother = $('rc-mother') ? readMother('rc-mother') : null;
      if (mother && (mother.motherId !== (p.motherId == null || p.motherId === '' ? null : Number(p.motherId)) || mother.motherName !== (p.motherName || ''))) {
        await db.collection('persons').doc(p.id).update({ motherId: mother.motherId, motherName: mother.motherName });
        logAdminAction('edit', `الاستقبال: تحديد أم ${p.firstName || ''} (#${p.displayId}) — ${mother.motherName || 'غير محددة'}`);
      }
      logAdminAction('edit', `الاستقبال: تحديث بيانات الأب ${f.firstName || ''} (#${f.displayId}) — الحالة: ${status === 'death' ? 'متوفى' : 'حي'}${fPhone !== String(f.phone || '') ? '، الجوال' : ''}، الزوجات: ${describeSpouses(links, fams) || '—'}`);
      flash('✅ تم حفظ بيانات الأب');
    } catch (err) {
      console.error(err); alert('تعذّر الحفظ: ' + err.message);
    } finally {
      const b = $('rc-father-save'); if (b) { b.disabled = false; b.textContent = '💾 حفظ بيانات الأب والأم'; }
    }
  }

  // إضافة ابن/ابنة (تحت الشخص) أو أخ/أخت (تحت الأب)
  async function addChild(prefix, ctx) {
    const parent = ctx.parent; if (!parent) return;
    const nameEl = $(prefix + '-name');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const gender = $(prefix + '-gender').querySelector('.on')?.dataset.v === 'female' ? 'female' : 'male';
    const mother = readMother(prefix + '-mother');
    const parentKey = String(parent.displayId);
    if (!confirmNotDuplicateAdmin(parentKey, name)) return;
    const btn = $(prefix + '-add'); btn.disabled = true;
    try {
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
          motherId: mother.motherId, motherName: mother.motherName, parentKey,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(counterRef, { lastId: newId }, { merge: true });
      });
      const rel = ctx.relation === 'sibling' ? (gender === 'female' ? 'أخت' : 'أخ') : (gender === 'female' ? 'ابنة' : 'ابن');
      logAdminAction('add', `الاستقبال: إضافة ${rel} «${name}» (#${createdId}) — تحت ${parent.firstName || ''} (#${parent.displayId})${mother.motherName ? '، الأم: ' + mother.motherName : ''}`);
      const fresh = $(prefix + '-name'); if (fresh) { fresh.value = ''; fresh.focus(); }
      flash(`✅ أُضيف ${name} (${createdId})`);
    } catch (err) {
      console.error(err); alert('تعذّرت الإضافة: ' + err.message);
    } finally { const b2 = $(prefix + '-add'); if (b2) b2.disabled = false; btn.disabled = false; }
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

  // إعادة الرسم مع الحفاظ على كل ما كتبه المستخدم ولم يحفظه بعد
  // (تعديلات الزوجات محفوظة في pendingSpouses فلا تضيع أصلاً)
  function renderPanelKeepInputs() {
    const inputs = ['rc-phone', 'rc-father-phone', 'rc-kid-name', 'rc-sib-name'];
    const toggles = ['rc-marital', 'rc-status', 'rc-father-status', 'rc-kid-gender', 'rc-sib-gender'];
    const selects = ['rc-mother', 'rc-kid-mother', 'rc-sib-mother'];
    const state = {};
    inputs.forEach(i => { if ($(i)) state[i] = $(i).value; });
    toggles.forEach(i => { const on = $(i) && $(i).querySelector('.on'); if (on) state[i] = on.dataset.v; });
    selects.forEach(i => { if ($(i)) state[i] = $(i).value; });
    const bd = birthPicker ? birthPicker.getValue() : null;
    const focusedId = document.activeElement && document.activeElement.id;
    const keepFor = currentId, scroll = window.scrollY, hadPanel = !!$('rc-phone');
    renderPanel();
    if (hadPanel && keepFor === currentId) {
      inputs.forEach(i => { if (i in state && $(i)) $(i).value = state[i]; });
      toggles.forEach(i => {
        if (!(i in state) || !$(i)) return;
        $(i).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state[i]));
        if (i === 'rc-marital') applyMaritalVisibility(state[i] === 'married');
      });
      selects.forEach(i => { if (state[i] && $(i) && Array.from($(i).options).some(o => o.value === state[i])) $(i).value = state[i]; });
      if (bd && bd.birthDate && birthPicker) birthPicker.setValue(bd);
      if (focusedId && $(focusedId)) $(focusedId).focus();
    }
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
