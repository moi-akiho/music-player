'use strict';

// ===== 状態管理 =====
const state = {
  tracks: [],
  playlists: [],
  currentTrackId: null,
  currentPlaylistId: null,
  queue: [],
  queueIndex: -1,
  playMode: 'sequential', // sequential / single / loopAll / loopOne
  shuffle: false,
  speed: 1.0,
  isPlaying: false,
  ctxTargetId: null,
};

const audio = document.getElementById('audioPlayer');
const $ = (id) => document.getElementById(id);

// ===== 波形モジュール =====
const Waveform = {
  BARS: 160,        // 表示するバー数
  data: null,       // Float32Array — 現在の曲の波形データ
  progress: 0,      // 0〜1

  canvas: null,
  ctx: null,
  wrap: null,
  cursor: null,
  isDragging: false,

  init() {
    this.canvas = $('waveformCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this.wrap   = $('waveformWrap');
    this.cursor = $('waveformCursor');
    this._setupResize();
    this._setupInteraction();
    this._drawEmpty();
  },

  // 波形データを生成（AudioContextでデコード）
  async generate(blobUrl) {
    $('waveformLoading').style.display = '';
    this.data = null;
    this._drawEmpty();

    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const resp = await fetch(blobUrl);
      const arrayBuf = await resp.arrayBuffer();
      const audioBuf = await ac.decodeAudioData(arrayBuf);
      ac.close();

      const raw = audioBuf.getChannelData(0);
      const blockSize = Math.floor(raw.length / this.BARS);
      const bars = new Float32Array(this.BARS);
      for (let i = 0; i < this.BARS; i++) {
        let peak = 0;
        const start = i * blockSize;
        for (let j = 0; j < blockSize; j++) {
          const abs = Math.abs(raw[start + j]);
          if (abs > peak) peak = abs;
        }
        bars[i] = peak;
      }
      // 最大値で正規化
      const max = Math.max(...bars) || 1;
      for (let i = 0; i < this.BARS; i++) bars[i] /= max;

      this.data = bars;
    } catch {
      // 生成失敗はプレーンバーで代替
      this.data = new Float32Array(this.BARS).fill(0.4);
    }

    $('waveformLoading').style.display = 'none';
    this.draw(this.progress);
  },

  // 再生進捗に合わせて描画（timeupdate から呼ぶ）
  draw(progress) {
    this.progress = Math.max(0, Math.min(1, progress));
    if (!this.data) return;

    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    const c = this.ctx;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, w, h);

    const barW  = w / this.BARS;
    const gap   = Math.max(1, barW * 0.18);
    const playX = this.progress * w;

    for (let i = 0; i < this.BARS; i++) {
      const x = i * barW;
      const amp = this.data[i];
      const barH = Math.max(3, amp * h * 0.88);
      const y = (h - barH) / 2;

      // 再生済み: アクセント色, 未再生: ベージュ
      c.fillStyle = x < playX ? '#a67c52' : '#d9d0c5';
      c.beginPath();
      c.roundRect(x + gap / 2, y, barW - gap, barH, 2);
      c.fill();
    }

    // カーソル位置
    this.cursor.style.left = (this.progress * 100) + '%';
  },

  _drawEmpty() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 200;
    const h = this.canvas.clientHeight || 52;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    const c = this.ctx;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, w, h);

    const barW = w / this.BARS;
    const gap  = Math.max(1, barW * 0.18);
    c.fillStyle = '#d9d0c5';
    for (let i = 0; i < this.BARS; i++) {
      const barH = Math.max(3, 0.12 * h);
      const y = (h - barH) / 2;
      c.beginPath();
      c.roundRect(i * barW + gap / 2, y, barW - gap, barH, 2);
      c.fill();
    }
    this.cursor.style.left = '0%';
  },

  // タッチ・マウス操作
  _setupInteraction() {
    const getPos = (e) => {
      const rect = this.wrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const seek = (pos) => {
      const dur = audio.duration || 0;
      if (dur > 0) audio.currentTime = pos * dur;
      this.draw(pos);
    };

    // マウス
    this.wrap.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      seek(getPos(e));
    });
    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) seek(getPos(e));
    });
    document.addEventListener('mouseup', () => { this.isDragging = false; });

    // タッチ
    this.wrap.addEventListener('touchstart', (e) => {
      this.isDragging = true;
      seek(getPos(e));
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (this.isDragging) seek(getPos(e));
    }, { passive: true });
    document.addEventListener('touchend', () => { this.isDragging = false; });
  },

  // ウィンドウリサイズ時に再描画
  _setupResize() {
    new ResizeObserver(() => this.draw(this.progress)).observe(this.wrap);
  },

  reset() {
    this.data = null;
    this.progress = 0;
    this._drawEmpty();
  },
};

// ===== LocalStorage =====
const STORAGE_KEY = 'akiho_music_v1';

function saveMeta() {
  const data = {
    playlists: state.playlists,
    tracksMeta: state.tracks.map(({ id, title, artist, album, picture, duration }) =>
      ({ id, title, artist, album, picture, duration })
    ),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota */ }
  // Driveにも保存（デバイス引き継ぎ用）
  if (driveReady) GDrive.savePlaylistData(data).catch(() => {});
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.playlists) state.playlists = data.playlists;
    state._cachedMeta = data.tracksMeta || [];
  } catch { /* 無視 */ }
}

