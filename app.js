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

  renderRelatedFamilies();
}

/**
 * مفتاح موحّد لمقارنة أسماء العوائل حتى لا تتكرر بسبب اختلاف
 * الهمزات أو التشكيل أو المسافات أو بادئة "آل".
 */
// أسماء عوائل الشخص: تدعم الحقل الجديد (قائمة) والقديم (نص واحد)
function personFamilies(p) {
  if (Array.isArray(p.spouseFamilies)) return p.spouseFamilies.filter(Boolean);
  return p.spouseFamily ? [p.spouseFamily] : [];
}

function familyKey(name) {
  return String(name)
    .replace(/[ً-ْٰـ]/g, '') // تشكيل وتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^(ال|آل)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// عائلتنا نفسها لا تُحسب ضمن "العوائل المنتسبون معهم"
const OWN_FAMILY_KEYS = new Set([familyKey('الماجد'), familyKey('ماجد')]);

// عوائل الأزواج والزوجات: رسم بياني بعدد الروابط لكل عائلة
function renderRelatedFamilies() {
  // المفتاح الموحّد -> { name: أول رسم للاسم, count: عدد الروابط }
  const stats = new Map();
  allPersons.forEach(p => {
    personFamilies(p).forEach(v => {
      const raw = String(v).trim().replace(/\s+/g, ' ');
      if (!raw) return;
      const key = familyKey(raw);
      if (!key || OWN_FAMILY_KEYS.has(key)) return; // نتجاهل عائلة الماجد نفسها
      if (!stats.has(key)) stats.set(key, { name: raw, count: 0 });
      stats.get(key).count += 1;
    });
  });

  // الأكثر ارتباطاً أولاً، وعند التساوي ترتيب أبجدي
  const families = Array.from(stats.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar'));

  const countEl = document.getElementById('stat-families');
  if (countEl) countEl.textContent = families.length;

  // ===== الصندوق الأول: أسماء العوائل كشارات =====
  const chipsBox = document.getElementById('families-chips');
  if (chipsBox) {
    chipsBox.innerHTML = '';
    if (families.length === 0) {
      chipsBox.innerHTML = '<div class="families-empty">لم تُسجَّل أي عائلة بعد — تُضاف تلقائياً عند تحديد «متزوج/متزوجة» وكتابة اسم عائلة الزوج أو الزوجة.</div>';
    } else {
      // ترتيب أبجدي في قائمة الأسماء
      families.slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        .forEach(f => {
          const chip = document.createElement('span');
          chip.className = 'family-chip';
          chip.textContent = f.name;
          chipsBox.appendChild(chip);
        });
    }
  }

  // ===== الصندوق الثاني: رسم بياني بعدد الروابط =====
  const barsBox = document.getElementById('families-bars');
  if (!barsBox) return;
  barsBox.innerHTML = '';

  if (families.length === 0) {
    barsBox.innerHTML = '<div class="families-empty">لا توجد بيانات لعرضها بعد.</div>';
    return;
  }

  const max = families[0].count || 1;

  families.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'family-bar-row';

    const rank = document.createElement('span');
    rank.className = 'fb-rank';
    rank.textContent = (i + 1);

    const name = document.createElement('span');
    name.className = 'fb-name';
    name.textContent = f.name;
    name.title = f.name;

    const track = document.createElement('div');
    track.className = 'fb-track';

    const fill = document.createElement('div');
    fill.className = 'fb-fill';
    // أقل عرض 14% حتى يبقى الرقم مقروءاً داخل الشريط
    fill.style.width = Math.max(14, (f.count / max) * 100) + '%';

    const val = document.createElement('span');
    val.className = 'fb-val';
    val.textContent = f.count;

    fill.appendChild(val);
    track.appendChild(fill);
    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(track);
    barsBox.appendChild(row);
  });

  // عرض عمود الأسماء تتكفّل به شبكة CSS (max-content) فيتسع لأطول اسم تلقائياً
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
    rootPersons.forEach(p => {
      ul.appendChild(buildPersonNode(p, childrenByParentKey));
    });
    container.appendChild(ul);
  });

  applyTreeZoom();
  enableTreePan(document.getElementById('tree-viewport'));

  // توسيط الجذر (المعرّف 1) في منتصف الشاشة بعد اكتمال الرسم
  centerTreeOnRootSoon();
}

