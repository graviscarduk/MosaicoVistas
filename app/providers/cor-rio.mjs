/**
 * Provider: Rio de Janeiro (COR-Rio).
 *
 * Unico provider com video ao vivo de verdade: WebRTC/WHEP em H.265.
 * A lista e a sinalizacao passam pelo servidor local porque a API do COR
 * exige Origin/Referer e nao libera CORS.
 */

const COR = 'https://appcor.cor-rio.work';
const LIST_URL = COR + '/api/cameras/?limit=0';

// Sem estes headers o COR responde 403 (exigencia desde 24/10/2026).
export const COR_HEADERS = {
  Origin: COR,
  Referer: COR + '/',
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
};

export const COR_PLAYER = COR + '/api/camera/player';

const TTL_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cache = { at: 0, data: null };

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

function normalize(list) {
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const raw = String(c.apiId ?? '').replace(/\D+/g, '').slice(0, 12);
    if (!raw) continue;
    const id = raw.padStart(6, '0');
    if (seen.has(id)) continue;
    seen.add(id);

    const lat = Number(c.lat);
    const lon = Number(c.lon);
    out.push({
      id,
      nome: String(c.nome || id).slice(0, 160),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    });
  }
  return out;
}

export default {
  id: 'cor-rio',
  label: 'Rio de Janeiro (COR)',
  attribution: 'Câmeras: COR-Rio',
  creditUrl: 'https://cor.rio/',
  kind: 'whep',
  countryCode: 'br',
  defaultCenter: { lat: -22.9068, lon: -43.1729, label: 'Rio de Janeiro' },
  defaultZoom: 15,
  defaultRadiusKm: 1.5,
  maxRadiusKm: 3,

  async listCameras(force = false) {
    const fresh = cache.data && Date.now() - cache.at < TTL_MS;
    if (fresh && !force) return cache.data;

    const data = normalize(await fetchPreferFull());
    if (!data.length) {
      if (cache.data) return cache.data; // mantem o ultimo bom
      throw new Error('Nao foi possivel obter a lista de cameras do COR');
    }
    cache = { at: Date.now(), data };
    return data;
  },

  async stream() {
    return { kind: 'whep' };
  },
};
