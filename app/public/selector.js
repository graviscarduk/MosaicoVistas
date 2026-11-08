import {
  getConfig,
  getCameras,
  putConfig,
  padId,
  prettyName,
  norm,
  haversineKm,
  fmtKm,
  groupCameras,
  readStatus,
  writeStatus,
  startKeepAlive,
  warnIfNoH265,
} from './common.js';
import { CameraPlayer } from './player.js';

startKeepAlive();
warnIfNoH265();

const el = (id) => document.getElementById(id);
const MAX_CAMERAS = 16;

let cfg = null;
let all = [];
let byId = new Map();
let groups = [];
let status = readStatus();

let center = null;
let radiusKm = 1.5;
let selected = new Set();
let query = '';

let map = null;
let circle = null;
let pin = null;
let markerLayer = null;

let testing = false;
let cancelTest = false;

/* ------------------------------------------------------------------ */
/*  Inicio                                                             */
/* ------------------------------------------------------------------ */

async function boot() {
  cfg = await getConfig();
  center = { ...cfg.center };
  radiusKm = cfg.radiusKm;
  selected = new Set((cfg.cameras || []).map((c) => padId(c.apiId)));

  el('radius').value = String(radiusKm);
  el('layout').value = `${cfg.layout.cols}x${cfg.layout.rows}`;
  updateRadiusLabel();
  updateCenterLabel();

  initMap();

  try {
    const raw = await getCameras();
    all = raw
      .map((c) => ({
        apiId: padId(c.apiId),
        nome: c.nome || c.apiId,
        lat: Number(c.lat),
        lon: Number(c.lon),
      }))
      .filter((c) => c.apiId && Number.isFinite(c.lat) && Number.isFinite(c.lon));

    byId = new Map(all.map((c) => [c.apiId, c]));
    groups = groupCameras(all);
    render();
  } catch (err) {
    listEl().innerHTML =
      '<div class="empty">Não foi possível carregar a lista de câmeras do COR.<br>Verifique a conexão e recarregue a página.</div>';
    console.error(err);
  }
}

