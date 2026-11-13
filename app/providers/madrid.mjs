/**
 * Provider: Madrid (Ayuntamiento de Madrid / Informo).
 *
 * Sem video publico: o KML oficial traz uma foto JPEG por camera, com
 * coordenadas. As imagens sao atualizadas com poucos minutos de atraso.
 */

const KML_URL = 'https://informo.madrid.es/informo/tmadrid/CCTV.kml';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  Accept: 'application/vnd.google-earth.kml+xml,text/xml,*/*',
};

const TTL_MS = 30 * 1000; // KML e pequeno e sem cache: 30 s mantem a versao fresca
let cache = { at: 0, data: null };

function dataValue(block, name) {
  const re = new RegExp(
    '<Data\\s+name="' + name + '"[^>]*>\\s*<Value>([\\s\\S]*?)</Value>',
    'i'
  );
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function normalize(kml) {
  const out = [];
  const seen = new Set();
  const re = /<Placemark\b[\s\S]*?<\/Placemark>/gi;
  let m;

  while ((m = re.exec(kml))) {
    const block = m[0];
    const id = dataValue(block, 'Numero');
    if (!id || seen.has(id)) continue;

    const nome = dataValue(block, 'Nombre') || `Câmera ${id}`;
    const coord = block.match(/<coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)/i);
    if (!coord) continue;

    const lon = Number(coord[1]);
    const lat = Number(coord[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // A descricao traz HTML escapado: &lt;img src=https://.../Camara06303.jpg?v=1
    const img = block.match(/&lt;img\s+src=([^\s&>]+)/i) ||
      block.match(/<img\s+src=([^\s&>]+)/i);
    if (!img) continue;

    const url = img[1].replace(/&amp;/g, '&').split('?')[0];
    seen.add(id);
    out.push({ id, nome, lat, lon, imageUrl: url });
  }
  return out;
}

export default {
  id: 'madrid',
  label: 'Madrid (Informo)',
  attribution: 'Imagens: Ayuntamiento de Madrid — Informo',
  creditUrl: 'https://informo.madrid.es/',
  kind: 'snapshot',
  countryCode: 'es',
  defaultCenter: { lat: 40.4168, lon: -3.7038, label: 'Madrid' },
  defaultZoom: 13,
  defaultRadiusKm: 3,
  maxRadiusKm: 15,

  // O CDN do Informo recusa requisicoes sem Referer do proprio site.
  imageHeaders: {
    Referer: 'https://informo.madrid.es/',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  },

  async listCameras(force = false) {
    const fresh = cache.data && Date.now() - cache.at < TTL_MS;
    if (fresh && !force) return cache.data;

    const r = await fetch(KML_URL, { headers: HEADERS, cache: 'no-store' });
    if (!r.ok) throw new Error(`Informo Madrid respondeu HTTP ${r.status}`);
    const data = normalize(await r.text());

    if (!data.length) {
      if (cache.data) return cache.data;
      throw new Error('Nao foi possivel ler a lista de cameras de Madrid');
    }
    cache = { at: Date.now(), data };
    return data;
  },

  async stream(camera) {
    if (!camera?.imageUrl) throw new Error('Camera sem imagem');

    return {
      kind: 'snapshot',
      refreshMs: 25000, // a fonte troca a foto em intervalos de dezenas de segundos
      frames: 1,
      // O servidor confere com um HEAD se a foto mudou antes de baixar de novo.
      revalidate: true,
      url: camera.imageUrl,
    };
  },
};
