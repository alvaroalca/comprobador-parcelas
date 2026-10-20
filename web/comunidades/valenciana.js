// Comunitat Valenciana: planeamiento urbanístico refundido de la Generalitat (ICV, MapServer WFS en
// EPSG:25830, GeoJSON y CORS abierto).
//
// Medido el 14/10/2026: 122.840 recintos con la zona normalizada de la LOTUP (`zon_suelo`: ZUR-RE, ZND-IN,
// ZRC-AG, ZRP-NA-LG...) y, si son dotación pública, su código (`dotacion`: PV, SQE-DO...). Toda la
// comunidad cabe en 23 combinaciones de clase y zona. MapServer no entiende CQL_FILTER: se pide por caja.

import { area, conReintento, traer } from '../geo.js';

const WFS = 'https://terramapas.icv.gva.es/0702_Planeamiento';
const PARCELA_MINIMA = 10000; // art. 211.1.b.1.º: una hectárea por vivienda

// zon_suelo -> código de la tabla. Las franjas de dominio público (carreteras, ferrocarril, cauces, vías
// pecuarias, tendidos, costas) van juntas: en todas manda su ley sectorial.
function codigo({ clas_suelo: clase, zon_suelo: zona = '', dotacion }) {
  if (dotacion) return 'DOT';
  if (/^ZUR-(IN|TR)/.test(zona)) return zona.slice(0, 6);
  if (zona.startsWith('ZUR')) return 'ZUR';
  if (zona.startsWith('ZND')) return 'ZND';
  if (/^ZRC-(AG|FO|EX)/.test(zona)) return zona.slice(0, 6);
  if (/^ZRP-(CR|CF|CA|DP|OT|CT)/.test(zona)) return 'ZRP-AF';
  if (/^ZRP-NA-LG/.test(zona)) return 'ZRP-NA-LG';
  if (/^ZRP-(AG|RI|PC)/.test(zona)) return zona.slice(0, 6);
  if (zona.startsWith('ZRP')) return 'ZRP-NA-MU';
  return { SU: 'ZUR', SUZ: 'ZND', 'SNU-C': 'ZRC-AG', 'SNU-P': 'ZRP-NA-MU' }[clase] ?? null;
}

function porCaja([x0, y0, x1, y1]) {
  return conReintento(async () => {
    const q = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'ms:Planeamiento.Clasificacion',
      outputFormat: 'application/json; subtype=geojson', bbox: `${x0},${y0},${x1},${y1},urn:ogc:def:crs:EPSG::25830`,
    });
    const r = await traer(`${WFS}?${q}`);
    if (!r.ok) throw new Error(`terramapas.icv.gva.es respondió ${r.status}`);
    return (await r.json()).features;
  });
}

export default {
  id: 'valenciana',
  nombre: 'Comunitat Valenciana',
  provincias: ['03', '12', '46'],
  normas: 'normas/valenciana.json',
  capaSuelo: {
    wms: WFS,
    capa: 'Planeamiento.Clasificacion',
    limites: [-1.6, 37.8, 0.7, 40.8],
    atribucion: '© Generalitat Valenciana',
  },
  fuentes: 'Generalitat Valenciana (planeamiento urbanístico del Instituto Cartográfico Valenciano)',
  consultadas: 'zonas de protección del propio planeamiento (Generalitat Valenciana)',
  pendientes: 'Red Natura 2000, montes de utilidad pública, espacios naturales protegidos ni patrimonio fuera de lo que ya marque el plan',

  async suelo(cajaUtm, utm, superficieCatastro) {
    const fs = await porCaja(cajaUtm);
    const pequena = (superficieCatastro ?? area(utm)) < PARCELA_MINIMA;
    const recintos = fs.flatMap((f) => {
      const p = f.properties;
      let c = codigo(p);
      if (!c) return [];
      if (pequena && (c === 'ZRC-AG' || c === 'ZRC-FO')) c = 'ZRC-PEQ';
      return [{ geometry: f.geometry, codigo: c, nombre: p.descripcio || p.clas_suelo, detalle: p.dotacion ? p.dot_descri : p.descripcio }];
    });
    // El instrumento: el del primer recinto que lo nombra (casi siempre el plan general)
    const plan = fs.map((f) => f.properties).find((p) => p.denominaci) ?? null;
    return { recintos, plan };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    return {
      titulo: `Planeamiento de ${p.noms_mun ?? datos.municipio}`,
      texto: `${p.denominaci}${p.expediente ? ` (expediente ${p.expediente})` : ''}. La clasificación sale del planeamiento refundido de la Generalitat Valenciana. Las normas del plan pueden ser más estrictas que la ley: parcela mínima, si la zona admite vivienda, alturas o materiales.`,
      enlace: p.url_abs && { href: p.url_abs, texto: 'Planeamiento del municipio en el Registro autonómico' },
    };
  },
};
