'use strict';

// ===== Google Drive 連携モジュール =====
// CLIENT_ID は Google Cloud Console で取得したものに差し替えてください
const GDrive = {
  CLIENT_ID: '646110345005-mhc9hdgd81j5mmuovpoekkbislenmsl1.apps.googleusercontent.com',

  SCOPES: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.appdata',
  ].join(' '),

  tokenClient: null,
  accessToken: null,
  isReady: false,

  // ===== 初期化 =====
  init() {
    return new Promise((resolve) => {
      if (this.CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
        console.warn('GDrive: CLIENT_ID が設定されていません');
        resolve(false);
        return;
      }

      google.accounts.id.initialize({ client_id: this.CLIENT_ID });

      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.CLIENT_ID,
        scope: this.SCOPES,
        callback: (resp) => {
          if (resp.error) return;
          this.accessToken = resp.access_token;
          this.isReady = true;
          this._onSignedIn && this._onSignedIn();
        },
      });

      // 前回のトークンがキャッシュされていれば自動サインイン
      const saved = sessionStorage.getItem('gd_token');
      if (saved) {
        this.accessToken = saved;
        this.isReady = true;
      }

      resolve(true);
    });
  },

  // ===== サインイン =====
  signIn(onSignedIn) {
    this._onSignedIn = () => {
      sessionStorage.setItem('gd_token', this.accessToken);
      onSignedIn && onSignedIn();
    };
    this.tokenClient.requestAccessToken({ prompt: '' });
  },

  signOut() {
    if (this.accessToken) {
      google.accounts.oauth2.revoke(this.accessToken);
    }
    this.accessToken = null;
    this.isReady = false;
    sessionStorage.removeItem('gd_token');
  },

  // ===== 音楽ファイル一覧取得 =====
  async listMusicFiles() {
    const files = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({
        q: "mimeType contains 'audio/' and trashed = false",
        fields: 'nextPageToken,files(id,name,size,mimeType,parents,createdTime)',
        pageSize: '200',
        orderBy: 'name',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await this._fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`
      );

      if (!res.ok) throw new Error('Drive API エラー: ' + res.status);
      const data = await res.json();
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return files; // [{ id, name, size, mimeType }, ...]
  },

  // ===== フォルダIDからフォルダ名を一括取得 =====
  async getFolderNames(folderIds) {
    if (!folderIds.length) return {};
    const names = {};
    await Promise.all(folderIds.map(async id => {
      const res = await this._fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name`
      );
      if (res.ok) {
        const data = await res.json();
        names[id] = data.name;
      }
    }));
    return names;
  },

  // ===== ファイルをBlobとして取得してBlobURLを返す =====
  async fetchAsBlobUrl(fileId, onProgress) {
    const res = await this._fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    );
    if (!res.ok) throw new Error('ファイル取得エラー: ' + res.status);

    const total = parseInt(res.headers.get('Content-Length') || '0');
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (onProgress && total) onProgress(loaded / total);
    }

    const blob = new Blob(chunks);
    return URL.createObjectURL(blob);
  },

  // ===== AppData にプレイリストを保存 =====
  async savePlaylistData(data) {
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });

    // 既存ファイルがあれば取得
    const existing = await this._findAppDataFile('playlists.json');

    if (existing) {
      await this._fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
        { method: 'PATCH', body: blob }
      );
    } else {
      const meta = JSON.stringify({
        name: 'playlists.json',
        parents: ['appDataFolder'],
      });
      const form = new FormData();
      form.append('metadata', new Blob([meta], { type: 'application/json' }));
      form.append('file', blob);
      await this._fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        { method: 'POST', body: form }
      );
    }
  },

  // ===== AppData からプレイリストを読み込み =====
  async loadPlaylistData() {
    const file = await this._findAppDataFile('playlists.json');
    if (!file) return null;
    const res = await this._fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    );
    if (!res.ok) return null;
    return await res.json();
  },

  // ===== AppData ファイル検索 =====
  async _findAppDataFile(name) {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${name}'`,
      fields: 'files(id)',
    });
    const res = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.files?.[0] || null;
  },

  // ===== 共通 fetch（Authヘッダー付き） =====
  _fetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  },
};