// توسيط بطاقة الشخص صاحب المعرّف 1 (أو أول جذر) أفقياً داخل نافذة عرض الشجرة
let treeCenteredOnce = false;
function centerTreeOnRoot() {
  const vp = document.getElementById('tree-viewport');
  // إن لم يكن للإطار مقاس بعد فالتخطيط لم يكتمل — نُعيد false ليُعاد المحاولة
  if (!vp || !vp.clientWidth) return false;

  const root = document.getElementById('person-node-1') || vp.querySelector('.person-node');
  if (!root || !root.getBoundingClientRect().width) return false;

  const vpRect = vp.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  // الموضع الحقيقي لمركز البطاقة داخل المحتوى (يعمل مع RTL وقيم التمرير السالبة)
  const rootCenterInContent = (rootRect.left - vpRect.left) + vp.scrollLeft + rootRect.width / 2;

  vp.scrollLeft = rootCenterInContent - vp.clientWidth / 2;
  vp.scrollTop = 0;
  treeCenteredOnce = true;
  return true;
}

// يحاول التوسيط عدة مرات حتى يكتمل التخطيط والخطوط والصور
// (مهم على الجوال حيث يتأخر حساب المقاسات بعد تدوير الشاشة أو تحميل الخطوط)
function centerTreeOnRootSoon() {
  let tries = 0;
  const attempt = () => {
    // ننجح مرة ثم نعيدها مرة أخيرة بعد استقرار التخطيط تماماً
    if (centerTreeOnRoot()) {
      setTimeout(centerTreeOnRoot, 200);
      return;
    }
    if (++tries > 25) return;
    setTimeout(attempt, 120);
  };
  // لا نعتمد على rAF وحده لأنه متوقّف في التبويبات الخلفية
  setTimeout(attempt, 0);
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
  const marital = person.maritalStatus === 'married'
    ? (person.gender === 'female' ? ' • متزوجة' : ' • متزوج')
    : '';
  idEl.textContent = `#${person.displayId}` + (person.status === 'death' ? ' • متوفى' : '') + marital;
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
// ---------------------------------------------------------------------
// سلسلة الآباء: الأب ثم الجد ثم جد الأب... حتى أعلى الشجرة
// ---------------------------------------------------------------------
function ancestorsOf(person, limit) {
  const chain = [];
  const seen = new Set([String(person.displayId)]);
  let cur = person;
  const max = limit || 60;

  while (chain.length < max) {
    const pk = String(cur.parentKey || '');
    // الجذر يبدأ مفتاحه بحرف v أي لا والد له
    if (!pk || pk.startsWith('v')) break;
    const parent = personsByDisplayId[pk];
    if (!parent || seen.has(String(parent.displayId))) break;
    seen.add(String(parent.displayId));
    chain.push(parent);
    cur = parent;
  }
  return chain;
}

// الاسم مع عدد محدود من الآباء: "حسن - علي - أحمد"
function shortLineage(person, depth) {
  const names = [person.firstName].concat(
    ancestorsOf(person, depth || 2).map(a => a.firstName)
  );
  return names.filter(Boolean).join(' - ');
}

// الاسم الكامل حتى نهاية الشجرة
function fullLineage(person) {
  const names = [person.firstName].concat(ancestorsOf(person).map(a => a.firstName));
  return names.filter(Boolean).join(' - ');
}

function openChoiceModal(person) {
  selectedTargetPerson = person;
  const fams = personFamilies(person);
  const spouseNote = person.maritalStatus === 'married' && fams.length
    ? ` — ${person.gender === 'female' ? 'عائلة الزوج' : 'عوائل الزوجات'}: ${fams.join('، ')}`
    : '';
  document.getElementById('choice-modal-title').textContent =
    `${person.firstName} (#${person.displayId})${spouseNote} — ماذا تريد أن تفعل؟`;

  // الاسم الكامل بسلسلة الآباء حتى أعلى الشجرة
  const fullBox = document.getElementById('choice-full-name');
  if (fullBox) {
    const chainLen = ancestorsOf(person).length;
    fullBox.querySelector('.cfn-value').textContent = fullLineage(person);
    fullBox.querySelector('.cfn-meta').textContent =
      chainLen > 0 ? `المعرّف #${person.displayId} • ${chainLen} جيل حتى الجد الأول` : `المعرّف #${person.displayId}`;
    fullBox.style.display = 'block';
  }

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

  // رقم التواصل الحالي يظهر في الحقل حتى يعرف المستخدم أنه مسجّل مسبقاً
  const phoneInput = document.getElementById('update-phone');
  phoneInput.value = person.phone || '';
  const phoneHint = document.getElementById('update-phone-hint');
  if (phoneHint) {
    phoneHint.textContent = person.phone
      ? 'الرقم المسجّل حالياً — عدّله إن تغيّر، أو امسحه لحذفه.'
      : 'لا يوجد رقم مسجّل لهذا الشخص.';
  }

  // الحالة الاجتماعية: النص بحسب جنس الشخص، والقيم الحالية إن وُجدت
  applyMaritalLabels(document.getElementById('update-modal'), person.gender);
  const currentMarital = person.maritalStatus === 'married' ? 'married' : 'single';
  document.querySelectorAll('input[name="update-marital"]').forEach(r => {
    r.checked = (r.value === currentMarital);
  });
  if (updateFamilyList) updateFamilyList.set(personFamilies(person));
  refreshMaritalGroup('update-marital', 'update-spouse-group');

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
      maritalStatus: (document.querySelector('input[name="update-marital"]:checked')?.value) || 'single',
      spouseFamilies: (document.querySelector('input[name="update-marital"]:checked')?.value === 'married' && updateFamilyList)
        ? updateFamilyList.values()
        : [],
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

// ---------------------------------------------------------------------
// الحالة الاجتماعية: تغيير النص بحسب الجنس وإظهار خانة عائلة الزوج/الزوجة
// ---------------------------------------------------------------------
function applyMaritalLabels(scopeEl, gender) {
  if (!scopeEl) return;
  const female = gender === 'female';
  scopeEl.querySelectorAll('.marital-single-lbl').forEach(el => {
    el.textContent = female ? 'غير متزوجة' : 'غير متزوج';
  });
  scopeEl.querySelectorAll('.marital-married-lbl').forEach(el => {
    el.textContent = female ? 'متزوجة' : 'متزوج';
  });
  scopeEl.querySelectorAll('.spouse-label').forEach(el => {
    el.textContent = female ? 'عائلة الزوج' : 'عائلة الزوجة';
  });
  scopeEl.querySelectorAll('.spouse-group input').forEach(el => {
    el.placeholder = female ? 'اسم عائلة الزوج' : 'اسم عائلة الزوجة';
  });
}

// إظهار/إخفاء خانة عائلة الزوج أو الزوجة بحسب الاختيار
function bindMaritalToggle(radioName, groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  document.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
    r.addEventListener('change', () => {
      group.style.display = (r.checked && r.value === 'married') ? 'block' : 'none';
    });
  });
}

