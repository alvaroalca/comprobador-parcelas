// Illes Balears: Mapa Urbanístic de les Illes Balears (MUIB) del Govern, contorno de las islas para la
// franja de costa, zona inundable de 500 años y Red Natura 2000. ArcGIS REST en EPSG:25831 que reproyecta
// a 25830 al pedírselo (en Menorca eso deforma las áreas un 0,9 %; para la parcela mínima se corrige).
//
// Medido el 14/10/2026: la clasificación (capa 12) solo distingue urbano, urbanizable y rústico; las
// categorías del rústico (capa 11) traen un código normalizado (CODIMUIB_G) que sigue la matriz de las
// Directrices (AANP, ANEI, ARIP, AIA, AT, SRG...). Las capas de APT (costa y carreteras) y de APR de
// inundación, erosión y desprendimientos están «temporalmente deshabilitadas»: la APT de costa se calcula
// aquí con el contorno de la isla (datos/costa-baleares.json). La zona inundable del Ministerio en Baleares son 4 recintos: se usa
// la de la IDEIB.

import { area, arcgis, caja, cuotas, dentroDe, distanciaPunto } from '../geo.js';

const IDEIB = 'https://ideib.caib.es/geoserveis/rest/services/public';
const MUIB = `${IDEIB}/GOIB_MUIB/MapServer`;
const CLASIFICACION = `${MUIB}/12`;
const CATEGORIAS = `${MUIB}/11`;
const SISTEMAS = `${MUIB}/6`;
const INCENDIO = `${MUIB}/2`;
const INUNDABLE = `${IDEIB}/GOIB_XarxaHidro_RiscInun_IB/MapServer/5`;
const NATURA = [
  [9, 'ZEC'], [11, 'LIC'], [12, 'ZEPA'], // gestión autonómica
  [16, 'ZEC'], [15, 'LIC'], [14, 'ZEPA'], // gestión estatal (sobre todo marinos)
].map(([id, tipo]) => [`${IDEIB}/GOIB_NATURA_N2000_IB/MapServer/${id}`, tipo]);

// CODIMUIB_G del MUIB -> código de la tabla. Las áreas de transición de Mallorca vienen partidas en
// crecimiento (ATC) y armonización (ATH); la matriz las trata igual.
const CATEGORIA = {
  AANP: 'AANP', ANEI: 'ANEI', ARIP: 'ARIP', ARIP_B: 'ARIP', ANIT: 'ANIT', SRPMUN: 'SRPMUN', AIP: 'AIP',
  AIA: 'AIA', AIA_I: 'AIA', AIA_E: 'AIA', AT: 'AT', ATC: 'AT', ATH: 'AT', SRG: 'SRG', SRG_F: 'SRG-F',
  NUR: 'NUR', VIA: 'VIA',
};
const COMUN = ['SRG', 'SRG-F', 'AT', 'AIA'];
const PROTEGIDO = ['ARIP', 'ANIT', 'SRPMUN', 'AIP'];
const PARCELA_MINIMA = 14000; // Ley 6/1997, art. 25.2 y 25.3

// Factor de escala de UTM a partir de la x: en Baleares, fuera de su huso, las áreas en 25830 salen
// hasta un 0,9 % mayores. Solo hace falta si el Catastro no da la superficie.
const escala = (x) => 0.9996 * (1 + ((x - 500000) / (0.9996 * 6381000)) ** 2 / 2);

// Contorno de las islas de más de 1 km², simplificado a 10 m (tools/costa_baleares.py). Pedirlo a la IDEIB
// en cada consulta tardaba 3-6 s, y preguntarle si la parcela con su búfer cabe en la isla, 1,4-4,5 s.
let costas = null;
const contornos = () => (costas ??= fetch('datos/costa-baleares.json').then((r) => r.json())
  .then((d) => d.islas).catch((err) => { costas = null; throw err; }));

// La isla de la parcela: la que contiene su primer vértice. Si cae justo fuera del contorno simplificado
// (una finca que llega al agua), la que lo tiene en su caja.
async function islaDe(utm) {
  const p = utm[0][0][0];
  const enSuCaja = (await contornos()).filter((i) => p[0] >= i.caja[0] && p[1] >= i.caja[1] && p[0] <= i.caja[2] && p[1] <= i.caja[3]);
  return enSuCaja.find((i) => i.anillos.some((a) => dentroDe(p, a))) ?? enSuCaja[0] ?? null;
}

