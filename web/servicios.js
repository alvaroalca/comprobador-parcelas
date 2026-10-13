// Llamadas a los servicios públicos. Todos responden con CORS abierto, así que
// la página habla con ellos directamente, sin servidor propio.

const CATASTRO = 'https://ovc.catastro.meh.es';
const IDECYL = 'https://idecyl.jcyl.es/geoserver/urbanismo/wfs';
const CARTOCIUDAD = 'https://www.cartociudad.es/geocoder/api/geocoder';

// Provincias de Castilla y León (código INE)
export const PROVINCIAS_CYL = new Set(['05', '09', '24', '34', '37', '40', '42', '47', '49']);

async function pedir(url, tipo = 'json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${new URL(url).host} respondió ${r.status}`);
  if (tipo === 'json') return r.json();
  return new DOMParser().parseFromString(await r.text(), 'text/xml');
}

const etiqueta = (doc, nombre) => doc.getElementsByTagName(nombre)[0]?.textContent ?? null;

// ---------- Búsqueda (CartoCiudad) ----------

export async function sugerencias(texto) {
  const q = new URLSearchParams({ q: texto, limit: '6' });
  return pedir(`${CARTOCIUDAD}/candidates?${q}`);
}

// Los candidatos de tipo calle o municipio llegan sin coordenadas: se piden aparte.
export async function coordenadas(candidato) {
  if (candidato.lat && candidato.lng) return { lon: candidato.lng, lat: candidato.lat };
  const q = new URLSearchParams({ id: candidato.id, type: candidato.type });
  const r = await pedir(`${CARTOCIUDAD}/find?${q}`);
  if (!r.lat) throw new Error('CartoCiudad no devolvió coordenadas para ese resultado');
  return { lon: r.lng, lat: r.lat };
}

// ---------- Catastro ----------

// Sin tolerancia: la parcela que contiene el punto. Con tolerancia (búsqueda de portal, cuyo punto
// suele caer en la acera): de las cercanas, la que tenga ese número de portal; si ninguna, la más
// cercana marcada como aproximada. Devuelve { rc, aproximada, direccion } o null.
export async function referenciaEnPunto(lon, lat, { tolerancia = 0, portal = null } = {}) {
  const q = new URLSearchParams({ SRS: 'EPSG:4326', Coordenada_X: lon, Coordenada_Y: lat });
  const consulta = tolerancia ? 'Consulta_RCCOOR_Distancia' : 'Consulta_RCCOOR';
  const doc = await pedir(`${CATASTRO}/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/${consulta}?${q}`, 'xml');
  if (etiqueta(doc, 'cuerr') !== '0') return null;
  if (!tolerancia) return { rc: etiqueta(doc, 'pc1') + etiqueta(doc, 'pc2'), aproximada: false };

  const cercanas = [...doc.getElementsByTagName('pcd')]
    .map((n) => ({
      rc: etiqueta(n, 'pc1') + etiqueta(n, 'pc2'),
      numero: etiqueta(n, 'pnp'),
      direccion: etiqueta(n, 'ldt'),
      distancia: Number(etiqueta(n, 'dis')),
    }))
    .filter((c) => c.distancia <= tolerancia)
    .sort((a, b) => a.distancia - b.distancia);
  if (!cercanas.length) return null;
  const exacta = portal != null && cercanas.find((c) => c.numero === String(portal));
  const elegida = exacta || cercanas[0];
  return { rc: elegida.rc, aproximada: !exacta, direccion: elegida.direccion };
}

// Centroide de una referencia (Catastro). null si la referencia no existe.
export async function centroDeReferencia(rc) {
  const q = new URLSearchParams({ Provincia: '', Municipio: '', SRS: 'EPSG:4326', RC: rc });
  const doc = await pedir(`${CATASTRO}/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?${q}`, 'xml');
  if (etiqueta(doc, 'cuerr') !== '0') return null;
  return { lon: Number(etiqueta(doc, 'xcen')), lat: Number(etiqueta(doc, 'ycen')) };
}

// Referencia catastral escrita por una persona: sin espacios ni guiones y en mayúsculas.
// Rústica: 5 cifras + letra + 8 cifras; urbana: 7 cifras + 2 letras + 4 cifras + letra.
// Admite los 20 caracteres (con inmueble y control) y se queda con los 14 de la parcela.
export function normalizarReferencia(texto) {
  const t = texto.replace(/[\s.-]/g, '').toUpperCase();
  const m = t.match(/^(\d{5}[A-Z]\d{8}|\d{7}[A-Z]{2}\d{4}[A-Z])(\d{4}[A-Z]{2})?$/);
  return m ? m[1] : null;
}

