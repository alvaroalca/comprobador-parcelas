// Navarra: el Gobierno foral no publica la clasificación por recintos (IDENA solo trae indicadores por
// municipio y el inventario de planes): las clases salen del SIU del Ministerio, que el 20/10/2026 tenía 83
// de los 272 municipios, pero entre ellos todos los de más de 1.300 habitantes (el 91 % de la población).
// No separa el no urbanizable de protección del de preservación, y de eso depende la vivienda (art. 115).
//
// Parcela y superficie, del catastro foral (catastro-foral.js). Municipio, figura de plan y enlace al SIUN,
// del inventario de planeamiento de IDENA. Afecciones de IDENA: GeoServer nativo en 25830, CORS abierto.

import { cuotas, distancia, wfs, wkt } from '../geo.js';
import { clasesSiu, fuenteSiu, SIU_TESELAS } from '../siu.js';

const IDENA = 'https://idena.navarra.es/ogc/wfs';

// Vivienda unifamiliar aislada en no urbanizable: 10.000 m² como mínimo (art. 115.2)
const MINIMA = 10000;

export default {
  id: 'navarra',
  nombre: 'Navarra',
  provincias: ['31'],
  normas: 'normas/navarra.json',
  capaSuelo: {
    teselas: SIU_TESELAS,
    limites: [-2.51, 41.9, -0.72, 43.32],
    atribucion: '© Ministerio de Vivienda y Agenda Urbana (SIU)',
  },
  fuentes: `${fuenteSiu} y Gobierno de Navarra (IDENA: planeamiento vigente, montes, vías pecuarias y Red Natura 2000)`,
  consultadas: 'montes de utilidad pública, vías pecuarias y Red Natura 2000 (Gobierno de Navarra)',
  pendientes: 'espacios naturales protegidos, carreteras ni patrimonio',

  async suelo(cajaUtm, utm, superficie, datos) {
    const [clases, planes] = await Promise.all([
      clasesSiu(cajaUtm),
      wfs(IDENA, 'IDENA:INFOTU_Pol_PlanUrbMun', `INTERSECTS(the_geom,SRID=25830;${wkt(utm, 2)})`, 'MUNICIPIO,TIPO,INSTRUMENT,URLSIUN', 'EPSG:25830')
        .catch(() => []), // sin él falta el nombre del municipio, no el veredicto
    ]);
    // El catastro foral no da el municipio
    const plan = planes[0]?.properties ?? null;
    if (plan && !datos.municipio) datos.municipio = plan.MUNICIPIO;
    const grande = (superficie ?? 0) >= MINIMA;
    const recintos = clases.map((r) => ({
      geometry: r.geometry,
      codigo: r.codigo === 'SNU' && !grande ? 'SNU-PEQ' : r.codigo,
      nombre: 'Sin clasificar',
    }));
    return { recintos, plan };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    return {
      titulo: datos.municipio ? `Planeamiento de ${datos.municipio}` : 'Planeamiento municipal',
      texto: `${p?.INSTRUMENT ? `${p.INSTRUMENT}${p.TIPO ? ` (${p.TIPO.toLowerCase()})` : ''}. ` : ''}La clase de suelo sale del ${fuenteSiu}, que recoge el plan de cada municipio sin distinguir el no urbanizable de protección del de preservación. Las normas del plan pueden ser más estrictas que la ley (parcela mínima, alturas, materiales).`,
      enlace: p?.URLSIUN?.startsWith('https://')
        ? { href: p.URLSIUN, texto: 'Plan del municipio en el SIUN del Gobierno de Navarra' }
        : { href: 'https://administracionelectronica.navarra.es/SIUN_Consulta/Index.html', texto: 'Consulta del planeamiento en el SIUN del Gobierno de Navarra' },
    };
  },

  afecciones(_lonlat, utm) {
    const filtro = `INTERSECTS(the_geom,SRID=25830;${wkt(utm, 2)})`;
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const ms = cuotas(await wfs(IDENA, 'IDENA:FOREST_Pol_MUP1912', filtro, 'the_geom,NUMMUP,NOMBRE', 'EPSG:25830'), utm);
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `nº ${m.NUMMUP} «${m.NOMBRE}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      // Los ejes no traen la anchura, pero hay una capa con los lindes: la vía toca la parcela si la cruza
      // su eje o uno de sus lindes. Los lindes no llevan nombre: se toma de los ejes a menos de 40 m (la
      // cañada más ancha mide 75), y si hay dos vías juntas pueden salir las dos.
      vvpp: {
        nombre: 'vías pecuarias',
        consulta: async () => {
          const [lindes, ejes] = await Promise.all([
            wfs(IDENA, 'IDENA:GANADE_Lin_VVPPAlinde', filtro, 'FEATURE', 'EPSG:25830'),
            wfs(IDENA, 'IDENA:GANADE_Lin_VVPPAeje', `DWITHIN(the_geom,SRID=25830;${wkt(utm, 2)},40,meters)`, 'the_geom,VVPP', 'EPSG:25830'),
          ]);
          const lineas = (f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates);
          const cruzan = ejes.filter((f) => distancia(utm, lineas(f)) === 0);
          if (!lindes.length && !cruzan.length) return [];
          const nombres = [...new Set((cruzan.length ? cruzan : ejes).map((f) => f.properties.VVPP))];
          return [{ tipo: 'vvpp', detalle: nombres.join(', ') || 'vía pecuaria sin nombre en la capa' }];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const capas = await Promise.all(['IDENA:BIODIV_Pol_RN2000', 'IDENA:BIODIV_Pol_ZEPA']
            .map((c) => wfs(IDENA, c, filtro, 'the_geom,RN2000,ABREVIATUR', 'EPSG:25830')));
          const es = cuotas(capas.flat(), utm);
          return es.length ? [{ tipo: 'natura', detalle: es.map((e) => `${e.ABREVIATUR} «${e.RN2000}»: ${pct(e)}`).join(', ') }] : [];
        },
      },
    };
  },
};