function getCachedMeta(id) {
  return (state._cachedMeta || []).find(m => m.id === id) || null;
}

// ===== ユーティリティ =====
function genId() { return Math.random().toString(36).slice(2, 10); }

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function artHtml(picture) {
  if (picture) return `<img src="${picture}" alt="">`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== タブ切り替え =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));
    if (tab === 'library') renderLibrary();
    if (tab === 'playlist') renderPlaylistList();
  });
});


// ===== ライブラリ描画 =====
let librarySort = 'name'; // 'name' | 'date'

function renderLibrary() {
  const albumView = $('albumView');
  const allView = $('allTracksView');

  const emptyHtml = `<div class="empty-state">
    <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
    <div class="empty-state-text">「＋ 音楽を追加」から<br>音楽を読み込んでください</div>
  </div>`;

  if (!state.tracks.length) {
    albumView.innerHTML = emptyHtml;
    allView.innerHTML = emptyHtml;
    return;
  }

  // フォルダグリッド
  const albums = groupByAlbum(state.tracks);
  let entries = Object.entries(albums);

  if (librarySort === 'name') {
    entries.sort(([a], [b]) => a.localeCompare(b, 'ja'));
  } else {
    // 各フォルダ内で最も古いcreatedTimeで並べる
    entries.sort(([, ta], [, tb]) => {
      const dateA = ta.map(t => t.createdTime).filter(Boolean).sort()[0] || '';
      const dateB = tb.map(t => t.createdTime).filter(Boolean).sort()[0] || '';
      return dateA.localeCompare(dateB);
    });
  }

  albumView.innerHTML = '';
  for (const [albumName, tracks] of entries) {
    const art = tracks.find(t => t.picture)?.picture || null;
    const card = document.createElement('div');
    card.className = 'album-card';
    card.innerHTML = `
      <div class="album-card-art">${art
        ? `<img src="${art}" alt="">`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
      }</div>
      <div class="album-card-info">
        <div class="album-card-name">${esc(albumName)}</div>
        <div class="album-card-count">${tracks.length}曲</div>
      </div>`;
    card.addEventListener('click', () => openAlbumModal(albumName, tracks));
    albumView.appendChild(card);
  }

  // 全曲リスト
  allView.innerHTML = '';
  state.tracks.forEach((track, i) => {
    allView.appendChild(makeTrackItem(track, i + 1, () => playOrLoad(track.id, state.tracks.map(t => t.id))));
  });
}

function groupByAlbum(tracks) {
  const map = {};
  for (const t of tracks) {
    const key = t.album || '不明';
    if (!map[key]) map[key] = [];
    map[key].push(t);
  }
  return map;
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
    librarySort = btn.dataset.sort;
    renderLibrary();
  });
});

// ===== ライブラリ検索 =====
let librarySearchQuery = '';

function showLibrarySearch() {
  $('librarySearchWrap').style.display = '';
}

$('librarySearchInput').addEventListener('input', () => {
  librarySearchQuery = $('librarySearchInput').value.trim().toLowerCase();
  $('btnLibrarySearchClear').style.display = librarySearchQuery ? '' : 'none';
  applyLibrarySearch();
});

$('btnLibrarySearchClear').addEventListener('click', () => {
  $('librarySearchInput').value = '';
  librarySearchQuery = '';
  $('btnLibrarySearchClear').style.display = 'none';
  applyLibrarySearch();
});

function applyLibrarySearch() {
  const q = librarySearchQuery;
  const albumView = $('albumView');
  const allView = $('allTracksView');
  const searchView = $('searchResultsView');

  if (!q) {
    // 検索なし → 通常表示に戻す
    searchView.style.display = 'none';
    const activeView = document.querySelector('.view-btn.active')?.dataset.view;
    albumView.style.display = activeView === 'all' ? 'none' : '';
    allView.style.display = activeView === 'all' ? '' : 'none';
    return;
  }

  // 検索あり → searchResultsViewに結果を表示
  albumView.style.display = 'none';
  allView.style.display = 'none';
  searchView.style.display = '';
  searchView.innerHTML = '';

  const matched = state.tracks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    (t.album || '').toLowerCase().includes(q)
  );

  if (!matched.length) {
    searchView.innerHTML = `<div class="empty-state"><div class="empty-state-text">「${esc($('librarySearchInput').value)}」に一致する曲はありません</div></div>`;
    return;
  }

  matched.forEach((track, i) => {
    searchView.appendChild(makeTrackItem(track, i + 1, () => playOrLoad(track.id, matched.map(t => t.id))));
  });
}

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
    $('albumView').style.display = btn.dataset.view === 'album' ? '' : 'none';
    $('allTracksView').style.display = btn.dataset.view === 'all' ? '' : 'none';
  });
});

// ===== アルバムモーダル =====
let modalSelectedIds = new Set();
let modalCurrentTracks = [];