export async function datosParcela(rc) {
  const q = new URLSearchParams({ Provincia: '', Municipio: '', RC: rc });
  const doc = await pedir(`${CATASTRO}/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?${q}`, 'xml');
  return {
    rc,
    // En urbana con varios inmuebles no hay <ldt> de parcela: se usa el del primero
    localizacion: etiqueta(doc, 'ldt'),
    municipio: etiqueta(doc, 'nm'),
    provinciaNombre: etiqueta(doc, 'np'),
    // Provincia en código INE; el de municipio (<cm>) es catastral y no coincide con el del INE
    provincia: etiqueta(doc, 'cp')?.padStart(2, '0'),
    clase: etiqueta(doc, 'cn'), // RU rústica, UR urbana
    uso: etiqueta(doc, 'luso'),
    cultivo: etiqueta(doc, 'dcc'),
    // VT vía de comunicación, HG hidrografía natural: el Catastro las marca como dominio público
    publica: ['VT', 'HG'].includes(etiqueta(doc, 'ccc')),
  };
}

// Polígono de la parcela en el sistema pedido. En EPSG:4326 Catastro da lat/lon: se gira a lon/lat.
async function poligonoCatastro(rc, srs) {
  const q = new URLSearchParams({
    service: 'wfs', version: '2.0.0', request: 'GetFeature',
    STOREDQUERIE_ID: 'GetParcel', refcat: rc, srsname: `EPSG::${srs}`,
  });
  const doc = await pedir(`${CATASTRO}/INSPIRE/wfsCP.aspx?${q}`, 'xml');
  const girar = srs === '4326';
  const anillo = (nodo) => {
    const n = nodo.getElementsByTagName('gml:posList')[0].textContent.trim().split(/\s+/).map(Number);
    const puntos = [];
    for (let i = 0; i < n.length; i += 2) puntos.push(girar ? [n[i + 1], n[i]] : [n[i], n[i + 1]]);
    return puntos;
  };
  const poligonos = [...doc.getElementsByTagName('gml:PolygonPatch')].map((p) => [
    ...[...p.getElementsByTagName('gml:exterior')].map(anillo),
    ...[...p.getElementsByTagName('gml:interior')].map(anillo),
  ]);
  if (!poligonos.length) throw new Error('Catastro no devolvió la geometría de la parcela');
  return { poligonos, superficie: Number(etiqueta(doc, 'cp:areaValue')) || null };
}

// lonlat para dibujar; utm (EPSG:25830, también en el huso 29) para medir. La Junta da los grados
// con 4 decimales (~10 m), demasiado gruesos para repartir una parcela; en metros da 0,1 mm.
export async function geometriaParcela(rc) {
  const [lonlat, utm] = await Promise.all([poligonoCatastro(rc, '4326'), poligonoCatastro(rc, '25830')]);
  return { lonlat: lonlat.poligonos, utm: utm.poligonos, superficie: utm.superficie };
}

// ---------- Junta de Castilla y León ----------

function wfs(capa, filtro, propiedades, srs) {
  const q = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: `urbanismo:${capa}`, outputFormat: 'application/json',
    srsName: srs, propertyName: propiedades, CQL_FILTER: filtro,
  });
  return pedir(`${IDECYL}?${q}`);
}

// Recintos de categoría de suelo que tocan la caja de la parcela (EPSG:25830). El recorte exacto se hace en el navegador.
export async function categoriasEnCaja([oeste, sur, este, norte]) {
  const r = await wfs('plau_cyl_categorias_desagrupa',
    `BBOX(geom,${oeste},${sur},${este},${norte},'EPSG:25830')`, 'geom,c_categ_sue,n_categ_sue', 'EPSG:25830');
  return r.features;
}

export async function instrumentoEnPunto(lon, lat) {
  const r = await wfs('plau_cyl_instrumentos_ambito', `INTERSECTS(geometry,SRID=4326;POINT(${lon} ${lat}))`,
    'c_instrum,n_instrum,n_mun,f_aprob,url_doc_info', 'EPSG:4326');
  return r.features[0]?.properties ?? null;
}
