import { initPWA } from './pwa.js';
import { TYPES, OWNER, MAX_BACKUP_BYTES, MAX_PHOTO_LENGTH, selectRecords, encodeBackup, decodeBackup } from './data.js';
import { listRecords, saveRecord, deleteRecord, replaceRecords } from './db.js';

const $ = selector => document.querySelector(selector);
let records = [], editing = null, selected = null, photo = null, photoBusy = false, saving = false, ranking = false, ready = false;
let photoGeneration = 0;
const form = $('#record-form');
let noticeTimer;
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function errorText(error) {
  if (error?.name === 'QuotaExceededError') return '端末の保存容量が不足しています。保存できていません。バックアップ後、不要な写真や記録を整理してください。';
  return error instanceof Error ? error.message : '操作に失敗しました。ブラウザの保存設定を確認してください。';
}
function notify(message, failed = false) {
  const status = $('#status');
  status.textContent = message;
  status.classList.toggle('failed', failed);
  clearTimeout(noticeTimer);
  if (!failed) noticeTimer = setTimeout(() => { status.textContent = ''; }, 5000);
}
function setReady(value) {
  ready = value;
  for (const id of ['add-record', 'empty-add', 'export', 'import']) $(`#${id}`).disabled = !value;
}
async function refresh() {
  records = await listRecords();
  render();
}
function render() {
  $('#total-count').textContent = `${records.length}本`;
  const filtered = selectRecords(records, { query: $('#search').value, type: $('#type-filter').value, sort: $('#sort').value, ranking });
  $('#result-count').textContent = `${filtered.length}本を表示${ranking ? ' · また飲みたいお酒' : ''}`;
  const grid = $('#records');
  grid.replaceChildren();
  filtered.forEach((record, index) => {
    const button = element('button', 'sake-card');
    button.type = 'button';
    button.setAttribute('aria-label', `${record.name}の記録を開く`);
    const visual = element('div', `card-photo type-${TYPES.indexOf(record.type)}`);
    if (record.photo) { const img = element('img'); img.src = record.photo; img.alt = `${record.name}の写真`; img.loading = 'lazy'; visual.append(img); }
    else { visual.append(element('span', 'bottle-icon', '酒'), element('span', 'no-photo', '写真なし')); }
    if (ranking) visual.append(element('span', 'rank', `#${index + 1}`));
    const body = element('div', 'card-body');
    const top = element('div', 'card-top');
    top.append(element('span', 'type-tag', record.type), element('span', 'heart', record.again ? '♡ また飲みたい' : ''));
    body.append(top, element('h3', '', record.name), element('p', 'card-origin', [record.maker, record.region].filter(Boolean).join(' / ') || '産地・メーカー未登録'));
    const meta = element('div', 'card-meta');
    const stars = element('span', 'stars', '★'.repeat(record.rating) + '☆'.repeat(5 - record.rating));
    stars.setAttribute('aria-label', `評価${record.rating} / 5`);
    meta.append(stars, element('span', '', record.drinkDate ? record.drinkDate.replaceAll('-', '.') : '日付未登録'));
    body.append(meta); button.append(visual, body);
    button.addEventListener('click', () => showDetail(record)); grid.append(button);
  });
  $('#empty').hidden = filtered.length > 0;
  const noRecords = records.length === 0;
  $('#empty-title').textContent = noRecords ? 'はじめの一本を、酒棚に。' : '該当するお酒はまだありません。';
  $('#empty-copy').textContent = noRecords ? 'ラベルの写真と、ひとことの感想から。\nあなたのお酒の物語をはじめましょう。' : ranking ? '「また飲みたい」を選ぶとここに並びます。検索条件も確認してください。' : '名前や酒類、検索条件を変えてみてください。';
  $('#empty-add').hidden = !noRecords;
}
function updatePhoto() {
  $('#photo-preview').hidden = !photo;
  if (photo) $('#photo-preview').src = photo; else $('#photo-preview').removeAttribute('src');
  $('#remove-photo').hidden = !photo;
}
function openEditor(record = null) {
  if (!ready) return;
  editing = record; form.reset(); photoGeneration++; photoBusy = false;
  photo = record?.photo ?? null;
  $('#editor-title').textContent = record ? '記録を編集する' : 'お酒を記録する';
  $('#form-error').textContent = '';
  if (record) for (const name of ['name', 'type', 'maker', 'region', 'drinkDate', 'price', 'rating', 'notes', 'pairing']) form.elements[name].value = record[name] ?? '';
  else {
    const now = new Date();
    form.elements.drinkDate.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  form.elements.again.checked = record?.again ?? false;
  updatePhoto(); $('#save-record').disabled = false; $('#editor').showModal();
}
function showDetail(record) {
  selected = record;
  const content = $('#detail-content'); content.replaceChildren();
  if (record.photo) { const img = element('img', 'detail-photo'); img.src = record.photo; img.alt = `${record.name}の写真`; content.append(img); }
  content.append(element('p', 'type-tag', record.type));
  const title = element('h2', '', record.name); title.id = 'detail-title'; content.append(title);
  content.append(element('p', 'stars', '★'.repeat(record.rating) + '☆'.repeat(5-record.rating)));
  const list = element('dl', 'detail-list');
  const pairs = [['メーカー・酒蔵', record.maker], ['産地', record.region], ['飲んだ日', record.drinkDate], ['価格', record.price === null ? '' : `${record.price.toLocaleString('ja-JP')}円`], ['テイスティングメモ', record.notes], ['ペアリングした料理', record.pairing], ['また飲みたい', record.again ? 'はい ♡' : 'いいえ'], ['登録日', new Date(record.createdAt).toLocaleString('ja-JP')]];
  pairs.forEach(([key, value]) => list.append(element('dt', '', key), element('dd', '', value || '未登録')));
  content.append(list); $('#detail-error').textContent = ''; $('#detail').showModal();
}
async function compressPhoto(file) {
  if (file.size > 6 * 1024 * 1024) throw new Error('写真は6MB以内にしてください。');
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const isJPEG = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isPNG = [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
  const isWebP = ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
  const isHEIF = ascii(4,8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(8,12));
  if (!isJPEG && !isPNG && !isWebP && !isHEIF) throw new Error('対応する画像を選んでください。JPEG・PNG・WebPを推奨します。');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 60_000_000) throw new Error('画像の解像度が大きすぎるか、読み取れません。');
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth*scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight*scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const result = canvas.toDataURL('image/jpeg', .82);
    if (result.length > MAX_PHOTO_LENGTH) throw new Error('保存用の画像が大きすぎます。小さい画像を選んでください。');
    return result;
  } catch(error) { throw new Error(error.name === 'EncodingError' ? '画像を読み込めません。JPEG・PNG・WebPで選び直してください。' : errorText(error)); }
  finally { URL.revokeObjectURL(url); }
}
TYPES.forEach(type => { $('#record-type').add(new Option(type, type)); $('#type-filter').add(new Option(type, type)); });
$('#add-record').onclick = () => openEditor(); $('#empty-add').onclick = () => openEditor();
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(`#${button.dataset.close}`).close();
$('#editor').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('#editor').addEventListener('close', () => { photoGeneration++; });
async function onPhotoChange(event) {
  const file = event.target.files[0]; if (!file) return;
  const generation = ++photoGeneration; photoBusy = true; $('#save-record').disabled = true; $('#form-error').textContent = '写真を準備しています…';
  try { const result = await compressPhoto(file); if (generation === photoGeneration) { photo = result; updatePhoto(); $('#form-error').textContent = ''; } }
  catch(error) { if (generation === photoGeneration) $('#form-error').textContent = errorText(error); }
  finally { if (generation === photoGeneration) { photoBusy = false; $('#save-record').disabled = false; event.target.value = ''; } }
};
$('#photo').onchange = onPhotoChange;
$('#photo-camera').onchange = onPhotoChange;
$('#remove-photo').onclick = () => { photoGeneration++; photoBusy = false; photo = null; $('#photo').value = ''; $('#form-error').textContent = ''; $('#save-record').disabled = false; updatePhoto(); };
form.onsubmit = async event => {
  event.preventDefault(); if (photoBusy || saving) return;
  saving = true; $('#save-record').disabled = true; $('#form-error').textContent = '';
  const now = new Date().toISOString();
  const get = name => form.elements[name].value;
  const record = { id: editing?.id ?? crypto.randomUUID(), ownerId: OWNER, visibility: 'private', name: get('name'), type: get('type'), maker: get('maker'), region: get('region'), drinkDate: get('drinkDate'), price: get('price') === '' ? null : Number(get('price')), rating: Number(get('rating')), notes: get('notes'), pairing: get('pairing'), again: form.elements.again.checked, photo, createdAt: editing?.createdAt ?? now, updatedAt: now };
  try { await saveRecord(record, editing?.updatedAt ?? null); $('#editor').close(); notify('記録を端末に保存しました。'); await refresh(); }
  catch(error) { if ($('#editor').open) $('#form-error').textContent = errorText(error); else notify(errorText(error), true); }
  finally { saving = false; $('#save-record').disabled = false; }
};
$('#edit-record').onclick = () => { $('#detail').close(); openEditor(selected); };
$('#delete-record').onclick = async () => {
  if (!selected || !confirm(`「${selected.name}」を削除しますか？写真も削除されます。この操作は取り消せません。`)) return;
  $('#delete-record').disabled = true;
  try { await deleteRecord(selected.id, selected.updatedAt); $('#detail').close(); notify('記録を削除しました。'); await refresh(); }
  catch(error) { $('#detail-error').textContent = errorText(error); }
  finally { $('#delete-record').disabled = false; }
};
for (const id of ['search', 'type-filter', 'sort']) $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render);
function setTab(value) {
  ranking = value;
  $('#all-tab').classList.toggle('active', !value); $('#all-tab').setAttribute('aria-pressed', String(!value));
  $('#ranking-tab').classList.toggle('active', value); $('#ranking-tab').setAttribute('aria-pressed', String(value));
  $('#ranking-help').hidden = !value; $('#sort').disabled = value; render();
}
$('#all-tab').onclick = () => setTab(false); $('#ranking-tab').onclick = () => setTab(true);
$('#storage-open').onclick = () => { $('#storage-result').textContent = ''; $('#storage').showModal(); };
$('#export').onclick = async () => {
  $('#export').disabled = true;
  try {
    const latest = await listRecords(); const json = encodeBackup(latest);
    const blob = new Blob([json], { type: 'application/json' });
    if (blob.size > MAX_BACKUP_BYTES) throw new Error('50MBを超えるため、このMVPで復元可能なバックアップを作成できません。記録を削除せず、開発者に分割バックアップの対応を依頼してください。');
    const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = `my-sake-log-${new Date().toISOString().slice(0,10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('#storage-result').textContent = `${latest.length}本のバックアップを作成しました。ダウンロード先でファイルの保存完了を確認してください。`;
  } catch(error) { $('#storage-result').textContent = errorText(error); }
  finally { $('#export').disabled = !ready; }
};
$('#import').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  event.target.disabled = true;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('バックアップは50MB以内にしてください。');
    const restored = decodeBackup(await file.text());
    for (const record of restored) {
      if (!record.photo) continue;
      const image = new Image(); image.src = record.photo;
      try { await image.decode(); } catch { throw new Error('バックアップに読み取れない写真があります。現在の記録は変更していません。'); }
    }
    if (!confirm(`${restored.length}本の記録と写真で、現在の全記録を置き換えます。現在のバックアップを保存しましたか？復元を実行しますか？`)) return;
    await replaceRecords(restored); await refresh(); $('#storage-result').textContent = `${restored.length}本の記録と写真を復元しました。`; notify('バックアップを復元しました。');
  } catch(error) { $('#storage-result').textContent = errorText(error); }
  finally { event.target.value = ''; event.target.disabled = !ready; }
};
window.addEventListener('focus', () => { if (ready && !document.querySelector('dialog[open]')) refresh().catch(error => notify(errorText(error), true)); });
try { await refresh(); setReady(true); }
catch(error) { setReady(false); $('#empty').hidden = true; notify(`保存先を開けません。記録機能を停止しています。${errorText(error)}`, true); }

initPWA();
