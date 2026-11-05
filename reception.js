// =====================================================================
// تبويب «الاستقبال» — لاجتماعات العائلة
// عند وصول الشخص: ابحث عنه برقمه أو اسمه، سلّمه بطاقته، وأكمل بياناته الناقصة.
// كل تعديل يُحفظ مباشرة في الشجرة (المدير فقط حسب قواعد الحماية) ويُسجَّل في سجل النشاط.
// يعتمد على دوال لوحة المدير في admin.js (allPersonsAdmin، escapeHtml، logAdminAction …).
// =====================================================================
(function () {
  let currentId = null;              // المعرّف المعروض حالياً
  let birthPicker = null;
  let attendance = {};               // displayId -> { at, by } لتسليم البطاقات اليوم
  let attendanceUnsub = null;
  const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD بتوقيت الجهاز
  const attendanceRef = () => db.collection('meta').doc('attendance_' + todayKey());

  const $ = id => document.getElementById(id);
  const byId = id => (typeof personsByDisplayIdAdmin !== 'undefined' ? personsByDisplayIdAdmin[String(id)] : null);
  const fullName = p => [p.firstName].concat(ancestorsOfAdmin(p).map(a => a.firstName)).filter(Boolean).join(' ');
  const shortName = p => [p.firstName].concat(ancestorsOfAdmin(p, 2).map(a => a.firstName)).filter(Boolean).join(' ');
  const childrenOf = p => allPersonsAdmin
    .filter(c => String(c.parentKey) === String(p.displayId))
    .sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));
  const splitFamilies = txt => String(txt || '').split(/[،,\n]+/).map(x => x.trim()).filter(Boolean);

  // ------------------------------------------------------------------
  // البحث
  // ------------------------------------------------------------------
  function search(q) {
    q = String(q || '').trim();
    if (!q) return [];
    if (/^\d+$/.test(q)) return allPersonsAdmin.filter(p => String(p.displayId) === q);
    const tokens = normalizeArabic(q).split(' ').filter(Boolean).slice(0, 3);
    const rank = p => { const n = normalizeArabic(p.firstName); return n === tokens[0] ? 0 : (n.startsWith(tokens[0]) ? 1 : 2); };
    return allPersonsAdmin
      .filter(p => p.firstName && matchNameTokensAdmin(p, tokens))
      .sort((a, b) => rank(a) - rank(b) || (Number(a.displayId) - Number(b.displayId)))
      .slice(0, 40);
  }

  function renderResults() {
    const box = $('rc-results');
    const q = $('rc-search').value;
    const list = search(q);
    if (!q.trim()) { box.style.display = 'none'; box.innerHTML = ''; return; }
    if (!list.length) {
      box.innerHTML = '<div class="rc-noresult">لا يوجد شخص بهذا الرقم أو الاسم</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = list.map(p => `
      <button type="button" class="rc-item" data-id="${Number(p.displayId)}">
        <img src="${safeImgSrc(p.photoURL, defaultAvatarAdmin(p.gender))}" alt="">
        <span class="rc-item-name"><b>${escapeHtml(p.firstName || '')}</b> ${escapeHtml(ancestorsOfAdmin(p, 2).map(a => a.firstName).filter(Boolean).join(' '))}</span>
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
  // لوحة الشخص
  // ------------------------------------------------------------------
  function missingHints(p) {
    const out = [];
    if (!hasPhoneAdmin(p)) out.push('📞 بدون رقم جوال');
    if (!hasBirthAdmin(p)) out.push('🎂 بدون تاريخ ميلاد');
    if (isMarriedAdmin(p) && !personFamiliesAdmin(p).length && !(p.spouseLinks || []).length) {
      out.push(p.gender === 'female' ? '💍 عائلة الزوج غير مسجّلة' : '💍 عائلة الزوجة غير مسجّلة');
    }
    if (isMarriedAdmin(p) && p.gender === 'male' && !childrenOf(p).length) out.push('👶 لا يوجد أبناء مسجّلون');
    return out;
  }

  function renderPanel() {
    const panel = $('rc-panel');
    const p = currentId ? byId(currentId) : null;
    if (!p) return;
    const female = p.gender === 'female';
    const married = isMarriedAdmin(p);
    const kids = childrenOf(p);
    const hints = missingHints(p);
    const done = attendance[p.displayId];
    const links = Array.isArray(p.spouseLinks) ? p.spouseLinks : [];
    const fams = personFamiliesAdmin(p);

    panel.innerHTML = `
      <div class="rc-person">
        <img class="rc-photo" src="${safeImgSrc(p.photoURL, defaultAvatarAdmin(p.gender))}" alt="">
        <div class="rc-person-info">
          <div class="rc-name">${escapeHtml(fullName(p))}</div>
          <div class="rc-meta">
            <span class="rc-id">${Number(p.displayId)}</span>
            <span>${female ? 'أنثى' : 'ذكر'}</span>
            <span>${p.status === 'death' ? (female ? 'متوفاة' : 'متوفى') : 'على قيد الحياة'}</span>
            <span>${married ? (female ? 'متزوجة' : 'متزوج') : (female ? 'غير متزوجة' : 'غير متزوج')}</span>
          </div>
          ${hints.length
            ? `<div class="rc-hints">${hints.map(h => `<span class="rc-hint">${h}</span>`).join('')}</div>`
            : '<div class="rc-hints"><span class="rc-hint ok">✔ البيانات الأساسية مكتملة</span></div>'}
        </div>
      </div>

      <div class="rc-actions">
        <button type="button" class="rc-btn ${done ? 'rc-btn-done' : 'rc-btn-primary'}" id="rc-checkin">
          ${done ? `✅ استلم بطاقته (${new Date(done.at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}) — إلغاء` : '🎫 تم تسليم البطاقة'}
        </button>
        <button type="button" class="rc-btn" id="rc-print">🖨️ طباعة بطاقته</button>
        <button type="button" class="rc-btn" id="rc-full-edit">✏️ تعديل كامل</button>
      </div>

      <div class="rc-grid">
        <section class="rc-box">
          <h3>📝 إكمال البيانات</h3>
          <label class="rc-label" for="rc-phone">رقم الجوال</label>
          <input type="tel" id="rc-phone" class="rc-input" dir="ltr" placeholder="05xxxxxxxx" value="${escapeHtml(p.phone || '')}">

          <label class="rc-label">تاريخ الميلاد</label>
          <div id="rc-birth-mount"></div>

          <label class="rc-label">الحالة الاجتماعية</label>
          <div class="rc-toggle" id="rc-marital">
            <button type="button" data-v="single" class="${married ? '' : 'on'}">${female ? 'غير متزوجة' : 'غير متزوج'}</button>
            <button type="button" data-v="married" class="${married ? 'on' : ''}">${female ? 'متزوجة' : 'متزوج'}</button>
          </div>
          <div id="rc-spouse-block" style="${married ? '' : 'display:none;'}">
            <label class="rc-label" for="rc-families">${female ? 'عائلة الزوج' : 'عائلة الزوجة / الزوجات'} <small>(افصل بين أكثر من عائلة بفاصلة)</small></label>
            <input type="text" id="rc-families" class="rc-input" placeholder="${female ? 'مثال: العفالق' : 'مثال: العفالق، الملحم'}" value="${escapeHtml(fams.join('، '))}">
            ${links.length ? `<div class="rc-note">${female ? 'الزوج' : 'الزوجات'} من العائلة: ${links.map(l => `<button type="button" class="rc-chip" data-goto="${Number(l.id)}">${escapeHtml(l.name || '')} (${Number(l.id)})</button>`).join(' ')}</div>` : ''}
            <div class="rc-note">لربط ${female ? 'زوج' : 'زوجة'} من داخل عائلة الماجد استخدم «تعديل كامل».</div>
          </div>
          <button type="button" class="rc-btn rc-btn-primary rc-save" id="rc-save">💾 حفظ البيانات</button>
        </section>

        <section class="rc-box">
          <h3>👨‍👩‍👧 ${female ? 'الأبناء والبنات' : 'الأبناء والبنات'} <small>(${kids.length})</small></h3>
          ${female
            ? '<div class="rc-note">أبناء المرأة يُضافون من صفحة الأب (لأن الشجرة تتبع نسب الأب).</div>'
            : `${kids.length
                ? `<div class="rc-kids">${kids.map(k => `<button type="button" class="rc-chip" data-goto="${Number(k.displayId)}">${k.gender === 'female' ? '👧' : '👦'} ${escapeHtml(k.firstName || '')} <i>${Number(k.displayId)}</i></button>`).join('')}</div>`
                : '<div class="rc-note">لا يوجد أبناء مسجّلون بعد.</div>'}
              <div class="rc-addkid">
                <input type="text" id="rc-kid-name" class="rc-input" placeholder="اسم الابن أو البنت">
                <div class="rc-toggle" id="rc-kid-gender">
                  <button type="button" data-v="male" class="on">ابن</button>
                  <button type="button" data-v="female">ابنة</button>
                </div>
                <button type="button" class="rc-btn rc-btn-primary" id="rc-kid-add">➕ إضافة</button>
              </div>
              <div class="rc-note">يُضاف مباشرة إلى الشجرة تحت ${escapeHtml(p.firstName || '')}. يمكنك إضافة أكثر من واحد تباعاً.</div>`}
          ${p.parentKey && byId(p.parentKey) ? `<div class="rc-note" style="margin-top:12px;">الأب: <button type="button" class="rc-chip" data-goto="${Number(p.parentKey)}">${escapeHtml(shortName(byId(p.parentKey)))} (${Number(p.parentKey)})</button></div>` : ''}
        </section>
      </div>
    `;

    // تاريخ الميلاد
    birthPicker = window.Birthdate ? window.Birthdate.create('rc-birth-mount') : null;
    if (birthPicker && (p.birthDate || p.birthDateHijri)) {
      birthPicker.setValue({ birthDate: p.birthDate, birthDateHijri: p.birthDateHijri, birthDateCal: p.birthDateCal });
    }
    // أزرار التبديل
    panel.querySelectorAll('.rc-toggle').forEach(t => t.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      t.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (t.id === 'rc-marital') $('rc-spouse-block').style.display = b.dataset.v === 'married' ? '' : 'none';
    }));
    panel.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => select(b.dataset.goto)));
    $('rc-save').addEventListener('click', save);
    $('rc-checkin').addEventListener('click', toggleCheckin);
    $('rc-print').addEventListener('click', () => printCard(p));
    $('rc-full-edit').addEventListener('click', () => openAdminEditModal(p));
    const addBtn = $('rc-kid-add');
    if (addBtn) {
      addBtn.addEventListener('click', addChild);
      $('rc-kid-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addChild(); } });
    }
  }

  // ------------------------------------------------------------------
  // حفظ البيانات
  // ------------------------------------------------------------------
  async function save() {
    const p = byId(currentId); if (!p) return;
    const btn = $('rc-save');
    const phone = $('rc-phone').value.trim();
    const married = $('rc-marital').querySelector('.on')?.dataset.v === 'married';
    const families = married ? splitFamilies($('rc-families').value) : [];
    const bd = birthPicker ? birthPicker.getValue() : null;

    const updates = {
      phoneLast4: phoneLast4Of(phone),
      maritalStatus: married ? 'married' : 'single',
      spouseFamilies: families,
      phone: firebase.firestore.FieldValue.delete()
    };
    if (!married) updates.spouseLinks = [];
    if (bd && bd.birthDate) {
      updates.birthDate = bd.birthDate; updates.birthDateHijri = bd.birthDateHijri || ''; updates.birthDateCal = bd.birthDateCal || '';
    }
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    try {
      const batch = db.batch();
      batch.update(db.collection('persons').doc(p.id), updates);
      setPrivatePhone(batch, p.id, phone);
      await batch.commit();
      const changes = [];
      if (String(p.phone || '') !== phone) changes.push('الجوال');
      if (bd && bd.birthDate && bd.birthDate !== p.birthDate) changes.push('تاريخ الميلاد');
      if (married !== isMarriedAdmin(p)) changes.push('الحالة الاجتماعية');
      if (families.join('،') !== personFamiliesAdmin(p).join('،')) changes.push(p.gender === 'female' ? 'عائلة الزوج' : 'عائلة الزوجة');
      logAdminAction('edit', `الاستقبال: تحديث بيانات ${p.firstName || ''} (#${p.displayId})${changes.length ? ' — ' + changes.join('، ') : ''}`);
      flash('✅ تم الحفظ');
    } catch (err) {
      console.error(err); alert('تعذّر الحفظ: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '💾 حفظ البيانات';
    }
  }

  async function addChild() {
    const p = byId(currentId); if (!p) return;
    const input = $('rc-kid-name');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const gender = $('rc-kid-gender').querySelector('.on')?.dataset.v === 'female' ? 'female' : 'male';
    const parentKey = String(p.displayId);
    if (!confirmNotDuplicateAdmin(parentKey, name)) return;
    const btn = $('rc-kid-add'); btn.disabled = true;
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
          motherId: null, motherName: '', parentKey,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(counterRef, { lastId: newId }, { merge: true });
      });
      logAdminAction('add', `الاستقبال: إضافة ${gender === 'female' ? 'ابنة' : 'ابن'} «${name}» (#${createdId}) لـ ${p.firstName || ''} (#${p.displayId})`);
      // اللوحة قد تُعاد رسمها بعد الإضافة، لذلك نعيد جلب الحقل الحالي
      const fresh = $('rc-kid-name'); if (fresh) { fresh.value = ''; fresh.focus(); }
      flash(`✅ أُضيف ${name} (${createdId})`);
    } catch (err) {
      console.error(err); alert('تعذّرت الإضافة: ' + err.message);
    } finally { const b2 = $('rc-kid-add'); if (b2) b2.disabled = false; btn.disabled = false; }
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
      <div class="idc-name"><span>${escapeHtml(name)}</span>${dead ? `<small>${p.gender === 'female' ? 'رحمها الله' : 'رحمه الله'}</small>` : ''}</div>
      <div class="idc-id">الرقم التعريفي<b>${Number(p.displayId)}</b></div>
      <div class="idc-bottom"></div>
    </div></div>`;
    const restore = () => { window.removeEventListener('afterprint', restore); renderIdCards(); };
    window.addEventListener('afterprint', restore);
    // ننتظر تحميل الشعار والصورة قبل الطباعة
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

  // تحديث زر «تسليم البطاقة» فقط (بدون إعادة رسم اللوحة كلها)
  function updateCheckinButton() {
    const p = byId(currentId); const btn = $('rc-checkin'); if (!p || !btn) return;
    const done = attendance[p.displayId];
    btn.className = 'rc-btn ' + (done ? 'rc-btn-done' : 'rc-btn-primary');
    btn.textContent = done
      ? `✅ استلم بطاقته (${new Date(done.at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}) — إلغاء`
      : '🎫 تم تسليم البطاقة';
  }

  // إعادة الرسم مع الحفاظ على كل ما كتبه المستخدم ولم يحفظه بعد
  function renderPanelKeepInputs() {
    const state = {};
    ['rc-phone', 'rc-families', 'rc-kid-name'].forEach(i => { const el = $(i); if (el) state[i] = el.value; });
    ['rc-marital', 'rc-kid-gender'].forEach(i => { const on = $(i) && $(i).querySelector('.on'); if (on) state[i] = on.dataset.v; });
    const bd = birthPicker ? birthPicker.getValue() : null;
    const focusedId = document.activeElement && document.activeElement.id;
    const keepFor = currentId, scroll = window.scrollY;
    const hadPanel = !!$('rc-phone');
    renderPanel();
    if (hadPanel && keepFor === currentId) {
      ['rc-phone', 'rc-families', 'rc-kid-name'].forEach(i => { if (i in state && $(i)) $(i).value = state[i]; });
      ['rc-marital', 'rc-kid-gender'].forEach(i => {
        if (!(i in state) || !$(i)) return;
        $(i).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state[i]));
        if (i === 'rc-marital') $('rc-spouse-block').style.display = state[i] === 'married' ? '' : 'none';
      });
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
        document.addEventListener('click', e => { if (!e.target.closest('.rc-search-wrap')) $('rc-results').style.display = 'none'; });
      }
      listenAttendance();
      setTimeout(() => $('rc-search').focus(), 50);
    },
    // عند أي تحديث في بيانات الأشخاص (بعد الحفظ أو من جهاز آخر)
    onPersonsUpdated() {
      if (currentId && $('tab-panel-reception') && $('tab-panel-reception').classList.contains('active')) renderPanelKeepInputs();
    }
  };
})();
