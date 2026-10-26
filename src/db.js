import { validateRecord, encodeBackup, MAX_BACKUP_BYTES } from './data.js';
let connection;
export function openDB() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('my-sake-log', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => { connection = null; reject(new Error('別のタブを閉じて、再読み込みしてください。')); };
  });
  return connection;
}
export async function listRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const req = tx.objectStore('records').getAll();
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error || new Error('記録を読み取れません。'));
  });
}
async function mutate(operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    let problem;
    const abort = error => { problem = error; tx.abort(); };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(problem || tx.error || new Error('保存できませんでした。'));
    try { operation(tx.objectStore('records'), abort); } catch (error) { abort(error); }
  });
}
export async function saveRecord(record, expectedUpdatedAt = null) {
  const valid = validateRecord(record);
  return mutate((store, abort) => {
    const req = store.getAll();
    req.onsuccess = () => {
      try {
        const current = req.result.find(row => row.id === valid.id);
        if (expectedUpdatedAt === null ? Boolean(current) : current?.updatedAt !== expectedUpdatedAt) {
          abort(new Error('記録が別のタブで変更されました。画面を更新してやり直してください。')); return;
        }
        const next = req.result.filter(row => row.id !== valid.id).concat(valid);
        if (next.length > 10000 || new TextEncoder().encode(encodeBackup(next)).length > MAX_BACKUP_BYTES) {
          abort(new Error('バックアップ可能な上限（50MB・10,000本）に達しました。保存できていません。写真を小さくしてやり直してください。')); return;
        }
        store.put(valid);
      } catch (error) { abort(error); }
    };
  });
}
export async function deleteRecord(id, expectedUpdatedAt) {
  return mutate((store, abort) => {
    const req = store.get(id);
    req.onsuccess = () => {
      try {
        if (req.result?.updatedAt !== expectedUpdatedAt) { abort(new Error('記録が変更されました。画面を更新してください。')); return; }
        store.delete(id);
      } catch (error) { abort(error); }
    };
  });
}
export async function replaceRecords(records) {
  const valid = records.map(validateRecord);
  if (new Set(valid.map(r => r.id)).size !== valid.length) throw new Error('記録IDが重複しています。');
  if (valid.length > 10000 || new TextEncoder().encode(encodeBackup(valid)).length > MAX_BACKUP_BYTES) throw new Error('復元後のバックアップが上限（50MB・10,000本）を超えます。現在の記録は変更していません。');
  return mutate(store => { store.clear(); valid.forEach(r => store.add(r)); });
}
