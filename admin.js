// =====================================================================
// منطق لوحة تحكم المدير
// =====================================================================

let pendingRequests = [];
let allPersonsAdmin = [];
let personsByDisplayIdAdmin = {};
let selectedRootPhotoFile = null;

// حالة تبويب شجرة العائلة (تعديل/إضافة/حذف فوري)
let selectedAdminTargetPerson = null;
let selectedAdminRelationType = null;
let selectedAdminEditPhotoFile = null;
let selectedAdminAddPhotoFile = null;
let adminAddedMembersThisSession = [];

const RELATION_TO_GENDER_ADMIN = { son: 'male', brother: 'male', daughter: 'female', sister: 'female' };

// ---------------------------------------------------------------------
// تسجيل الدخول بكلمة السر
// ---------------------------------------------------------------------
async function handleLogin(evt) {
  evt.preventDefault();
  const pass = document.getElementById('admin-password').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.style.display = 'none';

  const loginBtn = document.getElementById('login-btn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'جارٍ التحقق...';

  try {
    await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pass);
    showAdminPanel();
  } catch (err) {
    console.error('Admin login error:', err.code, err.message);
    errBox.textContent = describeAuthError(err);
    errBox.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'دخول';
  }
}

function describeAuthError(err) {
  switch (err.code) {
    case 'auth/wrong-password':
      return 'كلمة السر غير صحيحة. تأكد أنها مطابقة تماماً لكلمة سر حساب admin@family-tree.local في Firebase Authentication.';
    case 'auth/user-not-found':
      return 'حساب المدير (admin@family-tree.local) غير موجود في Firebase Authentication > Users. أنشئه أولاً (راجع الخطوة 2 في README).';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'كلمة السر غير صحيحة، أو حساب admin@family-tree.local غير موجود. تحقق من الحساب في Firebase Authentication > Users (البريد وكلمة السر يجب أن تتطابق تماماً بدون مسافات زائدة).';
    case 'auth/operation-not-allowed':
      return 'طريقة الدخول بالبريد وكلمة السر غير مُفعّلة. فعّلها من Firebase Console > Authentication > Sign-in method > Email/Password.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
    case 'auth/invalid-app-credential':
      return 'بيانات الاتصال في js/firebase-config.js غير صحيحة أو غير مكتملة. راجعها من إعدادات مشروع Firebase.';
    case 'auth/network-request-failed':
      return 'تعذر الاتصال بالإنترنت أو بخوادم Firebase. تحقق من اتصالك وحاول مجدداً.';
    case 'auth/too-many-requests':
      return 'محاولات كثيرة فاشلة، انتظر قليلاً ثم أعد المحاولة.';
    case 'auth/unauthorized-domain':
      return 'هذا النطاق (الموقع الذي تفتح منه الصفحة) غير مُصرَّح له. أضِفه من Firebase Console > Authentication > Settings > Authorized domains.';
    default:
      return `تعذر تسجيل الدخول (${err.code || err.message}). افتح أدوات المطوّر بالمتصفح (F12) وتبويب Console لمزيد من التفاصيل.`;
  }
}

function handleLogout() {
  auth.signOut().then(() => {
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  });
}

function showAdminPanel() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  listenToRequests();
  listenToPersonsAdmin();
}

// عند إعادة تحميل الصفحة وهناك جلسة مفتوحة مسبقاً
auth.onAuthStateChanged(user => {
  if (user && user.email === ADMIN_EMAIL) {
    showAdminPanel();
  }
});

// ---------------------------------------------------------------------
// التبويبات
// ---------------------------------------------------------------------
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-btn-' + tabName).classList.add('active');
  document.getElementById('tab-panel-' + tabName).classList.add('active');

  // إطار الشجرة يكون بلا مقاس وهو مخفي، لذا نوسّط المعرّف 1 بعد ظهوره
  if (tabName === 'tree') {
    setTimeout(() => { adminTreeCenteredOnce = false; centerAdminTreeOnRootSoon(); }, 80);
  }
  if (tabName === 'cards') renderIdCards();
  if (tabName === 'collect') renderCollectPreview();
  if (tabName === 'proto') renderProtoTree();
}

// ---------------------------------------------------------------------
// نموذج شجرة العائلة: تصميم عمودي أنيق قابل للطيّ (معاينة فقط)
// ---------------------------------------------------------------------
function protoRootsAndChildren() {
  const childrenOf = {};
  const roots = [];
  allPersonsAdmin.forEach(p => {
    const pk = String(p.parentKey || '');
    if (!pk || pk.startsWith('v') || !personsByDisplayIdAdmin[pk]) roots.push(p);
    else { (childrenOf[pk] = childrenOf[pk] || []).push(p); }
  });
  const byId = (a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0);
  roots.sort(byId);
  Object.values(childrenOf).forEach(list => list.sort(byId));
  return { roots, childrenOf };
}

function protoNodeHtml(p, childrenOf, depth, descOf) {
  const kids = childrenOf[String(p.displayId)] || [];
  const female = p.gender === 'female';
  const dead = p.status === 'death';
  const collapsed = kids.length && depth >= 2 ? ' collapsed' : '';
  const av = p.photoURL
    ? `<img class="pnode-av" src="${p.photoURL}" alt="">`
    : `<span class="pnode-av pnode-av-ph ${female ? 'f' : 'm'}">${escapeHtml((p.firstName || '؟').slice(0, 1))}</span>`;
  const chev = kids.length ? '<span class="pnode-chev">▾</span>' : '<span class="pnode-dot"></span>';
  const total = descOf(p.displayId);           // إجمالي من تحته (كل الذريّة)
  const metaBits = [female ? 'أنثى' : 'ذكر'];
  if (dead) metaBits.push('متوفى');
  const countBadge = total > 0 ? `<span class="pnode-count" title="إجمالي من تحته (أبناء وأحفاد...)">👥 ${total}</span>` : '';
  let html =
    `<li class="${collapsed.trim()}">` +
      `<div class="pnode ${female ? 'female' : 'male'}${dead ? ' dead' : ''}">` +
        chev + av +
        `<span class="pnode-info">` +
          `<span class="pnode-name">${escapeHtml(p.firstName || '')} <b class="pnode-id">#${p.displayId}</b></span>` +
          `<span class="pnode-meta">${metaBits.join(' • ')}</span>` +
        `</span>` +
        countBadge +
      `</div>`;
  if (kids.length) {
    html += '<ul>' + kids.map(k => protoNodeHtml(k, childrenOf, depth + 1, descOf)).join('') + '</ul>';
  }
  html += '</li>';
  return html;
}

function renderProtoTree() {
  const box = document.getElementById('proto-tree');
  if (!box) return;
  if (!allPersonsAdmin.length) { box.innerHTML = '<div class="empty-state">لا توجد بيانات بعد.</div>'; return; }
  const { roots, childrenOf } = protoRootsAndChildren();
  // عدّاد إجمالي الذريّة تحت كل شخص (مع تخزين مؤقّت)
  const memo = {};
  const descOf = (id) => {
    id = String(id);
    if (memo[id] != null) return memo[id];
    const kids = childrenOf[id] || [];
    let c = kids.length;
    for (const k of kids) c += descOf(k.displayId);
    memo[id] = c; return c;
  };
  box.innerHTML = '<ul class="ptree">' + roots.map(r => protoNodeHtml(r, childrenOf, 0, descOf)).join('') + '</ul>';
}

function protoSetAll(collapsed) {
  document.querySelectorAll('#proto-tree li').forEach(li => {
    if (li.querySelector(':scope > ul')) li.classList.toggle('collapsed', collapsed);
  });
}

// ---------------------------------------------------------------------
// جمع البيانات: تقسيم الشجرة إلى فروع + تصدير Excel
// ---------------------------------------------------------------------
function isNumericParent(pk) { return pk != null && /^\d+$/.test(String(pk)); }

// «رأس الفرع» = الابن المباشر للجذر الذي ينحدر منه هذا الشخص
function branchHeadOf(person) {
  const byId = personsByDisplayIdAdmin;
  let cur = person, guard = 0;
  while (guard++ < 500) {
    const pk = String(cur.parentKey || '');
    if (!pk || pk.startsWith('v') || !byId[pk]) return cur;   // cur جذر بذاته
    const parent = byId[pk];
    const ppk = String(parent.parentKey || '');
    if (!ppk || ppk.startsWith('v') || !byId[ppk]) return cur; // والد cur هو الجذر ⇒ cur رأس فرع
    cur = parent;
  }
  return cur;
}

// يجمع الأفراد في فروع حسب رأس كل فرع، مرتّبة
function computeBranches() {
  const groups = new Map();
  allPersonsAdmin.forEach(p => {
    const head = branchHeadOf(p);
    const key = String(head.displayId);
    if (!groups.has(key)) groups.set(key, { head, members: [] });
    groups.get(key).members.push(p);
  });
  const arr = Array.from(groups.values());
  arr.forEach(g => g.members.sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0)));
  arr.sort((a, b) => (Number(a.head.displayId) || 0) - (Number(b.head.displayId) || 0));
  return arr;
}

// معاينة الفروع في التبويب
function renderCollectPreview() {
  const box = document.getElementById('collect-branches-preview');
  if (!box) return;
  if (!allPersonsAdmin.length) { box.innerHTML = '<div class="empty-state">لا توجد بيانات بعد.</div>'; return; }
  const branches = computeBranches();
  box.innerHTML = `<div class="collect-title">الفروع (${branches.length}) — كل فرع ورقة منفصلة في الملف:</div>` +
    branches.map(b => `<div class="collect-branch-row"><b>فرع ${escapeHtml(b.head.firstName)} (#${b.head.displayId})</b><span>${b.members.length} فرد</span></div>`).join('');
}

const COLLECT_COLS = ['الرقم التعريفي', 'الاسم الأول', 'اسم الأب', 'اسم الجد', 'الجنس', 'رقم التواصل', 'تاريخ الميلاد', 'الحالة', 'الحالة الاجتماعية', 'اسم عائلة الزوجة', 'معرّف الأب (للربط)'];

function collectPersonRow(p) {
  const anc = ancestorsOfAdmin(p, 2);
  const father = anc[0], grandfather = anc[1];
  const wives = personFamiliesAdmin(p).concat((Array.isArray(p.spouseLinks) ? p.spouseLinks : []).map(s => s.name)).filter(Boolean);
  return {
    'الرقم التعريفي': p.displayId,
    'الاسم الأول': p.firstName || '',
    'اسم الأب': father ? father.firstName : '',
    'اسم الجد': grandfather ? grandfather.firstName : '',
    'الجنس': p.gender === 'female' ? 'أنثى' : 'ذكر',
    'رقم التواصل': p.phone || '',
    'تاريخ الميلاد': '',
    'الحالة': p.status === 'death' ? 'متوفى' : 'على قيد الحياة',
    'الحالة الاجتماعية': p.maritalStatus === 'married'
      ? (p.gender === 'female' ? 'متزوجة' : 'متزوج')
      : (p.gender === 'female' ? 'غير متزوجة' : 'غير متزوج'),
    'اسم عائلة الزوجة': wives.join('، '),
    'معرّف الأب (للربط)': isNumericParent(p.parentKey) ? Number(p.parentKey) : ''
  };
}

function sheetSafeName(name, used) {
  let n = String(name).replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28);
  if (!n) n = 'فرع';
  let base = n, i = 1;
  while (used.has(n)) { n = (base.slice(0, 24) + ' ' + (++i)); }
  used.add(n);
  return n;
}

