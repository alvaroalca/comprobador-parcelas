// Región de Murcia: clases de suelo del planeamiento general (SITMurcia, CARM). GeoServer en EPSG:25830
// sin cabecera CORS: todo pasa por el proxy del mismo origen /api/carm/ (tools/servir.py y el Worker).
//
// Medido el 14/10/2026: 9.469 recintos en 33 de los 45 municipios. La clase viene escrita entera
// (`Clasificacion`) e incluye las de los planes antiguos sin adaptar (no programado, apto para urbanizar,
// no urbanizable a secas), que la DT 5ª de la Ley 13/2015 equipara a las actuales. `Sistema_general = 'S'`
// marca los sistemas generales dentro de cualquier clase.

import { area, wfs, wkt } from '../geo.js';

const CARM = '/api/carm/geoserver/SIT_USU_PLA_URB_CARM';

const CLASE = {
  'Suelo Urbano': 'SU', 'Suelo Urbano Consolidado': 'SU', 'Suelo Urbano Sin Consolidar': 'SU-SC',
  'Suelo Urbano de Nucleo Rural': 'SU-NR', 'Suelo Urbano Especial': 'SU-E',
  'Suelo Urbanizable': 'SUS', 'Suelo Urbanizable Sectorizado': 'SUS', 'Suelo Urbanizable Sectorizado Especial': 'SUS',
  'Suelo Urbanizable Programado': 'SUS',
  'Suelo Urbanizable Sin Sectorizar': 'SUNS', 'Suelo Urbanizable Sin Sectorizar Especial': 'SUNS',
  'Suelo Urbanizable No Programado': 'SUNS', 'Suelo Apto para Urbanizar': 'SUNS',
  'Suelo No Urbanizable de Protección Específica': 'SNU-PE', 'Suelo No Urbanizable Protegido': 'SNU-PP',
  'Suelo No Urbanizable': 'SNU-PP', 'Suelo No Urbanizable Inadecuado': 'SNU-I',
  'Sistema General': 'SG',
};

export default {
  id: 'murcia',
  nombre: 'Región de Murcia',
  provincias: ['30'],
  normas: 'normas/murcia.json',
  capaSuelo: {
    // MapLibre pide las teselas con fetch: sin CORS en origen, también por el proxy
    teselas: `${location.origin}${CARM}/wms?service=WMS&version=1.1.1&request=GetMap&layers=clases_plu_ze_37mun&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`,
    limites: [-2.4, 37.3, -0.6, 38.8],
    atribucion: '© Región de Murcia (SITMurcia)',
  },
  fuentes: 'Región de Murcia (planeamiento general del SITMurcia)',
  consultadas: 'protecciones que recoge la clase de suelo del plan (Región de Murcia)',
  pendientes: 'Red Natura 2000, montes de utilidad pública, vías pecuarias, espacios naturales protegidos ni patrimonio',

  async suelo(_caja, utm, superficieCatastro) {
    const fs = await wfs(`${CARM}/wfs`, 'SIT_USU_PLA_URB_CARM:clases_plu_ze_37mun', `INTERSECTS(geom,SRID=25830;${wkt(utm, 2)})`,
      'geom,Clasificacion,Municipio,Ambito,Sistema_general,Area_suspendida,Enlace_ficha');
    const superficie = superficieCatastro ?? area(utm);
    const notas = {};
    const recintos = fs.flatMap((f) => {
      const p = f.properties;
      let codigo = p.Sistema_general === 'S' ? 'SG' : CLASE[p.Clasificacion] ?? 'SC';
      // Vivienda en urbanizable sin sectorizar: parcela de más de 5.000 m², 2.500 en el especial (art. 102.d)
      if (codigo === 'SUNS' && superficie <= (/Especial/.test(p.Clasificacion) ? 2500 : 5000)) codigo = 'SUNS-PEQ';
      if (p.Area_suspendida) notas[codigo] = 'En esta zona la aprobación del plan está suspendida: pregunta en el ayuntamiento qué rige mientras tanto.';
      return [{ geometry: f.geometry, codigo, nombre: p.Clasificacion || 'Sin clasificar', detalle: p.Ambito }];
    });
    return { recintos, plan: fs[0]?.properties ?? null, notas };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    return {
      titulo: `Planeamiento de ${p.Municipio ?? datos.municipio}`,
      texto: 'La clase de suelo sale del planeamiento general que publica la Región de Murcia en el SITMurcia. Las normas del plan pueden ser más estrictas que la ley: parcela mínima, si la zona admite vivienda, alturas o materiales.',
      enlace: p.Enlace_ficha && { href: p.Enlace_ficha, texto: 'Ficha del ámbito en el SITMurcia' },
    };
  },
};
