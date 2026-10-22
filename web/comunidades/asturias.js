// Asturias: Registro de Planeamiento y Gestión Urbanística (RPGUR) del Principado, desde un extracto estático
// (web/datos/asturias/, de tools/extracto_asturias.py). Su GeoServer solo va por http y tarda 5-15 s por
// parcela, porque el no urbanizable de cada concejo es un recinto de varios MB que lee entero también para
// pintarlo. Teselas de 2 km en EPSG:25830, coordenadas enteras en decímetros con deltas.
//
// Categorías (medido el 16/10/2026): urbano SU-C y SU-NC, urbanizable SUR-S, SUR-NS y SUR-PR, no urbanizable
// SNU-EP, SNU-I, SNU-C, SNU-IF y núcleo rural (de la capa de no urbanizable y de la de núcleos, 5.401).

import { agrupar, caja } from '../geo.js';

const TESELA = 2000;
const NOMBRES = {
  NR: 'Núcleo rural', 'SNU-EP': 'Suelo no urbanizable de especial protección', 'SNU-I': 'Suelo no urbanizable de interés',
  'SNU-C': 'Suelo no urbanizable de costas', 'SNU-IF': 'Suelo no urbanizable de infraestructuras', 'SU-C': 'Suelo urbano consolidado',
  'SU-NC': 'Suelo urbano no consolidado', 'SUR-S': 'Suelo urbanizable sectorizado', 'SUR-NS': 'Suelo urbanizable no sectorizado',
  'SUR-PR': 'Suelo urbanizable prioritario',
};

const teselas = new Map();
// Una tesela que no existe es terreno sin planeamiento publicado (o mar): lista vacía
function tesela(tx, ty) {
  const k = `${tx}_${ty}`;
  if (!teselas.has(k)) {
    teselas.set(k, fetch(`datos/asturias/${k}.json`).then((r) => (r.ok ? r.json() : [])).catch((e) => { teselas.delete(k); throw e; }));
  }
  return teselas.get(k);
}

let planes = null;
const planesVigentes = () => (planes ??= fetch('datos/asturias/planes.json').then((r) => r.json()));

// [dx0, dy0, dx1, dy1...] en decímetros → [[x, y]...] en metros
function anillo(plano) {
  const pts = [];
  let x = 0, y = 0;
  for (let i = 0; i < plano.length; i += 2) {
    x += plano[i]; y += plano[i + 1];
    pts.push([x / 10, y / 10]);
  }
  return pts;
}

export default {
  id: 'asturias',
  nombre: 'Asturias',
  provincias: ['33'],
  normas: 'normas/asturias.json',
  fuentes: 'Principado de Asturias (Registro de Planeamiento y Gestión Urbanística, extracto del 16/10/2026)',
  consultadas: null,
  pendientes: 'montes, vías pecuarias, Red Natura 2000, espacios naturales protegidos, costas, carreteras ni patrimonio',

  async suelo(_caja, utm, _superficie, datos) {
    const [x0, y0, x1, y1] = caja(utm);
    const pedidas = [];
    for (let tx = Math.floor(x0 / TESELA); tx <= Math.floor(x1 / TESELA); tx++) {
      for (let ty = Math.floor(y0 / TESELA); ty <= Math.floor(y1 / TESELA); ty++) pedidas.push(tesela(tx, ty));
    }
    const [trozos, vigentes] = await Promise.all([Promise.all(pedidas), planesVigentes()]);
    // En el urbano el «nombre» que da el plan suele ser el del propio concejo: no dice nada
    const plano = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const propio = (d) => d && datos?.municipio && plano(d) === plano(datos.municipio);
    const recintos = trozos.flat().map(([codigo, detalle, municipio, anillos]) => ({
      geometry: { type: 'Polygon', coordinates: anillos.map(anillo) }, codigo, nombre: NOMBRES[codigo] ?? codigo, detalle: propio(detalle) ? null : detalle, municipio,
    }));
    // El plan del concejo que más recintos pone en la parcela
    const municipio = [...agrupar(recintos, (r) => r.municipio)].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    return { recintos, plan: vigentes[municipio] ?? null, notas: {} };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    const fecha = p.aprobado && new Date(p.aprobado).toLocaleDateString('es-ES');
    return {
      titulo: `Planeamiento de ${datos.municipio}`,
      texto: `${p.nombre}${fecha ? `, aprobado el ${fecha}` : ''}. La clasificación sale del Registro de Planeamiento y Gestión Urbanística del Principado (extracto del 16/10/2026). Las normas del plan pueden ser más estrictas que la ley: parcela mínima, alturas o materiales.`,
      enlace: null,
    };
  },
};