async function downloadCollectionXlsx(btnEl) {
  if (!allPersonsAdmin.length) { alert('لا توجد بيانات لتصديرها.'); return; }
  const original = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'جارٍ التجهيز...'; }
  try {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const XLSX = window.XLSX;
    const branches = computeBranches();

    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };   // عرض من اليمين لليسار

    // ورقة التعليمات
    const instr = [
      ['تعليمات جمع البيانات — عائلة الماجد'],
      [''],
      ['• كل ورقة في هذا الملف تمثّل «فرعاً» من العائلة. وزّع كل ورقة على الشخص المسؤول عن ذلك الفرع.'],
      ['• الهدف: التأكّد من البيانات الحالية وتعبئة الناقص (مثل تاريخ الميلاد ورقم التواصل).'],
      ['• لا تُغيّر عمودَي «الرقم التعريفي» و«معرّف الأب (للربط)» — يُستخدمان لربط الأشخاص في الموقع.'],
      ['• عبّئ الأعمدة الفارغة وصحّح أي خطأ في الأسماء أو الحالة.'],
      ['• الجنس: ذكر / أنثى. الحالة: على قيد الحياة / متوفى. الحالة الاجتماعية: متزوج / غير متزوج.'],
      ['• تاريخ الميلاد: اكتبه بصيغة يوم/شهر/سنة (اتفقوا على هجري أو ميلادي).'],
      ['• بعد التعبئة أعِد الملف للمدير لإدخال/تحديث البيانات في الموقع.'],
      [''],
      ['راجع ورقة «ملخّص الفروع» لتوزيع المسؤوليات.']
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instr);
    instrWs['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, instrWs, 'تعليمات');

    // ورقة ملخّص الفروع
    const sumData = [['الفرع', 'عدد الأفراد', 'المسؤول (اكتب الاسم)']]
      .concat(branches.map(b => [`فرع ${b.head.firstName} (#${b.head.displayId})`, b.members.length, '']));
    const sumWs = XLSX.utils.aoa_to_sheet(sumData);
    sumWs['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, sumWs, 'ملخّص الفروع');

    // ورقة لكل فرع
    const used = new Set(['تعليمات', 'ملخّص الفروع']);
    const widths = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 7 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 14 }];
    branches.forEach(b => {
      const rows = b.members.map(collectPersonRow);
      const ws = XLSX.utils.json_to_sheet(rows, { header: COLLECT_COLS });
      ws['!cols'] = widths;
      ws['!views'] = [{ RTL: true }];
      XLSX.utils.book_append_sheet(wb, ws, sheetSafeName(`فرع ${b.head.firstName} ${b.head.displayId}`, used));
    });

    XLSX.writeFile(wb, 'بيانات_عائلة_الماجد.xlsx');
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء ملف Excel: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = original; }
  }
}

// الاسم الثلاثي + «الماجد» للبطاقة التعريفية
function idCardName(person) {
  const names = [person.firstName]
    .concat(ancestorsOfAdmin(person, 2).map(a => a.firstName))
    .filter(Boolean);
  return names.join(' ') + ' الماجد';
}

// فلتر الجنس للبطاقات: all | male | female
let idCardsGenderFilter = 'all';

