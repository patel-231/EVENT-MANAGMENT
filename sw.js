/* ============================================================
   GeoTask Service Worker v3
   — Runs in background even when Chrome is minimised
   — Shows lock-screen style OS notifications
   ============================================================ */
const CACHE = 'geotask-v3';

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => { e.waitUntil(self.clients.claim()); });

/* ── Messages from the page ── */
self.addEventListener('message', e => {
  if (!e.data) return;
  switch (e.data.type) {
    case 'SYNC_TASKS': saveTasks(e.data.tasks); break;
    case 'SYNC_POS':   savePos(e.data.lat, e.data.lng); break;
    case 'CHECK_NOW':  doCheck(); break;
  }
});

/* ── Periodic sync (Chrome Android supports this) ── */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'geo-check') e.waitUntil(doCheck());
});

/* ── Notification button clicks ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true })
      .then(cls => cls.length ? cls[0].focus() : self.clients.openWindow('./'))
  );
});

/* ── Core check loop ── */
async function doCheck() {
  const tasks = await loadTasks();
  const pos   = await loadPos();
  if (!tasks.length || !pos) return;
  const now = Date.now();
  let dirty = false;
  for (const t of tasks.filter(x => x.active)) {
    const d    = haversine(pos.lat, pos.lng, t.lat, t.lng);
    const cool = !t.lastN || now - t.lastN > 120000; // 2 min cooldown
    if (d <= t.radius && cool && !t.inside) {
      await pushNotif(t);
      t.inside = true; t.lastN = now; dirty = true;
    } else if (d > t.radius && t.inside) {
      t.inside = false; dirty = true;
    }
  }
  if (dirty) await saveTasks(tasks);
}

/* ── Lock-screen style notification ── */
async function pushNotif(t) {
  const title = '📍 ' + t.title;
  const body  = t.desc || 'You have arrived at your saved location!';
  await self.registration.showNotification(title, {
    body,
    icon:             'icon-192.png',
    badge:            'icon-96.png',
    tag:              'gt-' + t.id,
    renotify:         true,
    requireInteraction: true,          // stays on screen until dismissed
    silent:           false,
    vibrate:          [300, 150, 300, 150, 600],
    data:             { taskId: t.id },
    actions: [
      { action: 'open',    title: '📋 Open App' },
      { action: 'dismiss', title: '✕ Dismiss'  }
    ]
  });
}

/* ── Cache storage helpers ── */
async function saveTasks(tasks) {
  const c = await caches.open(CACHE);
  await c.put('/~tasks', new Response(JSON.stringify(tasks),
    { headers: { 'Content-Type': 'application/json' } }));
}
async function loadTasks() {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match('/~tasks');
    return r ? r.json() : [];
  } catch { return []; }
}
async function savePos(lat, lng) {
  const c = await caches.open(CACHE);
  await c.put('/~pos', new Response(JSON.stringify({ lat, lng }),
    { headers: { 'Content-Type': 'application/json' } }));
}
async function loadPos() {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match('/~pos');
    return r ? r.json() : null;
  } catch { return null; }
}

/* ── Haversine ── */
function haversine(a, b, c, d) {
  const R = 6371000, f = Math.PI / 180;
  const x = Math.sin((c-a)*f/2)**2 +
    Math.cos(a*f)*Math.cos(c*f)*Math.sin((d-b)*f/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
