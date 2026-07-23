// =====================================================================
// خوارزمية حساب صلة القرابة بين شخصين في الشجرة
// =====================================================================
// نموذج البيانات: كل شخص لديه parentKey (سلسلة نصية):
//   - إن كان رقماً (مثل "5") فهو معرّف شخص حقيقي أب/أم لهذا الشخص.
//   - إن كان يبدأ بـ "v" (مثل "v3") فهو "جذر افتراضي": يعني أن هذا
//     الشخص هو رأس فرع مستقل من العائلة (أو أضيف كأخ/أخت لرأس فرع
//     مستقل ولا يوجد أب مسجّل في الشجرة).
// هذا يسمح بحساب "أقرب جد مشترك" (LCA) بين أي شخصين، ومنه نستنتج
// درجة القرابة والمصطلح العربي المناسب (مذكر/مؤنث).
// =====================================================================

/**
 * يبني سلسلة الأسلاف لشخص معيّن حتى الجذر (حقيقي أو افتراضي)
 * يعيد مصفوفة من { key, depth } حيث depth=0 هو الشخص نفسه
 */
function getAncestorChain(personId, personsByDisplayId) {
  const chain = [];
  let currentKey = String(personId);
  let depth = 0;
  const visited = new Set();

  while (currentKey && !visited.has(currentKey)) {
    visited.add(currentKey);
    chain.push({ key: currentKey, depth });

    if (currentKey.startsWith('v')) break; // الجذر الافتراضي هو نهاية السلسلة

    const person = personsByDisplayId[currentKey];
    if (!person || !person.parentKey) break;

    currentKey = String(person.parentKey);
    depth++;
  }
  return chain;
}

/** يجد أقرب جد مشترك بين شخصين ويعيد {lcaKey, d1, d2} أو null إن لم يوجد */
function findLCA(id1, id2, personsByDisplayId) {
  const chain1 = getAncestorChain(id1, personsByDisplayId);
  const chain2 = getAncestorChain(id2, personsByDisplayId);
  const depthMap2 = {};
  chain2.forEach(item => { depthMap2[item.key] = item.depth; });

  for (const item of chain1) {
    if (item.key in depthMap2) {
      return { lcaKey: item.key, d1: item.depth, d2: depthMap2[item.key] };
    }
  }
  return null;
}

const ORDINALS_AR = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة'];
function ordinal(n) { return ORDINALS_AR[n] || `رقم ${n}`; }

/**
 * يحسب المصطلح العربي: "الشخص B هو/هي ____ بالنسبة إلى الشخص A"
 * d1 = بُعد A (عدد الأجيال) عن الجد المشترك، d2 = بُعد B عن الجد المشترك
 */
function describeRelationship(personA, personB, d1, d2) {
  const bMale = personB.gender === 'male';

  if (d1 === 0 && d2 === 0) return 'الشخص نفسه';

  // B سلف مباشر لـ A
  if (d2 === 0) {
    if (d1 === 1) return bMale ? 'الأب' : 'الأم';
    if (d1 === 2) return bMale ? 'الجد' : 'الجدة';
    return bMale ? `جد أعلى (يبعد ${d1} أجيال للأعلى)` : `جدة عليا (تبعد ${d1} أجيال للأعلى)`;
  }

  // B من نسل A مباشرة
  if (d1 === 0) {
    if (d2 === 1) return bMale ? 'الابن' : 'الابنة';
    if (d2 === 2) return bMale ? 'الحفيد' : 'الحفيدة';
    return bMale ? `من نسل الأحفاد (يبعد ${d2} أجيال للأسفل)` : `من نسل الأحفاد (تبعد ${d2} أجيال للأسفل)`;
  }

  // إخوة (يشتركان في نفس الجيل مباشرة تحت الأب المشترك)
  if (d1 === 1 && d2 === 1) return bMale ? 'الأخ' : 'الأخت';

  // B من جيل أكبر (أقرب إلى الجد المشترك من A) => عم/عمة أو أبعد
  if (d2 < d1) {
    if (d2 === 1) {
      if (d1 === 2) return bMale ? 'العم' : 'العمة';
      return bMale ? `عم الجد (يبعد ${d1} أجيال)` : `عمة الجد (تبعد ${d1} أجيال)`;
    }
    // كلاهما أبعد من جيل واحد عن الجد المشترك => أبناء عمومة بفارق أجيال
    const degree = d2 - 1;
    const removed = d1 - d2;
    const label = bMale ? 'ابن عم' : 'بنت عم';
    const degreeText = degree === 1 ? label : `${label} من الدرجة ${ordinal(degree)}`;
    return `${degreeText} (أكبر جيلاً بمقدار ${removed} ${removed === 1 ? 'جيل' : 'أجيال'})`;
  }

  // B من جيل أصغر (أبعد عن الجد المشترك من A) => ابن/بنت أخ أو أبعد
  if (d2 > d1) {
    if (d1 === 1) {
      if (d2 === 2) return bMale ? 'ابن الأخ' : 'ابنة الأخ';
      return bMale ? `من نسل الأخ (يبعد ${d2} أجيال)` : `من نسل الأخ (تبعد ${d2} أجيال)`;
    }
    const degree = d1 - 1;
    const removed = d2 - d1;
    const label = bMale ? 'ابن عم' : 'بنت عم';
    const degreeText = degree === 1 ? label : `${label} من الدرجة ${ordinal(degree)}`;
    return `${degreeText} (أصغر جيلاً بمقدار ${removed} ${removed === 1 ? 'جيل' : 'أجيال'})`;
  }

  // نفس الجيل (d1 === d2 >= 2): أبناء عمومة
  const degree = d1 - 1;
  const label = bMale ? 'ابن عم' : 'بنت عم';
  return degree === 1 ? label : `${label} من الدرجة ${ordinal(degree)}`;
}

