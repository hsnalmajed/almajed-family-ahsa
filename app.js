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
let urlPersonOpened = false;
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
    if (!urlPersonOpened) { urlPersonOpened = true; openPersonFromUrl(); }
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

// توحيد الحروف العربية حتى تتطابق الصيغ المختلفة في البحث:
// أ/إ/آ/ٱ → ا ، ة → ه ، ى → ي ، ؤ → و ، ئ → ي ، وإزالة التشكيل والتطويل
function normalizeArabic(s) {
  return String(s || '')
    .replace(/[ً-ْٰـ]/g, '')   // تشكيل وتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function familyKey(name) {
  // نفس التوحيد مع إزالة أداة التعريف "ال/آل" في بداية اسم العائلة
  return normalizeArabic(name).replace(/^(ال|آل)\s*/, '').trim();
}

// عائلتنا نفسها لا تُحسب ضمن "العوائل المنتسبون معهم"
const OWN_FAMILY_KEYS = new Set([familyKey('الماجد'), familyKey('ماجد')]);


// ---------------------------------------------------------------------
// عند الضغط على اسم عائلة: عرض الأفراد المرتبطين بها
// ---------------------------------------------------------------------
function openFamilyMembersModal(displayName, key) {
  const list = document.getElementById('family-members-list');
  const title = document.getElementById('family-members-title');
  const sub = document.getElementById('family-members-sub');
  if (!list) return;

  const members = allPersons.filter(p =>
    personFamilies(p).some(v => familyKey(v) === key)
  ).sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0));

  title.textContent = 'عائلة ' + displayName;
  sub.textContent = members.length === 1
    ? 'فرد واحد من عائلتنا مرتبط بها'
    : members.length + ' أفراد من عائلتنا مرتبطون بها';

  list.innerHTML = members.map(p => {
    const rel = p.gender === 'female' ? 'عائلة الزوج' : 'عائلة الزوجة';
    return `
      <div class="search-result-item" data-goto="${p.displayId}">
        <img src="${p.photoURL || defaultAvatar(p.gender)}" alt="">
        <span class="sr-name">
          <b class="sr-id">(${p.displayId})</b> ${escapeHtmlLocal(shortLineage(p, 2))}
          <span class="sr-rel">${rel}</span>
        </span>
      </div>`;
  }).join('');

  list.style.display = 'block';
  list.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.goto;
      closeFamilyMembersModal();
      setTimeout(() => {
        scrollToPerson(id);
        const p = personsByDisplayId[id];
        if (p) openChoiceModal(p);
      }, 150);
    });
  });

  document.getElementById('family-members-modal').classList.add('open');
}

function closeFamilyMembersModal() {
  document.getElementById('family-members-modal').classList.remove('open');
}

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
      if (!stats.has(key)) stats.set(key, { name: raw, count: 0, key });
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
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'family-chip';
          chip.textContent = f.name;
          chip.title = 'اعرض الأفراد المرتبطين بعائلة ' + f.name;
          chip.addEventListener('click', () => openFamilyMembersModal(f.name, f.key));
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

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'fb-name';
    name.textContent = f.name;
    name.title = 'اعرض الأفراد المرتبطين بعائلة ' + f.name;
    name.addEventListener('click', () => openFamilyMembersModal(f.name, f.key));

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


