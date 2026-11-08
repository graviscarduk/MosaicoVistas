import {
  getConfig,
  getCameras,
  putConfig,
  padId,
  prettyName,
  fmtKm,
  haversineKm,
  startKeepAlive,
  warnIfNoH265,
} from './common.js';
import { CameraPlayer } from './player.js';

startKeepAlive();
warnIfNoH265();

const grid = document.getElementById('grid');
const clockEl = document.getElementById('clock');
const centerLabel = document.getElementById('center-label');

const RETRY_DELAYS = [5, 10, 20, 40, 60];

/* Icones em SVG: os glifos de emoji variam demais entre fontes/navegadores. */
const ICON = {
  mute: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9l6 6"/><path d="M22 9l-6 6"/></svg>',
  sound:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  full: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
};

let cfg = null;
const cameras = new Map();
let tiles = [];
let activeTile = null;

/* ------------------------------------------------------------------ */
/*  Relogio                                                            */
/* ------------------------------------------------------------------ */

function tickClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('pt-BR', { hour12: false });
}
tickClock();
setInterval(tickClock, 1000);

/* ------------------------------------------------------------------ */
/*  Inicio                                                             */
/* ------------------------------------------------------------------ */

async function boot() {
  cfg = await getConfig();
  centerLabel.textContent = cfg.center?.label || 'Rio de Janeiro';
  applyLayoutUI();

  try {
    const list = await getCameras();
    for (const c of list) cameras.set(padId(c.apiId), c);
  } catch (err) {
    console.warn('Lista de cameras indisponivel:', err);
  }

  build();
}

function applyLayoutUI() {
  const { cols, rows } = cfg.layout;
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', rows);

  for (const btn of document.querySelectorAll('[data-layout]')) {
    const [c, r] = btn.dataset.layout.split('x').map(Number);
    btn.classList.toggle('primary', c === cols && r === rows);
  }
}

/* ------------------------------------------------------------------ */
/*  Grade                                                              */
/* ------------------------------------------------------------------ */

/**
 * Monta a grade reaproveitando os tiles que continuam na tela.
 *
 * Trocar 2x2 -> 3x3 nao pode derrubar as 4 transmissoes que ja estao
 * rodando: o COR limita tentativas por camera (HTTP 429) e reabrir tudo
 * de uma vez derruba o mosaico inteiro. So entram/saem os tiles que
 * realmente mudaram.
 */
function build() {
  const total = cfg.layout.cols * cfg.layout.rows;
  const list = cfg.cameras.slice(0, total);

  const pool = new Map();
  for (const t of tiles) pool.set(t.apiId, t);

  const next = [];
  const keep = [];

  for (let i = 0; i < total; i++) {
    const entry = list[i];
    if (!entry) {
      next.push(makeEmptyTile());
      continue;
    }

    const apiId = padId(entry.apiId);
    let tile = pool.get(apiId);

    if (tile) {
      pool.delete(apiId);
      tile.setName?.(entry);
    } else {
      tile = makeTile(entry, i * 700);
    }

    keep.push(tile);
    next.push(tile.el);
  }

  // o que sobrou no pool saiu do mosaico
  for (const t of pool.values()) t.stop();

  tiles = keep;
  if (!tiles.includes(activeTile)) activeTile = null;

  applyChildren(next);
}

/**
 * Atualiza o DOM causando o menor movimento possivel: video reparentado
 * pode interromper a reproducao, entao so mexemos no que e necessario.
 */
function applyChildren(next) {
  const current = [...grid.children];
  let same = 0;
  while (same < current.length && same < next.length && current[same] === next[same]) same++;

  if (same === current.length && same === next.length) return;

  if (same === current.length) {
    // so acrescenta no fim (2x2 -> 3x3)
    for (let i = current.length; i < next.length; i++) grid.appendChild(next[i]);
    return;
  }

  if (same === next.length) {
    // so remove o excedente do fim (3x3 -> 2x2)
    while (grid.children.length > next.length) grid.lastElementChild.remove();
    return;
  }

  // ordem mudou de verdade
  grid.replaceChildren(...next);
}

function makeEmptyTile() {
  const el = document.createElement('div');
  el.className = 'tile is-empty';
  el.innerHTML = `
    <div class="tile-msg">
      <div class="empty-plus">+</div>
      <div class="title">Sem camera</div>
      <div class="hint">Use "Editar cameras" para escolher outra.</div>
    </div>`;
  el.addEventListener('click', () => {
    location.href = '/';
  });
  return el;
}