function updateModalSelectionUI() {
  const count = modalSelectedIds.size;
  $('modalSelectCount').textContent = count > 0 ? `${count}曲選択中` : 'アイコンをタップして選択';
  $('btnModalAddToPlaylist').disabled = count === 0;
}

function openAlbumModal(albumName, tracks) {
  modalCurrentTracks = tracks;
  modalSelectedIds.clear();
  $('rangeFrom').value = '';
  $('rangeTo').value = '';
  $('modalAlbumName').textContent = albumName;
  updateModalSelectionUI();
  renderModalTrackList();
  $('albumModal').style.display = 'flex';
}

function renderModalTrackList() {
  const list = $('modalTrackList');
  list.innerHTML = '';
  modalCurrentTracks.forEach((track, i) => {
    const isSelected = modalSelectedIds.has(track.id);
    const item = document.createElement('div');
    item.className = 'track-item' + (track.id === state.currentTrackId ? ' playing' : '') + (isSelected ? ' selected' : '');
    item.dataset.trackId = track.id;
    item.innerHTML = `
      <div class="track-item-art-wrap" data-select="${track.id}">
        <div class="track-select-check">${isSelected ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20,6 9,17 4,12"/></svg>' : ''}</div>
        <div class="track-num">${i + 1}</div>
        <div class="track-item-art">${artHtml(track.picture)}</div>
      </div>
      <div class="track-item-info">
        <div class="track-item-title">${esc(track.title)}</div>
        <div class="track-item-sub">${esc(track.artist)} — ${esc(track.album)}</div>
      </div>`;

    // アイコン部分タップ → 選択
    item.querySelector('.track-item-art-wrap').addEventListener('click', (e) => {
      e.stopPropagation();
      if (modalSelectedIds.has(track.id)) modalSelectedIds.delete(track.id);
      else modalSelectedIds.add(track.id);
      item.classList.toggle('selected', modalSelectedIds.has(track.id));
      const check = item.querySelector('.track-select-check');
      check.innerHTML = modalSelectedIds.has(track.id)
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20,6 9,17 4,12"/></svg>'
        : '';
      updateModalSelectionUI();
    });

    // 曲名部分タップ → 再生
    item.querySelector('.track-item-info').addEventListener('click', () => {
      closeAlbumModal();
      playOrLoad(track.id, modalCurrentTracks.map(t => t.id));
    });

    list.appendChild(item);
  });
}

// 範囲選択
$('btnRangeSelect').addEventListener('click', () => {
  const from = parseInt($('rangeFrom').value);
  const to   = parseInt($('rangeTo').value);
  const total = modalCurrentTracks.length;
  if (isNaN(from) || isNaN(to)) { showToast('数値を入力してください'); return; }
  const start = Math.max(1, Math.min(from, to));
  const end   = Math.min(total, Math.max(from, to));
  for (let i = start - 1; i < end; i++) modalSelectedIds.add(modalCurrentTracks[i].id);
  updateModalSelectionUI();
  renderModalTrackList();
});

// キャンセル（選択解除）
$('btnRangeClear').addEventListener('click', () => {
  modalSelectedIds.clear();
  $('rangeFrom').value = '';
  $('rangeTo').value = '';
  updateModalSelectionUI();
  renderModalTrackList();
});

// プレイリストに追加（追加後も選択状態を維持）
$('btnModalAddToPlaylist').addEventListener('click', () => {
  if (!modalSelectedIds.size) return;
  openAddToPlaylistModal([...modalSelectedIds]);
});

function closeAlbumModal() { $('albumModal').style.display = 'none'; }
$('btnAlbumModalClose').addEventListener('click', closeAlbumModal);
$('albumModal').addEventListener('click', (e) => { if (e.target === $('albumModal')) closeAlbumModal(); });

// ===== 曲アイテム生成 =====
function makeTrackItem(track, num, onPlay) {
  const item = document.createElement('div');
  item.className = 'track-item' + (track.id === state.currentTrackId ? ' playing' : '');
  item.dataset.trackId = track.id;
  item.innerHTML = `
    <div class="track-num">${num}</div>
    <div class="track-item-art">${artHtml(track.picture)}</div>
    <div class="track-item-info">
      <div class="track-item-title">${esc(track.title)}</div>
      <div class="track-item-sub">${esc(track.artist)} — ${esc(track.album)}</div>
    </div>
    <button class="track-item-edit" title="曲名を編集">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>
    <button class="track-item-menu" title="メニュー">
      <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
    </button>`;

  item.addEventListener('click', (e) => {
    if (e.target.closest('.track-item-edit')) {
      openRenameModal(track.id);
    } else if (e.target.closest('.track-item-menu')) {
      openCtxMenu(track.id, e);
    } else {
      onPlay();
    }
  });
  return item;
}

// ===== コンテキストメニュー =====
function openCtxMenu(trackId, e) {
  state.ctxTargetId = trackId;
  const menu = $('ctxMenu');
  menu.style.display = 'block';

  const btn = e.target.closest('.track-item-menu');
  const rect = btn.getBoundingClientRect();
  const menuH = 100;
  const top = rect.bottom + menuH > window.innerHeight
    ? rect.top - menuH
    : rect.bottom + 4;
  menu.style.top = top + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.left = 'auto';
}

