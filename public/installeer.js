/* Home- en terugknop: altijd in beeld op elke pagina behalve de startpagina. Uitzetten: <html data-geen-navknoppen>. */
(function () {
  var html = document.documentElement;
  if (html.hasAttribute('data-geen-navknoppen')) return;
  var pad = location.pathname.replace(/index\.html?$/, '');
  if (pad === '/' || pad === '') return;
  var lang = (html.lang || 'nl').slice(0, 2).toLowerCase();
  var W = { nl: ['Startpagina', 'Terug'], en: ['Home', 'Back'], de: ['Startseite', 'Zurück'], fr: ['Accueil', 'Retour'], es: ['Inicio', 'Atrás'], it: ['Home', 'Indietro'], pl: ['Start', 'Wstecz'] }[lang] || ['Home', 'Back'];
  var thuis = '/' + (/^\/[a-z]{2}\//.test(pad) && lang !== 'nl' ? pad.slice(1, 3) + '/' : '');
  function start() {
    var st = document.createElement('style');
    st.textContent = '#nk{position:fixed;left:12px;bottom:12px;z-index:2147482999;display:flex;gap:8px}' +
      '#nk a{display:inline-grid;place-items:center;width:48px;height:48px;border-radius:50%;background:#0e7c4a;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.22);text-decoration:none}' +
      '#nk a:focus-visible{outline:3px solid #ffd43b;outline-offset:2px}#nk svg{width:24px;height:24px}' +
      '@media print{#nk{display:none}}body{padding-bottom:max(76px,env(safe-area-inset-bottom))}';
    document.head.appendChild(st);
    var n = document.createElement('nav'); n.id = 'nk'; n.setAttribute('aria-label', W[0] + ' / ' + W[1]);
    var i = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    n.innerHTML = '<a href="' + thuis + '" class="terug" aria-label="' + W[1] + '" title="' + W[1] + '">' + i + '<path d="M15 18l-6-6 6-6"/></svg></a>' +
      '<a href="' + thuis + '" aria-label="' + W[0] + '" title="' + W[0] + '">' + i + '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg></a>';
    document.body.appendChild(n);
    n.querySelector('.terug').addEventListener('click', function (e) {
      var vanHier = false; try { vanHier = document.referrer && new URL(document.referrer).origin === location.origin; } catch (x) {}
      if (vanHier && history.length > 1) { e.preventDefault(); history.back(); }
    });
    document.documentElement.classList.add('met-navknoppen');
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

/* Installeer-als-app balk. Werkt op Android/Chrome/Edge (knop) en iPhone/iPad Safari (uitleg). */
(function () {
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) return;
  if (document.getElementById('installeer')) return; /* site heeft al een eigen installeerbalk */
  var KEY = 'installbalk-weg';
  var T = {
    nl: ['Installeer als app', 'Gratis, sneller en direct op je beginscherm.', 'Installeren', 'Zet deze app op je beginscherm', 'Tik op %d <b style="display:inline">Deel</b> en kies <b style="display:inline">Zet op beginscherm</b>.', 'Sluiten'],
    en: ['Install as an app', 'Free, faster and right on your home screen.', 'Install', 'Add this app to your home screen', 'Tap %d <b style="display:inline">Share</b> and choose <b style="display:inline">Add to Home Screen</b>.', 'Close'],
    de: ['Als App installieren', 'Kostenlos, schneller und direkt auf dem Startbildschirm.', 'Installieren', 'App zum Home-Bildschirm hinzufügen', 'Tippe auf %d <b style="display:inline">Teilen</b> und wähle <b style="display:inline">Zum Home-Bildschirm</b>.', 'Schließen'],
    fr: ['Installer comme application', 'Gratuit, plus rapide et directement sur votre écran d’accueil.', 'Installer', 'Ajoutez cette app à l’écran d’accueil', 'Touchez %d <b style="display:inline">Partager</b> puis <b style="display:inline">Sur l’écran d’accueil</b>.', 'Fermer'],
    es: ['Instalar como app', 'Gratis, más rápida y en tu pantalla de inicio.', 'Instalar', 'Añade esta app a tu pantalla de inicio', 'Toca %d <b style="display:inline">Compartir</b> y elige <b style="display:inline">Añadir a pantalla de inicio</b>.', 'Cerrar'],
    it: ['Installa come app', 'Gratis, più veloce e direttamente nella schermata Home.', 'Installa', 'Aggiungi questa app alla schermata Home', 'Tocca %d <b style="display:inline">Condividi</b> e scegli <b style="display:inline">Aggiungi alla schermata Home</b>.', 'Chiudi'],
    pl: ['Zainstaluj jako aplikację', 'Za darmo, szybciej i prosto z ekranu głównego.', 'Zainstaluj', 'Dodaj tę aplikację do ekranu głównego', 'Stuknij %d <b style="display:inline">Udostępnij</b> i wybierz <b style="display:inline">Do ekranu początkowego</b>.', 'Zamknij']
  };
  var L = T[((document.documentElement.lang || 'nl').slice(0, 2)).toLowerCase()] || T.en;
  try { var t = +localStorage.getItem(KEY); if (t && Date.now() - t < 7 * 864e5) return; } catch (e) {}

  var ua = navigator.userAgent || '';
  var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var iosSafari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  var uitgesteld = null, balk = null;

  var css = '#ib{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:520px;margin:0 auto;background:#fff;color:#1b2a22;' +
    'border:2px solid #0e7c4a;border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:12px 44px 12px 12px;display:flex;gap:12px;align-items:center;' +
    'font:15px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    '#ib img{width:44px;height:44px;border-radius:10px;flex:none}#ib b{display:block;font-size:16px}#ib .t{flex:1;min-width:0}' +
    '#ib button.k{flex:none;background:#0e7c4a;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:700 15px system-ui,sans-serif;cursor:pointer}' +
    '#ib button.x{position:absolute;top:6px;right:6px;width:32px;height:32px;border:0;background:none;font-size:22px;line-height:1;color:#5b6b62;cursor:pointer}' +
    '#ib .d{display:inline-block;vertical-align:-3px;width:18px;height:18px}' +
    '.met-navknoppen #ib{bottom:72px}@media (prefers-color-scheme:dark){#ib{background:#16211b;color:#e8f1ec}#ib button.x{color:#a9b8b0}}';

  function icoon() {
    var l = document.querySelector('link[rel="apple-touch-icon"]') || document.querySelector('link[rel~="icon"]');
    return l ? l.href : '';
  }
  function sluit(onthoud) {
    if (balk) { balk.remove(); balk = null; }
    if (onthoud) try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
  }
  function toon(tekst, knop) {
    if (balk) return;
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    balk = document.createElement('div'); balk.id = 'ib'; balk.setAttribute('role', 'dialog'); balk.setAttribute('aria-label', L[0]);
    var src = icoon();
    balk.innerHTML = (src ? '<img alt="" src="' + src + '">' : '') + '<div class="t">' + tekst + '</div>' +
      (knop ? '<button class="k" type="button">' + L[2] + '</button>' : '') + '<button class="x" type="button" aria-label="' + L[5] + '">&times;</button>';
    document.body.appendChild(balk);
    balk.querySelector('.x').onclick = function () { sluit(true); };
    if (knop) balk.querySelector('.k').onclick = function () {
      if (!uitgesteld) return;
      uitgesteld.prompt();
      uitgesteld.userChoice.then(function (k) { uitgesteld = null; sluit(k && k.outcome === 'dismissed'); }, function () { sluit(false); });
    };
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); uitgesteld = e;
    toon('<b>' + L[0] + '</b>' + L[1], true);
  });
  window.addEventListener('appinstalled', function () { sluit(true); });

  if (iosSafari) {
    var deel = '<svg class="d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
    var start = function () { setTimeout(function () { toon('<b>' + L[3] + '</b>' + L[4].replace('%d', deel), false); }, 1500); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