// =====================================================================
// صلة القرابة المباشرة (تستخدم الأب parentKey والأم motherId معاً)
// تصف B بالنسبة إلى A بصيغة تناسب جنس A (الضمير) وجنس B (المصطلح)
// =====================================================================
function isNumericKey(k) { return k != null && /^\d+$/.test(String(k)); }

// هل p و q إخوة؟ (نفس الأب الحقيقي/جذر الفرع، أو نفس الأم)
function areSiblings(p, q) {
  if (!p || !q) return false;
  if (String(p.displayId) === String(q.displayId)) return false;
  const pf = p.parentKey != null ? String(p.parentKey) : '';
  const qf = q.parentKey != null ? String(q.parentKey) : '';
  if (pf && qf && pf === qf) return true;          // نفس الأب (أو نفس جذر الفرع)
  const pm = p.motherId != null ? String(p.motherId) : '';
  const qm = q.motherId != null ? String(q.motherId) : '';
  if (pm && qm && pm === qm) return true;          // نفس الأم
  return false;
}

function computeDirectRelation(personA, personB, personsByDisplayId) {
  const aMale = personA.gender === 'male';
  const bMale = personB.gender === 'male';
  const Aid = String(personA.displayId);
  const Bid = String(personB.displayId);
  const P = personsByDisplayId;

  const fatherA = isNumericKey(personA.parentKey) ? String(personA.parentKey) : null;
  const motherA = personA.motherId != null ? String(personA.motherId) : null;
  const fatherB = isNumericKey(personB.parentKey) ? String(personB.parentKey) : null;
  const motherB = personB.motherId != null ? String(personB.motherId) : null;

  // والدا A
  if (fatherA === Bid) return aMale ? 'أبوه' : 'أبوها';
  if (motherA === Bid) return aMale ? 'أمه' : 'أمها';

  // A والد/والدة لـ B  ⇒ B ابن/ابنة
  if (fatherB === Aid || motherB === Aid) {
    return bMale ? (aMale ? 'ابنه' : 'ابنها') : (aMale ? 'ابنته' : 'ابنتها');
  }

  // إخوة
  if (areSiblings(personA, personB)) {
    return bMale ? (aMale ? 'أخوه' : 'أخوها') : (aMale ? 'أخته' : 'أختها');
  }

  // عم/عمة: B أخو/أخت والد A
  if (fatherA && P[fatherA] && areSiblings(P[fatherA], personB)) {
    return bMale ? (aMale ? 'عمه' : 'عمها') : (aMale ? 'عمته' : 'عمتها');
  }
  // خال/خالة: B أخو/أخت والدة A
  if (motherA && P[motherA] && areSiblings(P[motherA], personB)) {
    return bMale ? (aMale ? 'خاله' : 'خالها') : (aMale ? 'خالته' : 'خالتها');
  }

  // أجداد A (من الأب أو الأم)
  const grandOf = (parentKey) => {
    if (!parentKey || !P[parentKey]) return false;
    const par = P[parentKey];
    const gf = isNumericKey(par.parentKey) ? String(par.parentKey) : null;
    const gm = par.motherId != null ? String(par.motherId) : null;
    return Bid === gf || Bid === gm;
  };
  if (grandOf(fatherA) || grandOf(motherA)) {
    return bMale ? (aMale ? 'جدّه' : 'جدّها') : (aMale ? 'جدّته' : 'جدّتها');
  }

  // A جد/جدة لـ B  ⇒ B حفيد/حفيدة
  const grandChild = (bParentKey) => {
    if (!bParentKey || !P[bParentKey]) return false;
    const par = P[bParentKey];
    const gf = isNumericKey(par.parentKey) ? String(par.parentKey) : null;
    const gm = par.motherId != null ? String(par.motherId) : null;
    return Aid === gf || Aid === gm;
  };
  if (grandChild(fatherB) || grandChild(motherB)) {
    return bMale ? (aMale ? 'حفيده' : 'حفيدها') : (aMale ? 'حفيدته' : 'حفيدتها');
  }

  return null;
}