// بطاقات تعريفية للأحياء فقط (اسم ثلاثي + معرّف) — للطباعة، مع فلتر الجنس
function renderIdCards() {
  const box = document.getElementById('id-cards-print');
  const countEl = document.getElementById('id-cards-count');
  if (!box) return;
  const living = allPersonsAdmin
    .filter(p => p.status === 'alive' && (idCardsGenderFilter === 'all' || p.gender === idCardsGenderFilter))
    .sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));
  if (countEl) countEl.textContent = living.length;
  if (!living.length) {
    box.innerHTML = '<div class="empty-state">لا يوجد أفراد مطابقون لعرض بطاقاتهم.</div>';
    return;
  }
  box.innerHTML = living.map(p => `
    <div class="id-card">
      <img class="id-card-logo" src="logo.jpg" alt="" onerror="this.style.display='none'">
      <div class="id-card-family">عائلة الماجد</div>
      <div class="id-card-name">${escapeHtml(idCardName(p))}</div>
      <div class="id-card-idrow"><span>الرقم التعريفي</span><b class="id-card-num">${p.displayId}</b></div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------
// تبويب: الطلبات المعلقة
// ---------------------------------------------------------------------
function listenToRequests() {
  // ملاحظة: تم تعمّد عدم استخدام orderBy هنا مع where لتفادي الحاجة لإنشاء
  // فهرس مركّب (composite index) في Firestore. الترتيب يتم يدوياً في المتصفح بدلاً من ذلك.
  db.collection('requests').where('requestStatus', '==', 'pending')
    .onSnapshot(snapshot => {
      pendingRequests = [];
      snapshot.forEach(doc => pendingRequests.push({ id: doc.id, ...doc.data() }));
      pendingRequests.sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt ? b.createdAt.toMillis() : 0;
        return ta - tb;
      });
      renderRequests();
    }, err => {
      console.error('listenToRequests error:', err.code, err.message);
    });
}

const RELATION_LABELS_AR = { son: 'ابن', daughter: 'ابنة', brother: 'أخ', sister: 'أخت' };
const STATUS_LABELS_AR = { alive: 'على قيد الحياة', death: 'متوفى' };
const GENDER_LABELS_AR = { male: 'ذكر', female: 'أنثى' };

// وصف الحالة الاجتماعية بصيغة تناسب جنس الشخص
function maritalLabel(maritalStatus, gender, families) {
  const female = gender === 'female';
  const list = Array.isArray(families) ? families.filter(Boolean) : (families ? [families] : []);
  if (maritalStatus === 'married') {
    const who = female ? 'عائلة الزوج' : (list.length > 1 ? 'عوائل الزوجات' : 'عائلة الزوجة');
    return (female ? 'متزوجة' : 'متزوج') + (list.length ? ` — ${who}: ${list.join('، ')}` : '');
  }
  return female ? 'غير متزوجة' : 'غير متزوج';
}

// اسم الأم للعرض (من العائلة: معرّف واسم؛ من خارجها: نص؛ أو لا يوجد)
function motherDisplay(motherId, motherName) {
  if (motherId) {
    const p = allPersonsAdmin.find(x => x.displayId === Number(motherId)) || {};
    return '(' + motherId + ') ' + (p.firstName || '');
  }
  return motherName || 'لا يوجد';
}

// تفصيل التغييرات في طلب التحديث: قبل ← بعد (يعرض المتغيّر فقط)
function renderUpdateDiff(r) {
  const person = allPersonsAdmin.find(p => p.displayId === r.targetPersonId) || {};
  const g = person.gender;
  const lines = [];
  const row = (label, before, after) =>
    `<div class="req-meta">• <b>${label}:</b> <span class="diff-old">${escapeHtml(before)}</span> ← <span class="diff-new">${escapeHtml(after)}</span></div>`;

  // رقم التواصل (يُرسَل فقط إن طُلب تغييره)
  if (typeof r.phone === 'string' && String(person.phone || '') !== String(r.phone || '')) {
    lines.push(row('رقم التواصل', person.phone || 'لا يوجد', r.phone || 'حُذف'));
  }
  // الحالة
  if (r.status && r.status !== person.status) {
    lines.push(row('الحالة', STATUS_LABELS_AR[person.status] || person.status || '—', STATUS_LABELS_AR[r.status] || r.status));
  }
  // الحالة الاجتماعية + الأزواج
  const beforeM = maritalLabel(person.maritalStatus, g, person.spouseFamilies) + spouseLinksLabel(g, person.spouseLinks);
  const afterM = maritalLabel(r.maritalStatus, g, r.spouseFamilies || r.spouseFamily) + spouseLinksLabel(g, r.spouseLinks);
  if (beforeM !== afterM) lines.push(row('الحالة الاجتماعية', beforeM, afterM));
  // الأم
  const beforeMo = motherDisplay(person.motherId, person.motherName);
  const afterMo = motherDisplay(r.motherId, r.motherName);
  if (('motherId' in r || 'motherName' in r) && beforeMo !== afterMo) lines.push(row('الأم', beforeMo, afterMo));
  // الصورة
  if (r.photoURL) lines.push(`<div class="req-meta">• <b>الصورة:</b> <span class="diff-new">تم رفع صورة جديدة</span></div>`);

  if (!lines.length) lines.push('<div class="req-meta">لا تغييرات فعلية على البيانات (الطلب مطابق للحالي).</div>');
  return lines.join('');
}

// وصف الأزواج المرتبطين من داخل الشجرة
function spouseLinksLabel(gender, links) {
  const list = Array.isArray(links) ? links.filter(l => l && l.id != null) : [];
  if (!list.length) return '';
  const who = gender === 'female' ? 'الزوج من العائلة' : 'الزوجة من العائلة';
  return ` — ${who}: ${list.map(l => `(${l.id}) ${l.name || ''}`.trim()).join('، ')}`;
}

function renderRequests() {
  const list = document.getElementById('requests-list');
  document.getElementById('requests-count').textContent = pendingRequests.length;

  if (pendingRequests.length === 0) {
    list.innerHTML = '<div class="empty-state">لا توجد طلبات معلقة حالياً</div>';
    return;
  }

  list.innerHTML = '';
  pendingRequests.forEach(r => {
    const row = document.createElement('div');
    row.className = 'request-card';

    if (r.requestType === 'update') {
      row.innerHTML = `
        <img class="req-photo" src="${r.photoURL || ''}" onerror="this.style.visibility='hidden'">
        <div class="req-info">
          <div class="req-name">✏️ طلب تحديث بيانات: <b>${escapeHtml(r.targetPersonName || '')}</b> (#${r.targetPersonId})</div>
          <div class="req-diff-title">تفاصيل التغييرات المطلوبة (قبل ← بعد):</div>
          ${renderUpdateDiff(r)}
        </div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approve-update="${r.id}">قبول</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">رفض</button>
        </div>
      `;
    } else if (r.requestType === 'addBatch') {
      const members = r.members || [];
      const membersHtml = members.map(m =>
        `<div class="req-meta">• ${escapeHtml(m.firstName)} — ${RELATION_LABELS_AR[m.relationType] || m.relationType} (${GENDER_LABELS_AR[m.gender] || ''})${m.phone ? ' — ' + escapeHtml(m.phone) : ''} — ${escapeHtml(maritalLabel(m.maritalStatus, m.gender, m.spouseFamilies || m.spouseFamily) + spouseLinksLabel(m.gender, m.spouseLinks))}${(m.motherId || m.motherName) ? ' — الأم: ' + escapeHtml(m.motherId ? ('(' + m.motherId + ') ' + ((allPersonsAdmin.find(p => p.displayId === Number(m.motherId)) || {}).firstName || '')) : m.motherName) : ''}</div>`
      ).join('');
      row.innerHTML = `
        <div class="req-info">
          <div class="req-name">➕ طلب إضافة ${members.length} فرد لـ <b>${escapeHtml(r.targetPersonName || '')}</b> (#${r.targetPersonId})</div>
          ${membersHtml}
        </div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approve-batch="${r.id}">قبول الكل</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">رفض</button>
        </div>
      `;
    } else {
      row.innerHTML = `
        <img class="req-photo" src="${r.photoURL || ''}" onerror="this.style.visibility='hidden'">
        <div class="req-info">
          <div class="req-name">${escapeHtml(r.firstName)} <span class="req-gender">(${GENDER_LABELS_AR[r.gender] || ''})</span></div>
          <div class="req-meta">${RELATION_LABELS_AR[r.relationType] || r.relationType} لِـ <b>${escapeHtml(r.targetPersonName || '')}</b> (#${r.targetPersonId})</div>
          <div class="req-meta">الهاتف: ${escapeHtml(r.phone || '—')} | الحالة: ${STATUS_LABELS_AR[r.status] || r.status}</div>
        </div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approve="${r.id}">قبول</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">رفض</button>
        </div>
      `;
    }
    list.appendChild(row);
  });

  list.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveRequest(btn.dataset.approve, btn));
  });
  list.querySelectorAll('[data-approve-update]').forEach(btn => {
    btn.addEventListener('click', () => approveUpdateRequest(btn.dataset.approveUpdate, btn));
  });
  list.querySelectorAll('[data-approve-batch]').forEach(btn => {
    btn.addEventListener('click', () => approveBatchRequest(btn.dataset.approveBatch, btn));
  });
  list.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => rejectRequest(btn.dataset.reject, btn));
  });
}

async function approveRequest(requestId, btnEl) {
  btnEl.disabled = true;
  try {
    const reqRef = db.collection('requests').doc(requestId);
    const counterRef = db.collection('meta').doc('counter');

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) throw new Error('الطلب لم يعد موجوداً');
      const reqData = reqSnap.data();
      if (reqData.requestStatus !== 'pending') throw new Error('تمت معالجة هذا الطلب مسبقاً');

      const counterSnap = await tx.get(counterRef);
      const lastId = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;
      const newId = lastId + 1;

      const personRef = db.collection('persons').doc();
      tx.set(personRef, {
        displayId: newId,
        firstName: reqData.firstName,
        gender: reqData.gender,
        photoURL: reqData.photoURL || '',
        phone: reqData.phone || '',
        status: reqData.status,
        maritalStatus: reqData.maritalStatus || 'single',
        spouseFamilies: reqData.spouseFamilies || (reqData.spouseFamily ? [reqData.spouseFamily] : []),
        parentKey: reqData.parentKey,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      tx.set(counterRef, { lastId: newId }, { merge: true });
      tx.update(reqRef, { requestStatus: 'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btnEl.disabled = false;
  }
}

/**
 * قبول طلب إضافة جماعي (addBatch): ينشئ كل الأفراد الموجودين في القائمة دفعة واحدة
 */
async function approveBatchRequest(requestId, btnEl) {
  btnEl.disabled = true;
  try {
    const reqRef = db.collection('requests').doc(requestId);
    const counterRef = db.collection('meta').doc('counter');
    const batchReciprocal = [];

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) throw new Error('الطلب لم يعد موجوداً');
      const reqData = reqSnap.data();
      if (reqData.requestStatus !== 'pending') throw new Error('تمت معالجة هذا الطلب مسبقاً');

      const counterSnap = await tx.get(counterRef);
      let lastId = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;

      const members = reqData.members || [];
      members.forEach(m => {
        lastId += 1;
        const married = (m.maritalStatus || 'single') === 'married';
        const personRef = db.collection('persons').doc();
        tx.set(personRef, {
          displayId: lastId,
          firstName: m.firstName,
          gender: m.gender,
          photoURL: m.photoURL || '',
          phone: m.phone || '',
          status: 'alive',
          maritalStatus: m.maritalStatus || 'single',
          spouseFamilies: married ? (m.spouseFamilies || (m.spouseFamily ? [m.spouseFamily] : [])) : [],
          spouseLinks: married ? (m.spouseLinks || []) : [],
          motherId: (typeof m.motherId === 'number') ? m.motherId : null,
          motherName: (typeof m.motherName === 'string') ? m.motherName : '',
          parentKey: m.parentKey,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // نجمع الروابط لتطبيق الربط التبادلي بعد نجاح المعاملة
        if (married && Array.isArray(m.spouseLinks) && m.spouseLinks.length) {
          batchReciprocal.push({ memberId: lastId, memberName: m.firstName, links: m.spouseLinks });
        }
      });

      tx.set(counterRef, { lastId }, { merge: true });
      tx.update(reqRef, { requestStatus: 'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });

    // ربط تبادلي (خارج المعاملة): إضافة كل فرد جديد كزوج لدى زوجاته المرتبطة من العائلة
    for (const rec of batchReciprocal) {
      for (const link of rec.links) {
        try {
          const q = await db.collection('persons').where('displayId', '==', Number(link.id)).limit(1).get();
          if (q.empty) continue;
          const ref = q.docs[0].ref;
          const existing = Array.isArray(q.docs[0].data().spouseLinks) ? q.docs[0].data().spouseLinks : [];
          if (!existing.some(s => Number(s.id) === Number(rec.memberId))) {
            existing.push({ id: Number(rec.memberId), name: rec.memberName || '' });
            await ref.update({ maritalStatus: 'married', spouseLinks: existing });
          }
        } catch (e) { console.error('تعذّر الربط التبادلي (دفعة) مع', link, e); }
      }
    }
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btnEl.disabled = false;
  }
}

/**
 * قبول طلب تحديث بيانات: يعدّل مستند الشخص الموجود بدلاً من إنشاء شخص جديد
 */
async function approveUpdateRequest(requestId, btnEl) {
  btnEl.disabled = true;
  try {
    const reqRef = db.collection('requests').doc(requestId);
    let approvedReq = null;

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) throw new Error('الطلب لم يعد موجوداً');
      const reqData = reqSnap.data();
      if (reqData.requestStatus !== 'pending') throw new Error('تمت معالجة هذا الطلب مسبقاً');

      const personQuery = await db.collection('persons').where('displayId', '==', reqData.targetPersonId).limit(1).get();
      if (personQuery.empty) throw new Error('الشخص المستهدف لم يعد موجوداً في الشجرة');
      const personRef = personQuery.docs[0].ref;

      const updates = {};
      // نقبل النص الفارغ أيضاً حتى يتمكن المستخدم من حذف رقمه
      if (typeof reqData.phone === 'string') updates.phone = reqData.phone;
      if (reqData.photoURL) updates.photoURL = reqData.photoURL;
      if (reqData.status) updates.status = reqData.status;
      if (reqData.maritalStatus) {
        updates.maritalStatus = reqData.maritalStatus;
        const married = reqData.maritalStatus === 'married';
        // يمكن الجمع بين النوعين: زوجات من العائلة (روابط) + زوجات من خارجها (أسماء عوائل)
        updates.spouseFamilies = married
          ? (reqData.spouseFamilies || (reqData.spouseFamily ? [reqData.spouseFamily] : []))
          : [];
        updates.spouseLinks = married ? (reqData.spouseLinks || []) : [];
      }
      // الأم (ربط بمعرّف شخص في الشجرة، أو اسم عائلة الأم من خارج الشجرة)
      if (reqData.motherId === null || typeof reqData.motherId === 'number') {
        updates.motherId = reqData.motherId;
      }
      if (typeof reqData.motherName === 'string') {
        updates.motherName = reqData.motherName;
      }

      tx.update(personRef, updates);
      tx.update(reqRef, { requestStatus: 'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
      approvedReq = reqData;
    });

    // ربط تبادلي (خارج المعاملة): نضيف هذا الشخص كزوج/زوجة لدى كل شخص مرتبط من العائلة
    if (approvedReq && approvedReq.maritalStatus === 'married'
        && Array.isArray(approvedReq.spouseLinks) && approvedReq.spouseLinks.length) {
      for (const link of approvedReq.spouseLinks) {
        try {
          const q = await db.collection('persons').where('displayId', '==', Number(link.id)).limit(1).get();
          if (q.empty) continue;
          const ref = q.docs[0].ref;
          const existing = Array.isArray(q.docs[0].data().spouseLinks) ? q.docs[0].data().spouseLinks : [];
          if (!existing.some(s => Number(s.id) === Number(approvedReq.targetPersonId))) {
            existing.push({ id: Number(approvedReq.targetPersonId), name: approvedReq.targetPersonName || '' });
            await ref.update({ maritalStatus: 'married', spouseLinks: existing });
          }
        } catch (e) { console.error('تعذّر الربط التبادلي مع', link, e); }
      }
    }
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btnEl.disabled = false;
  }
}

async function rejectRequest(requestId, btnEl) {
  btnEl.disabled = true;
  try {
    await db.collection('requests').doc(requestId).update({
      requestStatus: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btnEl.disabled = false;
  }
}

// ---------------------------------------------------------------------
// تبويب: كل الأشخاص
// ---------------------------------------------------------------------
function listenToPersonsAdmin() {
  db.collection('persons').orderBy('displayId').onSnapshot(snapshot => {
    allPersonsAdmin = [];
    snapshot.forEach(doc => allPersonsAdmin.push({ id: doc.id, ...doc.data() }));
    personsByDisplayIdAdmin = {};
    allPersonsAdmin.forEach(p => { personsByDisplayIdAdmin[String(p.displayId)] = p; });
    renderPersonsList(allPersonsAdmin);
    renderAdminTree();
    renderIdCards();
    renderCollectPreview();
    renderProtoTree();
  }, err => console.error(err));
}

// ---------------------------------------------------------------------
// تبويب: شجرة العائلة (عرض تفاعلي + تعديل/إضافة/حذف فوري بدون مراجعة)
// ---------------------------------------------------------------------
function defaultAvatarAdmin(gender) {
  const color = gender === 'female' ? '%23b2793b' : '%23175939';
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='${color}' opacity='0.25'/><circle cx='50' cy='38' r='18' fill='${color}'/><ellipse cx='50' cy='82' rx='30' ry='22' fill='${color}'/></svg>`;
}

function renderAdminTree() {
  const container = document.getElementById('admin-tree-forest');
  if (!container) return;
  container.innerHTML = '';

  if (allPersonsAdmin.length === 0) {
    container.innerHTML = '<div class="empty-state">لا يوجد أي أفراد في الشجرة بعد. استخدم زر "+ إضافة شخص مباشرة" من تبويب كل الأشخاص لإضافة أول فرد.</div>';
    return;
  }

  const childrenByParentKey = {};
  allPersonsAdmin.forEach(p => {
    const key = String(p.parentKey);
    if (!childrenByParentKey[key]) childrenByParentKey[key] = [];
    childrenByParentKey[key].push(p);
  });

  // ترتيب الجذور بحسب أصغر معرّف حتى تبدأ الشجرة دائماً بالمعرّف 1
  const virtualRootKeys = Object.keys(childrenByParentKey)
    .filter(k => k.startsWith('v'))
    .sort((a, b) => {
      const minOf = key => Math.min(...(childrenByParentKey[key] || []).map(p => Number(p.displayId) || 1e9));
      return minOf(a) - minOf(b);
    });

  virtualRootKeys.forEach(vKey => {
    const rootPersons = (childrenByParentKey[vKey] || [])
      .slice()
      .sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));
    const ul = document.createElement('ul');
    ul.className = 'tree-list root-list';
    rootPersons.forEach(p => ul.appendChild(buildAdminPersonNode(p, childrenByParentKey)));
    container.appendChild(ul);
  });

  applyAdminTreeZoom();
  enableAdminTreePan(document.getElementById('admin-tree-viewport'));

  // عند أول عرض: توسيط صاحب المعرّف 1 في منتصف الشاشة
  if (!adminTreeCenteredOnce) centerAdminTreeOnRootSoon();
}

function buildAdminPersonNode(person, childrenByParentKey) {
  const li = document.createElement('li');
  const node = document.createElement('div');
  const isDead = person.status === 'death';
  node.className = `person-node ${person.gender}${isDead ? ' deceased' : ''}`;
  node.id = 'admin-person-node-' + person.displayId;
  node.onclick = () => openAdminNodeModal(person);

  const photoWrap = document.createElement('div');
  photoWrap.className = 'photo-wrap';
  const img = document.createElement('img');
  img.className = 'person-photo';
  img.src = person.photoURL || defaultAvatarAdmin(person.gender);
  img.alt = person.firstName;
  photoWrap.appendChild(img);
  if (isDead) {
    const ribbon = document.createElement('span');
    ribbon.className = 'mourning-ribbon';
    photoWrap.appendChild(ribbon);
  }
  node.appendChild(photoWrap);

  const nameEl = document.createElement('div');
  nameEl.className = 'person-name';
  nameEl.textContent = person.firstName;
  node.appendChild(nameEl);

  const idEl = document.createElement('div');
  idEl.className = 'person-id';
  idEl.textContent = `#${person.displayId}` + (person.status === 'death' ? ' • متوفى' : '');
  node.appendChild(idEl);

  li.appendChild(node);

  const kids = childrenByParentKey[String(person.displayId)] || [];
  if (kids.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'tree-list';
    kids.forEach(k => ul.appendChild(buildAdminPersonNode(k, childrenByParentKey)));
    li.appendChild(ul);
  }
  return li;
}

function resizeImageToBase64Admin(file, maxSize, quality) {
  return resizeImageToBase64(file, maxSize, quality);
}

// --- نافذة اختيار الإجراء ---
function openAdminNodeModal(person) {
  selectedAdminTargetPerson = person;
  document.getElementById('admin-node-modal-title').textContent = `${person.firstName} (#${person.displayId}) — ماذا تريد أن تفعل؟`;
  document.getElementById('admin-node-choice-buttons').style.display = 'flex';
  document.getElementById('admin-delete-confirm').style.display = 'none';
  document.getElementById('admin-node-modal').classList.add('open');
}
function closeAdminNodeModal() {
  document.getElementById('admin-node-modal').classList.remove('open');
}
function showAdminDeleteConfirm() {
  document.getElementById('admin-node-choice-buttons').style.display = 'none';
  document.getElementById('admin-delete-confirm').style.display = 'block';
}

// --- نافذة تعديل مباشر ---

// ---------------------------------------------------------------------
// حقل يقبل أكثر من اسم عائلة
// ---------------------------------------------------------------------
// \u062A\u0648\u062D\u064A\u062F \u0627\u0644\u062D\u0631\u0648\u0641 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u062D\u062A\u0649 \u062A\u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u062E\u062A\u0644\u0641\u0629 \u0641\u064A \u0627\u0644\u0628\u062D\u062B:
// \u0623/\u0625/\u0622/\u0671 \u2192 \u0627 \u060C \u0629 \u2192 \u0647 \u060C \u0649 \u2192 \u064A \u060C \u0624 \u2192 \u0648 \u060C \u0626 \u2192 \u064A \u060C \u0648\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062A\u0634\u0643\u064A\u0644 \u0648\u0627\u0644\u062A\u0637\u0648\u064A\u0644
function normalizeArabic(s) {
  return String(s || '')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function familyKeyAdmin(name) {
  return normalizeArabic(name).replace(/^(\u0627\u0644|\u0622\u0644)\s*/, '').trim();
}

function personFamiliesAdmin(p) {
  if (Array.isArray(p.spouseFamilies)) return p.spouseFamilies.filter(Boolean);
  return p.spouseFamily ? [p.spouseFamily] : [];
}

function createFamilyListAdmin(inputId, addBtnId, chipsId, canAddFn) {
  const input = document.getElementById(inputId);
  const addBtn = document.getElementById(addBtnId);
  const chips = document.getElementById(chipsId);
  const state = [];

  function render() {
    if (!chips) return;
    chips.innerHTML = '';
    state.forEach((name, i) => {
      const chip = document.createElement('span');
      chip.className = 'family-chip-edit';
      chip.appendChild(document.createTextNode(name));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'family-chip-remove';
      x.textContent = '\u2715';
      x.addEventListener('click', () => { state.splice(i, 1); render(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  function add() {
    if (!input) return;
    const v = input.value.trim().replace(/\s+/g, ' ');
    if (!v) return;
    if (canAddFn && !canAddFn()) { input.value = ''; return; }
    if (!state.some(x => familyKeyAdmin(x) === familyKeyAdmin(v))) state.push(v);
    input.value = '';
    render();
  }

  if (addBtn) addBtn.addEventListener('click', add);
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  return {
    values() { add(); return state.slice(); },
    size() { return state.length; },
    set(list) {
      state.length = 0;
      (list || []).forEach(v => { const t = String(v).trim(); if (t) state.push(t); });
      if (input) input.value = '';
      render();
    },
    clear() { this.set([]); }
  };
}

let adminEditFamilyList = null;
let adminAddFamilyList = null;
let rootFamilyList = null;

function applyMaritalLabelsAdmin(scopeEl, gender) {
  if (!scopeEl) return;
  const female = gender === 'female';
  scopeEl.querySelectorAll('.marital-single-lbl').forEach(el => { el.textContent = female ? 'غير متزوجة' : 'غير متزوج'; });
  scopeEl.querySelectorAll('.marital-married-lbl').forEach(el => { el.textContent = female ? 'متزوجة' : 'متزوج'; });
  scopeEl.querySelectorAll('.spouse-label').forEach(el => { el.textContent = female ? 'عائلة الزوج' : 'عائلة الزوجة'; });
  scopeEl.querySelectorAll('#admin-edit-spouse-family, #admin-add-spouse-family, #root-spouse-family').forEach(el => { el.placeholder = female ? 'اسم عائلة الزوج' : 'اسم عائلة الزوجة'; });
  scopeEl.querySelectorAll('.spouse-origin-label').forEach(el => { el.textContent = female ? 'هل الزوج من عائلة الماجد؟' : 'هل الزوجة من عائلة الماجد؟'; });
  scopeEl.querySelectorAll('.spouse-link-label').forEach(el => {
    el.textContent = female ? 'ابحث عن الزوج في شجرة العائلة (بالمعرّف أو الاسم)' : 'ابحث عن الزوجة في شجرة العائلة (بالمعرّف أو الاسم)';
  });
  const secLbl = scopeEl.querySelector('#admin-edit-spouse-section-label');
  if (secLbl) secLbl.textContent = female ? 'الزوج المسجّل' : 'الزوجات المسجّلات';
  const multiHint = scopeEl.querySelector('#admin-edit-spouse-multi-hint');
  if (multiHint) multiHint.textContent = female
    ? 'يمكن إضافة زوج واحد فقط: اختر «نعم» للبحث عنه في الشجرة، أو «لا» لكتابة اسم عائلته.'
    : 'أضِف كل زوجة على حدة: اختر «نعم» للبحث عنها في الشجرة، أو «لا» لكتابة اسم عائلتها.';
}

// اقتراحات الأشخاص (معرّف أو اسم) للربط داخل لوحة المدير
function matchPersonsAdmin(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) return allPersonsAdmin.filter(p => String(p.displayId) === q);
  const tokens = nameSearchTokensAdmin(q);
  if (!tokens.length) return [];
  return allPersonsAdmin.filter(p => p.firstName && matchByNameTokensAdmin(p, tokens)).slice(0, 8);
}

// قائمة ربط الأزواج من داخل الشجرة (لوحة المدير) — تخزّن {id, name}
function createSpouseLinkListAdmin(inputId, sugId, chipsId, canAddFn) {
  const input = document.getElementById(inputId);
  const sug = document.getElementById(sugId);
  const chips = document.getElementById(chipsId);
  const state = [];

  function renderChips() {
    if (!chips) return;
    chips.innerHTML = '';
    state.forEach((item, i) => {
      const chip = document.createElement('span');
      chip.className = 'family-chip-edit spouse-chip-link';
      const badge = document.createElement('span');
      badge.className = 'chip-origin-badge';
      badge.textContent = 'من العائلة';
      chip.appendChild(badge);
      chip.appendChild(document.createTextNode(` (${item.id}) ${item.name}`));
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'family-chip-remove'; x.textContent = '✕';
      x.addEventListener('click', () => { state.splice(i, 1); renderChips(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  const hide = () => { if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; } };

  if (input) {
    input.addEventListener('input', () => {
      const matches = matchPersonsAdmin(input.value);
      if (!matches.length) { hide(); return; }
      sug.innerHTML = matches.map(p => `
        <div class="search-result-item" data-id="${p.displayId}">
          <span class="sr-name"><b class="sr-id">(${p.displayId})</b> ${escapeHtml(shortLineageAdmin(p, 2))}</span>
        </div>`).join('');
      sug.style.display = 'block';
      sug.querySelectorAll('[data-id]').forEach(el => {
        el.addEventListener('click', () => {
          const p = personsByDisplayIdAdmin[el.dataset.id];
          if (canAddFn && !canAddFn()) { input.value = ''; hide(); return; }
          if (p && !state.some(s => String(s.id) === String(p.displayId))) {
            state.push({ id: Number(p.displayId), name: shortLineageAdmin(p, 2) });
            renderChips();
          }
          input.value = ''; hide();
        });
      });
    });
    document.addEventListener('click', e => { if (e.target !== input && sug && !sug.contains(e.target)) hide(); });
  }

  return {
    values() { return state.map(s => ({ id: s.id, name: s.name })); },
    size() { return state.length; },
    set(list) {
      state.length = 0;
      (list || []).forEach(v => { if (v && v.id != null) state.push({ id: Number(v.id), name: String(v.name || '') }); });
      if (input) input.value = '';
      renderChips();
    },
    clear() { this.set([]); }
  };
}

// للإناث في لوحة المدير: زوج واحد فقط (حسب الجنس المختار في النموذج)
function adminEditSpouseCanAdd() {
  const female = document.querySelector('input[name="admin-edit-gender"]:checked')?.value === 'female';
  if (female) {
    const total = (adminEditSpouseLinkList ? adminEditSpouseLinkList.size() : 0)
                + (adminEditFamilyList ? adminEditFamilyList.size() : 0);
    if (total >= 1) {
      alert('للإناث يمكن إضافة زوج واحد فقط. احذف الزوج الحالي أولاً إن أردت تغييره.');
      return false;
    }
  }
  return true;
}

function refreshSpouseOriginAdmin(radioName, linkBlockId, familyBlockId) {
  const linkBlock = document.getElementById(linkBlockId);
  const famBlock = document.getElementById(familyBlockId);
  const yes = document.querySelector(`input[name="${radioName}"]:checked`)?.value === 'yes';
  if (linkBlock) linkBlock.style.display = yes ? 'block' : 'none';
  if (famBlock) famBlock.style.display = yes ? 'none' : 'block';
}
function bindSpouseOriginToggleAdmin(radioName, linkBlockId, familyBlockId) {
  document.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
    r.addEventListener('change', () => refreshSpouseOriginAdmin(radioName, linkBlockId, familyBlockId));
  });
}

// يملأ قائمة "الأم" من زوجات والد الشخص المسجّلات في الشجرة
// يملأ قائمة الأم من زوجات "الأب" المعطى مباشرةً (يُستخدم في جميع نوافذ المدير)
function fillMotherSelectAdmin(selectId, hintId, father, curMotherId, curMotherName) {
  const sel = document.getElementById(selectId);
  const hint = document.getElementById(hintId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— غير محددة —</option>';
  if (!father) {
    sel.disabled = true;
    if (hint) hint.textContent = 'لا يمكن تحديد الأم: لا يوجد أب مسجّل لهذا الفرد في الشجرة.';
    return;
  }
  const links = Array.isArray(father.spouseLinks) ? father.spouseLinks : [];
  const fams = personFamiliesAdmin(father);
  if (!links.length && !fams.length) {
    sel.disabled = true;
    if (hint) hint.textContent = 'لا توجد زوجات مسجّلات لوالد هذا الفرد. أضِف زوجات الأب أولاً.';
    return;
  }
  sel.disabled = false;
  if (hint) hint.textContent = 'تُختار من زوجات والد هذا الفرد (اختيار زوجة من العائلة يُفعّل صلات القرابة تلقائياً).';
  links.forEach(w => {
    const nm = w.name || (personsByDisplayIdAdmin[String(w.id)] ? shortLineageAdmin(personsByDisplayIdAdmin[String(w.id)], 2) : '');
    const opt = document.createElement('option');
    opt.value = 'id:' + w.id;
    opt.dataset.mid = String(w.id);
    opt.dataset.mname = nm;
    opt.textContent = `من العائلة — (${w.id}) ${nm}`;
    sel.appendChild(opt);
  });
  fams.forEach(fname => {
    const label = 'من عائلة ' + fname;
    const opt = document.createElement('option');
    opt.value = 'fam:' + fname;
    opt.dataset.mid = '';
    opt.dataset.mname = label;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  if (curMotherId != null) sel.value = 'id:' + curMotherId;
  else if (curMotherName) {
    const match = Array.from(sel.options).find(o => o.dataset && o.dataset.mname === curMotherName);
    if (match) sel.value = match.value;
  }
}

// نافذة تعديل المدير: الأب من parentKey الخاص بالشخص
function populateMotherOptionsAdmin(person, selectId, hintId) {
  const father = (person.parentKey && !String(person.parentKey).startsWith('v'))
    ? personsByDisplayIdAdmin[String(person.parentKey)] : null;
  fillMotherSelectAdmin(selectId, hintId, father, person.motherId, person.motherName);
}

// يقرأ اختيار الأم من قائمة select ({id, name})
function readMotherSelect(selectId) {
  const opt = document.getElementById(selectId)?.selectedOptions?.[0];
  return {
    motherId: (opt && opt.dataset.mid) ? Number(opt.dataset.mid) : null,
    motherName: (opt && opt.value) ? (opt.dataset.mname || '') : ''
  };
}

// ربط تبادلي: إضافة العضو الجديد كزوج لدى زوجاته المرتبطة من العائلة
async function applyReciprocalSpouse(memberDisplayId, memberName, spouseLinks) {
  for (const link of (spouseLinks || [])) {
    try {
      const q = await db.collection('persons').where('displayId', '==', Number(link.id)).limit(1).get();
      if (q.empty) continue;
      const ref = q.docs[0].ref;
      const existing = Array.isArray(q.docs[0].data().spouseLinks) ? q.docs[0].data().spouseLinks : [];
      if (!existing.some(s => Number(s.id) === Number(memberDisplayId))) {
        existing.push({ id: Number(memberDisplayId), name: memberName || '' });
        await ref.update({ maritalStatus: 'married', spouseLinks: existing });
      }
    } catch (e) { console.error('تعذّر الربط التبادلي مع', link, e); }
  }
}

let adminAddSpouseLinkList = null;
let rootSpouseLinkList = null;

// قيود زوج واحد للإناث في نافذتَي الإضافة
function adminAddSpouseCanAdd() {
  if (RELATION_TO_GENDER_ADMIN[selectedAdminRelationType] === 'female') {
    const total = (adminAddSpouseLinkList ? adminAddSpouseLinkList.size() : 0)
                + (adminAddFamilyList ? adminAddFamilyList.size() : 0);
    if (total >= 1) { alert('للإناث يمكن إضافة زوج واحد فقط. احذف الزوج الحالي أولاً.'); return false; }
  }
  return true;
}
function rootSpouseCanAdd() {
  const female = document.querySelector('input[name="root-gender"]:checked')?.value === 'female';
  if (female) {
    const total = (rootSpouseLinkList ? rootSpouseLinkList.size() : 0)
                + (rootFamilyList ? rootFamilyList.size() : 0);
    if (total >= 1) { alert('للإناث يمكن إضافة زوج واحد فقط. احذف الزوج الحالي أولاً.'); return false; }
  }
  return true;
}

// خيارات الأم في نافذة "إضافة قريب": الأب = الشخص المستهدف (ابن/ابنة) أو والده (أخ/أخت)
function populateAdminAddMotherOptions() {
  let father = null;
  if (selectedAdminRelationType === 'son' || selectedAdminRelationType === 'daughter') {
    father = selectedAdminTargetPerson;
  } else if (selectedAdminTargetPerson && selectedAdminTargetPerson.parentKey
             && !String(selectedAdminTargetPerson.parentKey).startsWith('v')) {
    father = personsByDisplayIdAdmin[String(selectedAdminTargetPerson.parentKey)];
  }
  fillMotherSelectAdmin('admin-add-mother', 'admin-add-mother-hint', father, null, null);
}

// خيارات الأم في نافذة "إضافة شخص مباشرة": الأب = صاحب المعرّف المُدخل في حقل الوالد
function populateRootMotherOptions() {
  const pid = document.getElementById('root-parent-id')?.value.trim();
  const father = pid ? personsByDisplayIdAdmin[String(pid)] : null;
  const hint = document.getElementById('root-mother-hint');
  if (!pid && hint) {
    const sel = document.getElementById('root-mother');
    if (sel) { sel.innerHTML = '<option value="">— غير محددة —</option>'; sel.disabled = true; }
    hint.textContent = 'أدخل معرّف الأب أولاً لعرض زوجاته المسجّلات.';
    return;
  }
  fillMotherSelectAdmin('root-mother', 'root-mother-hint', father, null, null);
}

// ضبط نصوص قسم الأزواج بحسب الجنس (مذكر: تعدد، مؤنث: زوج واحد)
function setSpouseSectionTexts(sectionLabelId, multiHintId, female) {
  const secLbl = document.getElementById(sectionLabelId);
  const multiHint = document.getElementById(multiHintId);
  if (secLbl) secLbl.textContent = female ? 'الزوج المسجّل' : 'الزوجات المسجّلات';
  if (multiHint) multiHint.textContent = female
    ? 'يمكن إضافة زوج واحد فقط: اختر «نعم» للبحث عنه في الشجرة، أو «لا» لكتابة اسم عائلته.'
    : 'أضِف كل زوجة على حدة: اختر «نعم» للبحث عنها في الشجرة، أو «لا» لكتابة اسم عائلتها.';
}
let adminEditSpouseLinkList = null;
function bindMaritalToggleAdmin(radioName, groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  document.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
    r.addEventListener('change', () => {
      group.style.display = (r.checked && r.value === 'married') ? 'block' : 'none';
    });
  });
}
function refreshMaritalGroupAdmin(radioName, groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const checked = document.querySelector(`input[name="${radioName}"]:checked`);
  group.style.display = (checked && checked.value === 'married') ? 'block' : 'none';
}
function readMarital(radioName, listObj) {
  const m = document.querySelector(`input[name="${radioName}"]:checked`)?.value || 'single';
  return {
    maritalStatus: m,
    spouseFamilies: (m === 'married' && listObj) ? listObj.values() : []
  };
}

function openAdminEditModal(person) {
  selectedAdminTargetPerson = person;
  selectedAdminEditPhotoFile = null;
  document.getElementById('admin-edit-modal-title').textContent = `تعديل: ${person.firstName} (#${person.displayId})`;
  document.getElementById('admin-edit-name').value = person.firstName || '';
  document.getElementById('admin-edit-phone').value = person.phone || '';
  document.getElementById('admin-edit-photo-preview').style.display = 'none';
  document.querySelectorAll('input[name="admin-edit-gender"]').forEach(r => { r.checked = (r.value === person.gender); });
  document.querySelectorAll('input[name="admin-edit-status"]').forEach(r => { r.checked = (r.value === person.status); });

  applyMaritalLabelsAdmin(document.getElementById('admin-edit-modal'), person.gender);
  const curM = person.maritalStatus === 'married' ? 'married' : 'single';
  document.querySelectorAll('input[name="admin-edit-marital"]').forEach(r => { r.checked = (r.value === curM); });
  if (adminEditFamilyList) adminEditFamilyList.set(personFamiliesAdmin(person));
  refreshMaritalGroupAdmin('admin-edit-marital', 'admin-edit-spouse-group');

  // الزوجات من العائلة (روابط) + سؤال "من عائلة الماجد؟"
  const links = Array.isArray(person.spouseLinks) ? person.spouseLinks : [];
  document.querySelectorAll('input[name="admin-edit-spouse-in-family"]').forEach(r => { r.checked = (r.value === (links.length ? 'yes' : 'no')); });
  if (adminEditSpouseLinkList) adminEditSpouseLinkList.set(links);
  refreshSpouseOriginAdmin('admin-edit-spouse-in-family', 'admin-edit-spouse-link-block', 'admin-edit-spouse-family-block');

  // الأم
  populateMotherOptionsAdmin(person, 'admin-edit-mother', 'admin-edit-mother-hint');

  document.getElementById('admin-edit-modal').classList.add('open');
}
function closeAdminEditModal() {
  document.getElementById('admin-edit-modal').classList.remove('open');
  selectedAdminEditPhotoFile = null;
}
function handleAdminEditPhotoSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  selectedAdminEditPhotoFile = file;
  const preview = document.getElementById('admin-edit-photo-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
}

async function submitAdminEdit(evt) {
  evt.preventDefault();
  if (!selectedAdminTargetPerson) return;

  const firstName = document.getElementById('admin-edit-name').value.trim();
  const gender = document.querySelector('input[name="admin-edit-gender"]:checked')?.value;
  const phone = document.getElementById('admin-edit-phone').value.trim();
  const status = document.querySelector('input[name="admin-edit-status"]:checked')?.value;

  if (!firstName || !gender || !status) {
    alert('الرجاء تعبئة الحقول المطلوبة');
    return;
  }

  const btn = document.getElementById('admin-edit-submit-btn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الحفظ...';

  try {
    const married = document.querySelector('input[name="admin-edit-marital"]:checked')?.value === 'married';
    const spouseLinks = married && adminEditSpouseLinkList ? adminEditSpouseLinkList.values() : [];
    const spouseFamilies = married && adminEditFamilyList ? adminEditFamilyList.values() : [];
    const motherOpt = document.getElementById('admin-edit-mother')?.selectedOptions?.[0];
    const motherId = (motherOpt && motherOpt.dataset.mid) ? Number(motherOpt.dataset.mid) : null;
    const motherName = (motherOpt && motherOpt.value) ? (motherOpt.dataset.mname || '') : '';

    const updates = {
      firstName, gender, phone, status,
      maritalStatus: married ? 'married' : 'single',
      spouseFamilies, spouseLinks, motherId, motherName
    };
    if (selectedAdminEditPhotoFile) {
      updates.photoURL = await resizeImageToBase64Admin(selectedAdminEditPhotoFile);
    }
    await db.collection('persons').doc(selectedAdminTargetPerson.id).update(updates);

    // ربط تبادلي: إضافة هذا الشخص كزوج/زوجة لدى كل زوجة مرتبطة من العائلة
    for (const link of spouseLinks) {
      try {
        const wife = personsByDisplayIdAdmin[String(link.id)];
        if (!wife) continue;
        const existing = Array.isArray(wife.spouseLinks) ? wife.spouseLinks.slice() : [];
        if (!existing.some(s => Number(s.id) === Number(selectedAdminTargetPerson.displayId))) {
          existing.push({ id: Number(selectedAdminTargetPerson.displayId), name: firstName });
          await db.collection('persons').doc(wife.id).update({ maritalStatus: 'married', spouseLinks: existing });
        }
      } catch (e) { console.error('تعذّر الربط التبادلي مع', link, e); }
    }

    closeAdminEditModal();
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ التعديلات';
  }
}

// --- حذف مباشر ---
async function deleteAdminPerson(person) {
  try {
    const delId = Number(person.displayId);
    // تنظيف الإشارات المعلّقة: إزالة هذا الشخص من روابط الأزواج، وإفراغ الأم عند من تشير إليه
    const affected = allPersonsAdmin.filter(p => p.id !== person.id && (
      (Array.isArray(p.spouseLinks) && p.spouseLinks.some(s => Number(s.id) === delId)) ||
      Number(p.motherId) === delId
    ));
    for (const p of affected) {
      const upd = {};
      if (Array.isArray(p.spouseLinks) && p.spouseLinks.some(s => Number(s.id) === delId)) {
        upd.spouseLinks = p.spouseLinks.filter(s => Number(s.id) !== delId);
      }
      if (Number(p.motherId) === delId) { upd.motherId = null; upd.motherName = ''; }
      if (Object.keys(upd).length) await db.collection('persons').doc(p.id).update(upd);
    }

    await db.collection('persons').doc(person.id).delete();
    closeAdminNodeModal();
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء الحذف: ' + err.message);
  }
}

// --- نافذة إضافة قريب مباشرة ---
function openAdminQuickAddModal(person) {
  selectedAdminTargetPerson = person;
  selectedAdminRelationType = null;
  selectedAdminAddPhotoFile = null;
  adminAddedMembersThisSession = [];

  document.getElementById('admin-quick-add-title').textContent = `إضافة قريب لـ: ${person.firstName} (#${person.displayId})`;
  document.querySelectorAll('#admin-quick-add-modal .relation-choices button').forEach(b => b.classList.remove('selected'));
  document.getElementById('admin-quick-add-form').reset();
  document.getElementById('admin-quick-add-form').style.display = 'none';
  document.getElementById('admin-add-photo-preview').style.display = 'none';
  if (adminAddFamilyList) adminAddFamilyList.clear();
  if (adminAddSpouseLinkList) adminAddSpouseLinkList.clear();
  renderAdminAddedMembersList();

  document.getElementById('admin-quick-add-modal').classList.add('open');
}
function closeAdminQuickAddModal() {
  document.getElementById('admin-quick-add-modal').classList.remove('open');
  selectedAdminRelationType = null;
  selectedAdminAddPhotoFile = null;
  adminAddedMembersThisSession = [];
  renderAdminAddedMembersList();
}
function chooseAdminRelationType(type, btnEl) {
  selectedAdminRelationType = type;
  document.querySelectorAll('#admin-quick-add-modal .relation-choices button').forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  document.getElementById('admin-quick-add-form').style.display = 'block';
  const female = RELATION_TO_GENDER_ADMIN[type] === 'female';
  applyMaritalLabelsAdmin(document.getElementById('admin-quick-add-modal'), RELATION_TO_GENDER_ADMIN[type]);
  setSpouseSectionTexts('admin-add-spouse-section-label', 'admin-add-spouse-multi-hint', female);
  document.querySelectorAll('input[name="admin-add-spouse-in-family"]').forEach(r => { r.checked = (r.value === 'no'); });
  if (adminAddSpouseLinkList) adminAddSpouseLinkList.clear();
  refreshSpouseOriginAdmin('admin-add-spouse-in-family', 'admin-add-spouse-link-block', 'admin-add-spouse-family-block');
  populateAdminAddMotherOptions();
}
function handleAdminAddPhotoSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  selectedAdminAddPhotoFile = file;
  const preview = document.getElementById('admin-add-photo-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
}
function renderAdminAddedMembersList() {
  const box = document.getElementById('admin-added-members-list');
  if (adminAddedMembersThisSession.length === 0) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = `<div class="added-members-title">تمت إضافة ${adminAddedMembersThisSession.length} فرد حتى الآن:</div>` +
    adminAddedMembersThisSession.map(m => `<div class="added-member-chip">✅ ${escapeHtml(m.name)} <span>(${escapeHtml(RELATION_LABELS_AR[m.relation] || m.relation)})</span></div>`).join('');
}

async function submitAdminQuickAdd(evt) {
  evt.preventDefault();
  if (!selectedAdminTargetPerson || !selectedAdminRelationType) {
    alert('الرجاء اختيار نوع القرابة أولاً');
    return;
  }
  const firstName = document.getElementById('admin-add-name').value.trim();
  const phone = document.getElementById('admin-add-phone').value.trim();
  const status = document.querySelector('input[name="admin-add-status"]:checked')?.value || 'alive';
  const gender = RELATION_TO_GENDER_ADMIN[selectedAdminRelationType];

  if (!firstName) {
    alert('الرجاء إدخال الاسم');
    return;
  }

  const btn = document.getElementById('admin-quick-add-submit-btn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الحفظ...';

  try {
    let photoURL = '';
    if (selectedAdminAddPhotoFile) {
      photoURL = await resizeImageToBase64Admin(selectedAdminAddPhotoFile);
    }

    let parentKey;
    if (selectedAdminRelationType === 'son' || selectedAdminRelationType === 'daughter') {
      parentKey = String(selectedAdminTargetPerson.displayId);
    } else {
      parentKey = String(selectedAdminTargetPerson.parentKey);
    }

    const married = document.querySelector('input[name="admin-add-marital"]:checked')?.value === 'married';
    const spouseFamilies = married && adminAddFamilyList ? adminAddFamilyList.values() : [];
    const spouseLinks = married && adminAddSpouseLinkList ? adminAddSpouseLinkList.values() : [];
    const { motherId, motherName } = readMotherSelect('admin-add-mother');

    let createdId = null;
    const counterRef = db.collection('meta').doc('counter');
    await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const lastId = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;
      const newId = lastId + 1;
      createdId = newId;

      const personRef = db.collection('persons').doc();
      tx.set(personRef, {
        displayId: newId,
        firstName, gender, phone, status, photoURL,
        maritalStatus: married ? 'married' : 'single',
        spouseFamilies, spouseLinks, motherId, motherName,
        parentKey,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.set(counterRef, { lastId: newId }, { merge: true });
    });

    if (married && spouseLinks.length) await applyReciprocalSpouse(createdId, firstName, spouseLinks);

    adminAddedMembersThisSession.push({ name: firstName, relation: selectedAdminRelationType });
    renderAdminAddedMembersList();

    document.getElementById('admin-add-name').value = '';
    document.getElementById('admin-add-phone').value = '';
    document.getElementById('admin-add-photo-input').value = '';
    document.getElementById('admin-add-photo-preview').style.display = 'none';
    if (adminAddFamilyList) adminAddFamilyList.clear();
    if (adminAddSpouseLinkList) adminAddSpouseLinkList.clear();
    document.querySelectorAll('input[name="admin-add-spouse-in-family"]').forEach(r => { r.checked = (r.value === 'no'); });
    refreshSpouseOriginAdmin('admin-add-spouse-in-family', 'admin-add-spouse-link-block', 'admin-add-spouse-family-block');
    refreshMaritalGroupAdmin('admin-add-marital', 'admin-add-spouse-group');
    populateAdminAddMotherOptions();
    selectedAdminAddPhotoFile = null;
    document.getElementById('admin-add-name').focus();
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '➕ حفظ وإضافة التالي';
  }
}

function renderPersonsList(list) {
  const container = document.getElementById('persons-list');
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state">لا يوجد أشخاص بعد</div>';
    return;
  }
  container.innerHTML = `
    <table class="persons-table">
      <thead><tr><th>المعرّف</th><th>الاسم</th><th>الجنس</th><th>الهاتف</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>
        ${list.map(p => `
          <tr>
            <td>#${p.displayId}</td>
            <td>${escapeHtml(p.firstName)}</td>
            <td>${GENDER_LABELS_AR[p.gender] || ''}</td>
            <td>${escapeHtml(p.phone || '—')}</td>
            <td>${STATUS_LABELS_AR[p.status] || p.status}</td>
            <td><button class="btn btn-secondary btn-sm" data-edit-person="${p.id}">✏️ تعديل</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  container.querySelectorAll('[data-edit-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const person = allPersonsAdmin.find(x => x.id === btn.dataset.editPerson);
      if (person) openAdminEditModal(person);
    });
  });
}

function handleSearchById(evt) {
  evt.preventDefault();
  const id = document.getElementById('search-id-input').value.trim();
  if (!id) { renderPersonsList(allPersonsAdmin); return; }
  const filtered = allPersonsAdmin.filter(p => String(p.displayId) === id);
  renderPersonsList(filtered);
}

// سلسلة الآباء في لوحة التحكم (مطابقة لمنطق الصفحة الرئيسية)
function adminPersonsById() {
  const map = {};
  allPersonsAdmin.forEach(p => { map[String(p.displayId)] = p; });
  return map;
}
function ancestorsOfAdmin(person, limit) {
  const byId = adminPersonsById();
  const chain = [];
  const seen = new Set([String(person.displayId)]);
  let cur = person;
  const max = limit || 60;
  while (chain.length < max) {
    const pk = String(cur.parentKey || '');
    if (!pk || pk.startsWith('v')) break;
    const parent = byId[pk];
    if (!parent || seen.has(String(parent.displayId))) break;
    seen.add(String(parent.displayId));
    chain.push(parent);
    cur = parent;
  }
  return chain;
}
function shortLineageAdmin(person, depth) {
  return [person.firstName]
    .concat(ancestorsOfAdmin(person, depth || 2).map(a => a.firstName))
    .filter(Boolean).join(' - ');
}

// بحث بالنسب: الكلمة الأولى = الاسم، الثانية = الأب، الثالثة = الجد (حتى 3)
function nameSearchTokensAdmin(query) {
  return normalizeArabic(query).split(' ').filter(Boolean).slice(0, 3);
}
function matchByNameTokensAdmin(person, tokens) {
  if (!tokens.length) return false;
  const names = [person.firstName].concat(ancestorsOfAdmin(person, tokens.length - 1).map(a => a.firstName));
  for (let i = 0; i < tokens.length; i++) {
    if (!names[i] || !normalizeArabic(names[i]).includes(tokens[i])) return false;
  }
  return true;
}

// البحث داخل شجرة العائلة بالاسم أو بالمعرّف: التمرير إلى الشخص وإبرازه
function focusAdminTreeNode(displayId) {
  const el = document.getElementById('admin-person-node-' + displayId);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  el.classList.add('highlighted');
  setTimeout(() => el.classList.remove('highlighted'), 2500);
  return true;
}

function handleAdminTreeSearch(evt) {
  evt.preventDefault();
  const box = document.getElementById('admin-tree-search-results');
  const term = document.getElementById('admin-tree-search-input').value.trim();
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
  if (!term) return;

  let matches;
  if (/^\d+$/.test(term)) {
    matches = allPersonsAdmin.filter(p => String(p.displayId) === term);
  } else {
    const tokens = nameSearchTokensAdmin(term);
    matches = tokens.length ? allPersonsAdmin.filter(p => p.firstName && matchByNameTokensAdmin(p, tokens)) : [];
  }

  if (!box) {
    if (matches.length) focusAdminTreeNode(matches[0].displayId);
    return;
  }

  if (matches.length === 0) {
    box.innerHTML = '<div class="search-no-results">لا توجد نتائج مطابقة</div>';
    box.style.display = 'block';
    return;
  }

  // نفس شكل الصفحة الرئيسية: (المعرّف) الاسم - الأب - الجد
  box.innerHTML = matches.map(p => `
    <div class="search-result-item" data-goto="${p.displayId}">
      <img src="${p.photoURL || defaultAvatarAdmin(p.gender)}" alt="">
      <span class="sr-name"><b class="sr-id">(${p.displayId})</b> ${escapeHtml(shortLineageAdmin(p, 2))}</span>
    </div>
  `).join('');
  box.style.display = 'block';

  box.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => {
      focusAdminTreeNode(el.dataset.goto);
      box.style.display = 'none';
      box.innerHTML = '';
    });
  });
}

// ---------------------------------------------------------------------
// إضافة شخص مباشرة (بدون مراجعة) - لبدء الشجرة أو إضافة فرع مستقل
// ---------------------------------------------------------------------
function openRootModal() {
  document.getElementById('root-add-form').reset();
  document.getElementById('root-photo-preview').style.display = 'none';
  selectedRootPhotoFile = null;
  // إعادة ضبط قسم الأزواج والأم
  if (rootFamilyList) rootFamilyList.clear();
  if (rootSpouseLinkList) rootSpouseLinkList.clear();
  document.querySelectorAll('input[name="root-spouse-in-family"]').forEach(r => { r.checked = (r.value === 'no'); });
  refreshSpouseOriginAdmin('root-spouse-in-family', 'root-spouse-link-block', 'root-spouse-family-block');
  refreshMaritalGroupAdmin('root-marital', 'root-spouse-group');
  setSpouseSectionTexts('root-spouse-section-label', 'root-spouse-multi-hint', false);
  populateRootMotherOptions();
  document.getElementById('root-modal').classList.add('open');
}
function closeRootModal() {
  document.getElementById('root-modal').classList.remove('open');
}

/**
 * يصغّر الصورة داخل المتصفح ويحوّلها إلى نص Base64 لتخزينها مباشرة في Firestore
 * (بدون الحاجة لخدمة تخزين ملفات منفصلة أو ترقية خطة Firebase المدفوعة)
 */
function resizeImageToBase64(file, maxSize = 220, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        else if (h >= w && h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('تعذرت قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

function handleRootPhotoSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  selectedRootPhotoFile = file;
  const preview = document.getElementById('root-photo-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
}

async function submitRootPerson(evt) {
  evt.preventDefault();
  const firstName = document.getElementById('root-first-name').value.trim();
  const gender = document.querySelector('input[name="root-gender"]:checked')?.value;
  const phone = document.getElementById('root-phone').value.trim();
  const status = document.querySelector('input[name="root-status"]:checked')?.value;
  const parentIdRaw = document.getElementById('root-parent-id').value.trim();

  if (!firstName || !gender || !status) {
    alert('الرجاء تعبئة الحقول المطلوبة');
    return;
  }

  const btn = document.getElementById('root-submit-btn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الحفظ...';

  try {
    let photoURL = '';
    if (selectedRootPhotoFile) {
      photoURL = await resizeImageToBase64(selectedRootPhotoFile);
    }

    // إذا حُدد معرّف أب/شخص مستهدف يُربط به مباشرة كابن/ابنة، وإلا يُنشأ كجذر مستقل جديد
    const married = document.querySelector('input[name="root-marital"]:checked')?.value === 'married';
    const spouseFamilies = married && rootFamilyList ? rootFamilyList.values() : [];
    const spouseLinks = married && rootSpouseLinkList ? rootSpouseLinkList.values() : [];
    const { motherId, motherName } = readMotherSelect('root-mother');

    let createdId = null;
    const counterRef = db.collection('meta').doc('counter');

    await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const lastId = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;
      const newId = lastId + 1;
      createdId = newId;

      let parentKey;
      if (parentIdRaw) {
        parentKey = parentIdRaw; // يصبح ابناً/ابنة لهذا الشخص مباشرة
      } else {
        parentKey = 'v' + newId; // جذر مستقل جديد
      }

      const personRef = db.collection('persons').doc();
      tx.set(personRef, {
        displayId: newId,
        firstName, gender, phone, status, photoURL, parentKey,
        maritalStatus: married ? 'married' : 'single',
        spouseFamilies, spouseLinks, motherId, motherName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.set(counterRef, { lastId: newId }, { merge: true });
    });

    if (married && spouseLinks.length) await applyReciprocalSpouse(createdId, firstName, spouseLinks);

    closeRootModal();
  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ';
  }
}

// ---------------------------------------------------------------------
// أدوات مساعدة
// ---------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// قصر الإدخال على الحروف العربية والمسافات فقط
function enforceArabicOnly(el) {
  if (!el) return;
  el.setAttribute('lang', 'ar');

  // رسالة تنبيه تظهر أسفل الحقل عند محاولة إدخال حروف غير عربية
  const warn = document.createElement('div');
  warn.className = 'arabic-warning';
  warn.textContent = '⚠️ الرجاء إدخال الاسم بالحروف العربية فقط';
  warn.style.display = 'none';
  el.insertAdjacentElement('afterend', warn);

  let warnTimer = null;
  el.addEventListener('input', () => {
    const cleaned = el.value.replace(/[^؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s]/g, '');
    if (cleaned !== el.value) {
      el.value = cleaned;
      warn.style.display = 'block';
      el.classList.add('input-invalid');
      clearTimeout(warnTimer);
      warnTimer = setTimeout(() => {
        warn.style.display = 'none';
        el.classList.remove('input-invalid');
      }, 3000);
    }
  });
}

// ---------------------------------------------------------------------
// حفظ الشجرة كاملة كملف PDF
// ---------------------------------------------------------------------
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('تعذر تحميل ' + src));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------------
// تكبير/تصغير شجرة المدير + السحب باليد
// ---------------------------------------------------------------------
let adminTreeZoom = 0.5;
function applyAdminTreeZoom() {
  const forest = document.getElementById('admin-tree-forest');
  if (forest) forest.style.zoom = adminTreeZoom;
  const lbl = document.getElementById('admin-zoom-level');
  if (lbl) lbl.textContent = Math.round(adminTreeZoom * 100) + '%';
}
function setAdminTreeZoom(z) {
  const vp = document.getElementById('admin-tree-viewport');
  const oldZoom = adminTreeZoom;
  const newZoom = Math.min(3, Math.max(0.1, Math.round(z * 100) / 100));
  if (newZoom === oldZoom) return;

  // نحفظ النقطة التي ينظر إليها المستخدم حتى لا تقفز الشجرة عند التكبير
  let cx = null, cy = null;
  if (vp && vp.clientWidth) {
    cx = (vp.scrollLeft + vp.clientWidth / 2) / oldZoom;
    cy = (vp.scrollTop + vp.clientHeight / 2) / oldZoom;
  }

  adminTreeZoom = newZoom;
  applyAdminTreeZoom();

  if (cx === null) return;
  const restore = () => {
    vp.scrollLeft = cx * adminTreeZoom - vp.clientWidth / 2;
    vp.scrollTop  = cy * adminTreeZoom - vp.clientHeight / 2;
  };
  restore();
  requestAnimationFrame(restore);
}
function fitAdminTreeToViewport() {
  const vp = document.getElementById('admin-tree-viewport');
  const forest = document.getElementById('admin-tree-forest');
  if (!vp || !forest) return;
  const prev = forest.style.zoom;
  forest.style.zoom = 1;
  const contentW = forest.scrollWidth, contentH = forest.scrollHeight;
  forest.style.zoom = prev;
  if (!contentW || !contentH) return;

  // إن لم يكن للإطار مقاس بعد (تبويب مخفي مثلاً) نرجع لمقاس النافذة
  const vpW = vp.clientWidth || window.innerWidth || 0;
  const vpH = vp.clientHeight || Math.round((window.innerHeight || 0) * 0.72);
  if (vpW < 50 || vpH < 50) return;

  setAdminTreeZoom(Math.min(vpW / contentW, vpH / contentH) * 0.97);
  vp.scrollLeft = 0; vp.scrollTop = 0;
}

// توسيط صاحب المعرّف 1 أفقياً داخل إطار شجرة المدير
let adminTreeCenteredOnce = false;
function centerAdminTreeOnRoot() {
  const vp = document.getElementById('admin-tree-viewport');
  if (!vp || !vp.clientWidth) return false;
  const root = document.getElementById('admin-person-node-1') || vp.querySelector('.person-node');
  if (!root || !root.getBoundingClientRect().width) return false;
  const vpRect = vp.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const rootCenter = (rootRect.left - vpRect.left) + vp.scrollLeft + rootRect.width / 2;
  vp.scrollLeft = rootCenter - vp.clientWidth / 2;
  vp.scrollTop = 0;
  adminTreeCenteredOnce = true;
  return true;
}

function centerAdminTreeOnRootSoon() {
  let tries = 0;
  const attempt = () => {
    if (centerAdminTreeOnRoot()) return;
    if (++tries > 15) return;
    setTimeout(attempt, 120);
  };
  requestAnimationFrame(attempt);
}

let adminTreeJustDragged = false;
function enableAdminTreePan(vp) {
  if (!vp || vp.dataset.panReady === '1') return;
  vp.dataset.panReady = '1';

  let down = false, moved = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

  vp.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    startLeft = vp.scrollLeft; startTop = vp.scrollTop;
    vp.classList.add('panning');
  });
  vp.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
    if (moved) { vp.scrollLeft = startLeft - dx; vp.scrollTop = startTop - dy; e.preventDefault(); }
  });
  const endPan = () => {
    if (!down) return;
    down = false;
    adminTreeJustDragged = moved;
    vp.classList.remove('panning');
  };
  vp.addEventListener('pointerup', endPan);
  vp.addEventListener('pointercancel', endPan);
  vp.addEventListener('pointerleave', endPan);

  vp.addEventListener('click', e => {
    if (adminTreeJustDragged) { e.stopPropagation(); e.preventDefault(); adminTreeJustDragged = false; }
  }, true);

  vp.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setAdminTreeZoom(adminTreeZoom * (e.deltaY < 0 ? 1.12 : 0.89));
  }, { passive: false });

  let pinchStartDist = 0, pinchStartZoom = 1;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinchStartDist = dist(e.touches); pinchStartZoom = adminTreeZoom; }
  }, { passive: true });
  vp.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      setAdminTreeZoom(pinchStartZoom * (dist(e.touches) / pinchStartDist));
    }
  }, { passive: false });
  vp.addEventListener('touchend', () => { pinchStartDist = 0; }, { passive: true });
}