function closeCtxMenu() { $('ctxMenu').style.display = 'none'; }

document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctxMenu') && !e.target.closest('.track-item-menu')) {
    closeCtxMenu();
  }
});

$('ctxRename').addEventListener('click', () => {
  closeCtxMenu();
  openRenameModal(state.ctxTargetId);
});

$('ctxAddToPlaylist').addEventListener('click', () => {
  closeCtxMenu();
  openAddToPlaylistModal(state.ctxTargetId);
});

// ===== 曲名変更モーダル =====
function openRenameModal(trackId) {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return;
  state.ctxTargetId = trackId;
  $('renameInput').value = track.title;
  $('renameModal').style.display = 'flex';
  setTimeout(() => $('renameInput').select(), 100);
}

function closeRenameModal() { $('renameModal').style.display = 'none'; }

$('btnRenameModalClose').addEventListener('click', closeRenameModal);
$('btnRenameCancel').addEventListener('click', closeRenameModal);
$('renameModal').addEventListener('click', (e) => { if (e.target === $('renameModal')) closeRenameModal(); });

$('btnRenameOk').addEventListener('click', doRename);
$('renameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });

function doRename() {
  const newTitle = $('renameInput').value.trim();
  if (!newTitle) return;
  const track = state.tracks.find(t => t.id === state.ctxTargetId);
  if (!track) return;
  track.title = newTitle;
  saveMeta();
  closeRenameModal();
  showToast('曲名を変更しました');

  // 再生中の曲なら表示更新
  if (state.currentTrackId === track.id) {
    $('trackTitle').textContent = newTitle;
  }
  renderLibrary();
}

// プレイヤー画面の曲名タップで編集
$('trackTitle').addEventListener('click', () => {
  if (!state.currentTrackId) return;
  openRenameModal(state.currentTrackId);
});
$('btnEditTitle').addEventListener('click', () => {
  if (!state.currentTrackId) return;
  openRenameModal(state.currentTrackId);
});

// Drive/ローカル共通の再生エントリ
function playOrLoad(trackId, queueIds) {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return;
  if (driveReady && track.driveId && !track.url) {
    playDriveTrack(trackId, queueIds);
  } else {
    playTrack(trackId, queueIds);
  }
}

// ===== 再生ロジック =====
function playTrack(trackId, queueIds) {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return;

  if (queueIds) {
    state.queue = state.shuffle ? shuffleArray([...queueIds]) : [...queueIds];
    state.queueIndex = state.queue.indexOf(trackId);
    if (state.queueIndex < 0) { state.queue.unshift(trackId); state.queueIndex = 0; }
  }

  state.currentTrackId = trackId;
  audio.src = track.url;
  audio.playbackRate = state.speed;
  audio.play();
  state.isPlaying = true;

  updateNowPlaying(track);
  updatePlayBtn();
  highlightPlayingTrack();

  // 波形生成（キャッシュがあればスキップ）
  if (track.waveformData) {
    Waveform.data = track.waveformData;
    Waveform.draw(0);
  } else {
    Waveform.reset();
    Waveform.generate(track.url).then(() => {
      track.waveformData = Waveform.data; // キャッシュ
    });
  }
}

function updateNowPlaying(track) {
  $('trackTitle').textContent = track.title;
  $('trackAlbum').textContent = track.album;
  $('trackArtist').textContent = track.artist;

  const artEl = $('albumArtImg');
  const placeholder = document.querySelector('.album-art-placeholder');
  if (track.picture) {
    artEl.src = track.picture;
    artEl.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    artEl.style.display = 'none';
    placeholder.style.display = '';
  }
}

function updatePlayBtn() {
  $('iconPlay').style.display = state.isPlaying ? 'none' : '';
  $('iconPause').style.display = state.isPlaying ? '' : 'none';
}

function highlightPlayingTrack() {
  document.querySelectorAll('.track-item').forEach(el => {
    el.classList.toggle('playing', el.dataset.trackId === state.currentTrackId);
  });
}

// 再生/一時停止
$('btnPlay').addEventListener('click', () => {
  if (!audio.src) return;
  if (state.isPlaying) {
    audio.pause();
    state.isPlaying = false;
  } else {
    audio.play();
    state.isPlaying = true;
  }
  updatePlayBtn();
});

// 前の曲
$('btnPrev').addEventListener('click', () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  moveTo(-1);
});

$('btnNext').addEventListener('click', () => moveTo(1));
$('btnRewind').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
$('btnForward').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });

function moveTo(delta) {
  if (!state.queue.length) return;
  if (state.shuffle && delta === 1) {
    state.queueIndex = Math.floor(Math.random() * state.queue.length);
  } else {
    state.queueIndex = Math.max(0, Math.min(state.queue.length - 1, state.queueIndex + delta));
  }
  playOrLoad(state.queue[state.queueIndex], null);
}

