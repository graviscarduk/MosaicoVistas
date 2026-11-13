/** Registro dos providers de cameras. */

import corRio from './cor-rio.mjs';
import caltransD7 from './caltrans-d7.mjs';
import cetSp from './cet-sp.mjs';
import madrid from './madrid.mjs';

const ALL = [corRio, caltransD7, cetSp, madrid];

export const PROVIDERS = new Map(ALL.map((p) => [p.id, p]));
export const DEFAULT_PROVIDER = 'cor-rio';

export function getProvider(id) {
  return PROVIDERS.get(String(id || '')) || null;
}

/** Dados que o navegador precisa para montar o seletor de cidade. */
export function publicProviders() {
  return ALL.map((p) => ({
    id: p.id,
    label: p.label,
    attribution: p.attribution,
    creditUrl: p.creditUrl || null,
    kind: p.kind,
    mediaLabel: p.mediaLabel || null,
    countryCode: p.countryCode || 'br',
    defaultCenter: p.defaultCenter,
    defaultZoom: p.defaultZoom || 14,
    defaultRadiusKm: p.defaultRadiusKm,
    maxRadiusKm: p.maxRadiusKm || 3,
  }));
}