// =====================================================================
// صلات إضافية عبر الأخوال والأعمام (تسلك روابط الأم motherId أيضاً)
// تُظهر الصلات التي لا تلتقطها شجرة الأب وحدها
// =====================================================================

// أسلاف عبر الأب والأم معاً: Map مفتاح -> أقرب عمق (1=والد)
function getBilateralAncestors(id, P) {
  const res = new Map();
  const start = String(id);
  const seen = new Set([start]);
  const queue = [{ k: start, d: 0 }];
  while (queue.length) {
    const { k, d } = queue.shift();
    const person = P[k];
    if (!person) continue;
    const parents = [];
    if (isNumericKey(person.parentKey)) parents.push(String(person.parentKey));
    if (person.motherId != null) parents.push(String(person.motherId));
    for (const pk of parents) {
      if (seen.has(pk)) continue;
      seen.add(pk);
      const nd = d + 1;
      if (!res.has(pk) || res.get(pk) > nd) res.set(pk, nd);
      queue.push({ k: pk, d: nd });
    }
  }
  return res;
}

// أسلاف عبر الأب فقط (لتمييز ما هو مغطّى بالفعل في شجرة الأب)
function paternalAncestorKeys(id, P) {
  const set = new Set();
  getAncestorChain(id, P).forEach(item => { if (item.depth > 0) set.add(item.key); });
  return set;
}

// أخوال/أعمام شخص: أشقّاء الأب (عم/عمة) وأشقّاء الأم (خال/خالة)
function unclesAuntsOf(id, P) {
  const person = P[String(id)];
  const out = [];
  if (!person) return out;
  const father = isNumericKey(person.parentKey) ? P[String(person.parentKey)] : null;
  const mother = person.motherId != null ? P[String(person.motherId)] : null;
  const pushSibs = (parent, maleTerm, femaleTerm) => {
    if (!parent) return;
    Object.keys(P).forEach(k => {
      const x = P[k];
      if (areSiblings(parent, x)) {
        out.push({ id: x.displayId, name: x.firstName, gender: x.gender, term: x.gender === 'female' ? femaleTerm : maleTerm });
      }
    });
  };
  pushSibs(father, 'عم', 'عمة');
  pushSibs(mother, 'خال', 'خالة');
  return out;
}

