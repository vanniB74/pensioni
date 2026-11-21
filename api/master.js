'use strict';

/**
 * MOCK MASTER — backend simbolico per test del widget.
 *
 * In produzione questo file NON esiste: il gate parla con un Master vero.
 * Qui Implementa:
 *   GET  ?endpoint=slots&date=YYYY-MM-DD&service=KEY     → lista orari disponibili
 *   GET  ?endpoint=services&service=KEY                  → servizio + figli
 *   POST ?endpoint=bookings                              → prenotazione atomica
 *
 * Atomicità slot: Map globale in-memory keyed da `service|consultant|date|time`.
 * Su stesso key: il primo POST → 201, il secondo → 409.
 * Idempotency-Key: se stessi payload + stessa key → stessa risposta cached.
 *
 * Verifica firma HMAC del gate: header `x-master-sig: hmac-sha256=<hex>`
 * calcolato su `${timestamp}\n${method}\n${path}\n${body}` con GATE_SECRET.
 * Rifiuta (>1000s di skew o firma non匹配) con 401.
 *
 * Variabili env:
 *   GATE_SECRET  — chiave HMAC condivisa col gate (default dev)
 */

const crypto = require('crypto');

const GATE_SECRET = process.env.GATE_SECRET || 'dev-shared-secret-do-not-use-in-prod';
const TIME_SKEW_SECONDS = 120;

// Stato in-memory. Vercel serverless: ogni istanza ha il suo stato.
// Per i test va bene: istanze nella stessa region sono coerenti per breve tempo.
const slotsBooked = globalThis.__csiSlotsBooked || (globalThis.__csiSlotsBooked = new Map());
const idemCache = globalThis.__csiIdemCache || (globalThis.__csiIdemCache = new Map());

// Catalogo servizi (mock CRM). Ogni servizio può avere figli (sottoservizi).
const SERVICES = {
  'ricalcolo-pensione': {
    key: 'ricalcolo-pensione',
    label: 'Ricalcolo pensione INPS',
    areas: ['INPS', 'INPDAP', 'ENPALS', 'ex Gestioni separate', 'prestazioni accessorie'],
    consultant: 'patronato-csi-bari',
    children: [
      { key: 'ricalcolo-pensione-standard', label: 'Ricalcolo standard' },
      { key: 'ricalcolo-pensione-anzianita', label: 'Ricalcolo per anzianità' },
      { key: 'ricalcolo-pensione-reversibilita', label: 'Reversibilità e superstiti' }
    ]
  },
  'spid-attivazione': {
    key: 'spid-attivazione',
    label: 'Attivazione SPID',
    areas: ['SPID', 'identità digitale', 'firma digitale'],
    consultant: 'sportello-spid-bari',
    children: [
      { key: 'spid-nuova', label: 'Prima attivazione SPID' },
      { key: 'spid-rinnovo', label: 'Rinnovo o recupero credenziali' }
    ]
  },
  'utenze-luce-gas': {
    key: 'utenze-luce-gas',
    label: 'Contratti luce e gas',
    areas: ['luce', 'gas', 'telefono', 'assistenza bollette'],
    consultant: 'sportello-utenze-bari',
    children: [
      { key: 'utenze-nuova-fornitura', label: 'Nuova fornitura' },
      { key: 'utenze-cambio-fornitore', label: 'Cambio fornitore' },
      { key: 'utenze-contestazione', label: 'Contestazione bollette' }
    ]
  }
};

function slotsForDay(dateStr, serviceKey) {
  // Slot fissi: 09:00, 11:00, 14:00, 16:00 — 30 min cad.
  // Disponibilità reale sarebbe dal CRM; qui mock fisso per test deterministici.
  const base = ['09:00', '09:30', '11:00', '11:30', '14:00', '14:30', '16:00', '16:30'];
  const svc = SERVICES[serviceKey];
  const consultant = svc ? svc.consultant : 'default';
  const out = base.map(function (t) {
    const key = [serviceKey, consultant, dateStr, t].join('|');
    return { time: t, available: !slotsBooked.has(key), consultant: consultant };
  });
  return out;
}

