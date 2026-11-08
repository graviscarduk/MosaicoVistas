#!/usr/bin/env node
/**
 * Mosaico Vistas - servidor local.
 *
 * Por que existe: a API do COR exige o header Origin (same-origin) e nao
 * libera CORS, entao o navegador nao consegue falar com ela direto.
 * Este processo faz tres coisas:
 *   1. serve os arquivos de public/
 *   2. busca a lista de cameras e repassa a sinalizacao WebRTC (WHEP)
 *      injetando Origin/Referer
 *   3. guarda a configuracao em config.json
 *
 * A midia (video) NAO passa por aqui: o navegador conecta direto nos
 * servidores do COR via ICE/TURN.
 *
 * Uso: node server.mjs   (ou iniciar.cmd)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execFile } from 'node:child_process';
import os from 'node:os';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// Pasta de onde o app foi extraido pode ser somente leitura (Program Files,
// pendrive protegido). Nesse caso a configuracao vai para o perfil do usuario.
const CONFIG_FALLBACK = path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir(),
  'MosaicoCOR',
  'config.json'
);
let configFile = CONFIG_FILE;

const COR = 'https://appcor.cor-rio.work';
const LIST_URL = COR + '/api/cameras/?limit=0';
const PLAYER = COR + '/api/camera/player';

// Sem estes headers o COR responde 403 (exigencia desde 24/10/2026).
const COR_HEADERS = {
  Origin: COR,
  Referer: COR + '/',
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
};

const LIST_TTL_MS = 5 * 60 * 1000;
const MAX_BODY = 1024 * 1024;

const DEFAULT_CONFIG = {
  center: { lat: -22.9068, lon: -43.1729, label: 'Rio de Janeiro' },
  radiusKm: 1.5,
  layout: { cols: 2, rows: 2 },
  cameras: [],
};

let listCache = { at: 0, data: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  Configuracao                                                       */
/* ------------------------------------------------------------------ */

function sanitizeConfig(input) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  if (!input || typeof input !== 'object') return cfg;

  if (input.center && typeof input.center === 'object') {
    const lat = Number(input.center.lat);
    const lon = Number(input.center.lon);
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) cfg.center.lat = lat;
    if (Number.isFinite(lon) && lon >= -180 && lon <= 180) cfg.center.lon = lon;
    if (typeof input.center.label === 'string' && input.center.label.trim()) {
      cfg.center.label = input.center.label.trim().slice(0, 120);
    }
  }

  const radius = Number(input.radiusKm);
  if (Number.isFinite(radius)) cfg.radiusKm = Math.min(10, Math.max(0.1, radius));

  if (input.layout && typeof input.layout === 'object') {
    const cols = Number(input.layout.cols);
    const rows = Number(input.layout.rows);
    if (Number.isInteger(cols) && cols >= 1 && cols <= 4) cfg.layout.cols = cols;
    if (Number.isInteger(rows) && rows >= 1 && rows <= 4) cfg.layout.rows = rows;
  }

  if (Array.isArray(input.cameras)) {
    const seen = new Set();
    const cameras = [];
    for (const item of input.cameras) {
      if (!item || typeof item !== 'object') continue;
      const apiId = String(item.apiId ?? '').replace(/\D+/g, '').slice(0, 12);
      if (!apiId || seen.has(apiId)) continue;
      seen.add(apiId);
      const nome = typeof item.nome === 'string' ? item.nome.slice(0, 160) : '';
      cameras.push({ apiId, nome });
      if (cameras.length >= 16) break;
    }
    cfg.cameras = cameras;
  }

  return cfg;
}

async function loadConfig() {
  for (const file of [CONFIG_FILE, CONFIG_FALLBACK]) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      configFile = file;
      return sanitizeConfig(JSON.parse(raw));
    } catch {
      /* tenta o proximo */
    }
  }
  return structuredClone(DEFAULT_CONFIG);
}

async function saveConfig(cfg) {
  const clean = sanitizeConfig(cfg);
  const data = JSON.stringify(clean, null, 2) + '\n';

  const write = async (file) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, data, 'utf8');
    await fsp.rename(tmp, file);
  };

  try {
    await write(CONFIG_FILE);
    configFile = CONFIG_FILE;
  } catch {
    await write(CONFIG_FALLBACK);
    configFile = CONFIG_FALLBACK;
  }
  return clean;
}

/* ------------------------------------------------------------------ */
/*  API do COR                                                         */
/* ------------------------------------------------------------------ */