/* ------------------------------------------------------------------ */
/*  Mapa                                                               */
/* ------------------------------------------------------------------ */

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([center.lat, center.lon], 15);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  circle = L.circle([center.lat, center.lon], {
    radius: radiusKm * 1000,
    color: '#4fd18b',
    weight: 1,
    opacity: 0.75,
    fillColor: '#4fd18b',
    fillOpacity: 0.05,
    interactive: false,
  }).addTo(map);

  pin = L.marker([center.lat, center.lon], {
    draggable: true,
    icon: L.divIcon({
      className: '',
      html: '<div class="center-pin"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  }).addTo(map);

  pin.on('dragend', () => {
    const p = pin.getLatLng();
    setCenter({ lat: p.lat, lon: p.lng, label: 'Ponto ajustado' }, { movePin: false });
    namePoint(p.lat, p.lng);
  });

  // Botao direito escolhe o ponto: e o gesto mais direto para "quero ver aqui".
  map.on('contextmenu', (e) => {
    if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);
    setCenter({ lat: e.latlng.lat, lon: e.latlng.lng, label: 'Ponto escolhido' });
    namePoint(e.latlng.lat, e.latlng.lng);
  });

  // Como no Google Maps: arrastou o mapa, aparece "Buscar nesta area".
  map.on('moveend', updateAreaButton);
}

function updateAreaButton() {
  if (!map) return;
  const c = map.getCenter();
  const longe = haversineKm(center.lat, center.lon, c.lat, c.lng) > 0.12;
  el('search-area').hidden = !longe;
}

function setCenter(next, { movePin = true, moveView = false, zoom } = {}) {
  center = next;
  reverseToken += 1;
  if (movePin) pin.setLatLng([center.lat, center.lon]);
  circle.setLatLng([center.lat, center.lon]);
  updateCenterLabel();
  if (moveView) map.setView([center.lat, center.lon], zoom ?? map.getZoom());
  render();
  updateAreaButton();
}

function updateCenterLabel() {
  el('center-label').textContent =
    center.label || `${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`;
}

/* ------------------------------------------------------------------ */
/*  Busca por regiao (CEP, endereco, ponto no mapa)                    */
/* ------------------------------------------------------------------ */

let reverseToken = 0;

/** Da um nome legivel ao ponto escolhido (chega depois, sem travar a tela). */
async function namePoint(lat, lon) {
  const token = ++reverseToken;
  try {
    const r = await fetch(`/api/geo/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
    if (!r.ok) return;
    const j = await r.json();
    if (token !== reverseToken || !j.label) return;
    center.label = j.label;
    updateCenterLabel();
  } catch {
    /* sem nome: fica "Ponto escolhido" */
  }
}

let toastTimer = null;
function toast(msg) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.className = 'toast';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 3400);
}

function hideResults() {
  const box = el('search-results');
  box.hidden = true;
  box.innerHTML = '';
}

function showResults(list) {
  const box = el('search-results');
  box.innerHTML = '';

  for (const p of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-hit';
    btn.textContent = p.label;
    btn.title = p.label;
    btn.addEventListener('click', () => applyPlace(p));
    box.appendChild(btn);
  }

  box.hidden = false;
}

function zoomForBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return 15;
  const dLat = Math.abs(bbox[1] - bbox[0]);
  if (dLat > 0.25) return 11;
  if (dLat > 0.09) return 12;
  if (dLat > 0.03) return 14;
  if (dLat > 0.012) return 15;
  return 16;
}

function applyPlace(p) {
  hideResults();
  el('search').value = '';
  query = '';
  setCenter({ lat: p.lat, lon: p.lon, label: p.label }, { moveView: true, zoom: zoomForBbox(p.bbox) });
  renderList();
  if (p.aproximado) {
    toast('CEP localizado na altura aproximada da rua. Arraste o pino para ajustar.');
  }
}

let searching = false;

async function goTo(raw) {
  const q = String(raw || '').trim();
  if (q.length < 3) {
    toast('Digite um CEP ou um endereço para ir até a região.');
    return;
  }
  if (searching) return;

  searching = true;
  el('go').disabled = true;
  hideResults();

  try {
    const isCep = /^\d{5}-?\d{3}$/.test(q);
    const url = isCep
      ? `/api/geo/cep?cep=${q.replace(/\D+/g, '')}`
      : `/api/geo/search?q=${encodeURIComponent(q)}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error('busca falhou');
    const j = await r.json();
    const results = Array.isArray(j.results) ? j.results : [];

    if (!results.length) {
      toast(`Nada encontrado para "${q}".`);
      return;
    }

    if (results.length === 1) applyPlace(results[0]);
    else showResults(results);
  } catch {
    toast('Não foi possível buscar agora. Verifique a conexão e tente de novo.');
  } finally {
    searching = false;
    el('go').disabled = false;
  }
}

el('search-area').addEventListener('click', () => {
  const c = map.getCenter();
  setCenter({ lat: c.lat, lon: c.lng, label: 'Área do mapa' });
  namePoint(c.lat, c.lng);
  toast('Região atualizada para o centro do mapa.');
});

function distTo(cam) {
  return haversineKm(center.lat, center.lon, cam.lat, cam.lon);
}

function renderMarkers() {
  markerLayer.clearLayers();
  for (const g of groups) {
    const d = distTo(g.rep);
    if (d > radiusKm) continue;

    const isSel = selected.has(g.rep.apiId);
    const st = status[g.rep.apiId]?.state;
    const fill = isSel
      ? '#4fd18b'
      : st === 'live'
        ? '#4fd18b'
        : st === 'codec'
          ? '#ff7a6b'
          : st === 'offline'
            ? '#7b8088'
            : '#5a95e6';

    const marker = L.circleMarker([g.rep.lat, g.rep.lon], {
      radius: isSel ? 8 : 6,
      color: isSel ? '#ffffff' : 'rgba(0,0,0,0.65)',
      weight: isSel ? 2 : 1,
      fillColor: fill,
      fillOpacity: 0.95,
      bubblingMouseEvents: false,
    }).addTo(markerLayer);

    marker.bindTooltip(`${prettyName(g.rep.nome)} · ${fmtKm(d)}`, { direction: 'top' });
    marker.on('click', () => toggle(g.rep.apiId));
  }
}

/* ------------------------------------------------------------------ */
/*  Lista                                                              */
/* ------------------------------------------------------------------ */

function listEl() {
  return el('list');
}

function visibleGroups() {
  const q = norm(query);
  return groups
    .map((g) => ({ g, d: distTo(g.rep) }))
    .filter((x) => x.d <= radiusKm)
    .filter((x) => !q || norm(x.g.rep.nome).includes(q))
    .sort((a, b) => a.d - b.d);
}

function render() {
  renderMarkers();
  renderList();
  renderChips();

  const near = groups.filter((g) => distTo(g.rep) <= radiusKm).length;
  el('count').textContent = `${near} no raio · ${selected.size} selecionada${selected.size === 1 ? '' : 's'}`;
}

function renderList() {
  const rows = visibleGroups();
  const root = listEl();
  root.innerHTML = '';

  if (!rows.length) {
    root.innerHTML = '<div class="empty">Nenhuma câmera neste raio.<br>Aumente o raio ou arraste o pino.</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  for (const { g, d } of rows) {
    const apiId = g.rep.apiId;
    const isSel = selected.has(apiId);
    const st = status[apiId]?.state;

    const row = document.createElement('div');
    row.className = 'group' + (isSel ? ' selected' : '');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const check = document.createElement('div');
    check.className = 'check';
    check.textContent = '✓';

    const info = document.createElement('div');
    info.className = 'info';

    const name = document.createElement('div');
    name.className = 'gname';
    name.textContent = prettyName(g.rep.nome);
    name.title = g.rep.nome;

    const sub = document.createElement('div');
    sub.className = 'gsub';
    const dist = document.createElement('span');
    dist.textContent = fmtKm(d);
    const id = document.createElement('span');
    id.textContent = `#${apiId}`;
    sub.append(dist, id);

    info.append(name, sub);

    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex;gap:4px;align-items:center';

    if (st === 'live') badges.appendChild(badge('ao vivo', 'live'));
    else if (st === 'offline') badges.appendChild(badge('fora', 'offline'));
    else if (st === 'codec') badges.appendChild(badge('H.265', 'codec'));

    if (g.items.length > 1) badges.appendChild(badge(`${g.items.length}`, 'dupe'));

    row.append(check, info, badges);

    const act = () => toggle(apiId);
    row.addEventListener('click', act);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        act();
      }
    });

    frag.appendChild(row);
  }

  root.appendChild(frag);
}