// ---------------------------------------------------------------------
// تنقّل داخل النافذة: الأب والأبناء (مفيد جداً على الجوال)
// ---------------------------------------------------------------------
function renderPersonNav(person) {
  const nav = document.getElementById('person-nav');
  if (!nav) return;
  const fatherGroup = document.getElementById('pn-father-group');
  const fatherBox = document.getElementById('pn-father');
  const kidsGroup = document.getElementById('pn-children-group');
  const kidsBox = document.getElementById('pn-children');
  fatherBox.innerHTML = '';
  kidsBox.innerHTML = '';

  const mkBtn = (p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pn-chip';
    b.textContent = p.firstName + ' (' + p.displayId + ')';
    b.addEventListener('click', () => {
      closeChoiceModal();
      setTimeout(() => { scrollToPerson(p.displayId); openChoiceModal(p); }, 120);
    });
    return b;
  };

  // الشخص نفسه (اسمه ومعرّفه) في أعلى البطاقة، قابل للنقر لتحديد موقعه في الشجرة
  const selfGroup = document.getElementById('pn-self-group');
  const selfBox = document.getElementById('pn-self');
  if (selfGroup && selfBox) {
    selfBox.innerHTML = '';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pn-chip';
    b.textContent = 'ID: ' + person.displayId;
    b.addEventListener('click', () => { closeChoiceModal(); setTimeout(() => scrollToPerson(person.displayId), 120); });
    selfBox.appendChild(b);
    selfGroup.style.display = 'flex';
  }

  const pk = String(person.parentKey || '');
  const father = (!pk || pk.startsWith('v')) ? null : personsByDisplayId[pk];
  if (father) { fatherBox.appendChild(mkBtn(father)); fatherGroup.style.display = 'flex'; }
  else fatherGroup.style.display = 'none';

  // الأم: من داخل الشجرة (قابلة للنقر) أو اسمها فقط إن كانت من خارجها
  const motherGroup = document.getElementById('pn-mother-group');
  const motherBox = document.getElementById('pn-mother');
  const mother = (person.motherId != null) ? personsByDisplayId[String(person.motherId)] : null;
  let hasMotherInfo = false;
  if (motherGroup && motherBox) {
    motherBox.innerHTML = '';
    if (mother) {
      motherBox.appendChild(mkBtn(mother));
      hasMotherInfo = true;
    } else if (person.motherName) {
      const chip = document.createElement('span');
      chip.className = 'pn-chip pn-chip-static';
      chip.textContent = person.motherName;
      motherBox.appendChild(chip);
      hasMotherInfo = true;
    }
    motherGroup.style.display = hasMotherInfo ? 'flex' : 'none';
  }

  const kids = allPersons.filter(p => String(p.parentKey) === String(person.displayId));
  if (kids.length) {
    kids.sort((a, b) => (Number(a.displayId) || 0) - (Number(b.displayId) || 0))
        .forEach(k => kidsBox.appendChild(mkBtn(k)));
    kidsGroup.style.display = 'flex';
  } else kidsGroup.style.display = 'none';

  // عائلة الزوجة/الزوج داخل نفس المربع مع الأب والأبناء
  const spouseGroup = document.getElementById('pn-spouse-group');
  const spouseBox = document.getElementById('pn-spouse');
  const spouseLabel = document.getElementById('pn-spouse-label');
  if (spouseGroup && spouseBox) {
    spouseBox.innerHTML = '';
    const fams = personFamilies(person);
    const links = Array.isArray(person.spouseLinks) ? person.spouseLinks : [];
    const showSpouse = person.maritalStatus === 'married' && (fams.length || links.length);
    if (showSpouse) {
      const female = person.gender === 'female';
      const total = links.length + fams.length;
      // إن كان الزوج/الزوجة من العائلة نعرض الاسم؛ وإلا نعرض اسم العائلة
      spouseLabel.textContent = female
        ? (links.length ? 'الزوج' : 'عائلة الزوج')
        : (total > 1 ? 'الزوجات' : (links.length ? 'الزوجة' : 'عائلة الزوجة'));
      // أزواج مرتبطون من داخل الشجرة — قابلون للنقر للانتقال إليهم
      links.forEach(l => {
        const p = personsByDisplayId[l.id];
        if (p) {
          spouseBox.appendChild(mkBtn(p));
        } else {
          const chip = document.createElement('span');
          chip.className = 'pn-chip pn-chip-static';
          chip.textContent = l.name || ('#' + l.id);
          spouseBox.appendChild(chip);
        }
      });
      // عوائل الزوجات من خارج الشجرة — نص ثابت
      fams.forEach(f => {
        const chip = document.createElement('span');
        chip.className = 'pn-chip pn-chip-static';
        chip.textContent = f;
        spouseBox.appendChild(chip);
      });
      spouseGroup.style.display = 'flex';
    } else spouseGroup.style.display = 'none';
    nav.style.display = 'block';   // يظهر دائماً لأن صفّ "الشخص" حاضر دوماً
    return;
  }

  nav.style.display = 'block';
}

// فتح الموقع على شخص محدد عبر رابط مثل ?id=147
function openPersonFromUrl() {
  const m = location.search.match(/[?&]id=(\d+)/) || location.hash.match(/id=(\d+)/);
  if (!m) return;
  const p = personsByDisplayId[m[1]];
  if (!p) return;
  setTimeout(() => { scrollToPerson(p.displayId); openChoiceModal(p); }, 600);
}

function openChoiceModal(person) {
  selectedTargetPerson = person;
  document.getElementById('choice-modal-title').textContent =
    `${person.firstName} (#${person.displayId}) — ماذا تريد أن تفعل؟`;

  // الاسم الكامل بسلسلة الآباء حتى أعلى الشجرة
  const fullBox = document.getElementById('choice-full-name');
  if (fullBox) {
    const chainLen = ancestorsOf(person).length;
    fullBox.querySelector('.cfn-value').textContent = fullLineage(person);
    fullBox.querySelector('.cfn-meta').textContent =
      chainLen > 0 ? `المعرّف #${person.displayId} • ${chainLen} جيل حتى الجد الأول` : `المعرّف #${person.displayId}`;
    fullBox.style.display = 'block';
  }

  renderPersonNav(person);
  document.getElementById('choice-modal').classList.add('open');
}
function closeChoiceModal() {
  document.getElementById('choice-modal').classList.remove('open');
}

