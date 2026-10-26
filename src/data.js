export const TYPES = ['日本酒', '焼酎', 'ワイン', 'ウイスキー', 'ビール', 'その他'];
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_PHOTO_LENGTH = 3 * 1024 * 1024;
export const OWNER = 'local-owner';
const invalid = message => { throw new Error(message); };
function string(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid(`${label}を確認してください（最大${max}文字）。`);
  return value.trim();
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('記録の形式が正しくありません。');
  const id = string(value.id, 'ID', 80, true);
  if (!/^[\w-]+$/.test(id)) invalid('IDが正しくありません。');
  if (!TYPES.includes(value.type)) invalid('酒類を選んでください。');
  if (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) invalid('評価は1〜5で選んでください。');
  if (value.price !== null && (!Number.isSafeInteger(value.price) || value.price < 0 || value.price > 99999999)) invalid('価格は0〜99,999,999円の整数で入力してください。');
  if (typeof value.drinkDate !== 'string' || (value.drinkDate !== '' && !validDate(value.drinkDate))) invalid('飲んだ日が正しくありません。');
  if (typeof value.again !== 'boolean') invalid('また飲みたいかを選んでください。');
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof value[key] !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value[key]) || !Number.isFinite(Date.parse(value[key]))) invalid('記録日時が正しくありません。');
  }
  if (value.ownerId !== OWNER || value.visibility !== 'private') invalid('このMVPでは自分の非公開記録のみ扱えます。');
  const photo = value.photo;
  if (photo !== null && (typeof photo !== 'string' || photo.length > MAX_PHOTO_LENGTH || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))) invalid('写真の形式またはサイズが正しくありません。');
  return {
    id, ownerId: OWNER, visibility: 'private',
    name: string(value.name, '銘柄名', 100, true), type: value.type,
    maker: string(value.maker, 'メーカー・酒蔵', 100), region: string(value.region, '産地', 100),
    drinkDate: value.drinkDate, price: value.price, rating: value.rating,
    notes: string(value.notes, 'テイスティングメモ', 3000), pairing: string(value.pairing, '料理', 1000),
    again: value.again, photo, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}
export function selectRecords(records, { query = '', type = '', sort = 'newest', ranking = false } = {}) {
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  return records.filter(r => (!ranking || r.again) && (!type || r.type === type) &&
    [r.name, r.type, r.region].some(s => s.normalize('NFKC').toLocaleLowerCase('ja').includes(normalized)))
    .sort((a, b) => ((ranking || sort === 'rating') ? b.rating - a.rating : 0) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function encodeBackup(records) {
  return JSON.stringify({ app: 'MY SAKE LOG', version: 1, exportedAt: new Date().toISOString(), records: records.map(validateRecord) }, null, 2);
}
export function decodeBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) invalid('バックアップは50MB以内にしてください。');
  let data;
  try { data = JSON.parse(text); } catch { invalid('JSONファイルを読み取れません。'); }
  if (data?.app !== 'MY SAKE LOG' || data.version !== 1 || !Array.isArray(data.records) || data.records.length > 10000) invalid('対応するMY SAKE LOGのバックアップではありません。');
  const records = data.records.map(validateRecord);
  if (new Set(records.map(r => r.id)).size !== records.length) invalid('記録IDが重複しています。');
  return records;
}