function badge(text, kind) {
  const b = document.createElement('span');
  b.className = 'badge ' + kind;
  b.textContent = text;
  return b;
}

function renderChips() {
  const root = el('chips');
  root.innerHTML = '';

  const total = selected.size;
  el('chips-count').textContent =
    total === 0 ? 'Nenhuma câmera selecionada' : `${total} selecionada${total === 1 ? '' : 's'}`;
  el('clear').disabled = total === 0;

  if (!selected.size) {
    const empty = document.createElement('span');
    empty.className = 'note';
    empty.textContent = 'Marque as câmeras na lista ou no mapa.';
    root.appendChild(empty);
    return;
  }

  for (const apiId of selected) {
    const cam = byId.get(apiId);
    const saved = (cfg.cameras || []).find((c) => padId(c.apiId) === apiId);
    const label = prettyName(cam?.nome || saved?.nome || apiId);

    const chip = document.createElement('span');
    chip.className = 'chip';

    const text = document.createElement('span');
    text.textContent = label;
    text.title = label;

    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Remover';
    x.addEventListener('click', () => {
      selected.delete(apiId);
      render();
    });

    chip.append(text, x);
    root.appendChild(chip);
  }
}

/* ------------------------------------------------------------------ */
/*  Acoes                                                              */
/* ------------------------------------------------------------------ */

function toggle(apiId) {
  if (selected.has(apiId)) {
    selected.delete(apiId);
  } else {
    if (selected.size >= MAX_CAMERAS) {
      alert(`O limite é ${MAX_CAMERAS} câmeras. Remova alguma antes de adicionar outra.`);
      return;
    }
    selected.add(apiId);
  }
  render();
}

function updateRadiusLabel() {
  el('radius-val').textContent = `${radiusKm.toFixed(1).replace('.', ',')} km`;
}

el('radius').addEventListener('input', () => {
  radiusKm = Number(el('radius').value);
  updateRadiusLabel();
  circle.setRadius(radiusKm * 1000);
  render();
});

el('search').addEventListener('input', () => {
  query = el('search').value;
  hideResults();
  renderList();
});

