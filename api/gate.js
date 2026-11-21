'use strict';

/**
 * GATE — proxy serverless tra widget (browser) e Master.
 *
 * Il widget NON contiene segreti: chiama /api/gate con JSON body.
 * Il gate firma la richiesta con HMAC-SHA256 usando GATE_SECRET e la
 * inoltra a MASTER_URL. Restituisce al widget solo la risposta del Master.
 *
 * Endpoint widget:
 *   POST /api/gate  body: { endpoint, method, query, body }
 *
 * Headers inoltrati dal widget al gate:
 *   x-idempotency-key  → passato al Master
 *
 * Header generati dal gate:
 *   x-master-sig  = "hmac-sha256:hex"  su canonical = `${ts}\n${method}\n${path}\n${body}`
 *   x-master-ts   = unix seconds
 *
 * Env:
 *   CSI_HMAC_SECRET — chiave HMAC condivisa col Master (REQUIRED in produzione)
 *   MASTER_URL      — base URL del Master (default /api/master stesso progetto)
 */

const crypto = require('crypto');

const GATE_SECRET = process.env.CSI_HMAC_SECRET || process.env.GATE_SECRET || '';
const MASTER_URL = process.env.MASTER_URL || ''; // vuoto = /api/master nello stesso progetto

function sign(ts, method, path, body) {
  const canonical = [ts, method, path, body].join('\n');
  return 'hmac-sha256:' + crypto.createHmac('sha256', GATE_SECRET).update(canonical).digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-idempotency-key');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  if (!GATE_SECRET) {
    res.status(503).json({
      error: 'gate_not_configured',
      message: 'CSI_HMAC_SECRET env var non impostata. Il gate non può firmare.'
    });
    return;
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload || '{}'); } catch (e) { payload = {}; }
  }
  payload = payload || {};

  const endpoint = String(payload.endpoint || '');
  const method = String(payload.method || 'GET').toUpperCase();
  const query = payload.query || {};
  const bodyStr = payload.body ? JSON.stringify(payload.body) : '';

  if (!endpoint) {
    res.status(400).json({ error: 'missing_endpoint' });
    return;
  }

  // Costruisce URL target
  const qs = new URLSearchParams(query).toString();
  const targetPath = '/api/master?endpoint=' + encodeURIComponent(endpoint) + (qs ? '&' + qs : '');

  let targetUrl;
  if (MASTER_URL) {
    targetUrl = MASTER_URL.replace(/\/$/, '') + targetPath;
  } else {
    // stesso progetto: il gate e master sono entrambi funzioni Vercel
    // Risolve via X-Forwarded-Host o Vercel URL
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || 'csi-pensioni-roan.vercel.app';
    targetUrl = proto + '://' + host + targetPath;
  }

  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(ts, method, targetPath, bodyStr);

  const forwardHeaders = {
    'Content-Type': 'application/json',
    'x-master-sig': sig,
    'x-master-ts': ts
  };
  // Idempotency-Key passa dal widget → master
  const idemKey = req.headers['x-idempotency-key'];
  if (idemKey) forwardHeaders['x-idempotency-key'] = String(idemKey);

  try {
    const r = await fetch(targetUrl, {
      method: method,
      headers: forwardHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : bodyStr
    });

    const respText = await r.text();
    let respJson = null;
    try { respJson = JSON.parse(respText); } catch (e) { /* testo non-JSON */ }

    res.status(r.status);
    // Propaga header rilevanti
    const cacheControl = r.headers.get('cache-control');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);
    if (respJson !== null) {
      res.json(respJson);
    } else {
      res.setHeader('Content-Type', r.headers.get('content-type') || 'text/plain');
      res.send(respText);
    }
  } catch (err) {
    console.error('gate_forward_failed', err && err.message);
    res.status(502).json({ error: 'gate_forward_failed', detail: String(err && err.message || err) });
  }
};
