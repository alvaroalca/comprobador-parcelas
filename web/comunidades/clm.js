// Castilla-La Mancha: Sistema de Información Urbana (SIU) de la Junta, figura de planeamiento de cada
// municipio, montes de utilidad pública, vías pecuarias y Red Natura 2000. Todo ArcGIS REST en EPSG:25830.
//
// Medido el 16/10/2026: 29.941 recintos en 920 municipios, también en los 284 sin planeamiento (ahí la Junta
// pone el casco como urbano, las protecciones sectoriales como especial protección y el resto como reserva).
// Clase, categoría y diferenciación vienen escritas a mano, con erratas («URBANIZALBE», «ESPECIALPROTECCIÓN»):
// se normalizan sin tildes y por palabras. `SUP_GIS` no sirve (repite la superficie del municipio). La
// superficie mínima para la vivienda en rústico la fija la Instrucción Técnica de Planeamiento (Orden 4/2020).

import { area, arcgis, caja, cuotas, distancia } from '../geo.js';

const VECTOR = 'https://geoservicios.castillalamancha.es/arcgis/rest/services/Vector';
const CLASIFICACION = `${VECTOR}/Sistema_Informacion_Urbana/MapServer/1`;
const PLANEAMIENTO = `${VECTOR}/Planeamiento_Municipal/MapServer/0`;
const MONTES = `${VECTOR}/Montes_Utilidad_Publica/MapServer/0`;
const VIAS = `${VECTOR}/Vias_Pecuarias/MapServer/0`;
const NATURA = `${VECTOR}/RN_2000_limites/MapServer/0`;

// Orden 4/2020, art. 5: vivienda aislada y vivienda ligada a una explotación, por categoría
const MINIMA = { SRR: [15000, 10000], SRNUEP: [30000, 15000] };
// Art. 54.3: la regla de los 200 m al suelo urbano no rige en municipios de hasta 5.000 habitantes
const HABITANTES_200M = 5000;

const FIGURAS = {
  POM: 'Plan de Ordenación Municipal', PGOU: 'Plan General de Ordenación Urbana', 'NNSS-A': 'Normas Subsidiarias tipo A',
  'NNSS-B': 'Normas Subsidiarias tipo B', DSU: 'Delimitación de Suelo Urbano', PDSU: 'Plan de Delimitación de Suelo Urbano',
  SP: 'Sin planeamiento propio',
};

const norma = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
// «6 -Cr de Balazote» → «Cordel de Balazote»
const TIPOS_VIA = { Cñ: 'Cañada', Cr: 'Cordel', Vr: 'Vereda', Cl: 'Colada', Ab: 'Abrevadero', Ds: 'Descansadero' };
const nombreVia = (t) => (t ?? 'Vía pecuaria').replace(/^\d+\s*-\s*/, '').replace(/^(Cñ|Cr|Vr|Cl|Ab|Ds)(?= )/, (a) => TIPOS_VIA[a]);
const fecha = (ms) => ms && new Date(ms).toLocaleDateString('es-ES');
const mayus = (t) => t && t[0] + t.slice(1).toLowerCase();

// La parcela como polígono ArcGIS: pedir por caja trae de más con parcelas alargadas
const comoArcgis = (utm) => ({
  geometry: JSON.stringify({ rings: utm.flat().map((r) => r.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])), spatialReference: { wkid: 25830 } }),
  geometryType: 'esriGeometryPolygon',
});

// Clase y categoría del SIU → código de normas/clm.json (sin el sufijo de superficie)
function codigo(p) {
  const clase = norma(p.CLASE), cat = norma(p.CATEGORIA), sub = norma(p.SUBCATEGOR);
  if ([clase, cat, sub, norma(p.DIFERENC), norma(p.ADSCRIP)].some((t) => t === 'SG' || t.startsWith('SISTEMA GENERAL'))) return 'SG';
  const urbanizado = /^SI$/.test(norma(p.URBANIZADO));
  // La categoría manda sobre la clase: hay recintos «suelo urbano» con categoría de especial protección
  if (/PROTEC/.test(cat)) return 'SRNUEP';
  if (/RUSTICO|^DE RESERVA$/.test(clase)) return /RESERVA/.test(cat) || clase === 'DE RESERVA' ? 'SRR' : sub && sub !== 'DE RESERVA' ? 'SRNUEP' : 'SR';
  if (/URBANIZABLE/.test(clase)) return urbanizado ? 'SUZ-URB' : 'SUZ';
  if (/URBANO/.test(clase)) {
    if (/NO CONSOLIDADO/.test(cat)) return urbanizado ? 'SUNC-URB' : 'SUNC';
    if (/CONSOLIDADO/.test(cat)) return 'SUC';
    if (/RESERVA/.test(cat)) return 'SURES';
    return 'SU';
  }
  return null;
}