el('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    goTo(el('search').value);
  }
  if (e.key === 'Escape') hideResults();
});

el('go').addEventListener('click', () => goTo(el('search').value));

el('clear').addEventListener('click', () => {
  if (!selected.size) return;
  selected.clear();
  render();
  toast('Seleção limpa. Escolha as câmeras da nova região.');
});

el('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('Geolocalização não disponível neste navegador.');
    return;
  }
  el('locate').disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el('locate').disabled = false;
      setCenter(
        {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: 'Minha localização',
        },
        { moveView: true, zoom: 16 }
      );
    },
    () => {
      el('locate').disabled = false;
      toast('Não foi possível obter a localização. Arraste o mapa ou use um CEP.');
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

/* ------------------------------------------------------------------ */
/*  Teste de cameras                                                   */
/* ------------------------------------------------------------------ */

function probe(apiId, timeout = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0';
    document.body.appendChild(video);

    const player = new CameraPlayer(apiId, video, (state) => {
      if (state === 'live') finish('live');
      else if (state === 'codec') finish('codec');
      else if (state === 'offline') finish('offline');
    });

    const timer = setTimeout(() => finish('offline'), timeout);

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      player.stop(true);
      video.remove();
      resolve(result);
    }

    player.start();
  });
}

function setProgress(done, total) {
  el('progress').hidden = false;
  el('progress').firstElementChild.style.width = `${total ? (done / total) * 100 : 0}%`;
  el('test-note').hidden = false;
  el('test-note').textContent = `Testando ${done}/${total}…`;
}

async function runTests(ids) {
  testing = true;
  cancelTest = false;
  el('test').textContent = 'Parar';

  let index = 0;
  let done = 0;
  setProgress(0, ids.length);

  const worker = async () => {
    while (index < ids.length && !cancelTest) {
      const id = ids[index++];
      const result = await probe(id);
      status[id] = { state: result, at: Date.now() };
      writeStatus(status);
      done += 1;
      setProgress(done, ids.length);
      renderList();
      renderMarkers();
    }
  };

  await Promise.all([worker(), worker()]);

  testing = false;
  el('test').textContent = 'Testar';
  el('test-note').textContent = cancelTest ? 'Teste interrompido.' : 'Teste concluído.';
  setTimeout(() => {
    el('progress').hidden = true;
    el('test-note').hidden = true;
  }, 2500);
  render();
}

el('test').addEventListener('click', async () => {
  if (testing) {
    cancelTest = true;
    return;
  }

  const ids = visibleGroups().map((x) => x.g.rep.apiId);
  if (!ids.length) return;

  if (ids.length > 30) {
    const minutes = Math.ceil((ids.length * 6) / 60);
    if (!confirm(`Testar ${ids.length} câmeras pode levar ~${minutes} min. Continuar?`)) return;
  }

  await runTests(ids);
});

/* ------------------------------------------------------------------ */
/*  Salvar                                                             */
/* ------------------------------------------------------------------ */

function parseLayout(value) {
  const [cols, rows] = value.split('x').map(Number);
  return { cols, rows };
}

async function save() {
  const layout = parseLayout(el('layout').value);
  const slots = layout.cols * layout.rows;

  if (selected.size > slots) {
    const ok = confirm(
      `Você selecionou ${selected.size} câmeras, mas o layout ${layout.cols}×${layout.rows} mostra ${slots}. ` +
        'As primeiras serão usadas. Continuar?'
    );
    if (!ok) return;
  }

  const cameras = [...selected].map((apiId) => {
    const cam = byId.get(apiId);
    const saved = (cfg.cameras || []).find((c) => padId(c.apiId) === apiId);
    return { apiId, nome: cam?.nome || saved?.nome || '' };
  });

  cfg = { center, radiusKm, layout, cameras };

  try {
    await putConfig(cfg);
    location.href = '/mosaic.html';
  } catch (err) {
    alert('Não foi possível salvar: ' + err.message);
  }
}

el('save').addEventListener('click', save);
el('open-mosaic').addEventListener('click', save);

boot().catch((err) => {
  console.error(err);
  el('center-label').textContent = 'Falha ao carregar';
});

/* Ajuda a diagnosticar pelo console do navegador: __selector.map() */
window.__selector = {
  map: () => map,
  center: () => center,
  selected: () => selected,
};
