/**
 * Player WebRTC (WHEP) das cameras do COR-Rio.
 *
 * Fluxo (o mesmo do app oficial):
 *   POST /api/session/start/{apiId}/   -> { sessionId }
 *   POST /api/whep                     -> SDP answer (+ header Link com TURN)
 *   POST /api/heartbeat                -> a cada 20s
 *   POST /api/stop                     -> ao encerrar
 *
 * O header Link traz os servidores TURN. Como o RTCPeerConnection precisa
 * deles ja na criacao, na primeira vez fazemos uma negociacao extra so para
 * descobrir. O resultado (inclusive "nao tem TURN") fica guardado por 12 h,
 * para nao pagar esse custo a cada abertura do mosaico.
 */

const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const ICE_KEY = 'mosaico.ice.v2';
const ICE_TTL_MS = 12 * 60 * 60 * 1000;
const HEARTBEAT_MS = 20000;
const WATCHDOG_MS = 32000;

/** null = ainda nao sabemos; [] = sabemos que nao ha TURN. */
function readIce() {
  try {
    const raw = JSON.parse(localStorage.getItem(ICE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.servers)) return null;
    if (!Number.isFinite(raw.at) || Date.now() - raw.at > ICE_TTL_MS) return null;
    return raw.servers;
  } catch {
    return null;
  }
}

function writeIce(servers) {
  try {
    localStorage.setItem(ICE_KEY, JSON.stringify({ at: Date.now(), servers }));
  } catch {
    /* ignora */
  }
}

/* O COR responde 429 quando a mesma camera e aberta muitas vezes seguidas.
   Limitamos as aberturas simultaneas para nao provocar isso. */
const MAX_PARALLEL_STARTS = 2;
let runningStarts = 0;
const waitingStarts = [];

function acquireStart() {
  if (runningStarts < MAX_PARALLEL_STARTS) {
    runningStarts += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingStarts.push(resolve));
}

function releaseStart() {
  const next = waitingStarts.shift();
  if (next) next();
  else runningStarts -= 1;
}

/** Extrai os servidores ICE do header Link (rel="ice-server"). */
export function parseIceLink(header) {
  if (!header) return [];
  const out = [];
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = part.match(/<([^>]+)>/);
    if (!m || !/rel\s*=\s*"ice-server"/i.test(part)) continue;
    const s = { urls: m[1] };
    const u = part.match(/username\s*=\s*"([^"]+)"/i);
    const c = part.match(/credential\s*=\s*"([^"]+)"/i);
    if (u) s.username = u[1];
    if (c) s.credential = c[1];
    out.push(s);
  }
  return out;
}

