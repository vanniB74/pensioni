/* ==========================================================================
   CSI Widget Host — snippet di embedding per le landing.
   - Carica l'iframe non bloccante (loading="lazy", async).
   - Bridge postMessage iframe ↔ parent: resize, navigate, dataLayer, booking:*.
   - Riemette i booking:* come CustomEvent sul document della landing.
   - Relay dataLayer (sanitizzato dal widget).
   Uso:
   <iframe id="csi-booking-widget"
           src="https://.../widget.html?service=ricalcolo-pensione&origin=https://landing.it"
           title="Prenota appuntamento"
           loading="lazy"
           style="width:100%;height:760px;border:0"
           referrerpolicy="no-referrer-when-downgrade"></iframe>
   <script src="https://.../assets/js/widget-host.js" async defer></script>
   ========================================================================== */

(function () {
  'use strict';

  var IFRAME_SELECTOR = 'iframe#csi-booking-widget, iframe[data-csi-widget]';
  var PARENT_ORIGIN = location.origin;

  function findIframes() {
    return Array.prototype.slice.call(document.querySelectorAll(IFRAME_SELECTOR));
  }

  function bind(iframe) {
    if (iframe.__csiHostBound) return;
    iframe.__csiHostBound = true;

    // Garantisce a11y + non-bloccante
    if (!iframe.getAttribute('title')) iframe.setAttribute('title', 'Prenota appuntamento — C.S.I.');
    iframe.setAttribute('loading', iframe.getAttribute('loading') || 'lazy');
    iframe.style.border = iframe.style.border || '0';
    iframe.style.width = iframe.style.width || '100%';

    // Altezza iniziale bassa → cresce dopo postMessage (no layout shift粗暴)
    if (!iframe.style.height || iframe.style.height === '0px') {
      iframe.style.height = '720px';
    }

    // Passa origin alla iframe via query string
    try {
      var src = iframe.getAttribute('src') || '';
      if (src && src.indexOf('origin=') === -1) {
        var sep = src.indexOf('?') === -1 ? '?' : '&';
        iframe.setAttribute('src', src + sep + 'origin=' + encodeURIComponent(PARENT_ORIGIN));
      }
    } catch (e) { /* cross-origin read blocked */ }

    // Bridge messaggi
    window.addEventListener('message', function (ev) {
      if (ev.source !== iframe.contentWindow) return;
      var msg = ev.data || {};
      if (typeof msg !== 'object') return;

      if (msg.type === 'resize' && typeof msg.height === 'number') {
        // Imposta altezza con piccolo buffer per evitare scrollbar
        iframe.style.height = Math.max(560, msg.height + 24) + 'px';
      } else if (msg.type === 'navigate' && msg.target) {
        // Top-level navigation (torna alla home)
        try { location.href = msg.target; } catch (e) {}
      } else if (msg.type === 'dataLayer' && msg.payload) {
        // Relay: dataLayer sanitizzato dal widget
        try {
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push(msg.payload);
        } catch (e) {}
      } else if (msg.type === 'booking' && msg.event) {
        // Re-emit come CustomEvent sul document della landing
        try {
          var ev2 = new CustomEvent(msg.event, { detail: msg.detail || {}, bubbles: true });
          document.dispatchEvent(ev2);
        } catch (e) {}
      }
    });
  }

  function init() {
    findIframes().forEach(bind);
    // Osserva iframe aggiunti dinamicamente (single-page)
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes && Array.prototype.forEach.call(m.addedNodes, function (n) {
            if (n && n.nodeType === 1) {
              if (n.matches && n.matches(IFRAME_SELECTOR)) bind(n);
              if (n.querySelectorAll) {
                Array.prototype.forEach.call(n.querySelectorAll(IFRAME_SELECTOR), bind);
              }
            }
          });
        });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pubblica minima
  window.CSIWidgetHost = {
    version: '1.0.0',
    bindAll: init
  };
})();