function verifySignature(req) {
  const sig = (req.headers['x-master-sig'] || '').trim();
  const ts = String(req.headers['x-master-ts'] || '');
  if (!sig || !ts) return { ok: false, code: 'missing_signature' };
  const now = Math.floor(Date.now() / 1000);
  const then = Number(ts);
  if (!Number.isFinite(then) || Math.abs(now - then) > TIME_SKEW_SECONDS) {
    return { ok: false, code: 'timestamp_skew' };
  }
  const method = (req.method || 'GET').toUpperCase();
  // Canonical include path+query (must match gate signing)
  const u = new URL(req.url || '/', 'http://x');
  const path = u.pathname + (u.search || '');
  let body;
  if (req.body === undefined || req.body === null || req.body === '') body = '';
  else if (typeof req.body === 'string') body = req.body;
  else body = JSON.stringify(req.body);
  const canonical = [ts, method, path, body].join('\n');
  const expected = crypto.createHmac('sha256', GATE_SECRET).update(canonical).digest('hex');
  // Constant-time compare
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig.replace(/^hmac-sha256[:=]/, ''), 'hex');
  if (a.length !== b.length) return { ok: false, code: 'sig_length' };
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? { ok: true } : { ok: false, code: 'sig_mismatch' };
}

function jsonBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { return JSON.parse(b || '{}'); } catch (e) { return {}; }
  }
  return b || {};
}

function makeRef() {
  return 'PR-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-master-sig, x-master-ts');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const url = new URL(req.url || '/', 'http://x');
  const params = url.searchParams;
  const endpoint = params.get('endpoint') || '';
  const auth = verifySignature(req);

  if (!auth.ok) {
    res.status(401).json({ error: 'unauthorized', code: auth.code });
    return;
  }

  // ---------- SERVICES ----------
  if (endpoint === 'services') {
    const sk = params.get('service') || '';
    const svc = SERVICES[sk];
    if (!svc) { res.status(404).json({ error: 'service_not_found' }); return; }
    res.status(200).json({ service: svc });
    return;
  }

  // ---------- SLOTS ----------
  if (endpoint === 'slots') {
    const date = params.get('date');
    const serviceKey = params.get('service');
    if (!date || !serviceKey) {
      res.status(400).json({ error: 'missing_params' });
      return;
    }
    res.status(200).json({
      date: date,
      service: serviceKey,
      timezone: 'Europe/Rome',
      slots: slotsForDay(date, serviceKey)
    });
    return;
  }

  // ---------- BOOKINGS (POST atomica) ----------
  if (endpoint === 'bookings' && req.method === 'POST') {
    const body = jsonBody(req);
    const idemKey = String(req.headers['x-idempotency-key'] || '');
    if (!idemKey) {
      res.status(400).json({ error: 'missing_idempotency_key' });
      return;
    }

    // Idempotency: stessa key + stesso payload → cached
    const cached = idemCache.get(idemKey);
    if (cached && JSON.stringify(cached.req) === JSON.stringify(body)) {
      res.status(cached.status).json(cached.res);
      return;
    }
    // Idempotency: stessa key + payload diverso → 422 (idempotency mismatch)
    if (cached && JSON.stringify(cached.req) !== JSON.stringify(body)) {
      res.status(422).json({ error: 'idempotency_mismatch' });
      return;
    }

    const serviceKey = body.service;
    const date = body.date;
    const time = body.time;
    const svc = SERVICES[serviceKey];
    if (!svc || !date || !time) {
      res.status(400).json({ error: 'bad_payload' });
      return;
    }
    const consultant = svc.consultant;
    const slotKey = [serviceKey, consultant, date, time].join('|');

    if (slotsBooked.has(slotKey)) {
      const conflict = {
        error: 'slot_conflict',
        code: 409,
        message: 'Lo slot non è più disponibile. Seleziona un altro orario.',
        slot: { date: date, time: time, consultant: consultant },
        available_slots: slotsForDay(date, serviceKey)
      };
      idemCache.set(idemKey, { req: body, status: 409, res: conflict });
      res.status(409).json(conflict);
      return;
    }

    // Prenota atomicamente
    slotsBooked.set(slotKey, {
      bookedAt: new Date().toISOString(),
      ref: makeRef(),
      idempotencyKey: idemKey
    });
    const booked = slotsBooked.get(slotKey);
    const ref = booked.ref;
    const payload = {
      ok: true,
      ref: ref,
      service: serviceKey,
      serviceLabel: svc.label,
      consultant: consultant,
      date: date,
      time: time,
      timezone: 'Europe/Rome',
      status: 'confirmed',
      created_at: booked.bookedAt
    };
    idemCache.set(idemKey, { req: body, status: 201, res: payload });
    res.status(201).json(payload);
    return;
  }

  // ---------- BOOKINGS (GET lista — solo per debug) ----------
  if (endpoint === 'bookings' && req.method === 'GET') {
    res.status(200).json({
      booked: Array.from(slotsBooked.entries()).map(function (e) {
        return { slot: e[0], ref: e[1].ref, bookedAt: e[1].bookedAt };
      })
    });
    return;
  }

  res.status(404).json({ error: 'endpoint_not_found', endpoint: endpoint });
};
