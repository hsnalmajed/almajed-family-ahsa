// =====================================================================
// إعدادات Firebase - تم ملؤها تلقائياً لمشروعك family-tree-hasan
// =====================================================================

const firebaseConfig = {
  apiKey: "AIzaSyD6l_dKMIgYxkW0AJfrLC-4YWeJqY6xIGA",
  authDomain: "family-tree-hasan.firebaseapp.com",
  projectId: "family-tree-hasan",
  storageBucket: "family-tree-hasan.firebasestorage.app",
  messagingSenderId: "932265240190",
  appId: "1:932265240190:web:a0983ec1b76ff2dfab1a2f"
};

// قائمة المديرين: بريد حساب Google لكل مدير. الدخول للوحة المدير بزر «الدخول بحساب Google»
// ويُنصح أن يفعّل كل مدير التحقق بخطوتين (Authenticator) على حسابه.
// ⚠️ لإضافة مدير أو إزالته: عدّل القائمة هنا وفي firestore.rules معاً (نفس البُرد بالضبط).
// لا توجد أي كلمة سر في ملفات الموقع، والحماية الحقيقية في firestore.rules.
const ADMIN_EMAILS = [
  "almajedhsn@gmail.com"
];

firebase.initializeApp(firebaseConfig);

// =====================================================================
// App Check: يجعل قاعدة البيانات تقبل الطلبات القادمة من موقعنا فقط (عبر reCAPTCHA v3)،
// فلا تستطيع البرامج الآلية سحب بيانات العائلة أو إغراق لوحة المدير بطلبات مزيفة.
// ضع هنا "مفتاح الموقع" (Site key) الخاص بـ reCAPTCHA v3 بعد إنشائه.
// المفتاح العام هذا ليس سراً، ومكانه الطبيعي في كود الموقع.
// إذا تُرك فارغاً يعمل الموقع بدون App Check.
// =====================================================================
const APP_CHECK_SITE_KEY = "6Ldi7g8uAAAAAMW1sp_cQsg3FZXzNwcnMbzGfUN8";

if (APP_CHECK_SITE_KEY && typeof firebase.appCheck === 'function') {
  try {
    firebase.appCheck().activate(APP_CHECK_SITE_KEY, true);
  } catch (e) {
    console.error('تعذّر تفعيل App Check:', e);
  }
}

const db = firebase.firestore();
const auth = firebase.auth();

// =====================================================================
// إعدادات EmailJS - لإرسال إشعار بريد إلكتروني للمدير عند تقديم طلب جديد
// (خدمة مجانية بالكامل، الإرسال يتم مباشرة من متصفح الزائر)
// =====================================================================
const EMAILJS_PUBLIC_KEY = "1HznykUk_prutffGW";
window.EMAILJS_SERVICE_ID = "service_ry5gkbs";
window.EMAILJS_TEMPLATE_ID = "template_19vqicl";

if (typeof emailjs !== 'undefined') {
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}
