// =====================================================================
// منطق الصفحة العامة: عرض الشجرة، الإحصائيات، إضافة/تحديث فرد (كطلب)،
// البحث، وحاسبة صلة القرابة.
// =====================================================================

let allPersons = [];              // كل الأشخاص المعتمدين
let personsByDisplayId = {};      // { "3": personObj, ... }
let selectedTargetPerson = null;  // الشخص الذي تم الضغط عليه
let selectedRelationType = null;  // 'son' | 'daughter' | 'brother' | 'sister'
let selectedPhotoFile = null;     // صورة طلب الإضافة
let selectedUpdatePhotoFile = null; // صورة طلب التحديث
let pendingMembers = []; // قائمة الأفراد المُجهّزين لإرسالهم ضمن طلب واحد

const RELATION_LABELS = {
  son: 'ابن',
  daughter: 'ابنة',
  brother: 'أخ',
  sister: 'أخت'
};

// أي "ابن" أو "أخ" ذكر تلقائياً، وأي "ابنة" أو "أخت" أنثى تلقائياً
const RELATION_TO_GENDER = {
  son: 'male',
  brother: 'male',
  daughter: 'female',
  sister: 'female'
};

// ---------------------------------------------------------------------
// تحميل البيانات (تحديث مباشر Realtime)
// ---------------------------------------------------------------------
function listenToPersons() {
  db.collection('persons').orderBy('displayId').onSnapshot(snapshot => {
    allPersons = [];
    personsByDisplayId = {};
    snapshot.forEach(doc => {
      const p = { id: doc.id, ...doc.data() };
      allPersons.push(p);
      personsByDisplayId[String(p.displayId)] = p;
    });
    renderStats();
    renderTree();
  }, err => {
    console.error(err);
    showToast('تعذر تحميل بيانات الشجرة. تحقق من إعدادات Firebase.', true);
  });
}

// ---------------------------------------------------------------------
// الإحصائيات
// ---------------------------------------------------------------------
function renderStats() {
  const total = allPersons.length;
  const male = allPersons.filter(p => p.gender === 'male').length;
  const female = allPersons.filter(p => p.gender === 'female').length;
  const alive = allPersons.filter(p => p.status === 'alive').length;
  const dead = allPersons.filter(p => p.status === 'death').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-male').textContent = male;
  document.getElementById('stat-female').textContent = female;
  document.getElementById('stat-alive').textContent = alive;
  document.getElementById('stat-dead').textContent = dead;
}

// ---------------------------------------------------------------------
// بناء وعرض الشجرة (من أعلى إلى أسفل، بحسب الأجيال)
// ---------------------------------------------------------------------
function renderTree() {
  const container = document.getElementById('tree-forest');
  container.innerHTML = '';

  if (allPersons.length === 0) {
    container.innerHTML = '<div class="empty-state">لا يوجد أي أفراد في الشجرة بعد. يقوم المدير بإضافة أول فرد (الجد الأول) من لوحة التحكم.</div>';
    return;
  }

  // تجميع الأبناء حسب parentKey
  const childrenByParentKey = {};
  allPersons.forEach(p => {
    const key = String(p.parentKey);
    if (!childrenByParentKey[key]) childrenByParentKey[key] = [];
    childrenByParentKey[key].push(p);
  });

  // تحديد الجذور الافتراضية (تبدأ بـ v) ثم عرض كل مجموعة كشجرة منفصلة
  const virtualRootKeys = Object.keys(childrenByParentKey).filter(k => k.startsWith('v'));

  virtualRootKeys.forEach(vKey => {
    const rootPersons = childrenByParentKey[vKey] || [];
    const ul = document.createElement('ul');
    ul.className = 'tree-list root-list';
    rootPersons.forEach(p => {
      ul.appendChild(buildPersonNode(p, childrenByParentKey));
    });
    container.appendChild(ul);
  });

  // عند أول تحميل: توسيط الجذر (المعرّف 1) في منتصف الشاشة
  if (!treeCenteredOnce) {
    setTimeout(centerTreeOnRoot, 80);
  }
}