// 曲終了時
audio.addEventListener('ended', () => {
  switch (state.playMode) {
    case 'loopOne':
      audio.currentTime = 0; audio.play();
      break;
    case 'single':
      state.isPlaying = false; updatePlayBtn();
      break;
    case 'sequential': {
      if (state.shuffle) {
        const idx = Math.floor(Math.random() * state.queue.length);
        state.queueIndex = idx;
        playOrLoad(state.queue[idx], null);
      } else {
        const next = state.queueIndex + 1;
        if (next < state.queue.length) {
          state.queueIndex = next;
          playOrLoad(state.queue[next], null);
        } else {
          state.isPlaying = false; updatePlayBtn();
        }
      }
      break;
    }
    case 'loopAll': {
      const next = state.shuffle
        ? Math.floor(Math.random() * state.queue.length)
        : (state.queueIndex + 1) % state.queue.length;
      state.queueIndex = next;
      playOrLoad(state.queue[next], null);
      break;
    }
  }
});

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== シーク（波形と同期） =====
audio.addEventListener('timeupdate', () => {
  const dur = audio.duration || 0;
  const cur = audio.currentTime || 0;
  $('timeCurrent').textContent = formatTime(cur);
  $('timeTotal').textContent = formatTime(dur);
  if (dur > 0 && !Waveform.isDragging) {
    Waveform.draw(cur / dur);
  }
});

// ===== 再生モード（サイクル切り替え） =====
const PLAY_MODES_CYCLE = ['sequential', 'loopAll', 'loopOne', 'single'];

function updatePlayModeIcon() {
  PLAY_MODES_CYCLE.forEach(m => {
    const key = 'iconMode' + m.charAt(0).toUpperCase() + m.slice(1);
    $(key).style.display = m === state.playMode ? '' : 'none';
  });
  $('btnPlayMode').classList.toggle('active', state.playMode !== 'sequential');
}

$('btnPlayMode').addEventListener('click', () => {
  const idx = PLAY_MODES_CYCLE.indexOf(state.playMode);
  state.playMode = PLAY_MODES_CYCLE[(idx + 1) % PLAY_MODES_CYCLE.length];
  updatePlayModeIcon();
});

$('btnShuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  $('btnShuffle').classList.toggle('active', state.shuffle);
});

// ===== スピードコントロール =====
$('speedSlider').addEventListener('input', () => {
  const val = parseInt($('speedSlider').value);
  setSpeed(val / 100);
  $('speedInput').value = val;
});

$('speedInput').addEventListener('input', () => {
  let val = parseInt($('speedInput').value);
  if (isNaN(val)) return;
  val = Math.max(50, Math.min(200, val));
  setSpeed(val / 100);
  $('speedSlider').value = val;
});

$('speedInput').addEventListener('change', () => {
  let val = parseInt($('speedInput').value);
  if (isNaN(val) || val < 50) val = 50;
  if (val > 200) val = 200;
  $('speedInput').value = val;
  setSpeed(val / 100);
  $('speedSlider').value = val;
});

// ===== フェードアウトタイマー =====
let fadeoutEnabled = false;
let fadeIntervalId = null;
const FADE_DUR_SEC = 5; // 5秒かけてフェード

function stopFadeTimer() {
  clearInterval(fadeIntervalId);
  fadeIntervalId = null;
  audio.volume = 1;
  fadeoutEnabled = false;
  $('btnFadeout').textContent = 'セット';
  $('btnFadeout').classList.remove('active');
  $('fadeoutStatus').textContent = '';
}

function startFadeMonitor(totalSec) {
  clearInterval(fadeIntervalId);
  fadeIntervalId = setInterval(() => {
    if (!fadeoutEnabled) { clearInterval(fadeIntervalId); return; }
    const cur = audio.currentTime;
    const remaining = totalSec - cur;

    if (remaining <= 0) {
      audio.pause();
      stopFadeTimer();
    } else if (remaining <= FADE_DUR_SEC) {
      audio.volume = Math.max(0, remaining / FADE_DUR_SEC);
      $('fadeoutStatus').textContent = 'フェード中…';
    } else {
      audio.volume = 1;
      const m = Math.floor(remaining / 60);
      const s = Math.floor(remaining % 60);
      $('fadeoutStatus').textContent = `残り ${m}:${String(s).padStart(2, '0')}`;
    }
  }, 200);
}

$('btnFadeout').addEventListener('click', () => {
  if (fadeoutEnabled) {
    stopFadeTimer();
    return;
  }
  const min = Math.max(0, parseInt($('fadeMinutes').value) || 0);
  const sec = Math.max(0, parseInt($('fadeSeconds').value) || 0);
  const totalSec = min * 60 + sec;
  if (totalSec <= 0) { showToast('時間を設定してください'); return; }

  fadeoutEnabled = true;
  $('btnFadeout').textContent = 'キャンセル';
  $('btnFadeout').classList.add('active');
  startFadeMonitor(totalSec);
});

// 曲が変わったらフェードタイマーをリセット
audio.addEventListener('play', () => {
  if (fadeoutEnabled) {
    const min = Math.max(0, parseInt($('fadeMinutes').value) || 0);
    const sec = Math.max(0, parseInt($('fadeSeconds').value) || 0);
    startFadeMonitor(min * 60 + sec);
  }
});

function setSpeed(spd) {
  state.speed = spd;
  audio.playbackRate = spd;
}

