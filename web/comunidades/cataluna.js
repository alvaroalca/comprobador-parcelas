// Cataluña: Mapa Urbanístic de Catalunya (MUC) de la Generalitat, planeamiento general vigente,
// montes del Catálogo de Utilidad Pública y Red Natura 2000. GeoServer en EPSG:25831 que reproyecta a
// 25830 al pedírselo (en el extremo este de Cataluña eso deforma las áreas un 0,7 %).
//
// Medido el 14/10/2026: la clasificación (SUC, SNC, SUD, SND, SNU) no distingue tipos de no urbanizable;
// las calificaciones sí (N1 ordinario, N2 protección del plan, N3 protección reglada, N4 actividad
// autorizada) y además marcan los sistemas públicos (S*) dentro del suelo urbano. Se combinan: la clase
// sale de la clasificación salvo en el no urbanizable, que sale de su calificación, y los sistemas
// mandan sobre la clase porque no son suelo para vivienda privada.

import { cuotas, wfs, wkt } from '../geo.js';

const MUC = 'https://sig.gencat.cat/ows/PLANEJAMENT/wfs';
const NATURALES = 'https://sig.gencat.cat/ows/ESPAIS_NATURALS/wfs';

const fecha = (iso) => iso && new Date(iso.replace('Z', '')).toLocaleDateString('es-ES');
// Por la geometría exacta y no por caja: una parcela alargada (un canal, 42 ha en una caja de 17 × 19 km)
// traía 3.749 recintos y 14,6 MB en 9 s; así, 147 recintos en 0,9 s. El servidor reproyecta el SRID.
const toca = (campo, utm) => `INTERSECTS(${campo},SRID=25830;${wkt(utm, 2)})`;

export default {
  id: 'cataluna',
  nombre: 'Cataluña',
  provincias: ['08', '17', '25', '43'],
  normas: 'normas/cataluna.json',
  capaSuelo: {
    wms: 'https://sig.gencat.cat/ows/PLANEJAMENT/wms',
    capa: 'MUC_CLASSIFICACIONS',
    limites: [0.1, 40.5, 3.4, 42.9],
    atribucion: '© Generalitat de Catalunya',
  },
  fuentes: 'Generalitat de Catalunya (Mapa Urbanístic de Catalunya, montes y Red Natura 2000)',
  consultadas: 'montes del Catálogo de Utilidad Pública y Red Natura 2000 (Generalitat de Catalunya)',
  pendientes: 'costas, carreteras ni patrimonio',

  async suelo(_caja, utm) {
    const [clases, calificaciones, planes] = await Promise.all([
      wfs(MUC, 'PLANEJAMENT:MUC_CLASSIFICACIONS', toca('GEOMETRIA', utm), 'GEOMETRIA,CODI_CLAS_MUC,DESC_CLAS_MUC,DESC_CLAS_AJUNT', 'EPSG:25830'),
      wfs(MUC, 'PLANEJAMENT:MUC_QUALIFICACIONS', `${toca('GEOMETRIA', utm)} AND (CODI_QUAL_MUC LIKE 'N%' OR CODI_QUAL_MUC LIKE 'S%')`,
        'GEOMETRIA,CODI_QUAL_MUC,DESC_QUAL_MUC,DESC_QUAL_AJUNT', 'EPSG:25830'),
      wfs(MUC, 'PLANEJAMENT:PLANEJAMENT_GENERAL_VIGENT', toca('GEOMETRIA', utm), 'NOM_MUNI,DESC_TIPEX,TIPEX,DATA_AD,URL_RPUC'),
    ]);
    const recintos = [
      // El no urbanizable sale de su calificación (N1-N4), no de la clasificación
      ...clases.filter((f) => f.properties.CODI_CLAS_MUC !== 'SNU').map((f) => ({
        geometry: f.geometry, codigo: f.properties.CODI_CLAS_MUC, nombre: f.properties.DESC_CLAS_MUC, detalle: f.properties.DESC_CLAS_AJUNT,
      })),
      ...calificaciones.map((f) => {
        const p = f.properties;
        const sistema = p.CODI_QUAL_MUC.startsWith('S');
        return { geometry: f.geometry, codigo: sistema ? 'SIS' : p.CODI_QUAL_MUC, nombre: p.DESC_QUAL_MUC, detalle: sistema ? p.DESC_QUAL_MUC : p.DESC_QUAL_AJUNT };
      }),
    ];
    return { recintos, plan: planes[0]?.properties ?? null };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    return {
      titulo: `Planeamiento de ${p.NOM_MUNI ?? datos.municipio}`,
      texto: `${p.DESC_TIPEX ?? p.TIPEX}${p.DATA_AD ? `, aprobado el ${fecha(p.DATA_AD)}` : ''}. La clasificación sale del Mapa Urbanístic de Catalunya. Las normas del plan pueden ser más estrictas que la ley (parcela mínima, alturas, materiales).`,
      enlace: p.URL_RPUC && { href: p.URL_RPUC, texto: 'Expediente en el Registro de planeamiento' },
    };
  },

  afecciones(_lonlat, utm) {
    const enParcela = toca('SHAPE', utm);
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const fs = await wfs(NATURALES, 'ESPAIS_NATURALS:ESPAISNATURALS_FORESTS', `${enParcela} AND CUP='Sí'`, 'SHAPE,FO_CODI,FOREST', 'EPSG:25830');
          const ms = cuotas(fs, utm);
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `«${m.FOREST}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const fs = await wfs(NATURALES, 'ESPAIS_NATURALS:ESPAISNATURALS_XARNAT_2000', enParcela, 'SHAPE,NOM_XN2,LIC_ZEC,ZEPA', 'EPSG:25830');
          const es = cuotas(fs, utm);
          const tipo = (e) => [e.LIC_ZEC === 'Sí' && 'ZEC', e.ZEPA === 'Sí' && 'ZEPA'].filter(Boolean).join(' y ');
          const nombres = [...new Map(es.map((e) => [e.NOM_XN2, `${tipo(e)} «${e.NOM_XN2}»: ${pct(e)}`.trim()])).values()];
          return nombres.length ? [{ tipo: 'natura', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