// توسيط بطاقة الشخص صاحب المعرّف 1 (أو أول جذر) أفقياً داخل نافذة عرض الشجرة
let treeCenteredOnce = false;
function centerTreeOnRoot() {
  const vp = document.getElementById('tree-viewport');
  if (!vp) return;
  let root = document.getElementById('person-node-1') || vp.querySelector('.person-node');
  if (!root) return;
  const vpRect = vp.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const rootCenterInContent = (rootRect.left - vpRect.left) + vp.scrollLeft + rootRect.width / 2;
  vp.scrollLeft = rootCenterInContent - vp.clientWidth / 2;
  vp.scrollTop = 0;
  treeCenteredOnce = true;
}

function buildPersonNode(person, childrenByParentKey) {
  const li = document.createElement('li');

  const node = document.createElement('div');
  const isDead = person.status === 'death';
  node.className = `person-node ${person.gender}${isDead ? ' deceased' : ''}`;
  node.id = 'person-node-' + person.displayId;
  node.onclick = () => openChoiceModal(person);

  const photoWrap = document.createElement('div');
  photoWrap.className = 'photo-wrap';
  const img = document.createElement('img');
  img.className = 'person-photo';
  img.src = person.photoURL || defaultAvatar(person.gender);
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
    kids.forEach(k => ul.appendChild(buildPersonNode(k, childrenByParentKey)));
    li.appendChild(ul);
  }
  return li;
}

function defaultAvatar(gender) {
  // صورة افتراضية بسيطة (SVG) حسب الجنس
  const color = gender === 'female' ? '%23b23b6b' : '%232f6f9e';
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='${color}' opacity='0.25'/><circle cx='50' cy='38' r='18' fill='${color}'/><ellipse cx='50' cy='82' rx='30' ry='22' fill='${color}'/></svg>`;
}

/**
 * يصغّر الصورة داخل المتصفح ويحوّلها إلى نص Base64 (بدون رفعها لأي خادم خارجي)
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

// ---------------------------------------------------------------------
// نافذة اختيار الإجراء: تحديث المعلومات / إضافة فرد جديد
// ---------------------------------------------------------------------
function openChoiceModal(person) {
  selectedTargetPerson = person;
  document.getElementById('choice-modal-title').textContent = `${person.firstName} (#${person.displayId}) — ماذا تريد أن تفعل؟`;
  document.getElementById('choice-modal').classList.add('open');
}
function closeChoiceModal() {
  document.getElementById('choice-modal').classList.remove('open');
}

// ---------------------------------------------------------------------
// نافذة تحديث المعلومات (هاتف / صورة / حالة)
// ---------------------------------------------------------------------
function openUpdateModal(person) {
  selectedTargetPerson = person;
  selectedUpdatePhotoFile = null;
  document.getElementById('update-modal-title').textContent = `تحديث معلومات: ${person.firstName} (#${person.displayId})`;
  document.getElementById('update-info-form').reset();
  document.getElementById('update-photo-preview').style.display = 'none';
  document.querySelectorAll('input[name="update-status"]').forEach(r => {
    r.checked = (r.value === person.status);
  });
  document.getElementById('update-modal').classList.add('open');
}
function closeUpdateModal() {
  document.getElementById('update-modal').classList.remove('open');
  selectedUpdatePhotoFile = null;
}

function handleUpdatePhotoSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('حجم الصورة كبير جداً (الحد الأقصى 8 ميجابايت)', true);
    evt.target.value = '';
    return;
  }
  selectedUpdatePhotoFile = file;
  const preview = document.getElementById('update-photo-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
}

