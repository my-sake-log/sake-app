export function initPWA() {
  const state = document.querySelector('#offline-state');
  const update = document.querySelector('#update-app');
  let prepared = false;
  const showState = () => {
    state.textContent = prepared
      ? (navigator.onLine ? 'オフライン利用の準備ができました。記録はこの端末内に保存されます。' : 'オフラインで利用中 · 記録はこの端末内に保存されます。')
      : 'オフライン利用はまだ準備できていません。記録はこの端末内に保存されます。';
  };
  window.addEventListener('online', showState);
  window.addEventListener('offline', showState);
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { showState(); return; }
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) window.location.reload();
  });
  const offerUpdate = registration => {
    if (!registration.waiting || !navigator.serviceWorker.controller) return;
    update.hidden = false;
    update.onclick = () => {
      if (document.querySelector('dialog[open]')) {
        window.alert('入力内容を保存し、開いている画面を閉じてから更新してください。'); return;
      }
      if (!window.confirm('アプリを更新します。保存済みの記録と写真は残ります。更新しますか？')) return;
      reloading = true;
      registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
    };
  };
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' })
    .then(registration => {
      offerUpdate(registration);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') offerUpdate(registration);
          if (installing.state === 'redundant' && !prepared) showState();
        });
      });
      return navigator.serviceWorker.ready;
    })
    .then(() => { prepared = true; showState(); })
    .catch(showState);
}
