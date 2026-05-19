// ID3タグ解析ラッパー（jsmediatags使用）

const ID3 = {
  // FileオブジェクトからID3タグを読み取る
  // 返り値: { title, artist, album, picture (DataURL or null) }
  read(file) {
    return new Promise((resolve) => {
      const fallback = {
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '不明',
        album: '不明',
        picture: null,
      };

      if (typeof jsmediatags === 'undefined') {
        resolve(fallback);
        return;
      }

      jsmediatags.read(file, {
        onSuccess(tag) {
          const t = tag.tags;
          const result = {
            title: t.title || fallback.title,
            artist: t.artist || '不明',
            album: t.album || '不明',
            picture: null,
          };

          if (t.picture) {
            try {
              const { data, format } = t.picture;
              const bytes = new Uint8Array(data);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              result.picture = `data:${format};base64,${btoa(binary)}`;
            } catch {
              // 画像読み取り失敗は無視
            }
          }

          resolve(result);
        },
        onError() {
          resolve(fallback);
        },
      });
    });
  },
};
