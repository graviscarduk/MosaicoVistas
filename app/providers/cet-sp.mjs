/**
 * Provider: Sao Paulo (CET).
 *
 * O portal da CET publica apenas fotos JPEG (nao ha video publico).
 * Cada camera tem uma pasta e um conjunto de quadros; o proprio site
 * alterna entre eles a cada ~1,1 s. Reproduzimos a mesma sequencia no
 * mosaico, entao a imagem "anda" como no site original.
 *
 * O catalogo vem embutido no HTML (gCams) e NAO traz coordenadas:
 * a tabela abaixo foi geocodificada uma vez (Nominatim/OpenStreetMap)
 * e fica fixa aqui.
 */

const PAGE_URL = 'https://cameras.cetsp.com.br/View/Cam.aspx';
const IMG_BASE = 'https://cameras.cetsp.com.br/cams';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  Referer: 'https://cameras.cetsp.com.br/',
};

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };

// pasta da CET -> coordenada aproximada do cruzamento
const COORDS = {
  225: { lat: -23.5986461, lon: -46.6506638 }, // Ascendino Reis x R. Pedro de Toledo
  184: { lat: -23.5678406, lon: -46.6491564 }, // Brasil x Av. Brig. Luis Antonio
  220: { lat: -23.5841331, lon: -46.6873566 }, // Cidade Jardim / Tunel Max Feffer
  180: { lat: -23.5506826, lon: -46.6479939 }, // Consolacao x R. Caio Prado
  222: { lat: -23.5937014, lon: -46.6657545 }, // Helio Pellegrino x R. Diogo Jacome
  224: { lat: -23.5937558, lon: -46.6517557 }, // Ibirapuera x R. Ipe
  200: { lat: -23.5811942, lon: -46.679976 }, // Iguatemi x R. Jeronimo da Veiga
  31: { lat: -23.5807009, lon: -46.6850238 }, // Faria Lima x JK
  57: { lat: -23.5758971, lon: -46.6394528 }, // Paraiso x R. Apeninos
  23: { lat: -23.5575814, lon: -46.6606235 }, // Paulista x Brig. Luis Antonio
  15: { lat: -23.5564, lon: -46.6621 }, // Paulista / Metro (inativa)
};

function field(block, name, quoted = true) {
  const re = quoted
    ? new RegExp(name + ":\\s*'([^']*)'")
    : new RegExp(name + ":\\s*([^,}]+)");
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function normalize(html) {
  const out = [];
  const seen = new Set();
  const re = /gCams\.push\(\{([^}]+)\}\)/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const pasta = Number(field(block, 'pasta', false));
    if (!Number.isInteger(pasta) || seen.has(pasta)) continue;
    if (field(block, 'ativa', false) === 'false') continue;

    const titulo = field(block, 'titulo');
    const subTitulo = field(block, 'subTitulo');
    const detalhe = field(block, 'detalhe');
    const apImg = Number(field(block, 'apImg', false)) || 1;
    const frames = Math.max(1, Number(field(block, 'qtdeImagens', false)) || 1);

    const nome = [titulo, subTitulo].filter(Boolean).join(' — ') +
      (detalhe ? ` (${detalhe})` : '');

    const coord = COORDS[pasta] || null;
    seen.add(pasta);
    out.push({
      id: String(pasta),
      nome: nome || `Camera ${pasta}`,
      lat: coord ? coord.lat : null,
      lon: coord ? coord.lon : null,
      apImg,
      frames,
    });
  }
  return out;
}

export default {
  id: 'cet-sp',
  label: 'São Paulo',
  attribution: 'Imagens: CET — Companhia de Engenharia de Tráfego de São Paulo',
  creditUrl: 'https://cameras.cetsp.com.br/View/Cam.aspx',
  kind: 'snapshot',
  countryCode: 'br',
  defaultCenter: { lat: -23.5705, lon: -46.6705, label: 'São Paulo' },
  defaultZoom: 13,
  defaultRadiusKm: 6,
  maxRadiusKm: 20,

  async listCameras(force = false) {
    const fresh = cache.data && Date.now() - cache.at < TTL_MS;
    if (fresh && !force) return cache.data;

    const r = await fetch(PAGE_URL, { headers: HEADERS, cache: 'no-store' });
    if (!r.ok) throw new Error(`CET respondeu HTTP ${r.status}`);
    const data = normalize(await r.text());

    if (!data.length) {
      if (cache.data) return cache.data;
      throw new Error('Nao foi possivel ler a lista de cameras da CET');
    }
    cache = { at: Date.now(), data };
    return data;
  },

  async stream(camera) {
    if (!camera) throw new Error('Camera inexistente');
    return {
      kind: 'snapshot',
      // 1,1 s e o intervalo do proprio site; 1,5 s poupa o servidor publico
      refreshMs: 1500,
      frames: camera.frames || 1,
      url: `${IMG_BASE}/${camera.id}/{frame}.jpg`,
    };
  },
};
