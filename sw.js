// =====================================================================
// Service Worker لتطبيق "عائلة الماجد"
// الهدف: يعمل التطبيق كأنه مثبّت على الجهاز، ويفتح حتى بلا إنترنت.
// =====================================================================

// عند كل تحديث للموقع نرفع هذا الرقم ليُحذف المخزون القديم تلقائياً
const CACHE_VERSION = 'almajed-v1';

// الملفات الأساسية التي تُخزَّن عند أول فتح
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './relationship.js',
  './firebase-config.js',
  './logo.jpg',
  './prepared-by.jpg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // لا نُفشل التثبيت كلّه إذا تعذّر تحميل ملف واحد
      .then(cache => Promise.allSettled(CORE_ASSETS.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  // يسمح للصفحة بطلب تفعيل النسخة الجديدة فوراً
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // لا نتدخّل إلا في طلبات GET من نفس الموقع.
  // مهم جداً: بيانات Firestore تمر عبر نطاق خارجي ويجب أن تبقى مباشرة
  // بلا أي تخزين حتى تظهر التحديثات لحظياً.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isAsset = /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname);

  if (isAsset) {
    // الصور والأيقونات: من المخزون أولاً (أسرع ولا تتغيّر كثيراً)
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // الصفحات وملفات JS/CSS: من الشبكة أولاً حتى تصل التحديثات فوراً،
  // ونرجع للمخزون فقط عند انقطاع الإنترنت.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
