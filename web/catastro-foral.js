// Catastros forales del País Vasco: cada diputación publica sus parcelas en un WFS INSPIRE propio y el
// Catastro estatal no tiene nada ahí. Sin consulta de punto a finca: se pide una caja pequeña alrededor del
// punto y se busca la parcela que lo contiene. Medido el 19/10/2026: los tres con CORS, 0,3 s por petición.
// Bizkaia va por la consulta REST del ArcGIS que hay debajo de su WFS: el mismo día, durante una hora, el WFS
// contestó con un 200 vacío a 23 de cada 30 peticiones y la consulta REST, a ninguna de 15.

import { comoMulti, conReintento, dentroDe, distanciaPunto, traer } from './geo.js';

const BIZKAIA = 'https://geo.bizkaia.eus/arcgisserverinspire/rest/services/Catastro/Annex1/MapServer';

// `caja` en lon/lat, holgada: donde se pisan se pregunta a las dos y responde la que tenga la finca.
// `estilo` del WMS: el de por defecto rotula la parcela en cada tesela que toca (una finca grande sale con
// su número diez veces); con LabelOnReferencePoint, una vez. Gipuzkoa no lo atiende: con el suyo por defecto
// el campo se lee bien y en los cascos los números se amontonan incluso a zoom 17.
export const FORALES = [
  {
    id: 'araba', provincia: '01', nombre: 'Araba/Álava', fuente: 'Catastro de Álava (Diputación Foral)',
    caja: [-3.30, 42.46, -2.22, 43.07],
    wfs: 'https://geo.araba.eus/WFS_INSPIRE_CP_V4',
    wms: 'https://geo.araba.eus/WMS_INSPIRE_CP',
    estilo: 'INSPIRE_CP:CP.CadastralParcel.LabelOnReferencePoint',
  },
  {
    id: 'bizkaia', provincia: '48', nombre: 'Bizkaia', fuente: 'Catastro de Bizkaia (Diputación Foral)',
    caja: [-3.46, 42.97, -2.40, 43.46],
    rest: `${BIZKAIA}/8`,
    wms: `${BIZKAIA}/exts/InspireView/service`,
    estilo: 'CP.CadastralParcel.LabelOnReferencePoint',
  },
  {
    id: 'gipuzkoa', provincia: '20', nombre: 'Gipuzkoa', fuente: 'Catastro de Gipuzkoa (Diputación Foral)',
    caja: [-2.62, 42.88, -1.72, 43.41],
    wfs: 'https://b5m.gipuzkoa.eus/inspire/wfs/gipuzkoa_wfs_cp',
    wms: 'https://b5m.gipuzkoa.eus/inspire/wms/gipuzkoa_wms',
  },
];

const dentroDeCaja = ([x0, y0, x1, y1], lon, lat) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1;
export const enForal = (lon, lat) => FORALES.some((t) => dentroDeCaja(t.caja, lon, lat));

const hijos = (el, nombre) => [...el.getElementsByTagNameNS('*', nombre)];
const texto = (el, nombre) => hijos(el, nombre)[0]?.textContent.trim() ?? '';

// Parcelas vigentes en la caja, con sus polígonos en el sistema pedido: [{ id, superficie, poligonos }].
const parcelas = (t, marco, srs) => (t.rest ? parcelasRest(t, marco, srs) : parcelasWfs(t, marco, srs));

function parcelasRest(t, [x0, y0, x1, y1], srs) {
  return conReintento(async () => {
    const q = new URLSearchParams({
      geometry: [x0, y0, x1, y1].join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: srs,
      spatialRel: 'esriSpatialRelIntersects', outFields: 'id_localId,areaValue,endLifespanVersion', f: 'geojson',
    });
    const r = await traer(`${t.rest}/query?${q}`);
    const host = new URL(t.rest).host;
    if (!r.ok) throw new Error(`${host} respondió ${r.status}`);
    const d = await r.json();
    if (d.error || !d.features) throw new Error(`${host}: ${d.error?.message ?? 'respuesta sin parcelas'}`);
    return d.features
      .filter((f) => !f.properties.endLifespanVersion)
      .map((f) => ({ id: f.properties.id_localId, superficie: f.properties.areaValue || null, poligonos: comoMulti(f.geometry) }));
  });
}