function makeTile(entry, startDelay = 0) {
  const apiId = padId(entry.apiId);
  const info = cameras.get(apiId) || { apiId, nome: entry.nome || apiId };
  const nome = prettyName(info.nome || entry.nome || apiId);

  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <video autoplay muted playsinline></video>
    <div class="tile-bar">
      <span class="dot" data-state="connecting"></span>
      <span class="tile-name"></span>
      <span class="tile-meta"></span>
      <button class="btn icon mute" title="Som">${ICON.mute}</button>
      <button class="btn icon full" title="Tela cheia">${ICON.full}</button>
    </div>
    <div class="tile-msg" hidden>
      <div class="title"></div>
      <div class="hint"></div>
      <button class="btn retry">Tentar de novo</button>
    </div>`;

  const video = el.querySelector('video');
  const dot = el.querySelector('.dot');
  const nameEl = el.querySelector('.tile-name');
  const metaEl = el.querySelector('.tile-meta');
  const msgEl = el.querySelector('.tile-msg');
  const titleEl = el.querySelector('.tile-msg .title');
  const hintEl = el.querySelector('.tile-msg .hint');
  const muteBtn = el.querySelector('.mute');
  const fullBtn = el.querySelector('.full');
  const retryBtn = el.querySelector('.retry');

  nameEl.textContent = nome;
  nameEl.title = nome;

  const bits = [`#${apiId}`];
  if (Number.isFinite(+info.lat) && Number.isFinite(+info.lon) && cfg.center) {
    const km = haversineKm(cfg.center.lat, cfg.center.lon, +info.lat, +info.lon);
    bits.push(fmtKm(km));
  }
  metaEl.textContent = bits.join(' · ');

  const tile = {
    apiId,
    el,
    video,
    player: null,
    attempt: 0,
    timer: null,
    baseHint: '',
    setName(next) {
      const n = prettyName(next?.nome || apiId);
      nameEl.textContent = n;
      nameEl.title = n;
    },
    stop() {
      clearTimeout(this.startTimer);
      clearInterval(this.timer);
      this.timer = null;
      this.player?.stop(true);
    },
    retry() {
      this.attempt = 0;
      connect();
    },
  };

  const player = new CameraPlayer(apiId, video, (state, msg, info) => {
    dot.dataset.state = state;

    if (state === 'live') {
      clearInterval(tile.timer);
      tile.timer = null;
      tile.attempt = 0;
      msgEl.hidden = true;
      return;
    }

    if (state === 'codec') {
      clearInterval(tile.timer);
      tile.timer = null;
      showError(
        'Codec nao suportado',
        'Esta camera transmite em H.265 (HEVC) e este navegador nao consegue decodificar.'
      );
      return;
    }

    if (state === 'offline') {
      showError('Camera fora do ar', msg || 'Sem sinal no momento.');
      // 429 = o COR bloqueou novas tentativas para esta camera; esperar mais.
      scheduleRetry(info?.status === 429 ? 25 : 0);
    }
  });

  tile.player = player;

  function showError(title, hint) {
    titleEl.textContent = title;
    hintEl.textContent = hint;
    tile.baseHint = hint;
    msgEl.hidden = false;
    video.srcObject = null;
  }

  function connect() {
    clearTimeout(tile.startTimer);
    clearInterval(tile.timer);
    tile.timer = null;
    msgEl.hidden = true;
    dot.dataset.state = 'connecting';
    player.start();
  }

  function scheduleRetry(minDelay = 0) {
    clearInterval(tile.timer);
    const base = RETRY_DELAYS[Math.min(tile.attempt, RETRY_DELAYS.length - 1)];
    const delay = Math.max(base, minDelay);
    tile.attempt += 1;
    const at = Date.now() + delay * 1000;

    const tick = () => {
      const left = Math.ceil((at - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(tile.timer);
        tile.timer = null;
        connect();
      } else {
        hintEl.textContent = `${tile.baseHint} Nova tentativa em ${left}s.`;
      }
    };

    tile.timer = setInterval(tick, 500);
    tick();
  }

  /* ---- interacao ---- */

  el.addEventListener('pointerdown', () => setActive(tile));

  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    toggleFullscreen(el);
  });

  video.addEventListener('click', () => {
    if (document.fullscreenElement === el) return;
    toggleFullscreen(el);
  });

  fullBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen(el);
  });

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMuted(tile, !video.muted);
  });

  retryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tile.retry();
  });

  video.addEventListener('volumechange', () => {
    muteBtn.innerHTML = video.muted ? ICON.mute : ICON.sound;
    muteBtn.title = video.muted ? 'Ligar som' : 'Desligar som';
  });

  // comeca conectado (escalonado: 4 negociacoes ao mesmo tempo atrapalham)
  tile.startTimer = setTimeout(connect, startDelay);

  return tile;
}

/* ------------------------------------------------------------------ */
/*  Som / tela cheia                                                   */
/* ------------------------------------------------------------------ */

function setMuted(tile, muted) {
  for (const t of tiles) {
    t.video.muted = t === tile ? muted : true;
  }
}

function toggleFullscreen(el) {
  if (document.fullscreenElement === el) {
    document.exitFullscreen?.();
  } else {
    el.requestFullscreen?.().catch(() => {});
  }
}

function setActive(tile) {
  activeTile = tile;
}

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

document.getElementById('layouts').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-layout]');
  if (!btn) return;
  const [cols, rows] = btn.dataset.layout.split('x').map(Number);
  if (cols === cfg.layout.cols && rows === cfg.layout.rows) return;

  cfg.layout = { cols, rows };
  applyLayoutUI();
  build();
  try {
    await putConfig(cfg);
  } catch (err) {
    console.warn('Nao foi possivel salvar o layout:', err);
  }
});

document.getElementById('fullscreen-all').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});

/* ------------------------------------------------------------------ */
/*  Teclado                                                            */
/* ------------------------------------------------------------------ */

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();

  if (k === 'f' && activeTile) toggleFullscreen(activeTile.el);
  if (k === 'm' && activeTile) setMuted(activeTile, !activeTile.video.muted);
  if (k === 'r' && activeTile) activeTile.retry();
});

/* ------------------------------------------------------------------ */
/*  Encerramento                                                       */
/* ------------------------------------------------------------------ */

function stopAll() {
  for (const t of tiles) t.stop();
}

window.addEventListener('pagehide', stopAll);
window.addEventListener('beforeunload', stopAll);

boot().catch((err) => {
  console.error(err);
  centerLabel.textContent = 'Falha ao carregar a configuracao';
});

/* Ajuda a diagnosticar pelo console do navegador: __mosaico.tiles() */
window.__mosaico = {
  tiles: () => tiles,
  config: () => cfg,
  stopAll,
};