async function fetchCameras(force = false) {
  const fresh = listCache.data && Date.now() - listCache.at < LIST_TTL_MS;
  if (fresh && !force) return listCache.data;

  const data = await fetchPreferFull();
  if (!data.length) {
    if (listCache.data) return listCache.data; // mantem o ultimo bom
    throw new Error('Nao foi possivel obter a lista de cameras do COR');
  }
  listCache = { at: Date.now(), data };
  return data;
}

// A API alterna entre a versao completa (com cameraId) e uma "lite"
// (so coordenadas). Insistimos ate vir a completa.
async function fetchPreferFull(tries = 10) {
  let best = [];
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(LIST_URL, { headers: COR_HEADERS, cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        const arr = Array.isArray(j) ? j : j.cameras || [];
        if (arr.length >= best.length) best = arr;
        if (arr.some((c) => c && c.cameraId && c.apiId)) return arr;
      }
    } catch {
      /* tenta de novo */
    }
    await sleep(400);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Geocodificacao (buscar regiao por CEP / endereco)                  */
/* ------------------------------------------------------------------ */

/*
 * Nominatim (OpenStreetMap) e ViaCEP sao servicos publicos e gratuitos.
 * Eles pedem identificacao no User-Agent e no maximo 1 requisicao por
 * segundo, por isso guardamos as respostas em memoria por 10 minutos.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const VIACEP = 'https://viacep.com.br/ws';
const GEO_TTL_MS = 10 * 60 * 1000;
const GEO_UA = 'MosaicoCOR/1.0 (aplicativo local de uso pessoal)';

const geoCache = new Map();

function cacheGet(key) {
  const hit = geoCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > GEO_TTL_MS) {
    geoCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (geoCache.size > 300) geoCache.clear();
  geoCache.set(key, { at: Date.now(), value });
  return value;
}

async function geoJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': GEO_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Servico de mapas respondeu ${r.status}`);
  return r.json();
}

/** Busca livre: rua, bairro, ponto de referencia. */
async function geoSearch(q, limit = 6) {
  const key = `s:${q.toLowerCase()}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL(NOMINATIM + '/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'pt-BR');
  url.searchParams.set('countrycodes', 'br');

  const raw = await geoJson(url);
  const results = (Array.isArray(raw) ? raw : []).map((r) => ({
    label: String(r.display_name || '').replace(/, Brasil$/, ''),
    lat: Number(r.lat),
    lon: Number(r.lon),
    bbox: Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null,
    tipo: r.type || r.category || '',
  }));

  return cacheSet(key, results.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)));
}

/** CEP: o ViaCEP diz qual e o logradouro, o Nominatim diz onde ele fica. */
async function geoCep(cep) {
  const digits = String(cep).replace(/\D+/g, '');
  if (digits.length !== 8) throw new Error('CEP precisa ter 8 digitos');

  const key = `c:${digits}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const dados = await geoJson(`${VIACEP}/${digits}/json/`);
  if (!dados || dados.erro) return cacheSet(key, []);

  const partes = [dados.logradouro, dados.bairro, dados.localidade, dados.uf, 'Brasil']
    .filter(Boolean)
    .join(', ');

  const results = await geoSearch(partes, 8);
  if (!results.length) return cacheSet(key, []);

  // O Nominatim devolve varios trechos da mesma rua. O CEP de cada trecho
  // aparece no rotulo, entao escolhemos o numericamente mais proximo.
  const alvo = Number(digits);
  let melhor = results[0];
  let menorDistancia = Infinity;
  for (const r of results) {
    const m = /(\d{5})-?(\d{3})/.exec(r.label);
    if (!m) continue;
    const diff = Math.abs(Number(m[1] + m[2]) - alvo);
    if (diff < menorDistancia) {
      menorDistancia = diff;
      melhor = r;
    }
  }

  const rotulo = [dados.logradouro, dados.bairro, `${dados.localidade} - ${dados.uf}`]
    .filter(Boolean)
    .join(' · ');

  return cacheSet(key, [
    {
      ...melhor,
      label: `${rotulo} (CEP ${digits.slice(0, 5)}-${digits.slice(5)})`,
      cep: digits,
      aproximado: true,
    },
  ]);
}

/** Coordenada -> nome do lugar (para rotular o ponto escolhido). */
async function geoReverse(lat, lon) {
  const key = `r:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL(NOMINATIM + '/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('accept-language', 'pt-BR');
  url.searchParams.set('zoom', '16');

  try {
    const raw = await geoJson(url);
    const label = String(raw?.display_name || '').replace(/, Brasil$/, '');
    return cacheSet(key, label || null);
  } catch {
    return null;
  }
}

async function proxySignal(targetUrl, contentType, body, extraHeaders = {}) {
  const r = await fetch(targetUrl, {
    method: 'POST',
    headers: { ...COR_HEADERS, 'Content-Type': contentType, ...extraHeaders },
    body,
  });
  const text = await r.text();
  const headers = {
    'Content-Type': r.headers.get('content-type') || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  const link = r.headers.get('link');
  if (link) headers.Link = link;
  return { status: r.status, headers, body: text };
}

/* ------------------------------------------------------------------ */
/*  Encerramento automatico (pagina fechada -> servico para)           */
/* ------------------------------------------------------------------ */

/*
 * O app portatil roda sem janela de console, entao nao existe um "X"
 * para fechar. A pagina avisa que esta viva a cada poucos segundos e
 * manda um adeus no pagehide. Quando nao sobra nenhuma pagina, o
 * processo termina sozinho.
 *
 * A carencia de 8 s existe porque trocar de index.html para mosaic.html
 * tambem dispara pagehide: a pagina nova chega antes do prazo e cancela.
 *
 * O limite de 120 s cobre o navegador em segundo plano, que estrangula
 * temporizadores para 1 por minuto.
 */

const AUTO_CLOSE = process.env.MOSAICO_AUTOCLOSE === '1';
const DEBUG = process.env.MOSAICO_DEBUG === '1';
const ALIVE_STALE_MS = 90 * 1000;
const EXIT_GRACE_MS = 8 * 1000;
const TOMBSTONE_MS = 60 * 1000;

const clients = new Map();
const deadClients = new Map();
const sessions = new Set();

let watchdogArmed = false;
let exitTimer = null;
let shuttingDown = false;

function clearExitTimer() {
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = null;
  }
}

function scheduleExit(ms) {
  if (!AUTO_CLOSE || shuttingDown || exitTimer) return;
  exitTimer = setTimeout(() => {
    exitTimer = null;
    shutdown('a pagina foi fechada');
  }, ms);
}

function noteAlive(id) {
  // Um ping atrasado pode chegar depois do adeus da mesma pagina (o
  // navegador dispara visibilitychange e pagehide quase juntos ao sair).
  // Sem o tombstone, esse ping ressuscitaria um cliente que nunca mais
  // responde e o servico ficaria vivo para sempre.
  const mortoEm = deadClients.get(id);
  if (mortoEm && Date.now() - mortoEm < TOMBSTONE_MS) return;

  clients.set(id, Date.now());
  watchdogArmed = true;
  clearExitTimer();
  if (DEBUG) console.log(`[vida] ${id.slice(0, 8)} (${clients.size} aberta(s))`);
}

function noteBye(id) {
  clients.delete(id);
  deadClients.set(id, Date.now());
  if (deadClients.size > 200) deadClients.clear();
  if (DEBUG) console.log(`[adeus] ${id.slice(0, 8)} (${clients.size} aberta(s))`);
  if (watchdogArmed && clients.size === 0) scheduleExit(EXIT_GRACE_MS);
}

/** Guarda o sessionId para encerrar no COR caso a pagina morra sem avisar. */
function rememberSession(text) {
  try {
    const j = JSON.parse(text);
    const sid = j && (j.sessionId || j.session_id);
    if (typeof sid === 'string' && sid) sessions.add(sid);
  } catch {
    /* resposta sem JSON */
  }
}

async function stopAllSessions() {
  if (!sessions.size) return;
  const list = [...sessions];
  sessions.clear();
  const stop = Promise.allSettled(
    list.map((sid) =>
      proxySignal(`${PLAYER}/session/stop/`, 'application/json', JSON.stringify({ sessionId: sid }))
    )
  );
  await Promise.race([stop, sleep(2500)]);
}

/* ------------------------------------------------------------------ */
/*  HTTP                                                               */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '' || rel === 'index.html') rel = 'index.html';
  if (rel === 'mosaic' || rel === 'mosaic/') rel = 'mosaic.html';

  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return sendText(res, 404, 'Not found');
  }
  if (!stat.isFile()) return sendText(res, 404, 'Not found');

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    /* ---- lista de cameras ---- */
    if (req.method === 'GET' && p === '/api/cameras') {
      const force = url.searchParams.get('refresh') === '1';
      const data = await fetchCameras(force);
      return sendJSON(res, 200, data);
    }

    /* ---- geocodificacao ---- */
    if (req.method === 'GET' && p === '/api/geo/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 3) return sendJSON(res, 400, { error: 'busca muito curta' });
      const results = await geoSearch(q.slice(0, 160));
      return sendJSON(res, 200, { results });
    }

    if (req.method === 'GET' && p === '/api/geo/cep') {
      const cep = (url.searchParams.get('cep') || '').replace(/\D+/g, '');
      if (cep.length !== 8) return sendJSON(res, 400, { error: 'CEP invalido' });
      const results = await geoCep(cep);
      return sendJSON(res, 200, { results });
    }

    if (req.method === 'GET' && p === '/api/geo/reverse') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return sendJSON(res, 400, { error: 'coordenada invalida' });
      }
      return sendJSON(res, 200, { label: await geoReverse(lat, lon) });
    }

    /* ---- configuracao ---- */
    if (p === '/api/config') {
      if (req.method === 'GET') return sendJSON(res, 200, await loadConfig());
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readBody(req);
        const saved = await saveConfig(JSON.parse(body || '{}'));
        return sendJSON(res, 200, saved);
      }
      return sendJSON(res, 405, { error: 'metodo nao permitido' });
    }

    /* ---- sinalizacao WHEP ---- */
    if (req.method === 'POST') {
      const body = await readBody(req);

      /* ---- pagina viva / pagina fechada ---- */
      if (p === '/api/alive' || p === '/api/bye') {
        let id = 'anon';
        try {
          const j = JSON.parse(body || '{}');
          if (typeof j.id === 'string' && j.id) id = j.id.slice(0, 64);
        } catch {
          /* corpo vazio */
        }
        if (p === '/api/alive') noteAlive(id);
        else noteBye(id);
        return sendJSON(res, 200, { ok: true, clients: clients.size });
      }

      if (p.startsWith('/api/session/start/')) {
        const id = decodeURIComponent(p.slice('/api/session/start/'.length));
        if (!/^[A-Za-z0-9_-]+$/.test(id)) return sendJSON(res, 400, { error: 'id invalido' });
        const r = await proxySignal(
          `${PLAYER}/session/start/${encodeURIComponent(id)}/`,
          'application/json',
          '{}'
        );
        rememberSession(r.body);
        return sendText(res, r.status, r.body, r.headers['Content-Type']);
      }

      if (p === '/api/whep') {
        const sid = req.headers['x-camera-session'];
        if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sid)) {
          return sendJSON(res, 400, { error: 'sessao invalida' });
        }
        sessions.add(sid);
        const r = await proxySignal(`${PLAYER}/whep/`, 'application/sdp', body, {
          'X-Camera-Session': sid,
        });
        res.writeHead(r.status, r.headers);
        return res.end(r.body);
      }

      if (p === '/api/heartbeat' || p === '/api/stop') {
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch {
          return sendJSON(res, 400, { error: 'json invalido' });
        }
        if (typeof payload.sessionId !== 'string' || !payload.sessionId) {
          return sendJSON(res, 400, { error: 'sessionId ausente' });
        }
        if (p === '/api/stop') sessions.delete(payload.sessionId);
        const target = p === '/api/heartbeat' ? '/session/heartbeat/' : '/session/stop/';
        const r = await proxySignal(`${PLAYER}${target}`, 'application/json', JSON.stringify(payload));
        return sendText(res, r.status, r.body, r.headers['Content-Type']);
      }

      return sendJSON(res, 404, { error: 'rota nao encontrada' });
    }

    if (p === '/api/health') {
      return sendJSON(res, 200, {
        ok: true,
        cameras: listCache.data ? listCache.data.length : 0,
        ageSeconds: listCache.at ? Math.round((Date.now() - listCache.at) / 1000) : null,
        autoClose: AUTO_CLOSE,
        clients: clients.size,
      });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(res, p);
    }

    return sendText(res, 405, 'Method not allowed');
  } catch (err) {
    const cause = err?.cause
      ? ` | cause: ${err.cause.code || err.cause.message || err.cause}${
          err.cause.hostname ? ` host=${err.cause.hostname}` : ''
        }`
      : '';
    console.error('[erro]', (err?.message || err) + cause);
    return sendJSON(res, 502, { error: String(err?.message || err), cause: cause.trim() || undefined });
  }
});

/* ------------------------------------------------------------------ */
/*  Subida                                                             */
/* ------------------------------------------------------------------ */

const basePort = Number(process.env.PORT || 8787);
const baseUrl = `http://127.0.0.1:${basePort}/`;

/** Ja existe um Mosaico rodando nesta porta? Entao so abre a janela. */
async function runningInstance(url) {
  try {
    const r = await fetch(url + 'api/health', { signal: AbortSignal.timeout(700) });
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j && j.ok === true);
  } catch {
    return false;
  }
}

/*
 * Chrome e Edge primeiro: sao os unicos no Windows que decodificam o
 * H.265 do COR. Abrir no navegador padrao poderia cair no Firefox, que
 * mostra a pagina mas nao toca video nenhum.
 */
function openBrowser(url) {
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];
    const found = candidates.find((f) => f && fs.existsSync(f));
    if (found) {
      execFile(found, [url], { detached: true, stdio: 'ignore' }, () => {});
      return path.basename(found);
    }
    exec(`start "" "${url}"`);
    return 'navegador padrao';
  }
  if (process.platform === 'darwin') {
    exec(`open "${url}"`);
    return 'Safari';
  }
  exec(`xdg-open "${url}"`);
  return 'navegador padrao';
}