// ---------------------------------------------------------------------
// نسخة احتياطية: تنزيل كل البيانات كملف يمكن الرجوع إليه
// ---------------------------------------------------------------------
async function downloadBackup(btnEl) {
  const original = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'جارٍ التجهيز...'; }
  try {
    const snap = await db.collection('persons').get();
    const people = [];
    snap.forEach(d => people.push({ docId: d.id, ...d.data() }));
    people.sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));

    const counterSnap = await db.collection('meta').doc('counter').get();
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');

    // (1) ملف JSON كامل — يصلح للاسترجاع الكامل لاحقاً
    const full = {
      exportedAt: new Date().toISOString(),
      count: people.length,
      counter: counterSnap.exists ? counterSnap.data() : null,
      persons: people
    };
    downloadFile(JSON.stringify(full, null, 1),
      'نسخة_احتياطية_' + stamp + '.json', 'application/json');

    // (2) ملف CSV للقراءة في Excel (بدون الصور حتى يبقى خفيفاً)
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['displayId','firstName','gender','status','phone','parentKey','maritalStatus','spouseFamilies'];
    const rows = [head.join(',')].concat(people.map(p => [
      p.displayId, p.firstName, p.gender, p.status, p.phone, p.parentKey,
      p.maritalStatus, (p.spouseFamilies || []).join(' | ')
    ].map(esc).join(',')));
    // BOM حتى تظهر العربية صحيحة في Excel
    downloadFile('\ufeff' + rows.join('\r\n'),
      'نسخة_احتياطية_' + stamp + '.csv', 'text/csv;charset=utf-8');

    alert('تم تنزيل ملفين:\n• JSON يحتوي كل البيانات والصور (للاسترجاع)\n• CSV لفتحه في Excel\n\nعدد الأفراد: ' + people.length + '\nاحفظهما في مكان آمن.');
  } catch (err) {
    console.error(err);
    alert('تعذر إنشاء النسخة الاحتياطية: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = original; }
  }
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------
// إعادة ترقيم المعرّفات لتبدأ من 1 بدون فجوات
// ---------------------------------------------------------------------
async function renumberAllIds(btnEl) {
  if (allPersonsAdmin.length === 0) { alert('لا يوجد أفراد لإعادة ترقيمهم.'); return; }

  const count = allPersonsAdmin.length;
  const ok = confirm(
    'سيتم إعادة ترقيم جميع المعرّفات لتصبح متسلسلة من 1 إلى ' + count + '.\n\n' +
    'سيتم تحديث جميع الروابط تلقائياً: الآباء، الأبناء، الأزواج المرتبطون من العائلة، والأمهات.\n' +
    '⚠️ تنبيه للسلامة: أي رابط كان يشير إلى شخص محذوف سابقاً سيُزال. يُنصح بمراجعة الروابط بعد الترقيم.\n' +
    'لا يمكن التراجع عن هذا الإجراء — يُفضّل تنفيذه بعد الانتهاء من إدخال جميع الأفراد.\n\n' +
    'بضغطك «موافق» فأنت المسؤول عن هذا الإجراء. هل تريد المتابعة؟'
  );
  if (!ok) return;

  const original = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'جارٍ إعادة الترقيم...'; }

  try {
    // نقرأ نسخة طازجة ومرتبة حتى لا نعتمد على حالة الشاشة
    const snap = await db.collection('persons').get();
    const people = [];
    snap.forEach(doc => people.push({ id: doc.id, ...doc.data() }));
    people.sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));

    // خريطة: المعرّف القديم -> المعرّف الجديد
    const idMap = {};
    people.forEach((p, i) => { idMap[String(p.displayId)] = i + 1; });

    let orphans = 0;
    const updates = people.map((p, i) => {
      const newId = i + 1;
      const oldKey = String(p.parentKey || '');
      let newParentKey;
      if (oldKey.startsWith('v')) {
        // جذر مستقل: يبقى جذراً بمعرّفه الجديد
        newParentKey = 'v' + newId;
      } else if (idMap[oldKey] !== undefined) {
        newParentKey = String(idMap[oldKey]);
      } else {
        // والد محذوف: نحوّله إلى جذر مستقل بدل أن يختفي من الشجرة
        newParentKey = 'v' + newId;
        orphans++;
      }

      // إعادة تعيين روابط الأزواج من العائلة إلى المعرّفات الجديدة (وإزالة روابط المحذوفين)
      const newSpouseLinks = Array.isArray(p.spouseLinks)
        ? p.spouseLinks.map(s => {
            const nm = idMap[String(s.id)];
            return nm !== undefined ? { id: nm, name: s.name || '' } : null;
          }).filter(Boolean)
        : [];
      // إعادة تعيين معرّف الأم (وإزالته إن كانت محذوفة)
      const newMotherId = (p.motherId != null && idMap[String(p.motherId)] !== undefined)
        ? idMap[String(p.motherId)] : null;

      return { docId: p.id, displayId: newId, parentKey: newParentKey, spouseLinks: newSpouseLinks, motherId: newMotherId };
    });

    // Firestore يسمح بحد أقصى 500 عملية لكل دفعة
    const CHUNK = 400;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const batch = db.batch();
      updates.slice(i, i + CHUNK).forEach(u => {
        batch.update(db.collection('persons').doc(u.docId), {
          displayId: u.displayId,
          parentKey: u.parentKey,
          spouseLinks: u.spouseLinks,
          motherId: u.motherId
        });
      });
      await batch.commit();
    }

    await db.collection('meta').doc('counter').set({ lastId: updates.length }, { merge: true });

    alert(
      'تمت إعادة الترقيم بنجاح ✅\n' +
      'عدد الأفراد: ' + updates.length + ' (المعرّفات الآن من 1 إلى ' + updates.length + ')' +
      (orphans ? '\nتنبيه: ' + orphans + ' فرد كان والدهم محذوفاً فأصبحوا جذوراً مستقلة.' : '')
    );
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إعادة الترقيم: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = original; }
  }
}