// ===== プレイリスト =====
const DEFAULT_PLAYLISTS = [
  '00 デモ', '01 ワルツ', '02 タンゴ', '03 ヴェニーズワルツ',
  '04 スローフォックストロット', '05 クイックステップ',
  '06 チャチャチャ', '07 サンバ', '08 ルンバ',
  '09 パソドブレ', '10 ジャイブ', '11 パーティーミュージック',
];

$('btnCreatePlaylist').addEventListener('click', () => {
  $('playlistNameInput').value = '';
  $('playlistModal').style.display = 'flex';
  setTimeout(() => $('playlistNameInput').focus(), 100);
});

$('btnCreateDefaultPlaylists').addEventListener('click', () => {
  const existing = state.playlists.map(p => p.name);
  const toAdd = DEFAULT_PLAYLISTS.filter(name => !existing.includes(name));
  if (!toAdd.length) {
    showToast('種目プレイリストはすでに作成済みです');
    return;
  }
  toAdd.forEach(name => {
    state.playlists.push({ id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2), name, trackIds: [] });
  });
  saveMeta();
  renderPlaylistList();
  showToast(`${toAdd.length}個の種目プレイリストを作成しました`);
});

$('btnPlaylistModalClose').addEventListener('click', () => $('playlistModal').style.display = 'none');
$('btnPlaylistCancel').addEventListener('click', () => $('playlistModal').style.display = 'none');
$('playlistModal').addEventListener('click', (e) => { if (e.target === $('playlistModal')) $('playlistModal').style.display = 'none'; });
$('btnPlaylistOk').addEventListener('click', createPlaylist);
$('playlistNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') createPlaylist(); });

function createPlaylist() {
  const name = $('playlistNameInput').value.trim();
  if (!name) return;
  state.playlists.push({ id: genId(), name, trackIds: [] });
  saveMeta();
  $('playlistModal').style.display = 'none';
  renderPlaylistList();
  showToast(`「${name}」を作成しました`);
}

function renderPlaylistList() {
  const list = $('playlistList');
  $('playlistDetail').style.display = 'none';
  list.style.display = '';

  if (!state.playlists.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>
      <div class="empty-state-text">「＋ 新しいプレイリスト」から<br>プレイリストを作れます</div>
    </div>`;
    return;
  }

  list.innerHTML = '';
  state.playlists.forEach(pl => {
    const item = document.createElement('div');
    item.className = 'playlist-item';
    item.innerHTML = `
      <div class="playlist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
      <div class="playlist-item-info">
        <div class="playlist-item-name">${esc(pl.name)}</div>
        <div class="playlist-item-count">${pl.trackIds.length}曲</div>
      </div>
      <button class="playlist-item-del" data-pl-id="${pl.id}" title="削除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
      </button>`;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.playlist-item-del')) {
        if (confirm(`「${pl.name}」を削除しますか？`)) {
          state.playlists = state.playlists.filter(p => p.id !== pl.id);
          saveMeta();
          renderPlaylistList();
        }
      } else {
        openPlaylistDetail(pl.id);
      }
    });
    list.appendChild(item);
  });
}

let playlistSortMode = 'manual'; // 'manual' | 'asc' | 'desc'

$('btnPlSortAsc').addEventListener('click', () => {
  playlistSortMode = playlistSortMode === 'asc' ? 'manual' : 'asc';
  $('btnPlSortAsc').classList.toggle('active', playlistSortMode === 'asc');
  $('btnPlSortDesc').classList.remove('active');
  const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
  if (pl) renderPlaylistTracks(pl);
});

$('btnPlSortDesc').addEventListener('click', () => {
  playlistSortMode = playlistSortMode === 'desc' ? 'manual' : 'desc';
  $('btnPlSortDesc').classList.toggle('active', playlistSortMode === 'desc');
  $('btnPlSortAsc').classList.remove('active');
  const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
  if (pl) renderPlaylistTracks(pl);
});

// ===== プレイリスト内検索 =====
$('playlistSearchInput').addEventListener('input', () => {
  const q = $('playlistSearchInput').value.trim();
  $('btnPlaylistSearchClear').style.display = q ? '' : 'none';
  const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
  if (pl) renderPlaylistTracks(pl);
});

$('btnPlaylistSearchClear').addEventListener('click', () => {
  $('playlistSearchInput').value = '';
  $('btnPlaylistSearchClear').style.display = 'none';
  const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
  if (pl) renderPlaylistTracks(pl);
});

function openPlaylistDetail(plId) {
  const pl = state.playlists.find(p => p.id === plId);
  if (!pl) return;
  state.currentPlaylistId = plId;
  playlistSortMode = 'manual';
  $('btnPlSortAsc').classList.remove('active');
  $('btnPlSortDesc').classList.remove('active');
  $('playlistSearchInput').value = '';
  $('btnPlaylistSearchClear').style.display = 'none';
  $('playlistList').style.display = 'none';
  $('playlistDetail').style.display = 'block';
  $('playlistDetailName').textContent = pl.name;
  renderPlaylistTracks(pl);
}

function renderPlaylistTracks(pl) {
  const container = $('playlistTracks');
  container.innerHTML = '';

  if (!pl.trackIds.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
      <div class="empty-state-text">曲がありません<br>曲の「⋮」から追加できます</div>
    </div>`;
    return;
  }

  let displayIds = [...pl.trackIds];

  // 検索フィルター
  const plSearchQ = ($('playlistSearchInput')?.value || '').trim().toLowerCase();
  if (plSearchQ) {
    displayIds = displayIds.filter(id => {
      const t = state.tracks.find(t => t.id === id);
      return t && t.title.toLowerCase().includes(plSearchQ);
    });
  }

  if (playlistSortMode === 'asc') {
    displayIds.sort((a, b) => {
      const ta = state.tracks.find(t => t.id === a)?.duration || 0;
      const tb = state.tracks.find(t => t.id === b)?.duration || 0;
      return ta - tb;
    });
  } else if (playlistSortMode === 'desc') {
    displayIds.sort((a, b) => {
      const ta = state.tracks.find(t => t.id === a)?.duration || 0;
      const tb = state.tracks.find(t => t.id === b)?.duration || 0;
      return tb - ta;
    });
  }

  displayIds.forEach((tid, i) => {
    const track = state.tracks.find(t => t.id === tid);
    if (!track) return;

    const item = makeTrackItem(track, i + 1, () => playOrLoad(track.id, displayIds));

    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    item.insertBefore(handle, item.firstChild);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'track-item-menu';
    removeBtn.title = '削除';
    removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pl.trackIds = pl.trackIds.filter(id => id !== tid);
      saveMeta();
      renderPlaylistTracks(pl);
    });

    // 元の⋮メニューボタンを削除して削除ボタンに置き換え
    const menuBtn = item.querySelector('.track-item-menu');
    if (menuBtn) item.removeChild(menuBtn);
    item.appendChild(removeBtn);

    container.appendChild(item);
  });

  Sortable.create(container, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd(evt) {
      const moved = pl.trackIds.splice(evt.oldIndex, 1)[0];
      pl.trackIds.splice(evt.newIndex, 0, moved);
      saveMeta();
    },
  });
}

