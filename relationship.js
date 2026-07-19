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

/**
 * الدالة الرئيسية: تُستدعى من الواجهة
 * personsByDisplayId: كائن { displayId: personObject }  (يحتوي على gender و parentKey)
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

  const lca = findLCA(key1, key2, personsByDisplayId);
  if (!lca) {
    return { ok: false, reason: 'لا توجد صلة قرابة معروفة بين هذين الشخصين (فرعان مختلفان من العائلة)' };
  }

  const relText = describeRelationship(personA, personB, lca.d1, lca.d2);

  // الشخص الذي "يربط" بين الاثنين هو أقرب جد مشترك (LCA)، إن كان مسجّلاً كفرد حقيقي في الشجرة
  let linkPerson = null;
  if (!lca.lcaKey.startsWith('v') && personsByDisplayId[lca.lcaKey]) {
    const lp = personsByDisplayId[lca.lcaKey];
    linkPerson = { id: lp.displayId, name: lp.firstName };
  }

  return {
    ok: true,
    text: `الشخص صاحب المعرّف ${key2} هو ${relText} بالنسبة إلى الشخص صاحب المعرّف ${key1}`,
    relationTerm: relText,
    linkPerson
  };
}

window.FamilyRelationship = { computeRelationship, getAncestorChain, findLCA };
if (typeof module !== 'undefined') { module.exports = { computeRelationship, getAncestorChain, findLCA }; }
