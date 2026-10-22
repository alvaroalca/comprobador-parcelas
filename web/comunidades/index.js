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
import canarias from './canarias.js';
import asturias from './asturias.js';
import euskadi from './euskadi.js';
import extremadura from './extremadura.js';
import andalucia from './andalucia.js';
import navarra from './navarra.js';
import galicia from './galicia.js';
import { ceuta, melilla } from './ciudades.js';

export const COMUNIDADES = [cyl, madrid, cantabria, cataluna, baleares, valenciana, murcia, aragon, clm, rioja, canarias, asturias, euskadi, extremadura, andalucia, navarra, galicia, ceuta, melilla];

export const comunidadDe = (provincia) => COMUNIDADES.find((c) => c.provincias.includes(provincia)) ?? null;

const normas = new Map();
export function normasDe(comunidad) {
  // Un fallo no se guarda: la siguiente finca de la comunidad lo vuelve a intentar en vez de heredar el error
  if (!normas.has(comunidad.id)) {
    normas.set(comunidad.id, fetch(comunidad.normas)
      .then((r) => { if (!r.ok) throw new Error(`no se pudo cargar ${comunidad.normas} (${r.status})`); return r.json(); })
      .catch((e) => { normas.delete(comunidad.id); throw e; }));
  }
  return normas.get(comunidad.id);
}
