/** Utilidades compartilhadas pelo seletor e pelo mosaico. */

export const padId = (id) =>
  /^\d+$/.test(String(id)) ? String(id).padStart(6, '0') : String(id || '');

export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** "ESTR. DO TINGUI X R. CASA NOVA - FIXA" -> "Estr. do Tinguí x R. Casa Nova" */
export function prettyName(nome) {
  const base = String(nome || '')
    .replace(/\s*-\s*(BRT|FIXA)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const small = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'x']);
  return base
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtKm = (km) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;

/** Deduplica cameras que estao no mesmo ponto com o mesmo nome. */
export function groupCameras(list) {
  const groups = [];
  const byKey = new Map();
  for (const cam of list) {
    const key =
      norm(cam.nome) +
      '|' +
      Number(cam.lat).toFixed(4) +
      '|' +
      Number(cam.lon).toFixed(4);
    let g = byKey.get(key);
    if (!g) {
      g = { rep: cam, items: [cam] };
      byKey.set(key, g);
      groups.push(g);
    } else {
      g.items.push(cam);
    }
  }
  return groups;
}

export async function getConfig() {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error('Falha ao ler a configuracao');
  return r.json();
}

export async function putConfig(cfg) {
  const r = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!r.ok) throw new Error('Falha ao salvar a configuracao');
  return r.json();
}

let camerasPromise = null;
export function getCameras(force = false) {
  if (force) camerasPromise = null;
  if (!camerasPromise) {
    camerasPromise = fetch('/api/cameras' + (force ? '?refresh=1' : ''))
      .then((r) => {
        if (!r.ok) throw new Error('Falha ao buscar cameras');
        return r.json();
      })
      .catch((e) => {
        camerasPromise = null;
        throw e;
      });
  }
  return camerasPromise;
}

/* ---- ciclo de vida: encerra o servico quando a pagina fecha ---- */

/*
 * O app portatil roda sem janela de console, entao a propria pagina
 * avisa que esta viva. Fechou a ultima aba -> o processo termina.
 *
 * Em segundo plano o navegador estrangula temporizadores (1 por
 * minuto), por isso o intervalo escondido e maior.
 */

const CLIENT_ID =
  (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);

const ALIVE_VISIBLE_MS = 5000;
const ALIVE_HIDDEN_MS = 25000;

let aliveTimer = null;

function ping() {
  fetch('/api/alive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: CLIENT_ID }),
    keepalive: true,
  }).catch(() => {});
}

function schedulePing() {
  clearTimeout(aliveTimer);
  aliveTimer = setTimeout(
    () => {
      ping();
      schedulePing();
    },
    document.visibilityState === 'hidden' ? ALIVE_HIDDEN_MS : ALIVE_VISIBLE_MS
  );
}

export function startKeepAlive() {
  ping();
  schedulePing();

  document.addEventListener('visibilitychange', () => {
    // Nao manda ping ao ficar escondida: ao navegar/sair o navegador
    // dispara visibilitychange e pagehide quase juntos, e o ping atrasado
    // chegaria depois do adeus.
    if (document.visibilityState === 'visible') ping();
    schedulePing();
  });

  addEventListener('pagehide', () => {
    clearTimeout(aliveTimer);
    const body = JSON.stringify({ id: CLIENT_ID });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/bye', body);
    else fetch('/api/bye', { method: 'POST', body, keepalive: true }).catch(() => {});
  });
}

/* ---- codec ---- */

const HEVC_STORE = 'ms-windows-store://pdp/?ProductId=9NMZLZ57R3T7';

/** O COR so entrega H.265: sem decodificador o video nunca aparece. */
export function supportsH265() {
  try {
    const caps = globalThis.RTCRtpReceiver?.getCapabilities?.('video');
    if (!caps || !Array.isArray(caps.codecs)) return true;
    return caps.codecs.some((c) => /H265|HEVC/i.test(c.mimeType || ''));
  } catch {
    return true;
  }
}

/** Faixa de aviso quando o navegador nao decodifica H.265. */
export function warnIfNoH265() {
  if (supportsH265()) return false;

  const bar = document.createElement('div');
  bar.className = 'codec-warn';

  const text = document.createElement('span');
  text.textContent =
    'Este navegador não decodifica H.265, o único formato das câmeras do COR. ' +
    'Use o Chrome ou o Edge no Windows com a extensão HEVC instalada.';

  const store = document.createElement('a');
  store.href = HEVC_STORE;
  store.textContent = 'Instalar HEVC';

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Fechar aviso';
  close.addEventListener('click', () => bar.remove());

  bar.append(text, store, close);
  document.body.prepend(bar);
  return true;
}

/* ---- status dos testes (localStorage) ---- */

const STATUS_KEY = 'mosaico.status.v1';

export function readStatus() {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeStatus(map) {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(map));
  } catch {
    /* ignora */
  }
}