function refreshMaritalGroup(radioName, groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const checked = document.querySelector(`input[name="${radioName}"]:checked`);
  group.style.display = (checked && checked.value === 'married') ? 'block' : 'none';
}


// ---------------------------------------------------------------------
// حقل يقبل أكثر من اسم عائلة (للزوجات المتعددات أو تعدد الروابط)
// ---------------------------------------------------------------------
function createFamilyList(inputId, addBtnId, chipsId) {
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
      x.textContent = '✕';
      x.title = 'إزالة';
      x.addEventListener('click', () => { state.splice(i, 1); render(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  function add() {
    if (!input) return;
    const v = input.value.trim().replace(/\s+/g, ' ');
    if (!v) return;
    // لا نكرّر نفس العائلة حتى لو اختلف الرسم
    if (!state.some(x => familyKey(x) === familyKey(v))) state.push(v);
    input.value = '';
    render();
  }

  if (addBtn) addBtn.addEventListener('click', add);
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  return {
    // نضيف ما تبقّى مكتوباً في الحقل حتى لو نسي المستخدم الضغط على "إضافة"
    values() { add(); return state.slice(); },
    set(list) {
      state.length = 0;
      (list || []).forEach(v => { const t = String(v).trim(); if (t) state.push(t); });
      if (input) input.value = '';
      render();
    },
    clear() { this.set([]); }
  };
}

let updateFamilyList = null;
let addFamilyList = null;

function chooseRelationType(type, btnEl) {
  selectedRelationType = type;
  document.querySelectorAll('.relation-choices button').forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  document.getElementById('add-member-form').style.display = 'block';
  // ابن/أخ ← صيغة المذكر وعائلة الزوجة، ابنة/أخت ← صيغة المؤنث وعائلة الزوج
  applyMaritalLabels(document.getElementById('add-modal'), RELATION_TO_GENDER[type]);
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

  const maritalStatus = document.querySelector('input[name="input-marital"]:checked')?.value || 'single';
  const spouseFamilies = (maritalStatus === 'married' && addFamilyList) ? addFamilyList.values() : [];

  pendingMembers.push({
    firstName, gender, phone, photoURL,
    relationType: selectedRelationType, parentKey,
    maritalStatus, spouseFamilies
  });
  renderPendingMembers();

  // تفريغ النموذج استعداداً للفرد التالي
  document.getElementById('add-member-form').reset();
  document.getElementById('photo-preview').style.display = 'none';
  if (addFamilyList) addFamilyList.clear();
  refreshMaritalGroup('input-marital', 'input-spouse-group');
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
      <span class="sr-name"><b class="sr-id">(${p.displayId})</b> ${escapeHtmlLocal(shortLineage(p, 2))}</span>
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
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  el.classList.add('highlighted');
  setTimeout(() => el.classList.remove('highlighted'), 2200);

  const results = document.getElementById('search-results');
  if (results) results.style.display = 'none';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
}

// الانتقال إلى موقع مُعِدّ الشجرة (المعرّف 147) من بطاقة "إعداد"
const PREPARED_BY_ID = 147;
function gotoPreparedByPerson() {
  const el = document.getElementById('person-node-' + PREPARED_BY_ID);
  if (!el) {
    showToast('لم يتم العثور على المعرّف ' + PREPARED_BY_ID + ' في الشجرة بعد', true);
    return;
  }
  // نكبّر قليلاً إن كانت الشجرة مصغّرة جداً حتى تظهر البطاقة بوضوح
  if (treeZoom < 0.5) setTreeZoom(0.6);
  setTimeout(() => scrollToPerson(PREPARED_BY_ID), 60);
}

// ---------------------------------------------------------------------
// أدوات مساعدة
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// تكبير/تصغير الشجرة
// ---------------------------------------------------------------------
let treeZoom = 0.5;
function applyTreeZoom() {
  const forest = document.getElementById('tree-forest');
  if (forest) {
    // نستخدم خاصية zoom لأنها تعيد حساب التخطيط فتظهر أشرطة التمرير عند التكبير
    forest.style.zoom = treeZoom;
  }
  const lbl = document.getElementById('zoom-level');
  if (lbl) lbl.textContent = Math.round(treeZoom * 100) + '%';
}
/**
 * تغيير التكبير مع الإبقاء على نفس النقطة التي ينظر إليها المستخدم في المنتصف،
 * حتى لا تقفز الشجرة إلى مكان آخر عند كل ضغطة تكبير أو تصغير.
 */
function setTreeZoom(z) {
  const vp = document.getElementById('tree-viewport');
  const oldZoom = treeZoom;
  const newZoom = Math.min(3, Math.max(0.1, Math.round(z * 100) / 100));
  if (newZoom === oldZoom) return;

  // إحداثيات نقطة المنتصف الحالية بالنسبة للمحتوى غير المكبَّر
  let cx = null, cy = null;
  if (vp && vp.clientWidth) {
    cx = (vp.scrollLeft + vp.clientWidth / 2) / oldZoom;
    cy = (vp.scrollTop + vp.clientHeight / 2) / oldZoom;
  }

  treeZoom = newZoom;
  applyTreeZoom();

  if (cx === null) return;
  const restore = () => {
    vp.scrollLeft = cx * treeZoom - vp.clientWidth / 2;
    vp.scrollTop  = cy * treeZoom - vp.clientHeight / 2;
  };
  restore();
  requestAnimationFrame(restore);
}

// عرض الشجرة كاملة: يحسب التصغير المناسب ليظهر كل شيء داخل الإطار
function fitTreeToViewport() {
  const vp = document.getElementById('tree-viewport');
  const forest = document.getElementById('tree-forest');
  if (!vp || !forest) return;
  const prev = forest.style.zoom;
  forest.style.zoom = 1;
  const contentW = forest.scrollWidth;
  const contentH = forest.scrollHeight;
  forest.style.zoom = prev;
  if (!contentW || !contentH) return;

  // إن لم يكن للإطار مقاس بعد (تبويب مخفي مثلاً) نرجع لمقاس النافذة
  const vpW = vp.clientWidth || window.innerWidth || 0;
  const vpH = vp.clientHeight || Math.round((window.innerHeight || 0) * 0.78);
  if (vpW < 50 || vpH < 50) return;

  const z = Math.min(vpW / contentW, vpH / contentH) * 0.97;
  setTreeZoom(z);
  // في وضع "الشجرة كاملة" نُعيد التوسيط على المعرّف 1
  centerTreeOnRootSoon();
}

// التحريك بالسحب باليد + التكبير بعجلة الفأرة (Ctrl) وبالقرص على الجوال
let treeJustDragged = false;
function enableTreePan(vp) {
  if (!vp || vp.dataset.panReady === '1') return;
  vp.dataset.panReady = '1';

  let down = false, moved = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

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
    if (moved) {
      vp.scrollLeft = startLeft - dx;
      vp.scrollTop = startTop - dy;
      e.preventDefault();
    }
  });

  const endPan = () => {
    if (!down) return;
    down = false;
    treeJustDragged = moved;
    vp.classList.remove('panning');
  };
  vp.addEventListener('pointerup', endPan);
  vp.addEventListener('pointercancel', endPan);
  vp.addEventListener('pointerleave', endPan);

  // لا نفتح نافذة الشخص إذا كان المستخدم يسحب الشجرة
  vp.addEventListener('click', e => {
    if (treeJustDragged) {
      e.stopPropagation();
      e.preventDefault();
      treeJustDragged = false;
    }
  }, true);

  // Ctrl + عجلة الفأرة = تكبير/تصغير
  vp.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setTreeZoom(treeZoom * (e.deltaY < 0 ? 1.12 : 0.89));
  }, { passive: false });

  // القرص بإصبعين على الشاشات اللمسية
  let pinchStartDist = 0, pinchStartZoom = 1;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinchStartDist = dist(e.touches);
      pinchStartZoom = treeZoom;
    }
  }, { passive: true });
  vp.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      setTreeZoom(pinchStartZoom * (dist(e.touches) / pinchStartDist));
    }
  }, { passive: false });
  vp.addEventListener('touchend', () => { pinchStartDist = 0; }, { passive: true });
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
  document.getElementById('zoom-in').addEventListener('click', () => setTreeZoom(treeZoom + 0.1));
  document.getElementById('zoom-out').addEventListener('click', () => setTreeZoom(treeZoom - 0.1));
  document.getElementById('zoom-reset').addEventListener('click', () => { setTreeZoom(0.5); centerTreeOnRootSoon(); });
  // ملاحظة: التوسيط على المعرّف 1 يحدث عند الفتح وعند زر الإعادة وزر «الشجرة كاملة» فقط،
  // أما التكبير والتصغير فيحافظان على موضع المستخدم.

  // إعادة التوسيط عند تغيير حجم النافذة أو تدوير شاشة الجوال
  let recenterTimer = null;
  const scheduleRecenter = () => {
    clearTimeout(recenterTimer);
    recenterTimer = setTimeout(centerTreeOnRootSoon, 180);
  };
  window.addEventListener('resize', scheduleRecenter);
  window.addEventListener('orientationchange', scheduleRecenter);
  // بعد اكتمال تحميل الصور والخطوط (الجوال غالباً يتأخر)
  window.addEventListener('load', centerTreeOnRootSoon);
  // إذا فُتح الموقع في تبويب خلفي فلا مقاسات للصفحة — نوسّط عند ظهورها
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') centerTreeOnRootSoon();
  });
  const fitBtn = document.getElementById('zoom-fit');
  if (fitBtn) fitBtn.addEventListener('click', fitTreeToViewport);

  // تفعيل السحب باليد والتكبير باللمس داخل إطار الشجرة
  enableTreePan(document.getElementById('tree-viewport'));
  applyTreeZoom();

  // إظهار خانة عائلة الزوج/الزوجة عند اختيار "متزوج"
  bindMaritalToggle('update-marital', 'update-spouse-group');
  bindMaritalToggle('input-marital', 'input-spouse-group');
  updateFamilyList = createFamilyList('update-spouse-family', 'update-spouse-add', 'update-spouse-chips');
  addFamilyList = createFamilyList('input-spouse-family', 'input-spouse-add', 'input-spouse-chips');

  // بطاقة "إعداد": الضغط على المعرّف ينقل إلى موقعه في الشجرة
  const gotoMeBtn = document.getElementById('pb-goto-me');
  if (gotoMeBtn) gotoMeBtn.addEventListener('click', gotoPreparedByPerson);

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