// ---------------------------------------------------------------------
// نافذة تحديث المعلومات (هاتف / صورة / حالة)
// ---------------------------------------------------------------------
// يعرض آخر 4 أرقام فقط من رقم الجوال، والباقي نقاطاً
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return '••• •••• ' + digits.slice(-4);
}

// هل ضغط المستخدم "تغيير الرقم" في هذه الجلسة؟
let phoneChangeRequested = false;

function openUpdateModal(person) {
  selectedTargetPerson = person;
  selectedUpdatePhotoFile = null;
  document.getElementById('update-modal-title').textContent = `تحديث معلومات: ${person.firstName} (#${person.displayId})`;
  document.getElementById('update-info-form').reset();
  document.getElementById('update-photo-preview').style.display = 'none';
  document.querySelectorAll('input[name="update-status"]').forEach(r => {
    r.checked = (r.value === person.status);
  });

  // رقم التواصل: يظهر مخفياً بآخر 4 أرقام حفاظاً على الخصوصية،
  // مع زر لتغييره لمن أراد. الرقم الكامل يظهر للمدير فقط.
  phoneChangeRequested = false;
  const phoneInput = document.getElementById('update-phone');
  const phoneBox = document.getElementById('phone-current');
  const phoneMask = document.getElementById('phone-mask');
  const phoneHint = document.getElementById('update-phone-hint');

  phoneInput.value = '';
  if (person.phone) {
    phoneMask.textContent = maskPhone(person.phone);
    phoneBox.style.display = 'flex';
    phoneInput.style.display = 'none';
    if (phoneHint) phoneHint.textContent = 'رقمك مسجّل لدينا (تظهر آخر 4 أرقام فقط). اضغط «تغيير الرقم» إن أردت تحديثه.';
  } else {
    phoneBox.style.display = 'none';
    phoneInput.style.display = 'block';
    if (phoneHint) phoneHint.textContent = 'لا يوجد رقم مسجّل لهذا الشخص.';
  }

  // الحالة الاجتماعية: النص بحسب جنس الشخص، والقيم الحالية إن وُجدت
  applyMaritalLabels(document.getElementById('update-modal'), person.gender);
  const currentMarital = person.maritalStatus === 'married' ? 'married' : 'single';
  document.querySelectorAll('input[name="update-marital"]').forEach(r => {
    r.checked = (r.value === currentMarital);
  });
  if (updateFamilyList) updateFamilyList.set(personFamilies(person));
  refreshMaritalGroup('update-marital', 'update-spouse-group');

  // الأم: خيارات من زوجات والد هذا الشخص المسجّلات في الشجرة
  populateMotherOptions(person);

  // نصوص قسم الأزواج بحسب الجنس (الأنثى: زوج واحد فقط)
  const female = person.gender === 'female';
  const secLbl = document.getElementById('update-spouse-section-label');
  const multiHint = document.getElementById('update-spouse-multi-hint');
  if (secLbl) secLbl.textContent = female ? 'الزوج المسجّل' : 'الزوجات المسجّلات';
  if (multiHint) multiHint.textContent = female
    ? 'يمكن إضافة زوج واحد فقط: اختر «نعم» للبحث عنه في الشجرة، أو «لا» لكتابة اسم عائلته.'
    : 'أضِف كل زوجة على حدة: اختر «نعم» للبحث عنها في الشجرة، أو «لا» لكتابة اسم عائلتها. يمكنك إضافة أكثر من زوجة.';

  // هل الزوج/الزوجة من عائلة الماجد؟ — نحدّد الحالة من بيانات الشخص
  const links = Array.isArray(person.spouseLinks) ? person.spouseLinks : [];
  const inFamily = links.length ? 'yes' : 'no';
  document.querySelectorAll('input[name="update-spouse-in-family"]').forEach(r => { r.checked = (r.value === inFamily); });
  if (updateSpouseLinkList) updateSpouseLinkList.set(links);
  refreshSpouseOrigin('update-spouse-in-family', 'update-spouse-link-block', 'update-spouse-family-block');

  document.getElementById('update-modal').classList.add('open');
}
function closeUpdateModal() {
  document.getElementById('update-modal').classList.remove('open');
  selectedUpdatePhotoFile = null;
}