// En minúscula salvo las siglas (MUP, LIC, ZEPA, DP...)
const siglas = (t) => mayus(t.trim()).replace(/\b(mup|lic|zepa|zec|bic|dp|sg)\b/gi, (s) => s.toUpperCase());

// Qué protege el suelo protegido, para la ficha: «Protección natural · ZEPA»
function proteccion(p) {
  const d = norma(p.DIFERENC);
  const tipo = /^IN[FT]+RA?EST?RU[CT]+URAS?$/.test(d) ? 'de infraestructuras' : /^EQUIPAMIENTOS?$/.test(d) ? 'de equipamientos'
    : /HIDROLOGIC|AGRICOL|GANADER|FORESTAL|EXTRACTIV/.test(d) ? `estructural ${p.DIFERENC.trim().toLowerCase()}`
    : d ? p.DIFERENC.trim().toLowerCase().replace(/o$/, 'a') : null;
  return [tipo && `Protección ${tipo}`, p.ADSCRIP && siglas(p.ADSCRIP), p.DENOMINAC].filter(Boolean).join(' · ') || null;
}

export default {
  id: 'clm',
  nombre: 'Castilla-La Mancha',
  provincias: ['02', '13', '16', '19', '45'],
  normas: 'normas/clm.json',
  capaSuelo: {
    wms: 'https://geoservicios.castillalamancha.es/arcgis/services/Vector/Sistema_Informacion_Urbana/MapServer/WMSServer',
    capa: '1',
    limites: [-5.45, 38.0, -0.9, 41.35],
    atribucion: '© Junta de Comunidades de Castilla-La Mancha',
  },
  fuentes: 'Junta de Comunidades de Castilla-La Mancha (Sistema de Información Urbana, planeamiento municipal, montes, vías pecuarias y Red Natura 2000)',
  consultadas: 'montes de utilidad pública, vías pecuarias y Red Natura 2000 (Junta de Comunidades)',
  pendientes: 'espacios naturales protegidos, carreteras ni patrimonio',

  async suelo(_caja, utm, superficieCatastro) {
    const [fs, planes] = await Promise.all([
      arcgis(CLASIFICACION, caja(utm), { campos: 'CLASE,CATEGORIA,SUBCATEGOR,DIFERENC,ADSCRIP,NOMBR_PLAN,DENOMINAC,URBANIZADO,MUNICIPIO', extra: comoArcgis(utm) }),
      arcgis(PLANEAMIENTO, caja(utm), { campos: 'MUNICIPIO,PLAN_,NOM_PLAN,FECHA_APRO,HABITANTES,DESCARGA,DISPONIBLE', geometria: false, extra: comoArcgis(utm) }),
    ]);
    const superficie = superficieCatastro ?? area(utm);
    const plan = planes[0]?.properties ?? null;
    const ha = (m2) => (m2 / 10000).toLocaleString('es-ES', { maximumFractionDigits: 2 });
    const notas = {};
    const recintos = fs.flatMap((f) => {
      const p = f.properties;
      let c = codigo(p);
      if (!c) return [];
      const minima = MINIMA[c];
      if (minima) {
        const sufijo = superficie < minima[1] ? '-PEQ' : superficie < minima[0] ? '-MEDIA' : '';
        notas[c + sufijo] = `La parcela mide ${ha(superficie)} ha según el Catastro.`;
        c += sufijo;
      }
      const detalle = c.startsWith('SRNUEP') ? proteccion(p) : p.NOMBR_PLAN && p.NOMBR_PLAN !== 'Casco Urbano' ? p.NOMBR_PLAN : null;
      return [{ geometry: f.geometry, codigo: c, nombre: mayus(p.CATEGORIA ?? p.CLASE), detalle }];
    });
    if (/^PARCI/.test(norma(fs.find((f) => /^SU(Z|NC)$/.test(codigo(f.properties)))?.properties.URBANIZADO))) {
      notas.SUZ = notas.SUNC = 'El Sistema de Información Urbanística lo da como urbanizado en parte: pregunta en el ayuntamiento si esta parcela ya es solar.';
    }
    if (plan?.HABITANTES) {
      const aviso = plan.HABITANTES <= HABITANTES_200M
        ? ` ${plan.MUNICIPIO} tiene ${plan.HABITANTES.toLocaleString('es-ES')} habitantes: la regla de los 200 m al suelo urbano no rige.`
        : ` ${plan.MUNICIPIO} tiene ${plan.HABITANTES.toLocaleString('es-ES')} habitantes: a menos de 200 m del suelo urbano o urbanizable con programa aprobado hay riesgo de núcleo de población, salvo que el plan fije otra distancia.`;
      notas.SRR = (notas.SRR ?? '') + aviso;
    }
    return { recintos, plan, notas };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    const figura = p.NOM_PLAN || FIGURAS[p.PLAN_] || p.PLAN_;
    const texto = p.PLAN_ === 'SP'
      ? 'Sin planeamiento propio: rigen las Normas Subsidiarias Provinciales, y la clasificación del Sistema de Información Urbana la hace la Junta con el casco urbano y las protecciones sectoriales (el resto, rústico de reserva). La vivienda en rústico necesita además calificación urbanística.'
      : `${figura}${p.FECHA_APRO ? `, aprobado el ${fecha(p.FECHA_APRO)}` : ''}. La clasificación sale del Sistema de Información Urbana de la Junta. Las normas del plan pueden ser más estrictas que la ley: parcela mínima, si admite vivienda, alturas o materiales.`;
    return {
      titulo: `Planeamiento de ${p.MUNICIPIO ?? datos.municipio}`,
      texto,
      enlace: p.DISPONIBLE === 'SI' && p.DESCARGA?.startsWith('https://') ? { href: p.DESCARGA, texto: 'Documentos del plan (zip de la Junta)' } : null,
    };
  },

  afecciones(_lonlat, utm) {
    const enParcela = { extra: comoArcgis(utm) };
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const ms = cuotas(await arcgis(MONTES, caja(utm), { campos: 'NOMBRE,CUP', ...enParcela }), utm);
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `nº ${m.CUP} «${m.NOMBRE}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      // Ejes con su anchura legal (texto; «-» sin dato): se traen a menos de 40 m y se compara con la mitad
      vvpp: {
        nombre: 'vías pecuarias',
        consulta: async () => {
          const fs = await arcgis(VIAS, caja(utm), { campos: 'NUM_NOM,ANCH_LEGAL', extra: { ...comoArcgis(utm), distance: '40', units: 'esriSRUnit_Meter' } });
          const ancho = (f) => Number(String(f.properties.ANCH_LEGAL).replace(',', '.')) || 0;
          const vias = fs.filter((f) => {
            const lineas = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
            return distancia(utm, lineas) <= ancho(f) / 2;
          });
          const nombres = [...new Set(vias.map((f) => nombreVia(f.properties.NUM_NOM) + (ancho(f) ? ` (${Math.round(ancho(f))} m de ancho)` : '')))];
          return nombres.length ? [{ tipo: 'vvpp', detalle: nombres.join(', ') }] : [];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const es = cuotas(await arcgis(NATURA, caja(utm), { campos: 'SITE_CODE,SITE_NAME,TIPO_2', ...enParcela }), utm);
          const nombres = [...new Map(es.map((e) => [e.SITE_CODE, `${e.TIPO_2 ? `${e.TIPO_2.replace('-', ' y ')} ` : ''}«${e.SITE_NAME}»: ${pct(e)}`])).values()];
          return nombres.length ? [{ tipo: 'natura', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