async function submitUpdateInfo(evt) {
  evt.preventDefault();
  if (!selectedTargetPerson) return;

  const phone = document.getElementById('update-phone').value.trim();
  const status = document.querySelector('input[name="update-status"]:checked')?.value;

  if (!status) {
    showToast('الرجاء اختيار الحالة', true);
    return;
  }

  const btn = document.getElementById('submit-update-btn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الإرسال...';

  try {
    let photoURL = '';
    if (selectedUpdatePhotoFile) {
      photoURL = await resizeImageToBase64(selectedUpdatePhotoFile);
    }

    await db.collection('requests').add({
      requestType: 'update',
      targetPersonId: selectedTargetPerson.displayId,
      targetPersonName: selectedTargetPerson.firstName,
      phone: phone || '',
      photoURL: photoURL || '',
      status,
      requestStatus: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    sendUpdateRequestEmailNotification({
      targetPersonId: selectedTargetPerson.displayId,
      targetPersonName: selectedTargetPerson.firstName,
      phone, status
    });

    showToast('تم إرسال طلب التحديث بنجاح، سيتم مراجعته من قِبل المدير.');
    closeUpdateModal();
  } catch (err) {
    console.error(err);
    showToast('حدث خطأ أثناء إرسال الطلب: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'إرسال طلب التحديث';
  }
}

// ---------------------------------------------------------------------
// نافذة إضافة فرد جديد
// ---------------------------------------------------------------------
function openAddModal(person) {
  selectedTargetPerson = person;
  selectedRelationType = null;
  selectedPhotoFile = null;
  pendingMembers = [];

  document.getElementById('modal-target-name').textContent = `إضافة أقارب لـ: ${person.firstName} (#${person.displayId})`;
  document.querySelectorAll('.relation-choices button').forEach(b => b.classList.remove('selected'));
  document.getElementById('add-member-form').reset();
  document.getElementById('add-member-form').style.display = 'none';
  document.getElementById('photo-preview').style.display = 'none';
  renderPendingMembers();

  document.getElementById('add-modal').classList.add('open');
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
  selectedTargetPerson = null;
  selectedRelationType = null;
  selectedPhotoFile = null;
  pendingMembers = [];
  renderPendingMembers();
}

function renderPendingMembers() {
  const box = document.getElementById('added-members-list');
  if (pendingMembers.length === 0) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = `<div class="added-members-title">سيتم إرسال ${pendingMembers.length} فرد ضمن هذا الطلب:</div>` +
    pendingMembers.map((m, i) => `<div class="added-member-chip">✅ ${escapeHtmlLocal(m.firstName)} <span>(${escapeHtmlLocal(RELATION_LABELS[m.relationType] || m.relationType)})</span><button type="button" class="chip-remove" data-remove-member="${i}" aria-label="حذف">✕</button></div>`).join('');
  box.querySelectorAll('[data-remove-member]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingMembers.splice(parseInt(btn.dataset.removeMember, 10), 1);
      renderPendingMembers();
    });
  });
}

function chooseRelationType(type, btnEl) {
  selectedRelationType = type;
  document.querySelectorAll('.relation-choices button').forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  document.getElementById('add-member-form').style.display = 'block';
  document.getElementById('input-first-name').focus();
}

/**
 * يحفظ الفرد المعبّأ حالياً في قائمة الانتظار (pendingMembers) ضمن نفس الطلب.
 * يُرجع true عند النجاح.
 */
async function stashCurrentMember(showErrors) {
  if (!selectedRelationType) {
    if (showErrors) showToast('الرجاء اختيار نوع القرابة أولاً', true);
    return false;
  }
  const firstName = document.getElementById('input-first-name').value.trim();
  if (!firstName) {
    if (showErrors) showToast('الرجاء إدخال الاسم', true);
    return false;
  }
  const phone = document.getElementById('input-phone').value.trim();
  const gender = RELATION_TO_GENDER[selectedRelationType];

  let photoURL = '';
  if (selectedPhotoFile) {
    photoURL = await resizeImageToBase64(selectedPhotoFile);
  }

  let parentKey;
  if (selectedRelationType === 'son' || selectedRelationType === 'daughter') {
    parentKey = String(selectedTargetPerson.displayId);
  } else {
    parentKey = String(selectedTargetPerson.parentKey);
  }

  pendingMembers.push({ firstName, gender, phone, photoURL, relationType: selectedRelationType, parentKey });
  renderPendingMembers();

  // تفريغ النموذج استعداداً للفرد التالي
  document.getElementById('add-member-form').reset();
  document.getElementById('photo-preview').style.display = 'none';
  selectedPhotoFile = null;
  return true;
}

/**
 * "إضافة فرد آخر": يحفظ الفرد الحالي ثم يعيد إظهار خيارات القرابة لإدخال التالي
 */
async function addAnotherMember() {
  const btn = document.getElementById('add-another-btn');
  btn.disabled = true;
  try {
    const ok = await stashCurrentMember(true);
    if (ok) {
      selectedRelationType = null;
      document.querySelectorAll('.relation-choices button').forEach(b => b.classList.remove('selected'));
      document.getElementById('add-member-form').style.display = 'none';
      showToast('تمت إضافة الفرد للطلب. اختر نوع القرابة للفرد التالي.');
    }
  } finally {
    btn.disabled = false;
  }
}

function handlePhotoSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('حجم الصورة كبير جداً (الحد الأقصى 8 ميجابايت)', true);
    evt.target.value = '';
    return;
  }
  selectedPhotoFile = file;
  const preview = document.getElementById('photo-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
}

