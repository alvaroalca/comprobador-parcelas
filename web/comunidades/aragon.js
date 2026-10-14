// Aragón: Sistema de Información Urbanística de Aragón (SIUa) y capas ambientales del Gobierno de Aragón
// (IDEAragon). GeoServer sin cabecera CORS: todo pasa por el proxy del mismo origen /api/aragon/
// (tools/servir.py y el Worker).
//
// Medido el 14/10/2026: 54.312 recintos en 711 municipios con la clase normalizada (`notepa`: SU-C, SU-NC,
// SUZ-D, SUZ-ND, SNU-G, SNU-E) y si es sistema general (`dot_sg`). En 119 municipios el único plan que
// publica figura en `fiab_geom` como «No aprobada/Denegada/Obsoleta»: ahí no se decide. Sin filtro tarda
// 6 s; con INTERSECTS, 0,1 s.

import { area, cuotas, distancia, wfs, wkt } from '../geo.js';

const SIUA = '/api/aragon/geoserver/SIUa';
const VISOR = '/api/aragon/geoserver/VISOR2D/wfs';
const PARCELA_MINIMA = 10000; // art. 34.2
const SIN_PLAN_GENERAL = ['DSU', 'SinPlan_SinPDSU'];

const toca = (campo, utm) => `INTERSECTS(${campo},SRID=25830;${wkt(utm, 2)})`;

function codigo(p, pequena) {
  if (p.fiab_geom === 'No aprobada/Denegada/Obsoleta') return 'NOAP';
  if (p.dot_sg === 'SI') return 'SG';
  const c = p.notepa || (p.clase === 'SENU' ? 'SNU-G' : null);
  if ((c === 'SNU-G' || c === 'SUZ-ND') && pequena) return `${c}-PEQ`;
  return c;
}

export default {
  id: 'aragon',
  nombre: 'Aragón',
  provincias: ['22', '44', '50'],
  normas: 'normas/aragon.json',
  capaSuelo: {
    // MapLibre pide las teselas con fetch: sin CORS en origen, también por el proxy
    teselas: `${location.origin}${SIUA}/wms?service=WMS&version=1.1.1&request=GetMap&layers=SIUa:clasificacion_idearagon&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`,
    limites: [-2.2, 39.8, 0.8, 42.95],
    atribucion: '© Gobierno de Aragón (SIUa)',
  },
  fuentes: 'Gobierno de Aragón (Sistema de Información Urbanística de Aragón, montes, vías pecuarias y Red Natura 2000)',
  consultadas: 'montes de utilidad pública, vías pecuarias y Red Natura 2000 (Gobierno de Aragón)',
  pendientes: 'espacios naturales protegidos, carreteras ni patrimonio',

  async suelo(_caja, utm, superficieCatastro) {
    const fs = await wfs(`${SIUA}/wfs`, 'SIUa:clasificacion_idearagon', toca('shape', utm),
      'shape,notepa,clase,dot_sg,fiab_geom,d_muni_ine,cod_plan,n_expedien,date_acu,pdf,web_acu,nombre');
    const pequena = (superficieCatastro ?? area(utm)) < PARCELA_MINIMA;
    const notas = {};
    const recintos = fs.flatMap((f) => {
      const p = f.properties;
      const c = codigo(p, pequena);
      if (!c) return [];
      if (/dudosa|posiblemente/i.test(p.fiab_geom ?? '')) notas[c] = 'El Gobierno de Aragón marca la geometría de este plan como dudosa: confírmala en el ayuntamiento.';
      return [{ geometry: f.geometry, codigo: c, nombre: p.notepa || p.clase, detalle: p.nombre && p.nombre !== 'None' ? p.nombre : null }];
    });
    const plan = fs.map((f) => f.properties).find((p) => p.fiab_geom !== 'No aprobada/Denegada/Obsoleta') ?? fs[0]?.properties ?? null;
    if (plan && SIN_PLAN_GENERAL.includes(plan.cod_plan)) {
      const aviso = ' Este municipio no tiene plan general: la vivienda aislada necesita autorización especial con los mismos requisitos (art. 35.1.b), y junto al casco puede regir la «zona de borde» (art. 289: parcela de 1.500 m²).';
      for (const c of ['SNU-G', 'SUZ-ND']) notas[c] = (notas[c] ?? '') + aviso;
    }
    return { recintos, plan, notas };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    const figura = { PGOU: 'Plan general de ordenación urbana', NNSS: 'Normas subsidiarias', DSU: 'Delimitación de suelo urbano', SinPlan_SinPDSU: 'Sin planeamiento' }[p.cod_plan] ?? p.cod_plan;
    return {
      titulo: `Planeamiento de ${p.d_muni_ine ?? datos.municipio}`,
      texto: `${figura}${p.n_expedien && p.n_expedien !== 'None' ? ` (expediente ${p.n_expedien}${p.date_acu && p.date_acu !== 'None' ? `, acuerdo del ${p.date_acu}` : ''})` : ''}. La clasificación sale del Sistema de Información Urbanística de Aragón. Las normas del plan pueden ser más estrictas que la ley: parcela mínima, si admite vivienda, alturas o materiales.`,
      enlace: p.pdf?.startsWith('http') ? { href: p.pdf, texto: 'Plano del plan en IDEAragon' } : null,
    };
  },

  afecciones(_lonlat, utm) {
    const enParcela = toca('shape', utm);
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const ms = cuotas(await wfs(VISOR, 'VISOR2D:v_montes', `${enParcela} AND mup='True'`, 'shape,denominacion,num_mup', 'EPSG:25830'), utm);
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `nº ${Number(m.num_mup)} «${m.denominacion}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      // Ejes con su anchura (a veces 0, sin dato): se traen a menos de 40 m y se compara con la mitad de la anchura
      vvpp: {
        nombre: 'vías pecuarias',
        consulta: async () => {
          const fs = await wfs(VISOR, 'VISOR2D:v105_dagma_montes_vvpp', `DWITHIN(shape,SRID=25830;${wkt(utm, 1)},40,meters)`, 'shape,nb_via,anchura_ac', 'EPSG:25830');
          const vias = fs.filter((f) => {
            const lineas = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
            return distancia(utm, lineas) <= (Number(f.properties.anchura_ac) || 0) / 2;
          });
          const nombres = [...new Set(vias.map((f) => `${f.properties.nb_via}${Number(f.properties.anchura_ac) ? ` (${Math.round(f.properties.anchura_ac)} m de ancho)` : ''}`))];
          return nombres.length ? [{ tipo: 'vvpp', detalle: nombres.join(', ') }] : [];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const [lic, zepa] = await Promise.all([
            wfs(VISOR, 'VISOR2D:LIC_ES24', enParcela, 'shape,sitename', 'EPSG:25830'),
            wfs(VISOR, 'VISOR2D:v108_ps_zepa_es24_s', enParcela, 'shape,sitename', 'EPSG:25830'),
          ]);
          const es = [...cuotas(lic, utm).map((e) => ({ ...e, tipo: 'LIC' })), ...cuotas(zepa, utm).map((e) => ({ ...e, tipo: 'ZEPA' }))];
          const nombres = [...Map.groupBy(es, (e) => e.sitename)].map(([n, xs]) => `${xs.map((x) => x.tipo).join(' y ')} «${n}»: ${pct(xs[0])}`);
          return nombres.length ? [{ tipo: 'natura', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
