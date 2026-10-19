// Sistema de Información Urbana del Ministerio de Vivienda: clases de suelo de casi 6.000 municipios en una
// sola capa (ArcGIS REST, con CORS). Sirve donde la comunidad no publica su planeamiento por recintos, o de
// respaldo donde sí. Medido el 19/10/2026: 0,14-0,25 s y 11-235 kB por parcela (cada recinto es la clase
// entera de un municipio, hasta 6.000 vértices). Solo da la clase: no separa el no urbanizable protegido del
// común. `FechaBaja = '99999999'` es la versión vigente; `NuclRural = '1'`, núcleo rural.

import { arcgis } from './geo.js';

const SIU = 'https://mapas.fomento.gob.es/arcgis/rest/services/SIU/CLASES_DE_SUELO/MapServer/0';

const CLASES = {
  'SUELO URBANO': 'SU',
  'SUELO URBANO NO CONSOLIDADO': 'SUNC',
  'SUELO URBANIZABLE DELIMITADO O SECTORIZADO': 'SUZD',
  'SUELO URBANIZABLE NO DELIMITADO O SECTORIZADO': 'SUZND',
  'SUELO NO URBANIZABLE': 'SNU',
  'SISTEMAS GENERALES Y OTROS': 'SG',
};

// Teselas del mapa: el export del MapServer (con CORS), para la capa de suelo de cada comunidad
export const SIU_TESELAS = `${SIU.replace(/\/0$/, '')}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;

// Recintos del SIU en la caja (EPSG:25830): { geometry, codigo, nucleoRural, ine }. El código es el de la
// clase; la tabla de cada comunidad decide qué significa con su ley.
export async function clasesSiu(cajaUtm) {
  const fs = await arcgis(SIU, cajaUtm, { where: "FechaBaja = '99999999'", campos: 'ProvINE,ClaseSuelo,NuclRural' });
  return fs.map((f) => ({
    geometry: f.geometry,
    codigo: CLASES[f.properties.ClaseSuelo] ?? 'SIN-CODIGO',
    nucleoRural: f.properties.NuclRural === '1',
    ine: f.properties.ProvINE,
  }));
}

export const fuenteSiu = 'Ministerio de Vivienda y Agenda Urbana (Sistema de Información Urbana)';