/**
 * "إرسال الطلب": يضمّ الفرد المعبّأ حالياً (إن وُجد) إلى القائمة ثم يرسل جميع
 * الأفراد المُجهّزين كطلب واحد (requestType: 'addBatch').
 */
async function submitAddRequest(evt) {
  evt.preventDefault();
  if (!selectedTargetPerson) return;

  const submitBtn = document.getElementById('submit-request-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'جارٍ الإرسال...';

  try {
    // ضمّ الفرد المعبّأ حالياً (إن كان هناك اسم ونوع قرابة مختار)
    if (selectedRelationType && document.getElementById('input-first-name').value.trim()) {
      await stashCurrentMember(false);
    }

    if (pendingMembers.length === 0) {
      showToast('الرجاء إضافة فرد واحد على الأقل قبل الإرسال', true);
      return;
    }

    await db.collection('requests').add({
      requestType: 'addBatch',
      targetPersonId: selectedTargetPerson.displayId,
      targetPersonName: selectedTargetPerson.firstName,
      members: pendingMembers,
      requestStatus: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    sendBatchRequestEmailNotification({
      targetPersonId: selectedTargetPerson.displayId,
      targetPersonName: selectedTargetPerson.firstName,
      members: pendingMembers
    });

    showToast(`تم إرسال الطلب بنجاح (${pendingMembers.length} فرد)، سيتم مراجعته من قِبل المدير.`);
    closeAddModal();
  } catch (err) {
    console.error(err);
    showToast('حدث خطأ أثناء إرسال الطلب: ' + err.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '📨 إرسال الطلب';
  }
}

/**
 * إرسال إشعار بريد إلكتروني للمدير عند تقديم طلب إضافة (فرد واحد أو أكثر)، عبر EmailJS
 */
function sendBatchRequestEmailNotification(data) {
  if (typeof emailjs === 'undefined' || !window.EMAILJS_SERVICE_ID || !window.EMAILJS_TEMPLATE_ID) {
    console.warn('EmailJS غير مهيأ، تم تخطي إرسال إشعار البريد.');
    return;
  }
  const names = data.members
    .map(m => `${m.firstName} (${RELATION_LABELS[m.relationType] || m.relationType})`)
    .join('، ');

  emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
    new_person_name: names,
    new_person_gender: '—',
    relation_type: `طلب إضافة ${data.members.length} فرد`,
    target_person_name: data.targetPersonName,
    target_person_id: data.targetPersonId,
    phone: '—',
    status: 'على قيد الحياة'
  }).catch(err => {
    console.error('EmailJS error:', err);
  });
}

/**
 * إرسال إشعار بريد إلكتروني للمدير عند تقديم طلب تحديث معلومات
 */
function sendUpdateRequestEmailNotification(data) {
  if (typeof emailjs === 'undefined' || !window.EMAILJS_SERVICE_ID || !window.EMAILJS_TEMPLATE_ID) {
    console.warn('EmailJS غير مهيأ، تم تخطي إرسال إشعار البريد.');
    return;
  }
  const statusLabel = data.status === 'alive' ? 'على قيد الحياة' : 'متوفى';

  emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
    new_person_name: data.targetPersonName,
    new_person_gender: '—',
    relation_type: 'طلب تحديث بيانات',
    target_person_name: data.targetPersonName,
    target_person_id: data.targetPersonId,
    phone: data.phone || 'لم يتم تغييره',
    status: statusLabel
  }).catch(err => {
    console.error('EmailJS error:', err);
  });
}