// En 4326 el WFS da lat/lon: se gira. Gipuzkoa devuelve además las versiones antiguas de cada parcela, con
// `endLifespanVersion` relleno. Una respuesta vacía (Bizkaia, 19/10/2026) es un fallo, no «sin parcela»: todo
// lo que no sea una FeatureCollection se trata como error y se reintenta.
function parcelasWfs(t, [x0, y0, x1, y1], srs) {
  return conReintento(async () => {
    const q = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typenames: 'cp:CadastralParcel',
      bbox: `${y0},${x0},${y1},${x1},urn:ogc:def:crs:EPSG::4326`, srsName: `urn:ogc:def:crs:EPSG::${srs}`,
    });
    const r = await traer(`${t.wfs}?${q}`);
    const host = new URL(t.wfs).host;
    if (!r.ok) throw new Error(`${host} respondió ${r.status}`);
    // Vacío se descarta antes de parsear: el <parsererror> de Chrome lleva estilo inline y la CSP lo denuncia
    const cuerpo = await r.text();
    if (!cuerpo.trim()) throw new Error(`${host} respondió sin datos`);
    const doc = new DOMParser().parseFromString(cuerpo, 'text/xml');
    if (hijos(doc, 'ExceptionReport').length) throw new Error(`${host}: ${doc.documentElement.textContent.trim()}`);
    if (doc.documentElement?.localName !== 'FeatureCollection') throw new Error(`${host} respondió sin datos`);
    return doc;
  }).then((doc) => leer(doc, srs));
}

function leer(doc, srs) {
  const girar = srs === '4326';
  const anillo = (a) => {
    const n = texto(a, 'posList').split(/\s+/).map(Number);
    return Array.from({ length: n.length / 2 }, (_, i) => (girar ? [n[2 * i + 1], n[2 * i]] : [n[2 * i], n[2 * i + 1]]));
  };
  return hijos(doc, 'CadastralParcel')
    .filter((p) => !texto(p, 'endLifespanVersion'))
    .map((p) => ({
      id: texto(p, 'localId'),
      superficie: Number(texto(p, 'areaValue')) || null,
      poligonos: [...hijos(p, 'Polygon'), ...hijos(p, 'PolygonPatch')]
        .map((pol) => [...hijos(pol, 'exterior'), ...hijos(pol, 'interior')].map(anillo)),
    }));
}

const contiene = (multi, p) => multi.some((pol) => dentroDe(p, pol[0]) && !pol.slice(1).some((h) => dentroDe(p, h)));

// Parcela en el punto. Con tolerancia (portal de CartoCiudad, que cae en la acera), la más cercana a
// menos de esa distancia, marcada como aproximada: los forales no dan el número de portal de cada finca.
// Devuelve { datos, geo, aproximada } con la forma de datosParcela y geometriaParcela, o null.
export async function parcelaForal(lon, lat, tolerancia = 0) {
  // 0,0002° son 22 m de latitud y 16 de longitud a esta altura: cubre los 15 m de la tolerancia
  const d = tolerancia ? 0.0002 : 0.00001;
  const marco = [lon - d, lat - d, lon + d, lat + d];
  const territorios = FORALES.filter((t) => dentroDeCaja(t.caja, lon, lat));
  const respuestas = await Promise.all(territorios.map(async (t) => {
    const [lonlat, utm] = await Promise.all([parcelas(t, marco, '4326'), parcelas(t, marco, '25830')]);
    return lonlat.map((p) => ({ t, p, utm: utm.find((u) => u.id === p.id) })).filter((c) => c.utm);
  }));
  const candidatas = respuestas.flat();
  let elegida = candidatas.find((c) => contiene(c.p.poligonos, [lon, lat]));
  if (!elegida && tolerancia) {
    // Distancia en metros con grados escalados: sobra precisión para 15 m
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
    const metros = (c) => distanciaPunto([lon * kx, lat * ky], c.p.poligonos.flat().map((a) => a.map(([x, y]) => [x * kx, y * ky])));
    elegida = candidatas.map((c) => ({ ...c, dist: metros(c) })).filter((c) => c.dist <= tolerancia).sort((a, b) => a.dist - b.dist)[0];
  }
  if (!elegida) return null;
  const { t, p, utm } = elegida;
  // Gipuzkoa añade al identificador la versión de la parcela («069-8296152-46144»): se quita
  const rc = t.id === 'gipuzkoa' ? p.id.replace(/-\d+$/, '') : p.id;
  return {
    aproximada: !contiene(p.poligonos, [lon, lat]),
    datos: {
      rc, localizacion: null, municipio: null, provincia: t.provincia, provinciaNombre: t.nombre,
      clase: null, uso: null, cultivo: null, publica: false, fuenteCatastro: t.fuente,
    },
    geo: { lonlat: p.poligonos, utm: utm.poligonos, superficie: utm.superficie ?? p.superficie },
  };
}