// نضمن اكتمال تحميل كل صور الأفراد قبل الالتقاط حتى تظهر في ملف PDF
function waitForTreeImages(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 8000); // لا نعلّق التصدير بسبب صورة واحدة
    });
  }));
}

async function saveTreeAsPdf(btnEl) {
  const el = document.getElementById('admin-tree-forest');
  if (!el || allPersonsAdmin.length === 0) { alert('لا توجد شجرة لحفظها بعد.'); return; }
  const original = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'جارٍ التجهيز...'; }
  const prevZoom = el.style.zoom;
  try {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

    // نلتقط الشجرة بحجمها الطبيعي (100%) وليس بحجم العرض المصغّر
    el.style.zoom = 1;
    await new Promise(r => setTimeout(r, 150));

    // ننتظر تحميل كل صور الأفراد فعلياً حتى تظهر في الملف
    await waitForTreeImages(el);

    const fullW = el.scrollWidth, fullH = el.scrollHeight;

    // ===== حدود المتصفح للرسم (canvas) =====
    // المتصفحات لا تسمح برسم canvas يتجاوز ~16384 بكسل في أي بُعد، وتفشل
    // (تُرجع مربّعاً أسود) عند تجاوز الذاكرة. لذلك نقسم الشجرة إلى «بلاطات»
    // شبكية (صفوف × أعمدة) بحيث تبقى كل بلاطة أصغر من الحدود الآمنة، ثم
    // نرصّها في *صفحة واحدة* في مواضعها الصحيحة.
    const SAFE_DIM  = 8000;    // أقصى بُعد آمن لكل بلاطة (px) — أقل بكثير من حدّ 16384
    const SAFE_AREA = 30e6;    // أقصى مساحة آمنة لكل بلاطة (~120MB)

    // دقّة عالية للحدّة (3x). نخفّضها تدريجياً فقط للأشجار الضخمة جداً
    // حتى لا تنهار الذاكرة، مع إبقائها ≥ 2x لضمان وضوح النص.
    const PIXEL_BUDGET = 200e6;  // ميزانية إجمالية للبكسلات
    let scale = 3;
    const byBudget = Math.sqrt(PIXEL_BUDGET / Math.max(1, fullW * fullH));
    scale = Math.max(2, Math.min(scale, byBudget));

    // أقصى مقاس بلاطة بالـCSS بحيث تبقى بكسلاتها ضمن حدّ البُعد والمساحة
    const tileCssMax = Math.max(
      300,
      Math.floor(Math.min(SAFE_DIM / scale, Math.sqrt(SAFE_AREA) / scale))
    );

    const cols  = Math.max(1, Math.ceil(fullW / tileCssMax));
    const rows  = Math.max(1, Math.ceil(fullH / tileCssMax));
    const tileW = Math.ceil(fullW / cols);
    const tileH = Math.ceil(fullH / rows);
    const totalTiles = cols * rows;

    // ===== مقاس الصفحة =====
    // معيار PDF لا يسمح بصفحة أكبر من 14400 نقطة (200 بوصة) في أي اتجاه.
    // نُصغّر التخطيط ليناسبها، لكن الصور المدمجة تبقى بدقتها العالية.
    const MAX_PT = 14400;
    const k = Math.min(1, MAX_PT / fullW, MAX_PT / fullH);
    const pageW = fullW * k;
    const pageH = fullH * k;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: pageW >= pageH ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pageW, pageH],
      compress: true
    });

    // خلفية بيضاء للصفحة كاملة
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, pageH, 'F');

    let done = 0;
    for (let ry = 0; ry < rows; ry++) {
      const y = ry * tileH;
      const h = Math.min(tileH, fullH - y);
      for (let cx = 0; cx < cols; cx++) {
        done++;
        if (btnEl) btnEl.textContent = `جارٍ التجهيز... ${done}/${totalTiles}`;
        await new Promise(r => setTimeout(r, 0)); // نترك المتصفح يتنفّس

        const x = cx * tileW;
        const w = Math.min(tileW, fullW - x);

        const canvas = await html2canvas(el, {
          backgroundColor: '#ffffff',
          scale: scale,
          x: x,
          y: y,
          width: w,
          height: h,
          windowWidth: fullW,
          windowHeight: fullH,
          scrollX: 0,
          scrollY: 0,
          useCORS: true,
          allowTaint: true,
          imageTimeout: 0,
          logging: false
        });

        // PNG يحافظ على حدّة النص والخطوط بلا تشويش ضغط
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', x * k, y * k, w * k, h * k, undefined, 'FAST');

        // تحرير ذاكرة البلاطة فوراً
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    if (btnEl) btnEl.textContent = 'جارٍ الحفظ...';
    pdf.save('شجرة_عائلة_الماجد.pdf');
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء ملف PDF: ' + err.message);
  } finally {
    el.style.zoom = prevZoom || adminTreeZoom;
    applyAdminTreeZoom();
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = original; }
  }
}