$('btnPlaylistBack').addEventListener('click', renderPlaylistList);

$('btnPlayPlaylist').addEventListener('click', () => {
  const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
  if (!pl || !pl.trackIds.length) return;
  playTrack(pl.trackIds[0], pl.trackIds);
  document.querySelector('.tab-btn[data-tab="player"]').click();
});

// ===== プレイリストに追加モーダル =====
// trackIds: 文字列（1曲）または配列（複数曲）
function openAddToPlaylistModal(trackIds) {
  const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
  state.ctxTargetId = ids[0];
  const listEl = $('addToPlaylistList');
  listEl.innerHTML = '';

  if (!state.playlists.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);">プレイリストがありません</div>';
  } else {
    state.playlists.forEach(pl => {
      const item = document.createElement('div');
      item.className = 'playlist-select-item';
      item.textContent = pl.name;
      item.addEventListener('click', () => {
        const added = ids.filter(id => !pl.trackIds.includes(id));
        pl.trackIds.push(...added);
        saveMeta();
        if (ids.length > 1) {
          showToast(`「${pl.name}」に${added.length}曲追加しました`);
        } else {
          added.length ? showToast(`「${pl.name}」に追加しました`) : showToast('すでに追加されています');
        }
        $('addToPlaylistModal').style.display = 'none';
      });
      listEl.appendChild(item);
    });
  }
  $('addToPlaylistModal').style.display = 'flex';
}

$('btnAddToPlaylistClose').addEventListener('click', () => $('addToPlaylistModal').style.display = 'none');
$('addToPlaylistModal').addEventListener('click', (e) => { if (e.target === $('addToPlaylistModal')) $('addToPlaylistModal').style.display = 'none'; });

// ===== Google Drive 連携 =====
let driveReady = false;

async function initDrive() {
  // CLIENT_ID が未設定ならDriveなしモードで起動
  if (!window.google || GDrive.CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    showLocalMode();
    return;
  }

  await GDrive.init();

  // Googleにログイン済みなら自動接続を試みる（UIなし）
  GDrive.trySilentSignIn(
    () => onDriveSignedIn(),   // 成功 → 自動接続
    () => showDriveLogin()     // 失敗 → ログインボタン表示
  );
}

function showDriveLogin() {
  $('driveLoginPanel').style.display = '';
  $('libraryHeader').style.display = 'none';
  $('driveLoadingPanel').style.display = 'none';
}

function showLocalMode() {
  // Drive未連携時は従来のファイルアップロードUI
  $('driveLoginPanel').style.display = 'none';
  $('driveLoadingPanel').style.display = 'none';
  $('libraryHeader').style.display = '';
  // ヘッダーにアップロードボタンを動的追加
  if (!$('btnUploadInHeader')) {
    const btn = document.createElement('button');
    btn.className = 'upload-btn';
    btn.id = 'btnUploadInHeader';
    btn.textContent = '＋ 音楽を追加';
    btn.addEventListener('click', () => $('fileInput').click());
    $('libraryHeader').prepend(btn);
  }
  $('driveUserInfo').style.display = 'none';
  $('btnDriveReload').style.display = 'none';
  renderLibrary();
}