// ---------------------------------------------------------------------
// حاسبة صلة القرابة
// ---------------------------------------------------------------------
function handleRelationFinder(evt) {
  evt.preventDefault();
  const id1 = document.getElementById('rel-id-1').value.trim();
  const id2 = document.getElementById('rel-id-2').value.trim();
  const resultBox = document.getElementById('relation-result');

  if (!id1 || !id2) {
    resultBox.textContent = 'الرجاء إدخال المعرّفين';
    resultBox.className = 'relation-result error';
    resultBox.style.display = 'block';
    return;
  }

  const result = window.FamilyRelationship.computeRelationship(id1, id2, personsByDisplayId);
  if (result.ok) {
    let html = `<div>${escapeHtmlLocal(result.text)}</div>`;
    if (result.linkPerson && String(result.linkPerson.id) !== String(id1) && String(result.linkPerson.id) !== String(id2)) {
      html += `<div class="link-person-line">🔗 الشخص الذي يربط بينهما: <b>${escapeHtmlLocal(result.linkPerson.name)}</b> (#${result.linkPerson.id})</div>`;
    }
    resultBox.innerHTML = html;
    resultBox.className = 'relation-result';
  } else {
    resultBox.textContent = result.reason;
    resultBox.className = 'relation-result error';
  }
  resultBox.style.display = 'block';
}

