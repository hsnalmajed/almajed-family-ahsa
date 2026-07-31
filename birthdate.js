/* =====================================================================
   منتقي تاريخ الميلاد (هجري/ميلادي) مع تحويل تلقائي — عائلة الماجد
   - يختار المستخدم اليوم/الشهر/السنة
   - يبدّل بين التقويمين ويحوّل التاريخ تلقائياً (تقويم أم القرى)
   - يخزّن ثلاث قيم: birthDate (ميلادي ISO)، birthDateHijri (هجري ISO)، birthDateCal
   يعمل بدون أي مكتبة خارجية اعتماداً على Intl (islamic-umalqura)
   ===================================================================== */
(function (global) {
  'use strict';

  var G_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var H_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
    'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---- التحويل عبر تقويم أم القرى ----
  function hijriFmt() {
    try {
      return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
        { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    } catch (e) {
      return new Intl.DateTimeFormat('en-u-ca-islamic-nu-latn',
        { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    }
  }
  var _hf = null;
  function hijriParts(date) {
    if (!_hf) _hf = hijriFmt();
    var o = {};
    _hf.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10); });
    return { y: o.year, m: o.month, d: o.day };
  }
  function gregToHijri(y, m, d) { return hijriParts(new Date(Date.UTC(y, m - 1, d))); }
  function hijriToGreg(hy, hm, hd) {
    // تقدير أولي قرب مبدأ التقويم الهجري ثم ضبط يوماً بيوم حتى المطابقة
    var approx = Math.floor((hy - 1) * 354.367) + Math.floor((hm - 1) * 29.53) + hd;
    var t = Date.UTC(622, 6, 19) + (approx - 1) * 86400000;
    var date = new Date(t);
    for (var i = 0; i < 200; i++) {
      var h = hijriParts(date);
      var cmp = h.y - hy; if (!cmp) cmp = h.m - hm; if (!cmp) cmp = h.d - hd;
      if (cmp === 0) break;
      date = new Date(date.getTime() + (cmp < 0 ? 1 : -1) * 86400000);
    }
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }

  function todayHijriYear() {
    var n = new Date();
    return gregToHijri(n.getFullYear(), n.getMonth() + 1, n.getDate()).y;
  }

  // ---- تنسيقات العرض ----
  function formatGreg(iso) {
    if (!iso) return '';
    var p = iso.split('-'); if (p.length !== 3) return iso;
    return parseInt(p[2], 10) + ' ' + (G_MONTHS[parseInt(p[1], 10) - 1] || p[1]) + ' ' + parseInt(p[0], 10) + ' م';
  }
  function formatHijri(iso) {
    if (!iso) return '';
    var p = iso.split('-'); if (p.length !== 3) return iso;
    return parseInt(p[2], 10) + ' ' + (H_MONTHS[parseInt(p[1], 10) - 1] || p[1]) + ' ' + parseInt(p[0], 10) + ' هـ';
  }
  // نص مزدوج للعرض في لوحة الإدارة
  function formatBoth(person) {
    if (!person) return '';
    var g = person.birthDate ? formatGreg(person.birthDate) : '';
    var h = person.birthDateHijri ? formatHijri(person.birthDateHijri) : '';
    if (g && h) return h + ' — ' + g;
    return g || h || '';
  }

  // ---- حقن الأنماط مرة واحدة ----
  function injectStyles() {
    if (document.getElementById('bd-picker-styles')) return;
    var css =
      '.bd-picker{border:1px solid var(--border,#d9d3c7);border-radius:12px;padding:10px;background:#fff}' +
      '.bd-cal-toggle{display:flex;gap:6px;margin-bottom:8px}' +
      '.bd-cal-btn{flex:1;padding:7px 10px;border:1px solid var(--border,#d9d3c7);background:#f6f4ef;border-radius:9px;cursor:pointer;font:inherit;font-size:.9rem;color:#555}' +
      '.bd-cal-btn.active{background:#175939;color:#fff;border-color:#175939;font-weight:700}' +
      '.bd-selects{display:flex;gap:6px}' +
      '.bd-selects select{flex:1;padding:8px 6px;border:1px solid var(--border,#d9d3c7);border-radius:9px;font:inherit;font-size:.9rem;background:#fff}' +
      '.bd-preview{margin-top:8px;font-size:.82rem;color:#175939;min-height:1.1em}' +
      '.bd-preview .bd-alt{color:#8a6d1a}';
    var s = document.createElement('style');
    s.id = 'bd-picker-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- المنتقي ----
  function createBirthdatePicker(mountElOrId) {
    injectStyles();
    var mount = typeof mountElOrId === 'string' ? document.getElementById(mountElOrId) : mountElOrId;
    if (!mount) return null;

    mount.innerHTML =
      '<div class="bd-picker">' +
      '  <div class="bd-cal-toggle">' +
      '    <button type="button" class="bd-cal-btn active" data-cal="gregorian">ميلادي</button>' +
      '    <button type="button" class="bd-cal-btn" data-cal="hijri">هجري</button>' +
      '  </div>' +
      '  <div class="bd-selects">' +
      '    <select class="bd-day" aria-label="اليوم"></select>' +
      '    <select class="bd-month" aria-label="الشهر"></select>' +
      '    <select class="bd-year" aria-label="السنة"></select>' +
      '  </div>' +
      '  <div class="bd-preview"></div>' +
      '</div>';

    var cal = 'gregorian';
    var elDay = mount.querySelector('.bd-day');
    var elMonth = mount.querySelector('.bd-month');
    var elYear = mount.querySelector('.bd-year');
    var elPrev = mount.querySelector('.bd-preview');
    var calBtns = mount.querySelectorAll('.bd-cal-btn');

    function opt(v, label) { var o = document.createElement('option'); o.value = v; o.textContent = label; return o; }

    function fillMonths() {
      var names = cal === 'hijri' ? H_MONTHS : G_MONTHS;
      elMonth.innerHTML = '';
      elMonth.appendChild(opt('', 'الشهر'));
      names.forEach(function (nm, i) { elMonth.appendChild(opt(i + 1, nm)); });
    }
    function fillDays() {
      var maxD = cal === 'hijri' ? 30 : 31;
      var cur = elDay.value;
      elDay.innerHTML = '';
      elDay.appendChild(opt('', 'اليوم'));
      for (var d = 1; d <= maxD; d++) elDay.appendChild(opt(d, d));
      if (cur && parseInt(cur, 10) <= maxD) elDay.value = cur;
    }
    function fillYears() {
      var cur = elYear.value;
      elYear.innerHTML = '';
      elYear.appendChild(opt('', 'السنة'));
      var from, to;
      if (cal === 'hijri') { to = todayHijriYear(); from = to - 150; }
      else { to = new Date().getFullYear(); from = to - 150; }
      for (var y = to; y >= from; y--) elYear.appendChild(opt(y, y));
      if (cur) elYear.value = cur;
    }

    function selected() {
      var d = parseInt(elDay.value, 10), m = parseInt(elMonth.value, 10), y = parseInt(elYear.value, 10);
      if (!d || !m || !y) return null;
      return { d: d, m: m, y: y };
    }

    // يحوّل الاختيار الحالي إلى ISO للتقويمين
    function computeBoth() {
      var s = selected();
      if (!s) return null;
      var g, h;
      if (cal === 'hijri') {
        h = { y: s.y, m: s.m, d: s.d };
        g = hijriToGreg(s.y, s.m, s.d);
      } else {
        g = { y: s.y, m: s.m, d: s.d };
        h = gregToHijri(s.y, s.m, s.d);
      }
      return {
        birthDate: g.y + '-' + pad(g.m) + '-' + pad(g.d),
        birthDateHijri: h.y + '-' + pad(h.m) + '-' + pad(h.d),
        birthDateCal: cal
      };
    }

    function updatePreview() {
      var both = computeBoth();
      if (!both) { elPrev.innerHTML = ''; return; }
      if (cal === 'hijri') {
        elPrev.innerHTML = 'الموافق ميلادي: <b>' + formatGreg(both.birthDate) + '</b>';
      } else {
        elPrev.innerHTML = 'الموافق هجري: <b class="bd-alt">' + formatHijri(both.birthDateHijri) + '</b>';
      }
    }

    function setCal(newCal, keepDate) {
      if (newCal === cal) return;
      var prevBoth = keepDate ? computeBoth() : null;
      cal = newCal;
      calBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-cal') === cal); });
      fillMonths(); fillYears(); fillDays();
      if (prevBoth) {
        // نُبقي نفس اليوم الفعلي بعد تبديل التقويم
        var iso = cal === 'hijri' ? prevBoth.birthDateHijri : prevBoth.birthDate;
        var p = iso.split('-');
        elYear.value = String(parseInt(p[0], 10));
        elMonth.value = String(parseInt(p[1], 10));
        fillDays();
        elDay.value = String(parseInt(p[2], 10));
      }
      updatePreview();
    }

    calBtns.forEach(function (b) {
      b.addEventListener('click', function () { setCal(b.getAttribute('data-cal'), true); });
    });
    [elDay, elMonth, elYear].forEach(function (el) { el.addEventListener('change', function () { fillDays(); updatePreview(); }); });

    fillMonths(); fillYears(); fillDays(); updatePreview();

    return {
      getValue: function () { return computeBoth(); },
      setValue: function (data) {
        data = data || {};
        var c = data.birthDateCal === 'hijri' ? 'hijri' : 'gregorian';
        cal = c;
        calBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-cal') === cal); });
        fillMonths(); fillYears(); fillDays();
        var iso = cal === 'hijri' ? data.birthDateHijri : data.birthDate;
        if (iso) {
          var p = iso.split('-');
          if (p.length === 3) {
            elYear.value = String(parseInt(p[0], 10));
            elMonth.value = String(parseInt(p[1], 10));
            fillDays();
            elDay.value = String(parseInt(p[2], 10));
          }
        }
        updatePreview();
      },
      clear: function () {
        elDay.value = ''; elMonth.value = ''; elYear.value = '';
        updatePreview();
      }
    };
  }

  global.Birthdate = {
    create: createBirthdatePicker,
    gregToHijri: gregToHijri,
    hijriToGreg: hijriToGreg,
    formatGreg: formatGreg,
    formatHijri: formatHijri,
    formatBoth: formatBoth
  };
})(window);