function computeExtraRelations(personA, personB, P) {
  const out = [];
  const Aid = String(personA.displayId), Bid = String(personB.displayId);
  const aMale = personA.gender === 'male';
  const bMale = personB.gender === 'male';

  const bBilat = getBilateralAncestors(Bid, P);
  const bPater = paternalAncestorKeys(Bid, P);
  const aBilat = getBilateralAncestors(Aid, P);
  const aPater = paternalAncestorKeys(Aid, P);

  // وصف انحدار (depth) من قريب term مع لاحقة الملكية داخل النص
  const descK = (term, depth, gMale) => {
    const t = term + 'ك';                      // خالك/عمك/خالتك/عمتك
    if (depth === 1) return (gMale ? 'ابن ' : 'بنت ') + t;
    if (depth === 2) return (gMale ? 'حفيد ' : 'حفيدة ') + t;
    return `من نسل ${t} (يبعد ${depth} أجيال)`;
  };
  const descOf = (term, depth, gMale, ofWhom) => {
    const t = `${term} ${ofWhom}`;             // خال الطرف الآخر
    if (depth === 1) return (gMale ? 'ابن ' : 'بنت ') + t;
    if (depth === 2) return (gMale ? 'حفيد ' : 'حفيدة ') + t;
    return `من نسل ${t} (يبعد ${depth} أجيال)`;
  };

  // (I) الطرف الآخر ينحدر من أحد أخوال/أعمام A عبر رابط أمّي
  unclesAuntsOf(Aid, P).forEach(u => {
    const uk = String(u.id);
    if (uk === Bid) return;                     // مغطّى في الصلة المباشرة
    const d = bBilat.get(uk);
    if (d == null) return;
    const maternal = (u.term === 'خال' || u.term === 'خالة');
    const viaMotherOnB = !bPater.has(uk);       // وصله من جهة أمّ في نسب الطرف الآخر
    if (!maternal && !viaMotherOnB) return;     // علاقة أبوية بحتة مغطّاة مسبقاً
    out.push(`@{${Bid}} هو ${descK(u.term, d, bMale)}: @{${u.id}}`);
  });

  // (II) أنت تنحدر من أحد أخوال/أعمام الطرف الآخر عبر رابط أمّي
  unclesAuntsOf(Bid, P).forEach(u => {
    const uk = String(u.id);
    if (uk === Aid) return;
    const d = aBilat.get(uk);
    if (d == null) return;
    const maternal = (u.term === 'خال' || u.term === 'خالة');
    const viaMotherOnA = !aPater.has(uk);
    if (!maternal && !viaMotherOnA) return;
    out.push(`@{${Aid}} ${descOf(u.term, d, aMale, 'الطرف الآخر')}: @{${u.id}}`);
  });

  return Array.from(new Set(out));
}

/**
 * الدالة الرئيسية: تُستدعى من الواجهة
 * personsByDisplayId: كائن { displayId: personObject }  (يحتوي على gender و parentKey و motherId)
 * id1, id2: أرقام أو نصوص (معرّف الشخص المعروض في الشجرة)
 */
function computeRelationship(id1, id2, personsByDisplayId) {
  const key1 = String(id1);
  const key2 = String(id2);
  const personA = personsByDisplayId[key1];
  const personB = personsByDisplayId[key2];

  if (!personA || !personB) {
    return { ok: false, reason: 'أحد المعرّفين غير موجود في الشجرة' };
  }
  if (key1 === key2) {
    return { ok: true, text: 'نفس الشخص', sameParty: true, linkPerson: null };
  }

  // (1) صلة القرابة المباشرة (تشمل الأم: أم/خال/خالة …)
  const directTerm = computeDirectRelation(personA, personB, personsByDisplayId);

  // (2) صلة القرابة من ناحية الأب (خوارزمية أقرب جد مشترك)
  const lca = findLCA(key1, key2, personsByDisplayId);
  let paternalText = null;
  let linkPerson = null;
  if (lca) {
    const relText = describeRelationship(personA, personB, lca.d1, lca.d2);
    paternalText = `@{${key2}} هو ${relText} بالنسبة إلى @{${key1}}`;
    // الشخص الذي "يربط" بينهما هو أقرب جد مشترك إن كان مسجّلاً كفرد حقيقي
    if (!lca.lcaKey.startsWith('v') && personsByDisplayId[lca.lcaKey]) {
      const lp = personsByDisplayId[lca.lcaKey];
      linkPerson = { id: lp.displayId, name: lp.firstName };
    }
  }

  // (3) صلات إضافية عبر الأخوال/الأعمام (روابط الأم)
  const extras = computeExtraRelations(personA, personB, personsByDisplayId);

  if (!directTerm && !paternalText && (!extras || !extras.length)) {
    return { ok: false, reason: 'لا توجد صلة قرابة معروفة بين هذين الشخصين (فرعان مختلفان من العائلة)' };
  }

  return {
    ok: true,
    directTerm: directTerm || null,
    paternalText,                                   // قد تكون null
    extras: extras || [],
    text: paternalText || (directTerm ? `@{${key2}} هو ${directTerm} بالنسبة إلى @{${key1}}` : ''),
    linkPerson
  };
}

window.FamilyRelationship = { computeRelationship, computeDirectRelation, getAncestorChain, findLCA };
if (typeof module !== 'undefined') { module.exports = { computeRelationship, computeDirectRelation, getAncestorChain, findLCA }; }
