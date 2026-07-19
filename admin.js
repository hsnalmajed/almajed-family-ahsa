// =====================================================================
// منطق لوحة تحكم المدير
// =====================================================================

let pendingRequests = [];
let allPersonsAdmin = [];
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
          <div class="req-meta">الهاتف الجديد: ${r.phone ? escapeHtml(r.phone) : 'بدون تغيير'} | الصورة: ${r.photoURL ? 'محدَّثة' : 'بدون تغيير'}</div>
          <div class="req-meta">الحالة الجديدة: ${STATUS_LABELS_AR[r.status] || r.status}</div>
        </div>
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" data-approve-update="${r.id}">قبول</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">رفض</button>
        </div>
      `;
    } else if (r.requestType === 'addBatch') {
      const members = r.members || [];
      const membersHtml = members.map(m =>
        `<div class="req-meta">• ${escapeHtml(m.firstName)} — ${RELATION_LABELS_AR[m.relationType] || m.relationType} (${GENDER_LABELS_AR[m.gender] || ''})${m.phone ? ' — ' + escapeHtml(m.phone) : ''}</div>`
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
        const personRef = db.collection('persons').doc();
        tx.set(personRef, {
          displayId: lastId,
          firstName: m.firstName,
          gender: m.gender,
          photoURL: m.photoURL || '',
          phone: m.phone || '',
          status: 'alive',
          parentKey: m.parentKey,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      tx.set(counterRef, { lastId }, { merge: true });
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
 * قبول طلب تحديث بيانات: يعدّل مستند الشخص الموجود بدلاً من إنشاء شخص جديد
 */
async function approveUpdateRequest(requestId, btnEl) {
  btnEl.disabled = true;
  try {
    const reqRef = db.collection('requests').doc(requestId);

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) throw new Error('الطلب لم يعد موجوداً');
      const reqData = reqSnap.data();
      if (reqData.requestStatus !== 'pending') throw new Error('تمت معالجة هذا الطلب مسبقاً');

      const personQuery = await db.collection('persons').where('displayId', '==', reqData.targetPersonId).limit(1).get();
      if (personQuery.empty) throw new Error('الشخص المستهدف لم يعد موجوداً في الشجرة');
      const personRef = personQuery.docs[0].ref;

      const updates = {};
      if (reqData.phone) updates.phone = reqData.phone;
      if (reqData.photoURL) updates.photoURL = reqData.photoURL;
      if (reqData.status) updates.status = reqData.status;

      tx.update(personRef, updates);
      tx.update(reqRef, { requestStatus: 'approved', approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
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
    renderPersonsList(allPersonsAdmin);
    renderAdminTree();
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

  const virtualRootKeys = Object.keys(childrenByParentKey).filter(k => k.startsWith('v'));
  virtualRootKeys.forEach(vKey => {
    const rootPersons = childrenByParentKey[vKey] || [];
    const ul = document.createElement('ul');
    ul.className = 'tree-list root-list';
    rootPersons.forEach(p => ul.appendChild(buildAdminPersonNode(p, childrenByParentKey)));
    container.appendChild(ul);
  });
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
function openAdminEditModal(person) {
  selectedAdminTargetPerson = person;
  selectedAdminEditPhotoFile = null;
  document.getElementById('admin-edit-modal-title').textContent = `تعديل: ${person.firstName} (#${person.displayId})`;
  document.getElementById('admin-edit-name').value = person.firstName || '';
  document.getElementById('admin-edit-phone').value = person.phone || '';
  document.getElementById('admin-edit-photo-preview').style.display = 'none';
  document.querySelectorAll('input[name="admin-edit-gender"]').forEach(r => { r.checked = (r.value === person.gender); });
  document.querySelectorAll('input[name="admin-edit-status"]').forEach(r => { r.checked = (r.value === person.status); });
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
    const updates = { firstName, gender, phone, status };
    if (selectedAdminEditPhotoFile) {
      updates.photoURL = await resizeImageToBase64Admin(selectedAdminEditPhotoFile);
    }
    await db.collection('persons').doc(selectedAdminTargetPerson.id).update(updates);
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

    const counterRef = db.collection('meta').doc('counter');
    await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const lastId = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;
      const newId = lastId + 1;

      const personRef = db.collection('persons').doc();
      tx.set(personRef, {
        displayId: newId,
        firstName, gender, phone, status, photoURL,
        parentKey,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.set(counterRef, { lastId: newId }, { merge: true });
    });

    adminAddedMembersThisSession.push({ name: firstName, relation: selectedAdminRelationType });
    renderAdminAddedMembersList();

    document.getElementById('admin-add-name').value = '';
    document.getElementById('admin-add-phone').value = '';
    document.getElementById('admin-add-photo-input').value = '';
    document.getElementById('admin-add-photo-preview').style.display = 'none';
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

// البحث داخل شجرة العائلة بالمعرّف: التمرير إلى الشخص وإبرازه
function handleAdminTreeSearch(evt) {
  evt.preventDefault();
  const id = document.getElementById('admin-tree-search-input').value.trim();
  if (!id) return;
  const el = document.getElementById('admin-person-node-' + id);
  if (!el) { alert('لا يوجد شخص بهذا المعرّف في الشجرة'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  el.classList.add('highlighted');
  setTimeout(() => el.classList.remove('highlighted'), 2500);
}

// ---------------------------------------------------------------------
// إضافة شخص مباشرة (بدون مراجعة) - لبدء الشجرة أو إضافة فرع مستقل
// ---------------------------------------------------------------------
function openRootModal() {
  document.getElementById('root-add-form').reset();
  document.getElementById('root-photo-preview').style.display = 'none';
  selectedRootPhotoFile = null;
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
    const counterRef = db.collection('meta').doc('counter');

    await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const lastId = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;
      const newId = lastId + 1;

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
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.set(counterRef, { lastId: newId }, { merge: true });
    });

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
  el.addEventListener('input', () => {
    const cleaned = el.value.replace(/[^؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s]/g, '');
    if (cleaned !== el.value) el.value = cleaned;
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

async function saveTreeAsPdf(btnEl) {
  const el = document.getElementById('admin-tree-forest');
  if (!el || allPersonsAdmin.length === 0) { alert('لا توجد شجرة لحفظها بعد.'); return; }
  const original = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'جارٍ التجهيز...'; }
  try {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

    // مقياس مناسب مع البقاء ضمن حدود المتصفح لأبعاد الرسم (canvas)
    const fullW = el.scrollWidth, fullH = el.scrollHeight;
    const scale = Math.min(2, 16000 / Math.max(fullW, fullH));

    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: scale,
      width: fullW,
      height: fullH,
      windowWidth: fullW,
      windowHeight: fullH,
      useCORS: true
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.9);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height]
    });
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
    pdf.save('شجرة_عائلة_الماجد.pdf');
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء ملف PDF: ' + err.message);
  } finally {
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

  // حفظ الشجرة كاملة PDF
  document.getElementById('save-tree-pdf-btn').addEventListener('click', (e) => saveTreeAsPdf(e.currentTarget));

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