// يملأ قائمة "الأم" من زوجات والد الشخص المسجّلات في الشجرة (spouseLinks)
function populateMotherOptions(person) {
  const sel = document.getElementById('update-mother');
  const hint = document.getElementById('update-mother-hint');
  if (!sel) return;
  sel.innerHTML = '<option value="">— غير محددة —</option>';

  const father = (person.parentKey && !String(person.parentKey).startsWith('v'))
    ? personsByDisplayId[String(person.parentKey)] : null;
  if (!father) {
    sel.disabled = true;
    if (hint) hint.textContent = 'لا يمكن تحديد الأم: لا يوجد أب مسجّل لهذا الشخص في الشجرة.';
    return;
  }

  const links = Array.isArray(father.spouseLinks) ? father.spouseLinks : [];
  const fams = personFamilies(father);
  if (!links.length && !fams.length) {
    sel.disabled = true;
    if (hint) hint.textContent = 'لا توجد زوجات مسجّلات لوالد هذا الشخص. أضِف زوجات الأب أولاً في صفحة الأب.';
    return;
  }

  sel.disabled = false;
  if (hint) hint.textContent = 'تُختار من زوجات والد هذا الشخص (اختيار زوجة من العائلة يُفعّل صلات القرابة تلقائياً).';

  // (1) زوجات من العائلة — لها معرّف في الشجرة (تُفعّل صلة القرابة: أم/خال/خالة)
  links.forEach(w => {
    const nm = w.name || (personsByDisplayId[String(w.id)] ? shortLineage(personsByDisplayId[String(w.id)], 2) : '');
    const opt = document.createElement('option');
    opt.value = 'id:' + w.id;
    opt.dataset.mid = String(w.id);
    opt.dataset.mname = nm;
    opt.textContent = `من العائلة — (${w.id}) ${nm}`;
    sel.appendChild(opt);
  });
  // (2) زوجات من خارج العائلة — أسماء عوائل فقط (تُسجَّل كاسم دون ربط)
  fams.forEach(fname => {
    const label = 'من عائلة ' + fname;
    const opt = document.createElement('option');
    opt.value = 'fam:' + fname;
    opt.dataset.mid = '';
    opt.dataset.mname = label;
    opt.textContent = label;
    sel.appendChild(opt);
  });

  // القيمة الحالية إن كانت مسجّلة
  if (person.motherId != null) sel.value = 'id:' + person.motherId;
  else if (person.motherName) {
    const match = Array.from(sel.options).find(o => o.dataset && o.dataset.mname === person.motherName);
    if (match) sel.value = match.value;
  }
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

  // لا نرسل الهاتف إلا إذا طلب المستخدم تغييره فعلاً (أو لم يكن مسجّلاً أصلاً)
  const phoneEl = document.getElementById('update-phone');
  const phoneTouched = phoneChangeRequested || phoneEl.style.display !== 'none';
  const phone = phoneTouched ? phoneEl.value.trim() : null;
  const status = document.querySelector('input[name="update-status"]:checked')?.value;

  if (!status) {
    showToast('الرجاء اختيار الحالة', true);
    return;
  }

  const isMarried = document.querySelector('input[name="update-marital"]:checked')?.value === 'married';
  // نجمع النوعين معاً: زوجات من العائلة (روابط) + زوجات من خارجها (أسماء عوائل)
  const spouseLinkVals = (isMarried && updateSpouseLinkList) ? updateSpouseLinkList.values() : [];
  const spouseFamilyVals = (isMarried && updateFamilyList) ? updateFamilyList.values() : [];

  // الأم: قد تكون من العائلة (id) أو من خارجها (اسم عائلة فقط)
  const motherChoice = (function () {
    const opt = document.getElementById('update-mother')?.selectedOptions?.[0];
    if (!opt || !opt.value) return { id: null, name: '' };
    return { id: opt.dataset.mid ? Number(opt.dataset.mid) : null, name: opt.dataset.mname || '' };
  })();

  const btn = document.getElementById('submit-update-btn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الإرسال...';

  try {
    let photoURL = '';
    if (selectedUpdatePhotoFile) {
      photoURL = await resizeImageToBase64(selectedUpdatePhotoFile);
    }

    const payload = {
      requestType: 'update',
      targetPersonId: selectedTargetPerson.displayId,
      targetPersonName: selectedTargetPerson.firstName,
      photoURL: photoURL || '',
      status,
      maritalStatus: (document.querySelector('input[name="update-marital"]:checked')?.value) || 'single',
      spouseFamilies: spouseFamilyVals,
      spouseLinks: spouseLinkVals,
      spouseInFamily: spouseLinkVals.length > 0,
      motherId: motherChoice.id,
      motherName: motherChoice.name,
      requestStatus: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // لا نُدرج الهاتف إطلاقاً إن لم يطلب المستخدم تغييره،
    // فيبقى الرقم المسجّل لدى المدير كما هو.
    if (phone !== null) payload.phone = phone;

    await db.collection('requests').add(payload);

    sendUpdateRequestEmailNotification({
      targetPersonId: selectedTargetPerson.displayId,
      targetPersonName: selectedTargetPerson.firstName,
      phone: phone === null ? 'بدون تغيير' : phone,
      status
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
  scopeEl.querySelectorAll('#update-spouse-family, #input-spouse-family').forEach(el => {
    el.placeholder = female ? 'اسم عائلة الزوج' : 'اسم عائلة الزوجة';
  });
  scopeEl.querySelectorAll('.spouse-origin-label').forEach(el => {
    el.textContent = female ? 'هل الزوج من عائلة الماجد؟' : 'هل الزوجة من عائلة الماجد؟';
  });
  scopeEl.querySelectorAll('.spouse-link-label').forEach(el => {
    el.textContent = female
      ? 'ابحث عن الزوج في شجرة العائلة (بالمعرّف أو الاسم)'
      : 'ابحث عن الزوجة في شجرة العائلة (بالمعرّف أو الاسم)';
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

// سؤال: هل الزوج/الزوجة من عائلة الماجد؟ — يبدّل بين مربّع الربط ومربّع اسم العائلة
function refreshSpouseOrigin(radioName, linkBlockId, familyBlockId) {
  const linkBlock = document.getElementById(linkBlockId);
  const famBlock = document.getElementById(familyBlockId);
  const val = document.querySelector(`input[name="${radioName}"]:checked`)?.value;
  const yes = val === 'yes';
  if (linkBlock) linkBlock.style.display = yes ? 'block' : 'none';
  if (famBlock) famBlock.style.display = yes ? 'none' : 'block';
}
function bindSpouseOriginToggle(radioName, linkBlockId, familyBlockId) {
  document.querySelectorAll(`input[name="${radioName}"]`).forEach(r => {
    r.addEventListener('change', () => refreshSpouseOrigin(radioName, linkBlockId, familyBlockId));
  });
}

// قائمة ربط الأزواج من داخل الشجرة: بحث بالمعرّف أو الاسم ثم اختيار (يخزّن {id, name})
function createSpouseLinkList(inputId, sugId, chipsId, canAddFn) {
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
      x.type = 'button'; x.className = 'family-chip-remove'; x.textContent = '✕'; x.title = 'إزالة';
      x.addEventListener('click', () => { state.splice(i, 1); renderChips(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  const hide = () => { if (sug) { sug.style.display = 'none'; sug.innerHTML = ''; } };

  if (input) {
    input.addEventListener('input', () => {
      const matches = matchPersonsForRelation(input.value);
      if (!matches.length) { hide(); return; }
      sug.innerHTML = matches.map(p => `
        <div class="search-result-item" data-id="${p.displayId}">
          <img src="${p.photoURL || defaultAvatar(p.gender)}" alt="">
          <span class="sr-name"><b class="sr-id">(${p.displayId})</b> ${escapeHtmlLocal(shortLineage(p, 2))}</span>
        </div>`).join('');
      sug.style.display = 'block';
      sug.querySelectorAll('[data-id]').forEach(el => {
        el.addEventListener('click', () => {
          const p = personsByDisplayId[el.dataset.id];
          if (canAddFn && !canAddFn()) { input.value = ''; hide(); return; }
          if (p && !state.some(s => String(s.id) === String(p.displayId))) {
            state.push({ id: Number(p.displayId), name: shortLineage(p, 2) });
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
let updateSpouseLinkList = null;

// للإناث: يُسمح بزوج واحد فقط (مجموع الروابط + الأسماء = 1)
function updateSpouseCanAdd() {
  if (selectedTargetPerson && selectedTargetPerson.gender === 'female') {
    const total = (updateSpouseLinkList ? updateSpouseLinkList.size() : 0)
                + (updateFamilyList ? updateFamilyList.size() : 0);
    if (total >= 1) {
      showToast('للإناث يمكن إضافة زوج واحد فقط. احذف الزوج الحالي أولاً إن أردت تغييره.', true);
      return false;
    }
  }
  return true;
}


// ---------------------------------------------------------------------
// حقل يقبل أكثر من اسم عائلة (للزوجات المتعددات أو تعدد الروابط)
// ---------------------------------------------------------------------
function createFamilyList(inputId, addBtnId, chipsId, canAddFn) {
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
    if (canAddFn && !canAddFn()) { input.value = ''; return; }
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

let updateFamilyList = null;
let addFamilyList = null;
let addSpouseLinkList = null;

// للإناث (ابنة/أخت): زوج واحد فقط
function addSpouseCanAdd() {
  if (RELATION_TO_GENDER[selectedRelationType] === 'female') {
    const total = (addSpouseLinkList ? addSpouseLinkList.size() : 0)
                + (addFamilyList ? addFamilyList.size() : 0);
    if (total >= 1) {
      showToast('للإناث يمكن إضافة زوج واحد فقط. احذف الزوج الحالي أولاً إن أردت تغييره.', true);
      return false;
    }
  }
  return true;
}

// يملأ قائمة "الأم" للفرد الجديد من زوجات والده (والده يختلف حسب نوع القرابة)
function populateAddMotherOptions() {
  const sel = document.getElementById('input-mother');
  const hint = document.getElementById('input-mother-hint');
  if (!sel) return;
  sel.innerHTML = '<option value="">— غير محددة —</option>';

  // الابن/الابنة: الأب هو الشخص المستهدف. الأخ/الأخت: الأب هو والد الشخص المستهدف
  let father = null;
  if (selectedRelationType === 'son' || selectedRelationType === 'daughter') {
    father = selectedTargetPerson;
  } else if (selectedTargetPerson && selectedTargetPerson.parentKey
             && !String(selectedTargetPerson.parentKey).startsWith('v')) {
    father = personsByDisplayId[String(selectedTargetPerson.parentKey)];
  }

  if (!father) {
    sel.disabled = true;
    if (hint) hint.textContent = 'لا يمكن تحديد الأم: لا يوجد أب مسجّل لهذا الفرد في الشجرة.';
    return;
  }
  const links = Array.isArray(father.spouseLinks) ? father.spouseLinks : [];
  const fams = personFamilies(father);
  if (!links.length && !fams.length) {
    sel.disabled = true;
    if (hint) hint.textContent = 'لا توجد زوجات مسجّلات لوالد هذا الفرد. أضِف زوجات الأب أولاً.';
    return;
  }
  sel.disabled = false;
  if (hint) hint.textContent = 'تُختار من زوجات والد هذا الفرد (اختيار زوجة من العائلة يُفعّل صلات القرابة).';
  links.forEach(w => {
    const nm = w.name || (personsByDisplayId[String(w.id)] ? shortLineage(personsByDisplayId[String(w.id)], 2) : '');
    const opt = document.createElement('option');
    opt.value = 'id:' + w.id; opt.dataset.mid = String(w.id); opt.dataset.mname = nm;
    opt.textContent = `من العائلة — (${w.id}) ${nm}`;
    sel.appendChild(opt);
  });
  fams.forEach(fname => {
    const label = 'من عائلة ' + fname;
    const opt = document.createElement('option');
    opt.value = 'fam:' + fname; opt.dataset.mid = ''; opt.dataset.mname = label;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function chooseRelationType(type, btnEl) {
  selectedRelationType = type;
  document.querySelectorAll('.relation-choices button').forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  document.getElementById('add-member-form').style.display = 'block';
  // ابن/أخ ← صيغة المذكر وعائلة الزوجة، ابنة/أخت ← صيغة المؤنث وعائلة الزوج
  const female = RELATION_TO_GENDER[type] === 'female';
  applyMaritalLabels(document.getElementById('add-modal'), RELATION_TO_GENDER[type]);

  // نصوص قسم الأزواج بحسب الجنس
  const secLbl = document.getElementById('input-spouse-section-label');
  const multiHint = document.getElementById('input-spouse-multi-hint');
  if (secLbl) secLbl.textContent = female ? 'الزوج المسجّل' : 'الزوجات المسجّلات';
  if (multiHint) multiHint.textContent = female
    ? 'يمكن إضافة زوج واحد فقط: اختر «نعم» للبحث عنه في الشجرة، أو «لا» لكتابة اسم عائلته.'
    : 'أضِف كل زوجة على حدة: اختر «نعم» للبحث عنها في الشجرة، أو «لا» لكتابة اسم عائلتها.';

  // إعادة ضبط سؤال «من عائلة الماجد؟» والقوائم
  document.querySelectorAll('input[name="input-spouse-in-family"]').forEach(r => { r.checked = (r.value === 'no'); });
  if (addSpouseLinkList) addSpouseLinkList.clear();
  refreshSpouseOrigin('input-spouse-in-family', 'input-spouse-link-block', 'input-spouse-family-block');

  // خيارات الأم بحسب والد الفرد الجديد
  populateAddMotherOptions();

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
  const married = maritalStatus === 'married';
  const spouseFamilies = (married && addFamilyList) ? addFamilyList.values() : [];
  const spouseLinks = (married && addSpouseLinkList) ? addSpouseLinkList.values() : [];
  const spouseInFamily = married &&
    document.querySelector('input[name="input-spouse-in-family"]:checked')?.value === 'yes';

  // الأم (من العائلة id أو من خارجها اسم)
  const motherOpt = document.getElementById('input-mother')?.selectedOptions?.[0];
  const motherId = (motherOpt && motherOpt.dataset.mid) ? Number(motherOpt.dataset.mid) : null;
  const motherName = (motherOpt && motherOpt.value) ? (motherOpt.dataset.mname || '') : '';

  pendingMembers.push({
    firstName, gender, phone, photoURL,
    relationType: selectedRelationType, parentKey,
    maritalStatus, spouseFamilies, spouseLinks, spouseInFamily, motherId, motherName
  });
  renderPendingMembers();

  // تفريغ النموذج استعداداً للفرد التالي
  document.getElementById('add-member-form').reset();
  document.getElementById('photo-preview').style.display = 'none';
  if (addFamilyList) addFamilyList.clear();
  if (addSpouseLinkList) addSpouseLinkList.clear();
  document.querySelectorAll('input[name="input-spouse-in-family"]').forEach(r => { r.checked = (r.value === 'no'); });
  refreshSpouseOrigin('input-spouse-in-family', 'input-spouse-link-block', 'input-spouse-family-block');
  refreshMaritalGroup('input-marital', 'input-spouse-group');
  populateAddMotherOptions();
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
// يبحث عن الأشخاص المطابقين لنص (معرّف أو اسم) لعرضهم كاقتراحات
function matchPersonsForRelation(query) {
  const q = query.trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    return allPersons.filter(p => String(p.displayId) === q);
  }
  const nq = normalizeArabic(q);
  return allPersons.filter(p => p.firstName && normalizeArabic(p.firstName).includes(nq)).slice(0, 8);
}

// يربط حقل إدخال بقائمة اقتراحات تعمل مثل "ابحث عن شخص"
function attachRelationPicker(inputId, sugId) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(sugId);
  if (!input || !box) return;

  const hide = () => { box.style.display = 'none'; box.innerHTML = ''; };

  input.addEventListener('input', () => {
    input.dataset.selectedId = '';           // مسح أي اختيار سابق عند الكتابة
    const matches = matchPersonsForRelation(input.value);
    if (!matches.length) { hide(); return; }
    box.innerHTML = matches.map(p => `
      <div class="search-result-item" data-id="${p.displayId}">
        <img src="${p.photoURL || defaultAvatar(p.gender)}" alt="">
        <span class="sr-name"><b class="sr-id">(${p.displayId})</b> ${escapeHtmlLocal(shortLineage(p, 2))}</span>
      </div>
    `).join('');
    box.style.display = 'block';
    box.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const p = personsByDisplayId[el.dataset.id];
        input.value = `(${p.displayId}) ${shortLineage(p, 2)}`;
        input.dataset.selectedId = String(p.displayId);
        hide();
      });
    });
  });

  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
  document.addEventListener('click', (e) => { if (e.target !== input && !box.contains(e.target)) hide(); });
}

// يحوّل ما في الحقل إلى معرّف: اختيار من القائمة، أو رقم، أو اسم فريد
function resolveRelationInput(inputId) {
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (input.dataset.selectedId) return { id: input.dataset.selectedId };
  if (!val) return { error: 'الرجاء إدخال المعرّف أو الاسم' };
  if (/^\d+$/.test(val)) {
    if (!personsByDisplayId[val]) return { error: `لا يوجد شخص بالمعرّف ${val}` };
    return { id: val };
  }
  const nv = normalizeArabic(val);
  const matches = allPersons.filter(p => p.firstName && normalizeArabic(p.firstName).includes(nv));
  if (matches.length === 1) return { id: String(matches[0].displayId) };
  if (matches.length === 0) return { error: `لا يوجد شخص باسم «${val}»` };
  return { error: `يوجد أكثر من شخص باسم «${val}» — اختر من القائمة` };
}

// شريحة قابلة للنقر تُظهر اسم الشخص ومعرّفه وتنقل إليه في الشجرة
function personChipHtml(id) {
  const p = personsByDisplayId[String(id)];
  const name = p ? p.firstName : ('#' + id);
  return `<button type="button" class="rel-person" data-goto="${id}">${escapeHtmlLocal(name)} (ID:${id})</button>`;
}
// يحوّل الرموز @{id} داخل نص الصلة إلى شرائح أسماء قابلة للنقر
function renderRelText(str) {
  return escapeHtmlLocal(String(str || '')).replace(/@\{(\d+)\}/g, (m, id) => personChipHtml(id));
}
// يربط النقر على شرائح الأشخاص بالانتقال إليهم في الشجرة
function bindRelPersonClicks(scope) {
  scope.querySelectorAll('.rel-person[data-goto]').forEach(el => {
    el.addEventListener('click', () => {
      const p = personsByDisplayId[el.dataset.goto];
      if (!p) return;
      scrollToPerson(p.displayId);
      setTimeout(() => openChoiceModal(p), 320);
    });
  });
}

function handleRelationFinder(evt) {
  evt.preventDefault();
  const resultBox = document.getElementById('relation-result');
  const r1 = resolveRelationInput('rel-id-1');
  const r2 = resolveRelationInput('rel-id-2');

  if (r1.error || r2.error) {
    resultBox.textContent = r1.error || r2.error;
    resultBox.className = 'relation-result error';
    resultBox.style.display = 'block';
    return;
  }
  const id1 = r1.id, id2 = r2.id;

  const result = window.FamilyRelationship.computeRelationship(id1, id2, personsByDisplayId);
  if (result.ok) {
    let html = '';
    // (1) صلة القرابة المباشرة (تشمل الأم: أم/خال/خالة)
    if (result.directTerm) {
      html += `<div class="rel-direct"><b>صلة القرابة المباشرة:</b> ${escapeHtmlLocal(result.directTerm)}</div>`;
    }
    // (2) صلة القرابة من ناحية الأب
    if (result.paternalText) {
      html += `<div class="rel-paternal-title">صلة القرابة من ناحية الأب:</div>`;
      html += `<div>${renderRelText(result.paternalText)}</div>`;
      if (result.linkPerson && String(result.linkPerson.id) !== String(id1) && String(result.linkPerson.id) !== String(id2)) {
        html += `<div class="link-person-line">🔗 الشخص الذي يربط بينهما: ${personChipHtml(result.linkPerson.id)}</div>`;
      }
    }
    // (3) صلات إضافية عبر الأخوال/الأعمام
    if (result.extras && result.extras.length) {
      html += `<div class="rel-extra-title">صلات إضافية عبر الأخوال/الأعمام:</div>`;
      result.extras.forEach(s => { html += `<div class="rel-extra">🔸 ${renderRelText(s)}</div>`; });
    }
    resultBox.innerHTML = html;
    resultBox.className = 'relation-result';
    bindRelPersonClicks(resultBox);
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
    const nq = normalizeArabic(query);
    matches = allPersons.filter(p => p.firstName && normalizeArabic(p.firstName).includes(nq));
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
  updateFamilyList = createFamilyList('update-spouse-family', 'update-spouse-add', 'update-spouse-chips', updateSpouseCanAdd);
  addFamilyList = createFamilyList('input-spouse-family', 'input-spouse-add', 'input-spouse-chips', addSpouseCanAdd);

  // سؤال "هل الزوج/الزوجة من عائلة الماجد؟" وربط الزوج/الزوجة من الشجرة
  updateSpouseLinkList = createSpouseLinkList('update-spouse-link-input', 'update-spouse-link-sug', 'update-spouse-link-chips', updateSpouseCanAdd);
  bindSpouseOriginToggle('update-spouse-in-family', 'update-spouse-link-block', 'update-spouse-family-block');
  addSpouseLinkList = createSpouseLinkList('input-spouse-link-input', 'input-spouse-link-sug', 'input-spouse-link-chips', addSpouseCanAdd);
  bindSpouseOriginToggle('input-spouse-in-family', 'input-spouse-link-block', 'input-spouse-family-block');

  const closeFamBtn = document.getElementById('close-family-members-btn');
  if (closeFamBtn) closeFamBtn.addEventListener('click', closeFamilyMembersModal);
  const famModal = document.getElementById('family-members-modal');
  if (famModal) famModal.addEventListener('click', e => {
    if (e.target === famModal) closeFamilyMembersModal();
  });

  // زر «تغيير الرقم»: يُظهر حقل إدخال فارغ
  const phoneChangeBtn = document.getElementById('phone-change-btn');
  if (phoneChangeBtn) phoneChangeBtn.addEventListener('click', () => {
    phoneChangeRequested = true;
    document.getElementById('phone-current').style.display = 'none';
    const inp = document.getElementById('update-phone');
    inp.style.display = 'block';
    inp.value = '';
    inp.focus();
    const h = document.getElementById('update-phone-hint');
    if (h) h.textContent = 'اكتب الرقم الجديد، أو اتركه فارغاً لحذف الرقم المسجّل.';
  });

  // نسخ رابط مباشر يفتح الموقع على هذا الشخص
  const copyBtn = document.getElementById('copy-person-link');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    if (!selectedTargetPerson) return;
    const url = location.origin + location.pathname + '?id=' + selectedTargetPerson.displayId;
    navigator.clipboard.writeText(url)
      .then(() => showToast('تم نسخ الرابط: ' + url))
      .catch(() => showToast('تعذر النسخ تلقائياً. الرابط: ' + url, true));
  });

  // بطاقة "إعداد": الضغط على المعرّف ينقل إلى موقعه في الشجرة
  const gotoMeBtn = document.getElementById('pb-goto-me');
  if (gotoMeBtn) gotoMeBtn.addEventListener('click', gotoPreparedByPerson);

  // حاسبة القرابة — البحث بالمعرّف أو الاسم مثل "ابحث عن شخص"
  document.getElementById('relation-finder-form').addEventListener('submit', handleRelationFinder);
  attachRelationPicker('rel-id-1', 'rel-sug-1');
  attachRelationPicker('rel-id-2', 'rel-sug-2');

  // البحث
  document.getElementById('search-form').addEventListener('submit', handleSearch);
  document.addEventListener('click', (e) => {
    const box = document.getElementById('search-results');
    if (!box.contains(e.target) && e.target.id !== 'search-input') {
      box.style.display = 'none';
    }
  });
});
