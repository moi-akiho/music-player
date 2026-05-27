'use strict';

// アプリのHTML/CSS/JSをキャッシュするService Worker
// 音楽ファイルのキャッシュ（akiho-music-v1）は gdrive.js 側で管理

const APP_CACHE = 'akiho-app-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './gdrive.js',
  './id3.js',
  './manifest.json',
  './icon.svg',
];

// ===== インストール: アプリシェルを先読みキャッシュ =====
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()) // 即座に有効化
  );
});

// ===== アクティベート: 古いアプリキャッシュを削除 =====
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          // 音楽ファイルキャッシュ（akiho-music-v1）は残す、古いアプリキャッシュのみ削除
          .filter(k => k.startsWith('akiho-app-') && k !== APP_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ===== フェッチ: ネットワーク優先、オフライン時はキャッシュから返す =====
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Google API / CDN はサービスワーカーを介さない（認証が絡むため）
  if (
    url.includes('googleapis.com') ||
    url.includes('accounts.google.com') ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('cdn.jsdelivr.net')
  ) {
    return;
  }

  // アプリシェル: ネットワーク優先 → 取得したら更新キャッシュ → 失敗時はキャッシュを返す
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(APP_CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