function waitIceGathering(pc, ms = 2500) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** A sinalizacao do COR as vezes demora; sem isso o tile fica "conectando" para sempre. */
function signalFetch(url, init = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function errorMessage(text, status) {
  try {
    const j = JSON.parse(text);
    if (j && j.error) return String(j.error);
  } catch {
    /* nao e json */
  }
  const clean = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || `Falha na sinalizacao (HTTP ${status})`;
}

export class CameraPlayer {
  /**
   * @param {string} apiId
   * @param {HTMLVideoElement} video
   * @param {(state: 'connecting'|'live'|'offline'|'codec'|'idle', msg?: string) => void} onState
   */
  constructor(apiId, video, onState) {
    this.apiId = apiId;
    this.video = video;
    this.onState = onState;
    this.gen = 0;
    this.pc = null;
    this.sessionId = null;
    this.hb = null;
    this.watchdog = null;
    this.state = 'idle';
  }

  emit(state, msg, info) {
    this.state = state;
    this.onState?.(state, msg, info);
  }

  async start() {
    const gen = ++this.gen;
    this.#clearTimers();
    this.emit('connecting');

    try {
      let ice = readIce();
      if (ice === null) {
        const found = await this.#discover(gen);
        if (gen !== this.gen) return;
        if (found) {
          ice = found;
          writeIce(found);
        }
      }
      await this.#connect(ice, gen);
    } catch (err) {
      if (gen !== this.gen) return;
      this.#fail(err);
    }
  }

  stop(quiet = true) {
    this.gen++;
    this.#clearTimers();

    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        /* ignora */
      }
      this.pc = null;
    }
    if (this.video) this.video.srcObject = null;

    if (this.sessionId) {
      this.#stopSession(this.sessionId);
      this.sessionId = null;
    }
    if (!quiet) this.emit('idle');
  }

  #clearTimers() {
    if (this.hb) clearInterval(this.hb);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.hb = null;
    this.watchdog = null;
  }

  #fail(err) {
    const msg = String(err?.message || err || 'Falha ao conectar');
    const status = Number(err?.status) || 0;
    this.stop(true);
    if (/codec/i.test(msg)) this.emit('codec', msg, { status });
    else this.emit('offline', msg, { status });
  }

  async #startSession(gen) {
    await acquireStart();
    try {
      const r = await signalFetch(`/api/session/start/${encodeURIComponent(this.apiId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const text = await r.text();
      if (gen !== this.gen) return null;
      if (!r.ok) {
        const err = new Error(errorMessage(text, r.status));
        err.status = r.status;
        throw err;
      }
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        /* ignora */
      }
      if (!data.sessionId) throw new Error('Sessao de video invalida');
      return data.sessionId;
    } finally {
      releaseStart();
    }
  }

  /**
   * Negociacao descartavel so para ler os TURN do header Link.
   * Devolve null se nem deu para descobrir (nao cachear nesse caso).
   */
  async #discover(gen) {
    let pc;
    let sid;
    try {
      sid = await this.#startSession(gen);
      if (!sid || gen !== this.gen) return null;

      pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle', iceServers: STUN });
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceGathering(pc, 1500);
      if (gen !== this.gen) return null;

      const r = await signalFetch('/api/whep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', 'X-Camera-Session': sid },
        body: pc.localDescription.sdp,
      });
      if (!r.ok) return null;
      const link = r.headers.get('Link');
      return parseIceLink(link);
    } catch {
      return null;
    } finally {
      if (sid) this.#stopSession(sid);
      if (pc) {
        try {
          pc.close();
        } catch {
          /* ignora */
        }
      }
    }
  }

  async #connect(ice, gen) {
    const sid = await this.#startSession(gen);
    if (!sid || gen !== this.gen) return;
    this.sessionId = sid;

    const pc = new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
      iceServers: ice && ice.length ? ice : STUN,
    });
    this.pc = pc;

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (ev) => {
      if (gen !== this.gen) return;
      const stream = ev.streams && ev.streams[0];
      if (!stream) return;
      this.video.srcObject = stream;
      this.video.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (gen !== this.gen) return;
      const st = pc.connectionState;
      if (st === 'failed') this.#fail(new Error('Conexao perdida com a camera'));
      if (st === 'disconnected') {
        setTimeout(() => {
          if (gen === this.gen && pc.connectionState === 'disconnected') {
            this.#fail(new Error('Conexao perdida com a camera'));
          }
        }, 6000);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGathering(pc);
    if (gen !== this.gen) return;

    const r = await signalFetch('/api/whep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', 'X-Camera-Session': sid },
      body: pc.localDescription.sdp,
    });
    const answer = await r.text();
    if (gen !== this.gen) return;
    if (!r.ok) throw new Error(errorMessage(answer, r.status));

    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    if (gen !== this.gen) return;

    this.hb = setInterval(() => this.#heartbeat(sid), HEARTBEAT_MS);

    this.watchdog = setTimeout(() => {
      if (gen !== this.gen) return;
      if (!(this.video.videoWidth > 0)) {
        this.#fail(new Error('Camera sem sinal no momento'));
      }
    }, WATCHDOG_MS);

    const onPlaying = () => {
      if (gen !== this.gen) return;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
      this.emit('live');
    };
    if (!this.video.paused && this.video.videoWidth > 0) onPlaying();
    else this.video.addEventListener('playing', onPlaying, { once: true });
  }

  #heartbeat(sid) {
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
      keepalive: true,
    }).catch(() => {});
  }

  #stopSession(sid) {
    try {
      fetch('/api/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignora */
    }
  }
}
