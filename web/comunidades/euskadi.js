// País Vasco: Udalplan, el planeamiento municipal homogeneizado por el Gobierno Vasco (GeoEuskadi, ArcGIS
// REST en EPSG:25830). Las fincas salen de los catastros forales (catastro-foral.js).
//
// Medido el 19/10/2026: un mosaico sin solapes de nueve capas. Suelo residencial y de actividades
// económicas con su clase (`TIPO_DE_SU`: 1 urbano consolidado, 1b no consolidado, 2 urbanizable
// sectorizado, 2c no sectorizado, 3 núcleo rural o enclave en no urbanizable, 1a puertos y aeropuertos),
// seis de sistemas generales y el no urbanizable con las categorías de las Directrices de Ordenación
// Territorial (`SUBTIPO`). Todas traen el municipio con su código INE (`COD_IDEN`) y la figura de plan.

import { arcgis, cuotas } from '../geo.js';

const UDALPLAN = 'https://www.geo.euskadi.eus/geoeuskadi/rest/services/U11/WMS_PLANGINTZA/MapServer';
const CAMPOS = 'COD_IDEN,MUNICIPIO,DOC_PLA,FECHA,APROB';
const CAPAS = [802, 803, 805, 806, 807, 808, 809, 810, 811];

// Clase de suelo por capa: [capa, código según TIPO_DE_SU]
const CLASES = {
  802: { 1: 'SUC', '1b': 'SUNC', 2: 'SUZS', '2c': 'SUZNS', 3: 'NR' },
  803: { 1: 'SUC-AE', '1a': 'SG', '1b': 'SUNC-AE', 2: 'SUZS-AE', '2c': 'SUZNS-AE', 3: 'SNU-AE' },
};
const SISTEMAS = {
  805: 'Equipamientos', 806: 'Espacios libres', 807: 'Movilidad peatonal y ciclista',
  808: 'Infraestructuras de transporte y comunicaciones', 809: 'Infraestructuras básicas', 810: 'Cauces fluviales',
};
const NO_URBANIZABLE = {
  1: 'SNU-EP', 2: 'SNU-MA', 3: 'SNU-F', 4: 'SNU-AG', 18: 'SNU-AVE', 5: 'SNU-PM', 6: 'SNU-SV', 7: 'SNU-AS', 17: 'SNU-EX',
};
const FIGURAS = { 'P.G.O.U.': 'Plan general de ordenación urbana', 'NN.SS. a)': 'Normas subsidiarias (tipo a)', 'NN.SS. b)': 'Normas subsidiarias (tipo b)' };

// Nombres del INE (1 de enero de 2026). Las parzonerías (montes comunales) no tienen: va el de Udalplan.
let municipios = null;
const nombres = () => (municipios ??= fetch('datos/municipios-euskadi.json').then((r) => r.json()));

export default {
  id: 'euskadi',
  nombre: 'País Vasco',
  provincias: ['01', '20', '48'],
  normas: 'normas/euskadi.json',
  // Su WMS no tiene la capa agrupada de Udalplan: export de ArcGIS con las nueve capas
  capaSuelo: {
    teselas: `${UDALPLAN}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:${CAPAS}&f=image`,
    limites: [-3.46, 42.46, -1.72, 43.46],
    atribucion: '© Gobierno Vasco (Udalplan)',
  },
  fuentes: 'Gobierno Vasco (Udalplan, en GeoEuskadi)',
  consultadas: null,
  pendientes: 'Red Natura 2000, montes de utilidad pública, carreteras ni patrimonio',

  async suelo(cajaUtm, utm, _superficie, datos) {
    const campo = (id) => (id === 811 ? 'SUBTIPO' : id in CLASES ? 'TIPO_DE_SU' : 'OBJECTID');
    const [respuestas, ine] = await Promise.all([
      Promise.all(CAPAS.map((id) => arcgis(`${UDALPLAN}/${id}`, cajaUtm, { campos: `${CAMPOS},${campo(id)}` }))),
      nombres(),
    ]);
    const fs = respuestas.flatMap((r, i) => r.map((f) => ({ ...f, capa: CAPAS[i] })));
    const recintos = fs.map(({ geometry, properties: p, capa }) => ({
      geometry,
      codigo: (capa === 811 ? NO_URBANIZABLE[p.SUBTIPO] : capa in CLASES ? CLASES[capa][p.TIPO_DE_SU] : 'SG') ?? 'SIN-CODIGO',
      nombre: 'Sin clasificar',
      detalle: SISTEMAS[capa] ?? null,
    }));
    // Municipio y figura de plan, del recinto que más parcela ocupa: los catastros forales no dan el municipio
    const plan = cuotas(fs, utm)[0] ?? null;
    if (plan && !datos.municipio) datos.municipio = ine[plan.COD_IDEN] ?? plan.MUNICIPIO;
    return { recintos, plan };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p) return null;
    const figura = FIGURAS[p.DOC_PLA?.trim()] ?? p.DOC_PLA?.trim();
    return {
      titulo: `Planeamiento de ${datos.municipio}`,
      texto: `${figura ? `${figura}${p.FECHA ? ` (${p.APROB?.toLowerCase() ?? 'aprobado'} en ${p.FECHA})` : ''}. ` : ''}La clasificación sale de Udalplan, la recopilación de planes municipales del Gobierno Vasco, que no tiene valor normativo. Las normas del municipio pueden ser más estrictas que la ley (parcela mínima, alturas, materiales).`,
      enlace: null,
    };
  },
};