// Puntos del borde de la parcela cada 10 m como mucho, para medir su punto más cercano y más lejano al mar
function bordeDenso(utm) {
  const pts = [];
  for (const anillo of utm.map((p) => p[0])) {
    for (let i = 0; i < anillo.length - 1; i++) {
      const [a, b] = [anillo[i], anillo[i + 1]];
      const n = Math.min(50, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return pts;
}

// Franja de protección territorial de costa (DOT art. 19.1.e.1): 500 m, 100 m en Formentera.
// Devuelve { isla, limite, min, max } en metros, distancias del borde de la parcela al contorno de la isla.
async function costa(utm) {
  const isla = await islaDe(utm);
  if (!isla) return null;
  const ds = bordeDenso(utm).map((p) => distanciaPunto(p, isla.anillos));
  return { isla: isla.nombre, limite: isla.isla === 'Formentera' ? 100 : 500, min: Math.min(...ds), max: Math.max(...ds) };
}

export default {
  id: 'baleares',
  nombre: 'Illes Balears',
  provincias: ['07'],
  normas: 'normas/baleares.json',
  // El WMS pinta sobre las categorías, repetido como etiqueta, el aviso de que no están al día: tapa el mapa.
  // El export de ArcGIS deja quitar las etiquetas.
  capaSuelo: {
    teselas: `${MUIB}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&dynamicLayers=${encodeURIComponent(JSON.stringify(
      [12, 11].map((id) => ({ id, source: { type: 'mapLayer', mapLayerId: id }, drawingInfo: { showLabels: false } }))))}`,
    limites: [1.1, 38.6, 4.4, 40.1],
    atribucion: '© Govern de les Illes Balears',
  },
  aguaPropia: ['q500'],
  fuentes: 'Govern de les Illes Balears (Mapa Urbanístic de les Illes Balears, contorno de las islas, zonas inundables y Red Natura 2000)',
  consultadas: 'zona inundable de 500 años y Red Natura 2000 (Govern de les Illes Balears)',
  pendientes: 'montes de utilidad pública, espacios naturales protegidos, áreas de prevención de riesgos de inundación, erosión y desprendimientos y franja de carreteras (el Govern tiene esas capas deshabilitadas), costas ni patrimonio',

  async suelo(cajaUtm, utm, superficieCatastro) {
    const [clases, categorias, sistemas, incendio] = await Promise.all([
      arcgis(CLASIFICACION, cajaUtm, { where: "CODICLAS IN ('SU','SB')", campos: 'CODICLAS,MUNICIPI' }),
      arcgis(CATEGORIAS, cajaUtm, { campos: 'CODIMUIB_G,NOM,MUNICIPI,DINIVIGEN,URL,IDENTITAT' }),
      arcgis(SISTEMAS, cajaUtm, { campos: 'NOM,CARACTER' }),
      // La capa deshabilitada devuelve un recinto sin código: solo cuentan los que lo tienen
      arcgis(INCENDIO, cajaUtm, { where: 'CODIMUIB IS NOT NULL', geometria: false, extra: { returnCountOnly: 'true', f: 'json' } }),
    ]);
    const notas = {};
    const recintos = [
      ...clases.map((f) => ({ geometry: f.geometry, codigo: f.properties.CODICLAS, nombre: f.properties.CODICLAS === 'SU' ? 'Suelo urbano' : 'Suelo urbanizable' })),
      ...sistemas.map((f) => ({ geometry: f.geometry, codigo: 'SIS', nombre: 'Sistema urbanístico', detalle: f.properties.NOM })),
      ...categorias.filter((f) => CATEGORIA[f.properties.CODIMUIB_G]).map((f) => ({
        geometry: f.geometry, codigo: CATEGORIA[f.properties.CODIMUIB_G], nombre: f.properties.NOM ?? f.properties.CODIMUIB_G, detalle: f.properties.NOM,
      })),
    ];

    // Franja de costa: solo en el rústico que la matriz no prohíbe ya por sí mismo
    const enRustico = (r) => [...COMUN, ...PROTEGIDO].includes(r.codigo);
    if (recintos.some(enRustico)) {
      const c = await costa(utm);
      if (c && c.min < c.limite + 50) {
        const cerca = `El mar está a ${Math.round(c.min)} m de la parcela por su punto más cercano y a ${Math.round(c.max)} m por el más lejano, medido sobre el contorno de ${c.isla} del Govern (la ley mide desde el límite interior de la ribera del mar, algo tierra adentro).`;
        if (c.max < c.limite) {
          for (const r of recintos.filter(enRustico)) Object.assign(r, { codigo: 'APT', detalle: r.detalle ?? r.nombre });
          notas.APT = `Toda la parcela queda dentro de la franja de ${c.limite} m. ${cerca}`;
        } else if (c.min < c.limite) {
          const aviso = `Parte de la parcela está a menos de ${c.limite} m del mar: esa parte es Área de protección territorial y ahí no cabe vivienda. ${cerca}`;
          for (const r of recintos.filter(enRustico)) notas[r.codigo] = aviso;
        } else if (c.min < c.limite + 50) {
          const aviso = `Ojo: la parcela está a ${Math.round(c.min)} m del contorno de ${c.isla}, cerca de la franja de ${c.limite} m de protección de costa, donde no cabe vivienda. La ley la mide desde el límite interior de la ribera del mar, algo tierra adentro: compruébalo en el ayuntamiento.`;
          for (const r of recintos.filter(enRustico)) notas[r.codigo] = aviso;
        }
      }
    }

    // Parcela mínima: 14.000 m² en todo el rústico, común o protegido. Se compara la superficie del Catastro,
    // la misma que enseña la ficha; si falta, la medida, sin la deformación de 25830.
    const [x0, , x1] = caja(utm);
    const superficie = superficieCatastro ?? area(utm) / escala((x0 + x1) / 2) ** 2;
    if (superficie < PARCELA_MINIMA) {
      for (const r of recintos) {
        if (COMUN.includes(r.codigo)) Object.assign(r, { codigo: 'SRC-PEQ', detalle: r.detalle ?? r.nombre });
        else if (PROTEGIDO.includes(r.codigo)) Object.assign(r, { codigo: 'SRP-PEQ', detalle: r.detalle ?? r.nombre });
      }
    }

    if (incendio.count > 0) {
      const aviso = ' Está en un área de prevención de riesgo de incendio: la casa tendría que llevar acceso para emergencias, un depósito de agua y la vegetación aclarada en 30 m alrededor.';
      for (const c of [...COMUN, ...PROTEGIDO]) notas[c] = (notas[c] ?? '') + aviso;
    }

    const plan = (categorias.find((f) => f.properties.IDENTITAT) ?? categorias[0])?.properties ?? null;
    return { recintos, plan, notas };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    const vigente = p?.DINIVIGEN && /\d/.test(p.DINIVIGEN) ? `, en vigor desde el ${p.DINIVIGEN}` : '';
    return {
      titulo: `Planeamiento de ${datos.municipio}`,
      texto: `La clasificación sale del Mapa Urbanístic de les Illes Balears${vigente}. El propio Govern avisa de que las categorías del rústico no están puestas al día con las últimas modificaciones de los planes territoriales de cada isla ni con algunas normas municipales. El plan territorial de la isla y el del municipio pueden ser más estrictos que la ley (parcela mínima, alturas, materiales).`,
      enlace: p?.IDENTITAT ? { href: p.URL.replace(/^http:/, 'https:'), texto: 'Normativa del plan en el MUIB' } : null,
    };
  },

  afecciones(_lonlat, utm) {
    const enCaja = caja(utm);
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      inundableIB: {
        nombre: 'zona inundable',
        consulta: async () => {
          const zs = cuotas(await arcgis(INUNDABLE, enCaja, { campos: 'RIO,ZONA' }), utm);
          if (!zs.length) return [];
          const rios = [...new Set(zs.map((z) => z.RIO ?? z.ZONA).filter(Boolean))].join(', ');
          return [{ tipo: 'inundable', detalle: `${rios || 'Torrente sin nombre'}: ${pct(zs[0])} de la parcela` }];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const capas = await Promise.all(NATURA.map(async ([capa, tipo]) => (await arcgis(capa, enCaja, { campos: 'SITE_CODE,SITE_NAME' })).map((f) => ({ ...f, properties: { ...f.properties, tipo } }))));
          const espacios = cuotas(capas.flat(), utm);
          // Un mismo espacio puede ser ZEC y ZEPA: se juntan por nombre
          const porNombre = Map.groupBy(espacios, (e) => e.SITE_NAME);
          const nombres = [...porNombre].map(([nombre, es]) => `${[...new Set(es.map((e) => e.tipo))].join(' y ')} «${nombre}»: ${pct(es[0])}`);
          return nombres.length ? [{ tipo: 'natura', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
