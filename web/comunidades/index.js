// Comunidades con veredicto. Cada una aporta sus fuentes de planeamiento y afecciones y su tabla de
// normas (normas/*.json). Se elige por la provincia del Catastro, que coincide con la del INE.

import cyl from './cyl.js';
import madrid from './madrid.js';
import cantabria from './cantabria.js';
import cataluna from './cataluna.js';
import baleares from './baleares.js';
import valenciana from './valenciana.js';
import murcia from './murcia.js';
import aragon from './aragon.js';
import clm from './clm.js';
import rioja from './rioja.js';

export const COMUNIDADES = [cyl, madrid, cantabria, cataluna, baleares, valenciana, murcia, aragon, clm, rioja];

export const comunidadDe = (provincia) => COMUNIDADES.find((c) => c.provincias.includes(provincia)) ?? null;

const normas = new Map();
export function normasDe(comunidad) {
  if (!normas.has(comunidad.id)) normas.set(comunidad.id, fetch(comunidad.normas).then((r) => r.json()));
  return normas.get(comunidad.id);
}
