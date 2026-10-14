// Cantabria: clasificación urbanística del SIUCAN (Gobierno de Cantabria), figura de planeamiento de
// cada municipio, montes de utilidad pública y Red Natura 2000. Todo ArcGIS REST en EPSG:25830.
//
// Medido el 14/10/2026: la capa trae categoría normalizada (CdCatNor) y subcategoría del rústico
// protegido. En rústico de protección ordinaria la Ley 5/2022 admite vivienda aislada a 200 m como
// mucho del suelo urbano (art. 51.1): esa distancia se mide aquí con la propia capa.

import { area, arcgis, caja, comoMulti, cuotas, distancia } from '../geo.js';

const SERVICIOS = 'https://geoservicios.cantabria.es/inspire/rest/services';
const CLASIFICACION = `${SERVICIOS}/Urbanismo/MapServer/6`;
const FIGURA = `${SERVICIOS}/Urbanismo/MapServer/7`;
const MONTES = `${SERVICIOS}/Montes/MapServer/0`;
const NATURA = [6, 7, 23].map((id) => `${SERVICIOS}/Conservacion_de_la_Naturaleza/MapServer/${id}`); // ZEC, ZEPA regionales y ministeriales

// Suelo urbano a efectos del art. 51.1: el núcleo rural también lo es (art. 37.1.e)
const URBANO = "CdCatNor IN ('SUC','SUNC','SUNT','NR')";
const DISTANCIA_MAX = 200;
const PARCELA_MINIMA = 1500;
// Art. 51.2: sin Plan General o con Normas Subsidiarias tipo A, la vivienda aislada no depende de la categoría del rústico
const SIN_PLAN_GENERAL = /Normas Subsidiarias tipo A|Delimitaci[oó]n|SIN PLANEAMIENTO/i;

const fecha = (ms) => ms && new Date(ms).toLocaleDateString('es-ES');
const util = (t) => t && !/^NO PROCEDE$/i.test(t) ? t : null;

// Distancia de la parcela al suelo urbano más cercano, buscándolo en la caja ampliada 200 m. null si no hay.
async function distanciaUrbano(utm) {
  const [x0, y0, x1, y1] = caja(utm);
  const fs = await arcgis(CLASIFICACION, [x0 - DISTANCIA_MAX, y0 - DISTANCIA_MAX, x1 + DISTANCIA_MAX, y1 + DISTANCIA_MAX],
    { where: URBANO, campos: 'CdCatNor' });
  if (!fs.length) return null;
  return Math.min(...fs.map((f) => distancia(utm, comoMulti(f.geometry).flat())));
}

export default {
  id: 'cantabria',
  nombre: 'Cantabria',
  provincias: ['39'],
  normas: 'normas/cantabria.json',
  capaSuelo: {
    wms: 'https://geoservicios.cantabria.es/inspire/services/Urbanismo/MapServer/WMSServer',
    capa: '2',
    limites: [-4.9, 42.7, -3.1, 43.6],
    atribucion: '© Gobierno de Cantabria',
  },
  fuentes: 'Gobierno de Cantabria (clasificación urbanística del SIUCAN, montes y Red Natura 2000)',
  consultadas: 'montes de utilidad pública y Red Natura 2000 (Gobierno de Cantabria)',
  pendientes: 'costas, espacios naturales protegidos, carreteras ni patrimonio',

  async suelo(cajaUtm, utm) {
    const [fs, figuras] = await Promise.all([
      arcgis(CLASIFICACION, cajaUtm, { campos: 'CdCatNor,DsCatNor,DsSbcatNor,DsCatOrig,NomMuni' }),
      arcgis(FIGURA, cajaUtm, { campos: 'NomMuni,FigUrbVig_Des,Fecha_AD', geometria: false }),
    ]);
    const figura = figuras[0]?.properties ?? null;
    const sinPlanGeneral = SIN_PLAN_GENERAL.test(figura?.FigUrbVig_Des ?? '');
    const notas = {};

    // Rústico de protección ordinaria: cerca o lejos del suelo urbano cambia el régimen
    let lejos = false;
    if (fs.some((f) => f.properties.CdCatNor === 'SRPO')) {
      const d = await distanciaUrbano(utm);
      lejos = d === null || d > DISTANCIA_MAX;
      const superficie = area(utm);
      const pequena = superficie < PARCELA_MINIMA
        ? ` La parcela mide ${Math.round(superficie).toLocaleString('es-ES')} m²: por debajo de 1.500 m² solo vale en municipios en riesgo de despoblamiento.` : '';
      notas.SRPO = `${d === 0 ? 'La parcela linda con suelo urbano' : `El suelo urbano más cercano está a ${Math.round(d)} m`}: la casa tendría que quedar en la parte de la finca a menos de 200 m.${pequena}`;
      notas['SRPO-LEJOS'] = d === null ? 'No hay suelo urbano a menos de 200 m de la parcela.' : `El suelo urbano más cercano está a ${Math.round(d)} m.`;
    }
    if (sinPlanGeneral) {
      const aviso = ` En este municipio (${figura.FigUrbVig_Des.replace(/\s*\(.*$/, '')}) el art. 51.2 permite además la vivienda aislada en cualquier rústico, salvo donde la protección venga de una ley sectorial o de un plan territorial.`;
      notas.SREP = (notas.SREP ?? '') + aviso;
      notas['SRPO-LEJOS'] = (notas['SRPO-LEJOS'] ?? '') + aviso;
    }

    return {
      recintos: fs.map((f) => {
        const p = f.properties;
        const codigo = p.CdCatNor === 'SRPO' && lejos ? 'SRPO-LEJOS' : p.CdCatNor ?? 'SC';
        return { geometry: f.geometry, codigo, nombre: p.DsCatNor ?? 'Sin clasificar', detalle: util(p.DsSbcatNor) ?? util(p.DsCatOrig) };
      }),
      figura,
      notas,
    };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const f = suelo.figura;
    if (!f) return null;
    return {
      titulo: `Planeamiento de ${f.NomMuni ?? datos.municipio}`,
      texto: `${f.FigUrbVig_Des}${f.Fecha_AD ? `, aprobado el ${fecha(f.Fecha_AD)}` : ''}. La clasificación sale del Sistema de Información Urbanística de Cantabria. Las normas del municipio pueden ser más estrictas que la ley (parcela mínima, alturas, materiales).`,
      enlace: null,
    };
  },

  afecciones(_lonlat, utm) {
    const enCaja = caja(utm);
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const ms = cuotas(await arcgis(MONTES, enCaja, { campos: 'NCUP,Denominaci' }), utm);
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `nº ${m.NCUP} «${m.Denominaci}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const capas = await Promise.all(NATURA.map((c) => arcgis(c, enCaja, { campos: 'SITENAME,DESGSITE' })));
          const espacios = cuotas(capas.flat(), utm);
          const nombres = [...new Map(espacios.map((e) => [e.SITENAME, `${e.DESGSITE ? `${e.DESGSITE} ` : ''}«${e.SITENAME}»: ${pct(e)}`])).values()];
          return nombres.length ? [{ tipo: 'natura', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
