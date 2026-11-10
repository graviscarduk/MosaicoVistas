/**
 * Provider: Los Angeles / California (Caltrans, distrito 7).
 *
 * O catalogo em JSON traz coordenadas e duas midias por camera: um HLS
 * (fora do ar/geo-bloqueado na maior parte das redes) e uma foto JPEG
 * atualizada a cada ~2 minutos. Usamos a foto, que e o que funciona de
 * forma confiavel.
 */

const STATUS_URL = 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

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

    out.push({ id, nome: nome || id, lat, lon, imageUrl: url });
  }
  return out;
}

export default {
  id: 'caltrans-d7',
  label: 'Los Angeles (Caltrans)',
  attribution: 'Imagens: California Department of Transportation (Caltrans)',
  creditUrl: 'https://cwwp2.dot.ca.gov/vm/streamlist.htm',
  kind: 'snapshot',
  countryCode: 'us',
  defaultCenter: { lat: 34.0522, lon: -118.2437, label: 'Los Angeles, Califórnia' },
  defaultZoom: 10,
  defaultRadiusKm: 5,
  maxRadiusKm: 40,

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
    return {
      kind: 'snapshot',
      refreshMs: 120000, // a Caltrans atualiza a foto a cada 2 minutos
      frames: 1,
      url: camera.imageUrl,
    };
  },
};