// ---------------------------------------------------------------------
// ربط الأحداث
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  document.getElementById('tab-btn-requests').addEventListener('click', () => switchTab('requests'));
  document.getElementById('tab-btn-persons').addEventListener('click', () => switchTab('persons'));
  document.getElementById('tab-btn-tree').addEventListener('click', () => switchTab('tree'));
  document.getElementById('tab-btn-cards').addEventListener('click', () => switchTab('cards'));
  document.getElementById('tab-btn-collect').addEventListener('click', () => switchTab('collect'));
  const dlXlsxBtn = document.getElementById('download-collect-xlsx-btn');
  if (dlXlsxBtn) dlXlsxBtn.addEventListener('click', (e) => downloadCollectionXlsx(e.currentTarget));

  // نموذج شجرة العائلة
  document.getElementById('tab-btn-proto').addEventListener('click', () => switchTab('proto'));
  const protoBox = document.getElementById('proto-tree');
  if (protoBox) protoBox.addEventListener('click', (e) => {
    const node = e.target.closest('.pnode');
    if (!node) return;
    const li = node.parentElement;
    if (li && li.querySelector(':scope > ul')) li.classList.toggle('collapsed');
  });
  const pExpand = document.getElementById('proto-expand-all');
  if (pExpand) pExpand.addEventListener('click', () => protoSetAll(false));
  const pCollapse = document.getElementById('proto-collapse-all');
  if (pCollapse) pCollapse.addEventListener('click', () => protoSetAll(true));
  const printCardsBtn = document.getElementById('print-id-cards-btn');
  if (printCardsBtn) printCardsBtn.addEventListener('click', () => window.print());
  document.querySelectorAll('.cards-filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      idCardsGenderFilter = b.dataset.cardGender || 'all';
      document.querySelectorAll('.cards-filter-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderIdCards();
    });
  });

  // حفظ الشجرة كاملة PDF
  document.getElementById('save-tree-pdf-btn').addEventListener('click', (e) => saveTreeAsPdf(e.currentTarget));

  // إعادة ترقيم المعرّفات من 1
  const backupBtn = document.getElementById('backup-btn');
  if (backupBtn) backupBtn.addEventListener('click', (e) => downloadBackup(e.currentTarget));

  const renumberBtn = document.getElementById('renumber-ids-btn');
  if (renumberBtn) renumberBtn.addEventListener('click', (e) => renumberAllIds(e.currentTarget));

  // تكبير/تصغير شجرة المدير
  const azIn = document.getElementById('admin-zoom-in');
  const azOut = document.getElementById('admin-zoom-out');
  const azReset = document.getElementById('admin-zoom-reset');
  const azFit = document.getElementById('admin-zoom-fit');
  if (azIn) azIn.addEventListener('click', () => setAdminTreeZoom(adminTreeZoom + 0.1));
  if (azOut) azOut.addEventListener('click', () => setAdminTreeZoom(adminTreeZoom - 0.1));
  if (azReset) azReset.addEventListener('click', () => { setAdminTreeZoom(0.5); centerAdminTreeOnRootSoon(); });
  if (azFit) azFit.addEventListener('click', fitAdminTreeToViewport);
  const centerBtn = document.getElementById('admin-center-root-btn');
  if (centerBtn) centerBtn.addEventListener("click", () => { adminTreeCenteredOnce = false; centerAdminTreeOnRootSoon(); });
  enableAdminTreePan(document.getElementById('admin-tree-viewport'));
  applyAdminTreeZoom();

  // الحالة الاجتماعية: إظهار خانة عائلة الزوج/الزوجة عند اختيار "متزوج"
  bindMaritalToggleAdmin('admin-edit-marital', 'admin-edit-spouse-group');
  bindMaritalToggleAdmin('admin-add-marital', 'admin-add-spouse-group');
  bindMaritalToggleAdmin('root-marital', 'root-spouse-group');
  adminEditFamilyList = createFamilyListAdmin('admin-edit-spouse-family', 'admin-edit-spouse-family-add', 'admin-edit-spouse-family-chips', adminEditSpouseCanAdd);
  adminAddFamilyList = createFamilyListAdmin('admin-add-spouse-family', 'admin-add-spouse-family-add', 'admin-add-spouse-family-chips', adminAddSpouseCanAdd);
  rootFamilyList = createFamilyListAdmin('root-spouse-family', 'root-spouse-family-add', 'root-spouse-family-chips', rootSpouseCanAdd);

  // ربط الزوجة من داخل الشجرة + سؤال "من عائلة الماجد؟"
  adminEditSpouseLinkList = createSpouseLinkListAdmin('admin-edit-spouse-link-input', 'admin-edit-spouse-link-sug', 'admin-edit-spouse-link-chips', adminEditSpouseCanAdd);
  bindSpouseOriginToggleAdmin('admin-edit-spouse-in-family', 'admin-edit-spouse-link-block', 'admin-edit-spouse-family-block');
  adminAddSpouseLinkList = createSpouseLinkListAdmin('admin-add-spouse-link-input', 'admin-add-spouse-link-sug', 'admin-add-spouse-link-chips', adminAddSpouseCanAdd);
  bindSpouseOriginToggleAdmin('admin-add-spouse-in-family', 'admin-add-spouse-link-block', 'admin-add-spouse-family-block');
  rootSpouseLinkList = createSpouseLinkListAdmin('root-spouse-link-input', 'root-spouse-link-sug', 'root-spouse-link-chips', rootSpouseCanAdd);
  bindSpouseOriginToggleAdmin('root-spouse-in-family', 'root-spouse-link-block', 'root-spouse-family-block');

  // نافذة الإضافة المباشرة: تتغيّر الصيغة والحدّ بحسب الجنس، والأم بحسب معرّف الأب
  document.querySelectorAll('input[name="root-gender"]').forEach(r => {
    r.addEventListener('change', () => {
      applyMaritalLabelsAdmin(document.getElementById('root-modal'), r.value);
      setSpouseSectionTexts('root-spouse-section-label', 'root-spouse-multi-hint', r.value === 'female');
    });
  });
  const rootParentInput = document.getElementById('root-parent-id');
  if (rootParentInput) rootParentInput.addEventListener('input', populateRootMotherOptions);
  document.querySelectorAll('input[name="admin-edit-gender"]').forEach(r => {
    r.addEventListener('change', () => {
      applyMaritalLabelsAdmin(document.getElementById('admin-edit-modal'), r.value);
    });
  });

  // البحث داخل الشجرة بالمعرّف
  document.getElementById('admin-tree-search-form').addEventListener('submit', handleAdminTreeSearch);

  // قصر حقول الأسماء على الحروف العربية فقط
  enforceArabicOnly(document.getElementById('admin-edit-name'));
  enforceArabicOnly(document.getElementById('admin-add-name'));
  enforceArabicOnly(document.getElementById('root-first-name'));

  document.getElementById('search-id-form').addEventListener('submit', handleSearchById);

  document.getElementById('open-root-modal-btn').addEventListener('click', openRootModal);
  document.getElementById('close-root-modal-btn').addEventListener('click', closeRootModal);
  document.getElementById('cancel-root-modal-btn').addEventListener('click', closeRootModal);
  document.getElementById('root-add-form').addEventListener('submit', submitRootPerson);
  document.getElementById('root-photo-input').addEventListener('change', handleRootPhotoSelect);

  // نافذة اختيار الإجراء (شجرة المدير)
  document.getElementById('close-admin-node-modal-btn').addEventListener('click', closeAdminNodeModal);
  document.getElementById('admin-node-modal').addEventListener('click', (e) => {
    if (e.target.id === 'admin-node-modal') closeAdminNodeModal();
  });
  document.getElementById('admin-node-edit-btn').addEventListener('click', () => {
    const person = selectedAdminTargetPerson;
    closeAdminNodeModal();
    openAdminEditModal(person);
  });
  document.getElementById('admin-node-add-btn').addEventListener('click', () => {
    const person = selectedAdminTargetPerson;
    closeAdminNodeModal();
    openAdminQuickAddModal(person);
  });
  document.getElementById('admin-node-delete-btn').addEventListener('click', () => {
    const person = selectedAdminTargetPerson;
    const hasChildren = allPersonsAdmin.some(p => String(p.parentKey) === String(person.displayId));
    if (hasChildren) {
      alert('لا يمكن حذف هذا الشخص لأن لديه أبناء/أقارب مرتبطين به في الشجرة. احذفهم أولاً ثم أعد المحاولة.');
      return;
    }
    showAdminDeleteConfirm();
  });
  document.getElementById('admin-delete-confirm-no').addEventListener('click', () => {
    document.getElementById('admin-node-choice-buttons').style.display = 'flex';
    document.getElementById('admin-delete-confirm').style.display = 'none';
  });
  document.getElementById('admin-delete-confirm-yes').addEventListener('click', () => {
    deleteAdminPerson(selectedAdminTargetPerson);
  });

  // نافذة التعديل المباشر
  document.getElementById('admin-edit-form').addEventListener('submit', submitAdminEdit);
  document.getElementById('admin-edit-photo-input').addEventListener('change', handleAdminEditPhotoSelect);
  document.getElementById('close-admin-edit-modal-btn').addEventListener('click', closeAdminEditModal);
  document.getElementById('cancel-admin-edit-modal-btn').addEventListener('click', closeAdminEditModal);
  document.getElementById('admin-edit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'admin-edit-modal') closeAdminEditModal();
  });

  // نافذة الإضافة المباشرة
  document.querySelectorAll('#admin-quick-add-modal .relation-choices button').forEach(btn => {
    btn.addEventListener('click', () => chooseAdminRelationType(btn.dataset.adminRelation, btn));
  });
  document.getElementById('admin-quick-add-form').addEventListener('submit', submitAdminQuickAdd);
  document.getElementById('admin-add-photo-input').addEventListener('change', handleAdminAddPhotoSelect);
  document.getElementById('close-admin-quick-add-modal-btn').addEventListener('click', closeAdminQuickAddModal);
  document.getElementById('admin-finish-add-btn').addEventListener('click', closeAdminQuickAddModal);
  document.getElementById('admin-quick-add-modal').addEventListener('click', (e) => {
    if (e.target.id === 'admin-quick-add-modal') closeAdminQuickAddModal();
  });
});
