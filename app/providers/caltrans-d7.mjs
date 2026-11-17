/**
 * Provider: Los Angeles / California (Caltrans, distrito 7).
 *
 * O catalogo em JSON traz, por camera, um HLS (H.264) e uma foto JPEG.
 * O HLS so responde com o Referer da pagina da Caltrans e nao manda CORS,
 * por isso o servidor faz o proxy. Nem toda camera esta com o video no ar:
 * quando a playlist falha, caimos para a foto (atualizada a cada ~2 min).
 */

const STATUS_URL = 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

const HLS_REFERER = 'https://cwwp2.dot.ca.gov/vm/streamlist.htm';
const HLS_HOSTS = ['wzmedia.dot.ca.gov'];

const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

/** O video de uma camera entra e sai do ar; guardamos a resposta por 1 min. */
const HLS_TTL_MS = 60 * 1000;
const hlsCache = new Map(); // url -> { at, ok }

async function hlsAlive(url) {
  const hit = hlsCache.get(url);
  if (hit && Date.now() - hit.at < HLS_TTL_MS) return hit.ok;

  let ok = false;
  try {
    const r = await fetch(url, {
      headers: { ...HEADERS, Referer: HLS_REFERER, Accept: '*/*' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    ok = r.ok;
    try {
      await r.body?.cancel();
    } catch {
      /* resposta ja descartada */
    }
  } catch {
    ok = false;
  }

  hlsCache.set(url, { at: Date.now(), ok });
  return ok;
}

function normalize(raw) {
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const c = item && item.cctv;
    if (!c || !c.location || !c.imageData) continue;
    if (String(c.inService) === 'false') continue;

    const url = c.imageData.static?.currentImageURL;
    const lat = Number(c.location.latitude);
    const lon = Number(c.location.longitude);
    if (!url || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const id = 'D7-' + String(c.index ?? '').trim();
    if (id === 'D7-' || seen.has(id)) continue;
    seen.add(id);

    const nome = [c.location.locationName, c.location.nearbyPlace]
      .filter(Boolean)
      .join(' · ');

    out.push({
      id,
      nome: nome || id,
      lat,
      lon,
      imageUrl: url,
      videoUrl: c.imageData.streamingVideoURL || null,
    });
  }
  return out;
}

export default {
  id: 'caltrans-d7',
  label: 'Los Angeles',
  attribution: 'Imagens: California Department of Transportation (Caltrans)',
  creditUrl: 'https://cwwp2.dot.ca.gov/vm/streamlist.htm',
  kind: 'hls',
  mediaLabel: 'vídeo, foto se fora do ar',
  countryCode: 'us',
  defaultCenter: { lat: 34.0522, lon: -118.2437, label: 'Los Angeles, Califórnia' },
  defaultZoom: 10,
  defaultRadiusKm: 5,
  maxRadiusKm: 40,

  // usados pelo proxy /api/hls
  hlsHosts: HLS_HOSTS,
  hlsReferer: HLS_REFERER,

  async listCameras(force = false) {
    const fresh = cache.data && Date.now() - cache.at < TTL_MS;
    if (fresh && !force) return cache.data;

    const r = await fetch(STATUS_URL, { headers: HEADERS, cache: 'no-store' });
    if (!r.ok) throw new Error(`Caltrans respondeu HTTP ${r.status}`);
    const j = await r.json();
    const data = normalize(Array.isArray(j?.data) ? j.data : []);

    if (!data.length) {
      if (cache.data) return cache.data;
      throw new Error('Nao foi possivel obter a lista de cameras da Caltrans');
    }
    cache = { at: Date.now(), data };
    return data;
  },

  async stream(camera) {
    if (!camera?.imageUrl) throw new Error('Camera sem imagem');

    if (camera.videoUrl && (await hlsAlive(camera.videoUrl))) {
      return { kind: 'hls', url: camera.videoUrl, proxy: true };
    }

    return {
      kind: 'snapshot',
      refreshMs: 30000, // a fonte atualiza a foto a cada ~2 min
      frames: 1,
      revalidate: true,
      url: camera.imageUrl,
    };
  },
};