async function onDriveSignedIn() {
  driveReady = true;
  $('driveLoginPanel').style.display = 'none';
  $('driveLoadingPanel').style.display = '';
  $('libraryHeader').style.display = 'none';

  try {
    // Drive からプレイリストデータ読み込み
    const saved = await GDrive.loadPlaylistData();
    if (saved?.playlists) state.playlists = saved.playlists;
    if (saved?.tracksMeta) state._cachedMeta = saved.tracksMeta;

    // Drive の音楽ファイル一覧取得
    const files = await GDrive.listMusicFiles();

    // フォルダIDを収集して2階層パスを取得（例: "ワルツ / 初級"）
    const folderIds = [...new Set(files.flatMap(f => f.parents || []))];
    const folderNames = await GDrive.getFolderPaths(folderIds);

    state.tracks = files.map(f => {
      const cached = getCachedMeta(f.id);
      const parentId = f.parents?.[0];
      const folderName = parentId ? (folderNames[parentId] || '不明') : '不明';
      return {
        id: f.id,
        driveId: f.id,
        url: null,
        title: cached?.title || f.name.replace(/\.[^.]+$/, ''),
        artist: cached?.artist || '',
        album: folderName,
        picture: cached?.picture || null,
        duration: cached?.duration || 0,
        createdTime: f.createdTime || '',
      };
    });

    $('driveLoadingPanel').style.display = 'none';
    $('libraryHeader').style.display = '';
    $('driveUserInfo').style.display = '';
    $('driveUserName').textContent = 'Drive 接続済み';
    $('btnDriveReload').style.display = '';

    renderLibrary();
    showLibrarySearch();
    renderPlaylistList();

  } catch (err) {
    $('driveLoadingPanel').style.display = 'none';
    showToast('読み込みエラー。再ログインしてください');
    showDriveLogin();
  }
}

// Drive ログインボタン
$('btnDriveLogin').addEventListener('click', () => {
  GDrive.signIn(onDriveSignedIn);
});

// ログアウト
$('btnDriveLogout').addEventListener('click', () => {
  GDrive.signOut();
  state.tracks = [];
  driveReady = false;
  $('albumView').innerHTML = '';
  $('allTracksView').innerHTML = '';
  showDriveLogin();
  showToast('ログアウトしました');
});

// 再読み込み
$('btnDriveReload').addEventListener('click', async () => {
  if (!driveReady) return;
  showToast('更新中…');
  await onDriveSignedIn();
});

// キャッシュクリア
$('btnClearCache').addEventListener('click', async () => {
  const count = await GDrive.getCacheCount();
  if (count === 0) { showToast('キャッシュはありません'); return; }
  if (!confirm(`キャッシュされた${count}曲を削除しますか？\n次回再生時にまたダウンロードが必要になります。`)) return;
  await GDrive.clearCache();
  showToast('キャッシュをクリアしました');
});

// 設定ガイドモーダル
$('linkSetupGuide').addEventListener('click', (e) => {
  e.preventDefault();
  $('setupGuideModal').style.display = 'flex';
});
$('btnSetupGuideClose').addEventListener('click', () => $('setupGuideModal').style.display = 'none');
$('setupGuideModal').addEventListener('click', (e) => { if (e.target === $('setupGuideModal')) $('setupGuideModal').style.display = 'none'; });

// Drive曲再生（BlobURL取得してから再生）
async function playDriveTrack(trackId, queueIds) {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return;

  // すでにBlobURLがあればそのまま再生
  if (track.url) {
    playTrack(trackId, queueIds);
    return;
  }

  // ローディングオーバーレイ表示
  $('trackLoadingOverlay').style.display = 'flex';
  $('trackLoadingText').textContent = `${track.title} を読み込み中…`;
  $('trackLoadingBar').style.width = '0%';

  try {
    const blobUrl = await GDrive.fetchAsBlobUrl(track.driveId, (progress) => {
      $('trackLoadingBar').style.width = Math.round(progress * 100) + '%';
    });

    track.url = blobUrl;

    // ID3タグ取得（まだなければ）
    if (track.album === '不明' || track.artist === '不明') {
      try {
        const resp = await fetch(blobUrl);
        const arrayBuf = await resp.arrayBuffer();
        const file = new File([arrayBuf], track.title, { type: 'audio/mpeg' });
        const meta = await ID3.read(file);
        if (meta.title) track.title = meta.title;
        if (meta.artist && meta.artist !== '不明') track.artist = meta.artist;
        if (meta.album && meta.album !== '不明') track.album = meta.album;
        if (meta.picture) track.picture = meta.picture;
        saveMeta();
      } catch { /* タグ取得失敗は無視 */ }
    }

    $('trackLoadingOverlay').style.display = 'none';
    playTrack(trackId, queueIds);

  } catch (err) {
    $('trackLoadingOverlay').style.display = 'none';
    showToast('読み込みに失敗しました');
  }
}

// ===== 起動時 =====
Waveform.init();
loadMeta();
renderPlaylistList();

// Google APIの読み込み完了後にDrive初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initDrive, 500));
} else {
  setTimeout(initDrive, 500);
}
