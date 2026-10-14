// Comunidad de Madrid: clasificación del suelo del planeamiento refundido (Sistema de Información
// Territorial, sin validez jurídica), montes, vías pecuarias y Red Natura 2000 de la IDEM.
//
// Medido el 14/10/2026: la capa trae por recinto unas siglas comunes a toda la comunidad (CD_SIGLAS)
// y el nombre que le da cada plan municipal (1.387 variantes). El veredicto sale de las siglas; el
// nombre municipal se enseña. El refundido de 2025 deja fuera 13 municipios (Madrid capital entre
// ellos) que sí están en el de 2023 o, Madrid capital, solo en el plan general original digitalizado.

import { area, comoMulti, cuotas, poligonos, wfs, wkt } from '../geo.js';

const IDEM = 'https://idem.comunidad.madrid/geoidem/wfs';

// De la más reciente a la más antigua. Se usa la primera que cubra la parcela.
const VERSIONES = [
  { capa: 'UsoDelSuelo:VPLA_V_CLASIFICACION_REF_25', fecha: 'FC_REF', refundido: true },
  { capa: 'UsoDelSuelo:VPLA_V_CLASIFICACION_REF_23', fecha: 'FC_REF', refundido: true },
  { capa: 'UsoDelSuelo:VPLA_V_CLASIFICACION', fecha: 'FC_AC', refundido: false },
];

const fecha = (iso) => iso && new Date(iso.replace('Z', '')).toLocaleDateString('es-ES');

// Parte de la parcela cubierta por la unión de los recintos.
function cobertura(utm, features) {
  if (!features.length) return 0;
  const union = poligonos.union(...features.map((f) => comoMulti(f.geometry)));
  return area(poligonos.intersection(utm, union)) / area(utm);
}

export default {
  id: 'madrid',
  nombre: 'Comunidad de Madrid',
  provincias: ['28'],
  normas: 'normas/madrid.json',
  capaSuelo: {
    wms: 'https://idem.comunidad.madrid/geoidem/UsoDelSuelo/wms',
    capa: 'VPLA_V_CLASIFICACION_REF_25',
    limites: [-4.6, 39.85, -3.0, 41.2],
    atribucion: '© Comunidad de Madrid',
  },
  fuentes: 'Comunidad de Madrid (planeamiento refundido sin validez jurídica, montes, vías pecuarias y Red Natura 2000)',
  consultadas: 'montes de utilidad pública, montes preservados, vías pecuarias y Red Natura 2000 (Comunidad de Madrid)',
  pendientes: 'espacios naturales protegidos, carreteras ni patrimonio',

  async suelo(_caja, utm) {
    const filtro = `INTERSECTS(GEOMETRY1,SRID=25830;${wkt(utm, 2)})`;
    for (const v of VERSIONES) {
      const fs = await wfs(IDEM, v.capa, filtro, `GEOMETRY1,CD_SIGLAS,DS_CLASIF_GEN,DS_CLASIF_DET,DS_MUNICIPIO,${v.fecha}`, 'EPSG:25830');
      if (cobertura(utm, fs) < 0.5) continue;
      const p = fs[0].properties;
      return {
        recintos: fs.map((f) => ({
          geometry: f.geometry,
          // Lo «aplazado» no está en vigor: la Comunidad dejó pendiente su aprobación
          codigo: /_A$/.test(f.properties.CD_SIGLAS) ? 'APLAZADO' : f.properties.CD_SIGLAS,
          nombre: f.properties.DS_CLASIF_GEN,
          detalle: f.properties.DS_CLASIF_DET,
        })),
        fuente: { refundido: v.refundido, fecha: fecha(p[v.fecha]), municipio: p.DS_MUNICIPIO },
      };
    }
    return { recintos: [], fuente: null };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const f = suelo.fuente;
    if (!f) return null;
    const municipio = datos.municipio ?? f.municipio;
    return {
      titulo: `Planeamiento de ${municipio}`,
      texto: f.refundido
        ? `Clasificación del refundido del planeamiento que elabora la Comunidad de Madrid${f.fecha ? `, con fecha ${f.fecha}` : ''}. Es un trabajo técnico sin validez jurídica. El plan del ayuntamiento manda y sus normas pueden ser más estrictas (parcela mínima, alturas, materiales).`
        : `El refundido de la Comunidad no incluye este municipio. La clasificación sale del plan general original${f.fecha ? ` aprobado el ${f.fecha}` : ''}, sin las modificaciones posteriores: confírmala en el ayuntamiento.`,
      enlace: { href: 'https://idem.comunidad.madrid/cartografia/sitcm', texto: 'Sistema de Información Territorial de la Comunidad' },
    };
  },

  afecciones(_lonlat, utm) {
    const filtro = `INTERSECTS(GEOMETRY1,SRID=25830;${wkt(utm, 2)})`;
    const capa = async (nombre, props) => cuotas(await wfs(IDEM, nombre, filtro, `GEOMETRY1,${props}`, 'EPSG:25830'), utm);
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const ms = await capa('Zonas:IDEM_MA_MONTES_UP', 'CD_UP,DS_NOMBRE');
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `nº ${m.CD_UP} «${m.DS_NOMBRE}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      preservado: {
        nombre: 'montes preservados',
        consulta: async () => {
          const ms = await capa('Zonas:IDEM_MA_MONTES_PRESERVADOS', 'DS_TIPO');
          return ms.length ? [{ tipo: 'preservado', detalle: ms.map((m) => `${m.DS_TIPO.toLowerCase()}: ${pct(m)}`).join(', ') }] : [];
        },
      },
      vvpp: {
        nombre: 'vías pecuarias',
        consulta: async () => {
          const vs = await capa('Zonas:IDEM_MA_VIAS_PECUARIAS', 'DS_NOMBRE,DS_TIPO');
          return vs.length ? [{ tipo: 'vvpp', detalle: vs.map((v) => `${v.DS_NOMBRE}: ${pct(v)}`).join(', ') }] : [];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const [zec, zepa] = await Promise.all([
            capa('LugaresProtegidos:IDEM_MA_RED_NATURA_LIC_ZEC', 'CD_ZEC_CODE,DS_ZEC_NAME'),
            capa('LugaresProtegidos:IDEM_MA_RED_NATURA_ZEPA', 'CD_ZEPA,DS_ZEPA'),
          ]);
          const espacios = [...zec.map((z) => `ZEC «${z.DS_ZEC_NAME}»: ${pct(z)}`), ...zepa.map((z) => `ZEPA «${z.DS_ZEPA}»: ${pct(z)}`)];
          return espacios.length ? [{ tipo: 'natura', detalle: espacios.join(', ') }] : [];
        },
      },
    };
  },
};
