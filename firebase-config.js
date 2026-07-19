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

// البريد الإلكتروني الداخلي لحساب المدير (المستخدم يدخل فقط كلمة السر 2355)
const ADMIN_EMAIL = "admin@family-tree.local";

// كلمة سر المدير (يجب أن تطابق كلمة السر التي أنشأتها لحساب المدير في Firebase Authentication)
const ADMIN_PASSWORD = "2355";

firebase.initializeApp(firebaseConfig);
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