/* Arquivo com o PID: e o que o "Parar Mosaico.vbs" usa para matar o
 * processo certo, sem taskkill por nome (que acertaria qualquer node). */
const PID_FILES = [path.join(ROOT, '.mosaico.pid'), path.join(os.tmpdir(), 'mosaico-cor.pid')];

async function writePid() {
  for (const file of PID_FILES) {
    try {
      await fsp.writeFile(file, String(process.pid), 'utf8');
      return file;
    } catch {
      /* pasta somente leitura: tenta a proxima */
    }
  }
  return null;
}

async function removePid() {
  for (const file of PID_FILES) {
    try {
      const txt = await fsp.readFile(file, 'utf8');
      if (Number(txt) === process.pid) await fsp.unlink(file);
    } catch {
      /* nao existe */
    }
  }
}

if (await runningInstance(baseUrl)) {
  if (!process.env.NO_OPEN) openBrowser(baseUrl);
  process.exit(0);
}

async function listenFrom(startPort, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const port = startPort + i;
    try {
      await new Promise((resolve, reject) => {
        const onError = (e) => {
          server.off('listening', onListening);
          reject(e);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      return port;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('Nenhuma porta livre entre ' + startPort + ' e ' + (startPort + tries - 1));
}

const port = await listenFrom(basePort);
const url = `http://127.0.0.1:${port}/`;

process.title = AUTO_CLOSE ? 'Mosaico COR' : 'Mosaico COR - feche esta janela para parar';
console.log('');
console.log('  Mosaico Vistas');
console.log('  ' + url);
console.log(
  AUTO_CLOSE
    ? '  Fecha sozinho quando a pagina for fechada.'
    : '  Feche esta janela (ou Ctrl+C) para parar.'
);
console.log('');

await writePid();

if (!process.env.NO_OPEN) {
  const used = openBrowser(url);
  if (AUTO_CLOSE) console.log(`  Abrindo no ${used}...`);
}

/* Rede de seguranca: se nada abriu a pagina em 3 min, nao faz sentido
 * deixar um processo invisivel rodando para sempre. */
if (AUTO_CLOSE) {
  setTimeout(() => {
    if (!watchdogArmed) shutdown('nenhuma pagina abriu');
  }, 180 * 1000);
}

const watchdog = setInterval(() => {
  if (!AUTO_CLOSE || !watchdogArmed || shuttingDown) return;
  const now = Date.now();
  for (const [id, seen] of clients) {
    if (now - seen > ALIVE_STALE_MS) clients.delete(id);
  }
  for (const [id, when] of deadClients) {
    if (now - when > TOMBSTONE_MS) deadClients.delete(id);
  }
  if (clients.size === 0) scheduleExit(EXIT_GRACE_MS);
}, 10 * 1000);
watchdog.unref();

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(watchdog);
  clearExitTimer();

  console.log(reason ? `\nEncerrando (${reason})...` : '\nEncerrando...');

  // Devolve as sessoes ao COR: sem isso elas ficam presas ate expirarem
  // e atrapalham a proxima abertura da mesma camera (HTTP 429).
  await stopAllSessions();
  await removePid();

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('sinal'));
