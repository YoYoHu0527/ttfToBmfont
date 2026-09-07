const SETTINGS_KEY = 'ttf-to-bmfont:settings';
const FONT_DB_NAME = 'ttf-to-bmfont';
const FONT_STORE = 'fonts';
const FONT_KEY = 'loadedFont';

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 超出配额或隐私模式时静默失败，不影响主流程
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function openFontDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FONT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FONT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveFontToDb(file) {
  try {
    const db = await openFontDb();
    const buffer = await file.arrayBuffer();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readwrite');
      tx.objectStore(FONT_STORE).put(
        { name: file.name, type: file.type || '', size: file.size, buffer },
        FONT_KEY,
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 存储失败（隐私模式/磁盘限制）时忽略，仍可正常使用当前会话
  }
}

export async function loadFontFromDb() {
  try {
    const db = await openFontDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly');
      const request = tx.objectStore(FONT_STORE).get(FONT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!record || !record.buffer) return null;
    return new File([record.buffer], record.name, { type: record.type || '' });
  } catch {
    return null;
  }
}
