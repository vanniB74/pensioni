/* ==========================================================================
   CSI Booking Widget — logica centralizzata
   Embeddabile via iframe con ?service=<service-key>
   Parlante: /api/gate (che firma verso Master).
   Nessun segreto in questo file.
   ========================================================================== */

(function () {
  'use strict';

  // ---------- Bootstrap ----------
  var WIDGET_VERSION = '1.0.0';
  var GATE_URL = '/api/gate'; // relativo al deployment corrente

  // Servizio di riferimento dalla URL (landing-specifico)
  var urlParams = new URLSearchParams(location.search);
  var SERVICE_KEY = urlParams.get('service') || '';
  var PARENT_ORIGIN = urlParams.get('origin') || '*';

  // Attribution: cattura SOLO post-consenso cookie.
  // Qui salviamo grezzi in sessionStorage in attesa del consenso.
  var ATTR_KEY = 'csi.attr.v1';
  var CONSENT_KEY = 'csi.consent.v1';

  function captureAttribution() {
    // Non invia mai nulla fuori — solo persistenza locale in attesa di consenso
    try {
      var p = new URLSearchParams(location.search);
      var attr = {};
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(function (k) {
        if (p.get(k)) attr[k] = p.get(k);
      });
      attr.referrer = document.referrer || '';
      attr.landing_path = location.pathname;
      attr.landing_href = location.href;
      // Non salvare se non c'è nulla di utile
      if (Object.keys(attr).length > 2) {
        sessionStorage.setItem(ATTR_KEY, JSON.stringify(attr));
      }
    } catch (e) { /* sessionStorage non disponibile in qualche contesto */ }
  }
  captureAttribution();

  function hasConsent() {
    try { return sessionStorage.getItem(CONSENT_KEY) === 'granted'; } catch (e) { return false; }
  }
  function grantConsent() {
    try { sessionStorage.setItem(CONSENT_KEY, 'granted'); } catch (e) {}
  }
  function getAttribution() {
    if (!hasConsent()) return {};
    try { return JSON.parse(sessionStorage.getItem(ATTR_KEY) || '{}'); } catch (e) { return {}; }
  }

  // dataLayer sanitizzato: nessun dato personale
  function pushDataLayer(event, payload) {
    try {
      window.dataLayer = window.dataLayer || [];
      // Sanity check: nessuna chiave sospetta PII
      var SAFE_KEYS = ['event','service','service_label','consultant','practice_ref','date','time','timezone','step','widget_version','attribution_source'];
      var clean = {};
      Object.keys(payload || {}).forEach(function (k) {
        if (SAFE_KEYS.indexOf(k) > -1) clean[k] = payload[k];
      });
      clean.event = event;
      clean.widget_version = WIDGET_VERSION;
      window.dataLayer.push(clean);
      // postMessage verso parent (host script deciderà se relay)
      postToParent({ type: 'dataLayer', payload: clean });
    } catch (e) { /* no-op */ }
  }

  function postToParent(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, PARENT_ORIGIN);
      }
    } catch (e) {}
  }

  function emitDom(name, detail) {
    try {
      var ev = new CustomEvent(name, { detail: detail || {}, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      postToParent({ type: 'booking', event: name, detail: detail || {} });
    } catch (e) {}
  }

  // ---------- Utility ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function itDate(d) {
    var dd = new Date(d);
    return String(dd.getDate()).padStart(2,'0') + '/' + pad(dd.getMonth()+1) + '/' + dd.getFullYear();
  }
  function itDateLong(d) {
    var months = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    var days = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    var dd = new Date(d);
    return days[dd.getDay()] + ' ' + dd.getDate() + ' ' + months[dd.getMonth()] + ' ' + dd.getFullYear();
  }

  // ---------- Validazione ----------
  var VALIDATORS = {
    email: function (v) {
      v = String(v || '').trim();
      if (!v) return { ok: false, msg: 'Email obbligatoria.' };
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return { ok: false, msg: 'Formato email non valido.' };
      return { ok: true };
    },
    prefix: function (v) {
      v = String(v || '').trim();
      if (!v) return { ok: false, msg: 'Prefisso obbligatorio.' };
      if (!/^\+\d{1,4}$/.test(v)) return { ok: false, msg: 'Prefisso: + e 1-4 cifre (es. +39).' };
      return { ok: true };
    },
    tel: function (v) {
      v = String(v || '').replace(/[\s\-().]/g, '');
      if (!v) return { ok: false, msg: 'Telefono obbligatorio.' };
      if (!/^\d{6,12}$/.test(v)) return { ok: false, msg: 'Telefono: 6-12 cifre.' };
      return { ok: true };
    },
    cf: function (v) {
      v = String(v || '').trim().toUpperCase();
      if (!v) return { ok: false, msg: 'Codice fiscale obbligatorio.' };
      if (!/^[A-Z0-9]{16}$/.test(v)) return { ok: false, msg: 'Codice fiscale: 16 caratteri.' };
      // Controllo formale carattere di controllo (semplificato, validità formato)
      return { ok: true };
    },
    iban: function (v) {
      v = String(v || '').replace(/\s+/g, '').toUpperCase();
      if (!v) return { ok: true, msg: 'IBAN facoltativo: compilalo ora o in sede.' }; // facoltativo
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return { ok: false, msg: 'IBAN: formato non valido (es. IT60X0542811101000000123456).' };
      // Checksum modulo 97 (ISO 13616)
      var rearr = v.slice(4) + v.slice(0,4);
      var num = '';
      for (var i = 0; i < rearr.length; i++) {
        var c = rearr[i];
        if (c >= 'A' && c <= 'Z') num += String(c.charCodeAt(0) - 55);
        else num += c;
      }
      // BigInt non disponibile ovunque: usa chunked mod
      var rem = 0;
      for (var j = 0; j < num.length; j++) {
        rem = (rem * 10 + Number(num[j])) % 97;
      }
      if (rem !== 1) return { ok: false, msg: 'IBAN: checksum non valido.' };
      return { ok: true };
    },
    nome: function (v) {
      v = String(v || '').trim();
      if (v.length < 3) return { ok: false, msg: 'Nome e cognome obbligatori (min 3 caratteri).' };
      return { ok: true };
    }
  };

  function validateField(name, value) {
    var v = VALIDATORS[name];
    return v ? v(value) : { ok: true };
  }

  function setFieldState(input, result) {
    if (!input) return;
    input.classList.remove('is-invalid', 'is-valid');
    var help = document.getElementById(input.getAttribute('aria-describedby'));
    if (help) help.classList.remove('is-error', 'is-ok');
    if (result.ok) {
      if (input.value && input.value.trim()) input.classList.add('is-valid');
      if (help && result.msg) {
        help.textContent = result.msg;
        help.classList.add('is-ok');
      }
      input.setAttribute('aria-invalid', 'false');
    } else {
      input.classList.add('is-invalid');
      if (help) {
        help.textContent = result.msg;
        help.classList.add('is-error');
      }
      input.setAttribute('aria-invalid', 'true');
    }
  }

  // ---------- Gate client ----------
  function gateCall(endpoint, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var query = opts.query || {};
    var body = opts.body;
    var idem = opts.idempotencyKey;
    var signal = opts.signal;

    // Idempotency-Key: una per tentativo. Ri-usata se lo stesso tentativo viene reinviato.
    if (method === 'POST' && !idem) {
      idem = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('idem-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    }

    var fetchOpts = {
      method: 'POST', // il gate è sempre POST
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        endpoint: endpoint,
        method: method,
        query: query,
        body: body || null
      })
    };
    if (idem) fetchOpts.headers['x-idempotency-key'] = idem;
    if (signal) fetchOpts.signal = signal;

    return fetch(GATE_URL, fetchOpts).then(function (r) {
      return r.json().then(function (json) {
        return { status: r.status, body: json, idempotencyKey: idem };
      });
    });
  }

  // ---------- Stato widget ----------
  var state = {
    step: 1,
    service: null,
    serviceChildren: [],
    selectedChild: null,
    selectedAreas: [],
    date: null,
    time: null,
    slots: [],
    slotsLoading: false,
    form: {
      nome: '', cf: '', doc: '', docDate: '', email: '', prefix: '+39', tel: '',
      iban: '', ibanLater: false
    },
    otp: { sent: false, verified: false, code: '', ref: '' },
    submitting: false,
    confirmedRef: null
  };

  // ---------- Service loading ----------
  function loadService() {
    if (!SERVICE_KEY) {
      showBanner('error', 'Servizio non specificato', 'Il widget richiede il parametro ?service= nella URL.');
      return;
    }
    gateCall('services', { query: { service: SERVICE_KEY } })
      .then(function (r) {
        if (r.status === 200 && r.body.service) {
          state.service = r.body.service;
          renderServiceInfo();
        } else {
          showBanner('error', 'Servizio non trovato', 'Il servizio "' + SERVICE_KEY + '" non è configurato.');
        }
      })
      .catch(function (err) {
        showBanner('error', 'Caricamento servizio', 'Verifica la connessione e riprova.');
      });
  }

  function renderServiceInfo() {
    var sub = $('#csi-service-sub');
    var title = $('#csi-widget-title');
    if (state.service) {
      if (title) title.textContent = state.service.label;
      if (sub) sub.textContent = 'Servizio di riferimento: ' + state.service.label;
      // Render figli (sottoservizi) — visibili solo nella landing di quel servizio
      var childrenWrap = $('#csi-children');
      if (childrenWrap && state.service.children && state.service.children.length) {
        childrenWrap.innerHTML = '';
        // Auto-seleziona il PRIMO sottoservizio di default (UX: l'utente non
        // deve per forza scegliere se va bene il default — pulsante Avanti resta
        // attivo appena sceglie data + slot)
        state.selectedChild = state.service.children[0].key;
        state.service.children.forEach(function (ch, idx) {
          var lbl = document.createElement('label');
          lbl.className = 'csi-area';
          var isFirst = idx === 0;
          lbl.innerHTML = '<input type="radio" name="csi-child" value="' + ch.key + '"' + (isFirst ? ' checked' : '') + '> <span>' + ch.label + '</span>';
          if (isFirst) lbl.classList.add('is-checked');
          lbl.addEventListener('change', function () {
            state.selectedChild = ch.key;
            $all('#csi-children .csi-area').forEach(function (c) { c.classList.remove('is-checked'); });
            lbl.classList.add('is-checked');
            // Bug fix: ricalcola stato pulsante Avanti altrimenti resta disabled
            updateStepNav();
          });
          childrenWrap.appendChild(lbl);
        });
      }
      // Render aree del mandato omnibus
      var areasWrap = $('#csi-areas');
      if (areasWrap && state.service.areas) {
        areasWrap.innerHTML = '';
        state.service.areas.forEach(function (a) {
          var lbl = document.createElement('label');
          lbl.className = 'csi-area';
          lbl.innerHTML = '<input type="checkbox" name="csi-area" value="' + a + '"> <span>' + a + '</span>';
          lbl.querySelector('input').addEventListener('change', function (e) {
            if (e.target.checked) {
              lbl.classList.add('is-checked');
              if (state.selectedAreas.indexOf(a) < 0) state.selectedAreas.push(a);
            } else {
              lbl.classList.remove('is-checked');
              var idx = state.selectedAreas.indexOf(a);
              if (idx >= 0) state.selectedAreas.splice(idx, 1);
            }
            // Bug fix: ricalcola stato pulsante Avanti altrimenti resta disabled
            updateStepNav();
          });
          areasWrap.appendChild(lbl);
        });
      }
    }
  }

  // ---------- Banner ----------
  function showBanner(type, title, body) {
    var b = $('#csi-banner');
    if (!b) return;
    b.className = 'csi-banner is-' + type;
    b.innerHTML = '<strong class="csi-banner-t">' + escapeHtml(title) + '</strong><span>' + escapeHtml(body) + '</span>';
    b.setAttribute('role', type === 'error' ? 'alert' : 'status');
    b.style.display = '';
  }
  function hideBanner() {
    var b = $('#csi-banner');
    if (b) b.style.display = 'none';
  }
  function escapeHtml(s) {
    return String(s||'').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  // ---------- Calendar ----------
  function renderCalendar(year, month) {
    var cal = $('#csi-cal-grid');
    if (!cal) return;
    cal.innerHTML = '';
    var first = new Date(year, month, 1);
    var startDay = (first.getDay() + 6) % 7; // lunedì=0
    var dim = new Date(year, month+1, 0).getDate();
    var today = new Date(); today.setHours(0,0,0,0);

    // Header giorni settimana
    ['lun','mar','mer','gio','ven','sab','dom'].forEach(function (d) {
      var dow = document.createElement('div');
      dow.className = 'csi-cal-dow';
      dow.textContent = d;
      cal.appendChild(dow);
    });

    // Spazi vuoti prima del giorno 1
    for (var i = 0; i < startDay; i++) {
      var blank = document.createElement('div');
      cal.appendChild(blank);
    }
    for (var day = 1; day <= dim; day++) {
      var dd = new Date(year, month, day);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'csi-cal-day';
      cell.textContent = day;
      if (dd.getDay() === 0) cell.classList.add('is-disabled'); // domenica chiusa
      if (dd < today) cell.classList.add('is-disabled');
      if (dd.getTime() === today.getTime()) cell.classList.add('is-today');
      if (state.date && dd.getTime() === state.date.getTime()) cell.classList.add('is-selected');
      if (!cell.classList.contains('is-disabled')) {
        cell.addEventListener('click', function () {
          state.date = new Date(year, month, Number(this.textContent));
          state.time = null;
          $all('.csi-cal-day').forEach(function (c) { c.classList.remove('is-selected'); });
          this.classList.add('is-selected');
          loadSlots();
        });
      }
      cal.appendChild(cell);
    }
    var title = $('#csi-cal-title');
    if (title) {
      var months = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
      title.textContent = months[month] + ' ' + year;
    }
  }

  // ---------- Slots ----------
  function loadSlots() {
    if (!state.date) return;
    var wrap = $('#csi-slots-wrap');
    if (!wrap) return;
    state.slotsLoading = true;
    // Skeleton
    var skel = document.createElement('div');
    skel.className = 'csi-skel';
    for (var i = 0; i < 6; i++) {
      var s = document.createElement('div');
      s.className = 'csi-skel-item';
      skel.appendChild(s);
    }
    wrap.innerHTML = '';
    wrap.appendChild(skel);
    var tz = document.createElement('div');
    tz.className = 'csi-tz';
    tz.textContent = 'Fuso orario: Europe/Rome (CET/CEST)';
    wrap.appendChild(tz);

    gateCall('slots', { query: { date: isoDate(state.date), service: SERVICE_KEY } })
      .then(function (r) {
        state.slotsLoading = false;
        if (r.status === 200 && r.body.slots) {
          state.slots = r.body.slots;
          renderSlots();
        } else {
          wrap.innerHTML = '<p class="csi-help is-error">Caricamento orari non riuscito. Riprova.</p>';
        }
      })
      .catch(function () {
        state.slotsLoading = false;
        wrap.innerHTML = '<p class="csi-help is-error">Caricamento orari non riuscito. Riprova.</p>';
      });
  }

  function renderSlots() {
    var wrap = $('#csi-slots-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!state.slots.length) {
      wrap.innerHTML = '<p class="csi-help">Nessun orario disponibile per questa data.</p>';
      return;
    }
    var grid = document.createElement('div');
    grid.className = 'csi-slots';
    state.slots.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'csi-slot';
      b.textContent = s.time;
      if (!s.available) b.classList.add('is-gone');
      if (state.time === s.time) b.classList.add('is-selected');
      b.addEventListener('click', function () {
        if (b.classList.contains('is-gone')) return;
        state.time = s.time;
        $all('.csi-slot', grid).forEach(function (c) { c.classList.remove('is-selected'); });
        b.classList.add('is-selected');
        updateStepNav();
      });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    var tz = document.createElement('div');
    tz.className = 'csi-tz';
    tz.textContent = 'Fuso orario: Europe/Rome (CET/CEST)';
    wrap.appendChild(tz);
  }

  // ---------- OTP ----------
  function sendOtp() {
    var email = state.form.email;
    var name = state.form.nome;
    if (!VALIDATORS.email(email).ok) return;
    fetch('/api/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', email: email, nome: name })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (r) {
      if (r.status === 200 && r.body.ok) {
        state.otp.sent = true;
        showBanner('info', 'Codice inviato', 'Controlla la tua email: il codice vale 10 minuti.');
        $('#csi-otp-wrap').style.display = '';
        var inp = $('#csi-otp-input');
        if (inp) inp.focus();
      } else {
        showBanner('error', 'Invio OTP fallito', (r.body && r.body.error) || 'Riprova tra poco.');
      }
    }).catch(function () {
      showBanner('error', 'Invio OTP fallito', 'Verifica la connessione.');
    });
  }

  function verifyOtp() {
    var code = ($('#csi-otp-input') || {}).value || '';
    code = String(code).replace(/\D/g, '');
    if (code.length !== 6) {
      showBanner('error', 'Codice OTP', 'Inserisci 6 cifre.');
      return;
    }
    fetch('/api/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', email: state.form.email, code: code })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (r) {
      if (r.status === 200 && r.body.ok) {
        state.otp.verified = true;
        state.otp.code = code;
        state.otp.ref = r.body.ref || '';
        showBanner('success', 'Firma verificata', 'Mandato firmato con codice OTP · rif. ' + state.otp.ref);
        $('#csi-otp-wrap').style.display = 'none';
        updateStepNav();
      } else {
        showBanner('error', 'Verifica OTP', (r.body && r.body.error) || 'Codice non valido.');
      }
    }).catch(function () {
      showBanner('error', 'Verifica OTP', 'Verifica la connessione.');
    });
  }

  // ---------- Step navigation ----------
  function goToStep(n) {
    state.step = n;
    $all('.csi-panel').forEach(function (p) { p.classList.remove('is-open'); });
    var panel = $('.csi-panel[data-step="' + n + '"]');
    if (panel) panel.classList.add('is-open');
    $all('.csi-step').forEach(function (s) {
      var n2 = Number(s.getAttribute('data-step-n'));
      s.classList.toggle('is-active', n2 === n);
      s.classList.toggle('is-done', n2 < n);
    });
    updateStepNav();
    var head = $('.csi-panel[data-step="' + n + '"] h2');
    if (head) head.focus();
    pushDataLayer('booking_step', { step: n, service: SERVICE_KEY });
    // Scroll into view su iframe piccolo
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function canAdvanceStep(n) {
    if (n === 1) {
      if (!state.date) return { ok: false, msg: 'Seleziona una data.' };
      if (!state.time) return { ok: false, msg: 'Seleziona un orario.' };
      if (state.service && state.service.children && state.service.children.length && !state.selectedChild) {
        return { ok: false, msg: 'Seleziona il sottoservizio di tuo interesse.' };
      }
      return { ok: true };
    }
    if (n === 2) {
      // Anagrafica — IBAN è facoltativo
      var fields = ['nome','cf','email','prefix','tel'];
      for (var i = 0; i < fields.length; i++) {
        var r = validateField(fields[i], state.form[fields[i]]);
        if (!r.ok) return { ok: false, msg: r.msg };
      }
      if (!state.form.ibanLater) {
        var ir = validateField('iban', state.form.iban);
        if (!ir.ok) return { ok: false, msg: ir.msg };
      }
      return { ok: true };
    }
    if (n === 3) {
      if (!state.selectedAreas.length) return { ok: false, msg: 'Seleziona almeno un\'area del mandato.' };
      if (!$('#csi-consent-privacy').checked) return { ok: false, msg: 'Devi accettare l\'informativa privacy.' };
      if (!$('#csi-consent-data').checked) return { ok: false, msg: 'Devi accettare il trattamento dei dati.' };
      if (!state.otp.verified) return { ok: false, msg: 'Verifica il codice OTP per firmare il mandato.' };
      return { ok: true };
    }
    return { ok: true };
  }

  function updateStepNav() {
    var prev = $('#csi-btn-prev');
    var prevMain = $('#csi-btn-prev-main');
    var next = $('#csi-btn-next');
    var submit = $('#csi-btn-submit');
    var hint = $('#csi-next-hint');
    // Back button visibility:
    //   - csi-btn-prev (dentro panel 4): visibile solo su step 4
    //   - csi-btn-prev-main (nav comune): visibile su step 2 e 3
    if (prev) prev.style.display = state.step === 4 ? '' : 'none';
    if (prevMain) prevMain.style.display = (state.step > 1 && state.step < 4) ? '' : 'none';
    if (next) next.style.display = state.step < 4 ? '' : 'none';
    if (submit) submit.style.display = state.step === 4 ? '' : 'none';
    var check = canAdvanceStep(state.step);
    if (next) next.disabled = !check.ok;
    if (submit) submit.disabled = !check.ok || state.submitting;
    // Hint dinamico: cosa manca per abilitare Avanti
    if (hint) {
      if (check.ok || state.step === 4) {
        hint.textContent = '';
        hint.style.display = 'none';
      } else {
        hint.textContent = 'Per continuare: ' + check.msg;
        hint.style.display = '';
      }
    }
  }

  // ---------- Submit ----------
  function submitBooking() {
    if (state.submitting) return; // idempotency client-side per doppio click
    var check = canAdvanceStep(4);
    if (!check.ok) {
      showBanner('error', 'Verifica i dati', check.msg);
      return;
    }
    state.submitting = true;
    var btn = $('#csi-btn-submit');
    if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
    hideBanner();

    var payload = {
      service: SERVICE_KEY,
      serviceChild: state.selectedChild,
      areas: state.selectedAreas,
      date: isoDate(state.date),
      time: state.time,
      anag: {
        nome: state.form.nome,
        cf: state.form.cf,
        email: state.form.email,
        prefix: state.form.prefix,
        tel: state.form.tel,
        iban: state.form.ibanLater ? '' : state.form.iban,
        iban_later: state.form.ibanLater,
        doc: state.form.doc,
        docDate: state.form.docDate
      },
      otp_ref: state.otp.ref,
      attribution: getAttribution()
    };

    var idem = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('idem-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    // Idempotency-Key salvata su sessionStorage: se l'utente clicca di nuovo
    // (doppio click), riusiamo la stessa key + payload → risposta cached dal Master.
    try { sessionStorage.setItem('csi.lastBooking.v1', JSON.stringify({ idem: idem, payload: payload })); } catch (e) {}

    gateCall('bookings', { method: 'POST', body: payload, idempotencyKey: idem })
      .then(function (r) {
        state.submitting = false;
        if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }

        if (r.status === 201 && r.body.ref) {
          state.confirmedRef = r.body.ref;
          showConfirmation(r.body);
          emitDom('booking:confirmed', { ref: r.body.ref, service: SERVICE_KEY, date: r.body.date, time: r.body.time });
          pushDataLayer('appointment_booked', {
            service: SERVICE_KEY,
            service_label: state.service ? state.service.label : SERVICE_KEY,
            practice_ref: r.body.ref,
            date: r.body.date,
            time: r.body.time,
            timezone: r.body.timezone,
            attribution_source: getAttribution().utm_source || 'direct'
          });
          try { sessionStorage.removeItem('csi.lastBooking.v1'); } catch (e) {}
        } else if (r.status === 409) {
          // Slot non più disponibile: NON azzerare i dati
          handleConflict(r.body);
        } else if (r.status === 0) {
          showBanner('error', 'Connessione assente', 'Verifica la rete e riprova. I tuoi dati sono intatti.');
          emitDom('booking:error', { code: 'network' });
        } else {
          showBanner('error', 'Prenotazione fallita', 'Errore ' + r.status + ': ' + ((r.body && r.body.error) || 'riprova.'));
          emitDom('booking:error', { code: r.status });
        }
      })
      .catch(function (err) {
        state.submitting = false;
        if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
        showBanner('error', 'Connessione assente', 'Verifica la rete e riprova. I tuoi dati sono intatti.');
        emitDom('booking:error', { code: 'network' });
      });
  }

  function handleConflict(body) {
    var msg = body && body.message ? body.message : 'Lo slot non è più disponibile.';
    showBanner('error', 'Slot non disponibile', msg + ' Scegli un altro orario qui sotto. I tuoi dati anagrafici e di contatto restano compilati.');
    emitDom('booking:conflict', { slot: body && body.slot });

    // Segna lo slot come esaurito nel rendering
    if (state.slots && state.slots.length) {
      state.slots = state.slots.map(function (s) {
        if (s.time === state.time) s.available = false;
        return s;
      });
    }
    state.time = null;
    renderSlots();
    // Ricarica anche gli slot freschi dal Master
    if (state.date) loadSlots();
    // Torna al passo 1 (calendario)
    goToStep(1);
  }

  function showConfirmation(body) {
    var panel = $('.csi-panel[data-step="4"]');
    if (!panel) return;
    var html = '<h2 tabindex="-1">Prenotazione confermata</h2>' +
      '<p class="csi-panel-sub">Ti aspettiamo. Codice pratica: <strong>' + escapeHtml(body.ref) + '</strong></p>' +
      '<div class="csi-banner is-success" role="status"><strong class="csi-banner-t">Conferma avvenuta</strong><span>' +
      escapeHtml(body.serviceLabel || state.service.label) + ' · ' + escapeHtml(itDateLong(body.date)) + ' alle ' + escapeHtml(body.time) + ' (Europe/Rome)' +
      '</span></div>' +
      '<div class="csi-summary"><dl>' +
      '<dt>Codice pratica</dt><dd>' + escapeHtml(body.ref) + '</dd>' +
      '<dt>Servizio</dt><dd>' + escapeHtml(body.serviceLabel || state.service.label) + '</dd>' +
      '<dt>Data</dt><dd>' + escapeHtml(itDateLong(body.date)) + '</dd>' +
      '<dt>Orario</dt><dd>' + escapeHtml(body.time) + ' (Europe/Rome)</dd>' +
      '<dt>Modalità</dt><dd>In sede · Ceglie del Campo (BA)</dd>' +
      '</dl></div>' +
      '<div class="csi-actions">' +
      '<button type="button" class="csi-btn" id="csi-btn-home">Torna alla home</button>' +
      '<button type="button" class="csi-btn csi-btn-secondary" id="csi-btn-change">Cambia data e ora</button>' +
      '<button type="button" class="csi-btn csi-btn-danger" id="csi-btn-cancel">Annulla appuntamento</button>' +
      '</div>' +
      '<div class="csi-modal" id="csi-change-modal" role="dialog" aria-modal="true" aria-labelledby="csi-modal-t">' +
        '<div class="csi-modal-card">' +
          '<h3 id="csi-modal-t">Cambia o annulla appuntamento</h3>' +
          '<p>Puoi modificare data e ora oppure annullare del tutto l\'appuntamento. ' +
          'Ti servirà il codice pratica <strong>' + escapeHtml(body.ref) + '</strong>.</p>' +
          '<div class="csi-modal-actions">' +
            '<button type="button" class="csi-btn csi-btn-secondary" data-close-modal="1">Chiudi</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    panel.innerHTML = html;
    goToStep(4);

    $('#csi-btn-home').addEventListener('click', function () {
      postToParent({ type: 'navigate', target: '/' });
    });
    $('#csi-btn-change').addEventListener('click', function () {
      // Resetta solo data/ora, preserva anagrafica
      state.date = null;
      state.time = null;
      goToStep(1);
    });
    $('#csi-btn-cancel').addEventListener('click', function () {
      // Demo: pop-up che spiega
      var modal = $('#csi-change-modal');
      if (modal) modal.classList.add('is-open');
    });
    $all('[data-close-modal]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#csi-change-modal').classList.remove('is-open');
      });
    });
  }

  // ---------- Init ----------
  function bindForm() {
    // Inputs anagrafica
    $all('[data-field]').forEach(function (input) {
      var f = input.getAttribute('data-field');
      input.addEventListener('input', function () {
        state.form[f] = input.value;
        if (input.value.length > 0) {
          var r = validateField(f, input.value);
          setFieldState(input, r);
        } else {
          input.classList.remove('is-invalid', 'is-valid');
        }
        updateStepNav();
      });
      input.addEventListener('blur', function () {
        if (input.value) setFieldState(input, validateField(f, input.value));
      });
    });

    // IBAN-later checkbox
    var ibanLater = $('#csi-iban-later');
    if (ibanLater) {
      ibanLater.addEventListener('change', function () {
        state.form.ibanLater = ibanLater.checked;
        var ibanInput = $('#csi-iban');
        if (ibanInput) {
          ibanInput.disabled = ibanLater.checked;
          if (ibanLater.checked) {
            ibanInput.classList.remove('is-invalid', 'is-valid');
          }
        }
        updateStepNav();
      });
    }

    // Consenso cookie (banner che appare all'avvio)
    var consentBtn = $('#csi-consent-btn');
    if (consentBtn) {
      consentBtn.addEventListener('click', function () {
        grantConsent();
        $('#csi-consent-banner').style.display = 'none';
      });
    }

    // Consensi privacy + trattamento dati (step 3) — ricalcola button Avanti
    var consentPrivacy = $('#csi-consent-privacy');
    var consentData = $('#csi-consent-data');
    if (consentPrivacy) consentPrivacy.addEventListener('change', updateStepNav);
    if (consentData) consentData.addEventListener('change', updateStepNav);

    // OTP
    var sendBtn = $('#csi-otp-send');
    if (sendBtn) sendBtn.addEventListener('click', sendOtp);
    var verifyBtn = $('#csi-otp-verify');
    if (verifyBtn) verifyBtn.addEventListener('click', verifyOtp);

    // Stepper clickable
    $all('.csi-step').forEach(function (s) {
      s.addEventListener('click', function () {
        var n = Number(s.getAttribute('data-step-n'));
        if (n < state.step) goToStep(n);
      });
    });

    // Nav
    var prev = $('#csi-btn-prev');
    if (prev) prev.addEventListener('click', function () {
      if (state.step > 1) goToStep(state.step - 1);
    });
    var next = $('#csi-btn-next');
    if (next) next.addEventListener('click', function () {
      var c = canAdvanceStep(state.step);
      if (c.ok) goToStep(state.step + 1);
      else showBanner('error', 'Verifica i dati', c.msg);
    });
    var submit = $('#csi-btn-submit');
    if (submit) submit.addEventListener('click', function (e) {
      e.preventDefault();
      submitBooking();
    });

    // Calendar nav
    var calPrev = $('#csi-cal-prev');
    var calNext = $('#csi-cal-next');
    var calNow = new Date();
    var calYear = calNow.getFullYear();
    var calMonth = calNow.getMonth();
    if (calPrev) calPrev.addEventListener('click', function () {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar(calYear, calMonth);
    });
    if (calNext) calNext.addEventListener('click', function () {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar(calYear, calMonth);
    });
    renderCalendar(calYear, calMonth);

    // Popup moduli scaricabili
    var formsBtn = $('#csi-open-forms');
    if (formsBtn) formsBtn.addEventListener('click', openFormsModal);

    // Esc su modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $all('.csi-modal.is-open').forEach(function (m) { m.classList.remove('is-open'); });
      }
    });
  }

  function openFormsModal() {
    var modal = $('#csi-forms-modal');
    if (!modal) return;
    modal.classList.add('is-open');

    var pdfBtn = $('#csi-pdf-mandato');
    if (pdfBtn && !pdfBtn.bound) {
      pdfBtn.bound = true;
      pdfBtn.addEventListener('click', function () {
        var data = {
          nome: state.form.nome,
          cf: state.form.cf,
          indirizzo: '',
          cap: '70129',
          residenza: 'Ceglie del Campo (BA)',
          dataNascita: '',
          luogoNascita: '',
          pratica: state.confirmedRef || 'BOZZA',
          ente: state.service ? state.service.label : SERVICE_KEY,
          firma: state.otp.verified ? { at: new Date().toISOString(), email: state.form.email, ref: state.otp.ref } : null
        };
        var f = document.createElement('form');
        f.method = 'POST';
        f.action = '/api/doc-pdf';
        f.style.display = 'none';
        var i1 = document.createElement('input'); i1.name = 'kind'; i1.value = 'mandato'; f.appendChild(i1);
        var i2 = document.createElement('input'); i2.name = 'data'; i2.value = JSON.stringify(data); f.appendChild(i2);
        document.body.appendChild(f);
        f.submit();
      });
    }

    var sendBtn = $('#csi-email-docs');
    if (sendBtn && !sendBtn.bound) {
      sendBtn.bound = true;
      sendBtn.addEventListener('click', function () {
        if (!state.form.email) { showBanner('error', 'Email mancante', 'Compila l\'email per ricevere i documenti.'); return; }
        var data = {
          nome: state.form.nome,
          cf: state.form.cf,
          cap: '70129',
          residenza: 'Ceglie del Campo (BA)',
          pratica: state.confirmedRef || 'BOZZA',
          ente: state.service ? state.service.label : SERVICE_KEY
        };
        fetch('/api/send-docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: state.form.email, kind: 'mandato', data: data })
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (j.ok) showBanner('success', 'Documenti inviati', 'Riceverai un\'email a breve.');
          else showBanner('error', 'Invio fallito', j.error || 'Riprova.');
        }).catch(function () {
          showBanner('error', 'Invio fallito', 'Verifica la connessione.');
        });
      });
    }
  }

  // ---------- Host events (resize + dataLayer relay) ----------
  function setupHostBridge() {
    // Notifica altezza al parent (per ridurre layout shift)
    function reportHeight() {
      var h = document.documentElement.scrollHeight;
      postToParent({ type: 'resize', height: h });
    }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { reportHeight(); });
      ro.observe(document.body);
    } else {
      window.addEventListener('load', reportHeight);
      window.addEventListener('resize', reportHeight);
    }
    setTimeout(reportHeight, 200);
    setTimeout(reportHeight, 1500);
  }

  // ---------- Boot ----------
  function init() {
    bindForm();
    setupHostBridge();
    loadService();
    goToStep(1);
    pushDataLayer('widget_ready', { service: SERVICE_KEY });

    // Auto-fill da lastBooking se esiste (doppio click recovery)
    try {
      var last = JSON.parse(sessionStorage.getItem('csi.lastBooking.v1') || 'null');
      if (last && last.payload) {
        // Non ri-usiamo automaticamente; però teniamo l'idempotency-key in caso
        // l'utente clicchi di nuovo submit (vedi submitBooking che genera nuova key)
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