function escapeHtmlLocal(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------
// البحث بالاسم أو المعرّف
// ---------------------------------------------------------------------
function handleSearch(evt) {
  evt.preventDefault();
  const query = document.getElementById('search-input').value.trim();
  const box = document.getElementById('search-results');

  if (!query) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }

  let matches;
  if (/^\d+$/.test(query)) {
    matches = allPersons.filter(p => String(p.displayId) === query);
  } else {
    matches = allPersons.filter(p => p.firstName && p.firstName.includes(query));
  }

  if (matches.length === 0) {
    box.innerHTML = '<div class="search-no-results">لا توجد نتائج مطابقة</div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = matches.map(p => `
    <div class="search-result-item" data-goto="${p.displayId}">
      <img src="${p.photoURL || defaultAvatar(p.gender)}" alt="">
      <span>${escapeHtmlLocal(p.firstName)} (#${p.displayId})</span>
    </div>
  `).join('');
  box.style.display = 'block';

  box.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => scrollToPerson(el.dataset.goto));
  });
}

function scrollToPerson(displayId) {
  const el = document.getElementById('person-node-' + displayId);
  if (!el) {
    showToast('تعذر إيجاد هذا الشخص في الشجرة المعروضة', true);
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('highlighted');
  setTimeout(() => el.classList.remove('highlighted'), 2200);

  document.getElementById('search-results').style.display = 'none';
  document.getElementById('search-input').value = '';
}

// ---------------------------------------------------------------------
// أدوات مساعدة
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// تكبير/تصغير الشجرة
// ---------------------------------------------------------------------
let treeZoom = 1;
function applyTreeZoom() {
  const forest = document.getElementById('tree-forest');
  if (forest) {
    // نستخدم خاصية zoom لأنها تعيد حساب التخطيط فتظهر أشرطة التمرير عند التكبير
    forest.style.zoom = treeZoom;
  }
  const lbl = document.getElementById('zoom-level');
  if (lbl) lbl.textContent = Math.round(treeZoom * 100) + '%';
}
function setTreeZoom(z) {
  treeZoom = Math.min(2, Math.max(0.5, Math.round(z * 100) / 100));
  applyTreeZoom();
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

let toastTimer = null;
function showToast(msg, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4000);
}

// ---------------------------------------------------------------------
// ربط الأحداث عند تحميل الصفحة
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  listenToPersons();

  // نافذة اختيار الإجراء
  document.getElementById('close-choice-modal-btn').addEventListener('click', closeChoiceModal);
  document.getElementById('choice-modal').addEventListener('click', (e) => {
    if (e.target.id === 'choice-modal') closeChoiceModal();
  });
  document.getElementById('choice-update-btn').addEventListener('click', () => {
    const person = selectedTargetPerson;
    closeChoiceModal();
    openUpdateModal(person);
  });
  document.getElementById('choice-add-btn').addEventListener('click', () => {
    const person = selectedTargetPerson;
    closeChoiceModal();
    openAddModal(person);
  });

  // نافذة تحديث المعلومات
  document.getElementById('update-info-form').addEventListener('submit', submitUpdateInfo);
  document.getElementById('update-photo-input').addEventListener('change', handleUpdatePhotoSelect);
  document.getElementById('close-update-modal-btn').addEventListener('click', closeUpdateModal);
  document.getElementById('cancel-update-modal-btn').addEventListener('click', closeUpdateModal);
  document.getElementById('update-modal').addEventListener('click', (e) => {
    if (e.target.id === 'update-modal') closeUpdateModal();
  });

  // نافذة إضافة فرد جديد
  document.querySelectorAll('.relation-choices button').forEach(btn => {
    btn.addEventListener('click', () => chooseRelationType(btn.dataset.relation, btn));
  });
  document.getElementById('add-member-form').addEventListener('submit', submitAddRequest);
  document.getElementById('add-another-btn').addEventListener('click', addAnotherMember);
  document.getElementById('input-photo').addEventListener('change', handlePhotoSelect);
  document.getElementById('close-modal-btn').addEventListener('click', closeAddModal);
  document.getElementById('add-modal').addEventListener('click', (e) => {
    if (e.target.id === 'add-modal') closeAddModal();
  });

  // قصر حقل اسم الفرد الجديد على الحروف العربية فقط
  enforceArabicOnly(document.getElementById('input-first-name'));

  // أزرار تكبير/تصغير الشجرة
  document.getElementById('zoom-in').addEventListener('click', () => setTreeZoom(treeZoom + 0.15));
  document.getElementById('zoom-out').addEventListener('click', () => setTreeZoom(treeZoom - 0.15));
  document.getElementById('zoom-reset').addEventListener('click', () => { setTreeZoom(1); setTimeout(centerTreeOnRoot, 50); });

  // حاسبة القرابة
  document.getElementById('relation-finder-form').addEventListener('submit', handleRelationFinder);

  // البحث
  document.getElementById('search-form').addEventListener('submit', handleSearch);
  document.addEventListener('click', (e) => {
    const box = document.getElementById('search-results');
    if (!box.contains(e.target) && e.target.id !== 'search-input') {
      box.style.display = 'none';
    }
  });
});
