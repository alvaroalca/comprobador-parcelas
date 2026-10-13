import {
  PROVINCIAS_CYL, sugerencias, coordenadas, referenciaEnPunto, datosParcela,
  geometriaParcela, categoriasEnCaja, instrumentoEnPunto, centroDeReferencia, normalizarReferencia,
} from './servicios.js';
import { caja, reparto, veredicto } from './veredicto.js';
import { afecciones } from './afecciones.js';

/* global maplibregl */
maplibregl.setWorkerUrl('vendor/maplibre-gl-csp-worker.js');

const [reglamento, normasAfecciones] = await Promise.all(
  ['reglamento.json', 'afecciones.json'].map(async (f) => (await fetch(f)).json()));
const $ = (sel) => document.querySelector(sel);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------- Mapa ----------

const wmts = (servicio, capa, formato) =>
  `https://www.ign.es/wmts/${servicio}?service=WMTS&request=GetTile&version=1.0.0&format=${formato}` +
  `&layer=${capa}&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&style=default`;
const wms = (base, capa) =>
  `${base}?service=WMS&version=1.1.1&request=GetMap&layers=${capa}&styles=&format=image/png` +
  '&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}';
const VACIO = { type: 'FeatureCollection', features: [] };

const mapa = new maplibregl.Map({
  container: 'mapa',
  center: [-4.75, 41.8],
  zoom: 6.4,
  attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [wmts('ign-base', 'IGNBaseTodo', 'image/png')], tileSize: 256, maxzoom: 19, attribution: 'CC BY 4.0 <a href="https://www.ign.es">IGN</a>' },
      orto: { type: 'raster', tiles: [wmts('pnoa-ma', 'OI.OrthoimageCoverage', 'image/jpeg')], tileSize: 256, maxzoom: 20, attribution: 'PNOA CC BY 4.0 <a href="https://www.ign.es">IGN</a>' },
      suelo: { type: 'raster', tiles: [wms('https://idecyl.jcyl.es/geoserver/urbanismo/wms', 'plau_cyl_categorias_desagrupa')], tileSize: 256, attribution: '© Junta de Castilla y León' },
      catastro: { type: 'raster', tiles: [wms('https://ovc.catastro.meh.es/cartografia/INSPIRE/spadgcwms.aspx', 'CP.CadastralParcel')], tileSize: 256, attribution: 'Dirección General del Catastro' },
      parcela: { type: 'geojson', data: VACIO },
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'orto', type: 'raster', source: 'orto', layout: { visibility: 'none' } },
      { id: 'suelo', type: 'raster', source: 'suelo', minzoom: 11, paint: { 'raster-opacity': 0.5 } },
      { id: 'catastro', type: 'raster', source: 'catastro', minzoom: 15 },
      { id: 'parcela-relleno', type: 'fill', source: 'parcela', paint: { 'fill-color': css('--rojo'), 'fill-opacity': 0.12 } },
      { id: 'parcela-borde', type: 'line', source: 'parcela', paint: { 'line-color': css('--rojo'), 'line-width': 3 } },
    ],
  },
});
mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
mapa.getCanvas().style.cursor = 'crosshair';
mapa.on('click', (e) => analizar(e.lngLat.lng, e.lngLat.lat));

// En móvil el panel de capas empieza plegado: abierto tapa un tercio del mapa
$('#capas').open = !matchMedia('(max-width: 820px)').matches;
document.querySelectorAll('#capas input').forEach((casilla) => {
  casilla.addEventListener('change', () =>
    mapa.setLayoutProperty(casilla.dataset.capa, 'visibility', casilla.checked ? 'visible' : 'none'));
});

// ---------- Buscador ----------

const entrada = $('#q');
const lista = $('#lista');
let opciones = [];
let activa = -1;
let espera;

const TIPOS = { portal: 'Portal', callejero: 'Calle', Municipio: 'Municipio', poblacion: 'Población', toponimo: 'Lugar', refcatastral: 'Ref. catastral', carretera: 'Carretera', Codpost: 'Código postal' };

function cerrarLista() {
  lista.hidden = true;
  entrada.setAttribute('aria-expanded', 'false');
  activa = -1;
}

function pintarLista() {
  lista.replaceChildren(...opciones.map((o, i) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.id = `op-${i}`;
    li.setAttribute('aria-selected', String(i === activa));
    const tipo = document.createElement('small');
    tipo.textContent = TIPOS[o.type] ?? o.type;
    const texto = document.createElement('span');
    texto.textContent = o.type === 'refcatastral' ? o.address : `${o.address}${o.muni && !o.address.includes(o.muni) ? `, ${o.muni}` : ''}`;
    li.append(texto, tipo);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); elegir(o); });
    return li;
  }));
  lista.hidden = !opciones.length;
  entrada.setAttribute('aria-expanded', String(!!opciones.length));
  entrada.setAttribute('aria-activedescendant', activa >= 0 ? `op-${activa}` : '');
}

entrada.addEventListener('input', () => {
  clearTimeout(espera);
  const texto = entrada.value.trim();
  if (texto.length < 3) { opciones = []; cerrarLista(); return; }
  // Una referencia catastral se reconoce aquí mismo: CartoCiudad no entiende minúsculas ni espacios
  const rc = normalizarReferencia(texto);
  if (rc) { opciones = [{ type: 'refcatastral', address: rc }]; activa = -1; pintarLista(); return; }
  espera = setTimeout(async () => {
    try {
      opciones = await sugerencias(texto);
      activa = -1;
      if (entrada.value.trim() === texto) pintarLista();
    } catch { opciones = []; cerrarLista(); }
  }, 250);
});

entrada.addEventListener('keydown', (e) => {
  if (lista.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activa = (activa + (e.key === 'ArrowDown' ? 1 : -1) + opciones.length) % opciones.length;
    pintarLista();
  } else if (e.key === 'Escape') cerrarLista();
});
entrada.addEventListener('blur', cerrarLista);

// Enter nunca se queda callado: si aún no han llegado sugerencias se buscan ahora, y si no hay, se dice
$('#buscador').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearTimeout(espera);
  const texto = entrada.value.trim();
  if (!texto) return;
  const rc = normalizarReferencia(texto);
  if (rc) { cerrarLista(); return analizarReferencia(rc); }
  let o = opciones[activa] ?? opciones[0];
  if (!o) {
    try {
      [o] = await sugerencias(texto);
      // Portal desconocido para CartoCiudad: se busca la calle sin el número y se pide pinchar
      const sinNumero = texto.replace(/\s\d+[a-z]?\s*(,|$)/i, '$1').trim();
      if (!o && sinNumero !== texto) [o] = await sugerencias(sinNumero);
    } catch (err) { return pintarError(err); }
  }
  if (o) return elegir(o);
  pintarAviso(`No encuentro «${texto}»`, 'Prueba con la calle sin número, con el nombre del pueblo o con la referencia catastral. También puedes pinchar la finca en el mapa.');
});

// Portal y referencia catastral caen dentro de una finca; calle o pueblo, no: ahí se acerca el mapa y se pide pinchar.
async function elegir(o) {
  cerrarLista();
  entrada.value = o.address;
  if (o.type === 'refcatastral') return analizarReferencia(normalizarReferencia(o.address) ?? o.address);
  try {
    const { lon, lat } = await coordenadas(o);
    if (o.type === 'portal') return analizar(lon, lat, { tolerancia: 15, portal: o.portalNumber, buscado: o.address });
    mapa.flyTo({ center: [lon, lat], zoom: o.type === 'callejero' ? 17 : 15 });
    pintarAviso('Ahora pincha la finca', 'Una calle o un pueblo no son una parcela. Acércate y pincha dentro de la finca que te interesa.');
  } catch (err) { pintarError(err); }
}

document.querySelectorAll('#ejemplos button').forEach((b) =>
  b.addEventListener('click', () => analizar(Number(b.dataset.lon), Number(b.dataset.lat),
    b.dataset.portal ? { tolerancia: 15, portal: b.dataset.portal } : {})));

// ---------- Análisis ----------

let turno = 0;

// Por punto (clic, portal, ejemplo): primero se averigua qué parcela hay ahí.
async function analizar(lon, lat, busqueda = {}) {
  const mio = ++turno;
  pintarCargando();
  try {
    const punto = await referenciaEnPunto(lon, lat, busqueda);
    if (mio !== turno) return;
    if (!punto) {
      mapa.getSource('parcela').setData(VACIO);
      return pintarAviso('Aquí no hay parcela catastral', 'Pasa en calles, caminos, ríos y fuera de España. Pincha dentro de una finca.');
    }
    await completar(mio, punto.rc, lon, lat, punto.aproximada && busqueda.buscado);
  } catch (err) {
    if (mio === turno) pintarError(err);
  }
}

// Por referencia (enlace, referencia tecleada): no hace falta buscar el punto. El centroide del
// Catastro solo sirve para saber qué plan municipal rige.
async function analizarReferencia(rc) {
  const mio = ++turno;
  pintarCargando();
  try {
    const centro = await centroDeReferencia(rc);
    if (mio !== turno) return;
    if (!centro) return pintarAviso(`La referencia ${rc} no existe`, 'Revisa que esté bien copiada: son 14 caracteres (o 20, con el inmueble).');
    await completar(mio, rc, centro.lon, centro.lat, false);
  } catch (err) {
    if (mio === turno) pintarError(err);
  }
}

async function completar(mio, rc, lon, lat, aproximada) {
  const vigente = () => mio === turno;
  const [datos, geo] = await Promise.all([datosParcela(rc), geometriaParcela(rc)]);
  datos.aproximada = aproximada;
  if (!vigente()) return;
  mapa.getSource('parcela').setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: geo.lonlat } });
  const limites = caja(geo.lonlat);
  mapa.fitBounds([[limites[0], limites[1]], [limites[2], limites[3]]], { padding: 80, maxZoom: 18, duration: 900 });
  history.replaceState(null, '', `#${rc}`);

  if (datos.publica || !PROVINCIAS_CYL.has(datos.provincia)) return pintarResultado(datos, geo, null, null);
  // Las afecciones del agua tardan 2-3 s cerca de un río: el veredicto se pinta antes y ellas llegan después
  const af = afecciones(geo.lonlat, geo.utm);
  const [recintos, instrumento] = await Promise.all([categoriasEnCaja(caja(geo.utm)), instrumentoEnPunto(lon, lat)]);
  if (!vigente()) return;
  pintarResultado(datos, geo, veredicto(reglamento, reparto(geo.utm, recintos, reglamento.proteccion), datos), instrumento, af, vigente);
}

// Enlace compartible: #referencia catastral
function abrirDesdeEnlace() {
  const rc = normalizarReferencia(decodeURIComponent(location.hash.slice(1)));
  if (rc) analizarReferencia(rc);
}
mapa.on('load', abrirDesdeEnlace);

// ---------- Ficha ----------

const resultado = $('#resultado');
const inicio = $('#inicio');

function mostrar(...nodos) {
  inicio.hidden = true;
  resultado.hidden = false;
  resultado.replaceChildren(...nodos);
  resultado.scrollTop = 0;
}

function el(etiqueta, clase, texto) {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  if (texto != null) n.textContent = texto;
  return n;
}

function enlace(href, texto) {
  const a = el('a', null, texto);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

const volver = () => {
  const b = el('button', 'volver', '← Otra búsqueda');
  b.addEventListener('click', () => { resultado.hidden = true; inicio.hidden = false; entrada.focus(); });
  return b;
};

function pintarCargando() {
  mostrar(el('p', 'cargando', 'Consultando Catastro y Junta de Castilla y León…'));
}

function pintarAviso(titulo, texto) {
  mostrar(volver(), el('h2', 'aviso-titulo', titulo), el('p', null, texto));
}

function pintarError(err) {
  console.error(err);
  pintarAviso('No se pudo completar la consulta', `${err.message}. Los servicios públicos a veces tardan o se caen un rato: prueba de nuevo en unos segundos.`);
}

const m2 = (n) => n >= 10000
  ? `${(n / 10000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ha (${Math.round(n).toLocaleString('es-ES')} m²)`
  : `${Math.round(n).toLocaleString('es-ES')} m²`;
const fecha = (iso) => iso && new Date(iso.replace('Z', '')).toLocaleDateString('es-ES');
const articulo = (n) => `Art. ${n} del Reglamento de Urbanismo de Castilla y León`;

function bloqueCita(cita, art, norma = null) {
  const f = el('figure', 'cita');
  f.append(el('blockquote', null, `«${cita}»`));
  const pie = el('figcaption', null, norma ? `Art. ${art} del ${norma.nombre} · ` : `${articulo(art)} · `);
  pie.append(enlace(norma?.url ?? reglamento.fuente.url, 'texto en el BOE'));
  f.append(pie);
  return f;
}

function pintarAfecciones(secAf, bloque, t, af) {
  const graves = af.halladas.filter((a) => normasAfecciones.tipos[a.tipo].tono === 'no');
  if (graves.length && t.vivienda !== 'prohibida') {
    bloque.append(el('p', 'ojo', `Ojo: además hay ${graves.length === 1 ? 'una afección que limita' : `${graves.length} afecciones que limitan`} más. Míralas abajo.`));
  }
  // Si algo falló no se puede decir «sin afecciones»: solo que no se encontraron en lo que sí respondió
  const titulo = af.halladas.length ? 'Afecciones'
    : af.fallidas.length ? 'Afecciones: consulta incompleta' : 'Sin afecciones en las capas consultadas';
  const nodos = [el('h3', null, titulo)];
  for (const a of af.halladas) {
    const tipo = normasAfecciones.tipos[a.tipo];
    const art = el('article', `tono-${tipo.tono}`);
    art.append(el('h4', null, tipo.titulo), el('p', 'detalle', a.detalle), el('p', null, tipo.texto),
      bloqueCita(tipo.cita, tipo.articulo, normasAfecciones.fuentes[tipo.fuente]));
    nodos.push(art);
  }
  if (af.fallidas.length) {
    nodos.push(el('p', 'fallo', `No se pudo consultar: ${af.fallidas.join(', ')}. Que no salga no quiere decir que no haya. Prueba de nuevo en un rato.`));
  }
  nodos.push(el('p', 'consultadas', `Consultado: ${normasAfecciones.consultadas} Aún no: Red Natura 2000, carreteras ni patrimonio.`));
  secAf.replaceChildren(...nodos);
  secAf.dataset.listo = '';
}

function pintarResultado(datos, geo, v, instrumento, af, vigente) {
  const nodos = [volver()];

  const cab = el('header', 'parcela');
  cab.append(el('p', 'rc', datos.rc), el('h2', null, datos.localizacion ?? datos.municipio));
  const dl = el('dl', 'datos');
  const fila = (k, val) => { if (val) dl.append(el('dt', null, k), el('dd', null, val)); };
  fila('Superficie', geo.superficie && m2(geo.superficie));
  fila('Catastro', { RU: 'Rústica', UR: 'Urbana' }[datos.clase] ?? datos.clase);
  fila('Uso', datos.uso);
  fila('Cultivo', datos.cultivo);
  cab.append(dl);
  nodos.push(cab);
  if (datos.aproximada) {
    nodos.push(el('p', 'aproximada', `El Catastro no tiene «${datos.aproximada}» como tal. Esta es la parcela más cercana al punto: comprueba en el mapa que es la que buscas o pincha la correcta.`));
  }

  if (datos.publica) {
    nodos.push(el('p', 'fuera', `El Catastro la clasifica como «${datos.cultivo}»: es un camino, una carretera o un cauce, no una finca privada. Pincha la finca que te interesa.`));
    return mostrar(...nodos);
  }
  if (!v) {
    nodos.push(el('p', 'fuera', `Por ahora el veredicto solo cubre Castilla y León. Esta parcela está en ${datos.provinciaNombre}.`));
    return mostrar(...nodos);
  }

  // Veredicto principal
  const t = v.titular;
  const bloque = el('section', `veredicto tono-${v.nivel.tono}`);
  bloque.append(el('p', 'pregunta', '¿Casa nueva, también prefabricada?'), el('p', 'respuesta', v.nivel.titulo));
  if (v.partes.length === 1) bloque.append(el('p', 'categoria', t.codigo ? `${t.nombre} (${t.codigo})` : t.nombre));
  else bloque.append(el('p', 'categoria', `En la parte de ${t.nombre.toLowerCase()}: ${Math.round(t.cuota * 100)} % de la parcela`));
  bloque.append(el('p', 'explicacion', t.explicacion), bloqueCita(t.cita, t.articulo));
  if (t.vivienda === 'vinculada') bloque.append(bloqueCita(reglamento.art57e.cita, reglamento.art57e.articulo));
  nodos.push(bloque);

  // Afecciones sectoriales: llegan después; mientras, se dice que se están comprobando
  const secAf = el('section', 'afecciones');
  secAf.append(el('h3', null, 'Afecciones'), el('p', 'cargando-af', 'Comprobando ríos, montes públicos y vías pecuarias…'));
  nodos.push(secAf);
  af.then((r) => { if (vigente()) pintarAfecciones(secAf, bloque, t, r); })
    .catch((err) => { if (vigente()) pintarAfecciones(secAf, bloque, t, { halladas: [], fallidas: [err.message] }); });

  // Parcela partida entre categorías
  if (v.partes.length > 1) {
    const sec = el('section', 'partes');
    sec.append(el('h3', null, 'La parcela está partida entre categorías'));
    const ul = el('ul');
    for (const p of v.partes) {
      const li = el('li', `tono-${reglamento.niveles[p.vivienda].tono}`);
      const barra = el('span', 'barra');
      barra.style.setProperty('--cuota', p.cuota);
      li.append(el('span', 'pct', `${Math.round(p.cuota * 100)} %`), el('span', 'nombre', `${p.nombre}`),
        el('span', 'nivel', `${reglamento.niveles[p.vivienda].titulo} · art. ${p.articulo}`), barra);
      ul.append(li);
    }
    sec.append(ul);
    nodos.push(sec);
  }
  if (v.solape) {
    const sec = el('section', 'secundario');
    sec.append(el('h3', null, 'Categorías superpuestas'), el('p', null, reglamento.concurrencia.explicacion),
      bloqueCita(reglamento.concurrencia.cita, reglamento.concurrencia.articulo));
    nodos.push(sec);
  }

  // Rehabilitar lo existente (solo rústico)
  const rehab = { autorizable: 'Con autorización de uso excepcional, siempre que lo existente no esté fuera de ordenación.', segun_plan: 'Depende del plan municipal.' }[t.rehabilitar];
  if (rehab) {
    const sec = el('section', 'secundario');
    sec.append(el('h3', null, '¿Y rehabilitar o ampliar lo que ya hay?'), el('p', null, `${rehab} ${articulo(t.articulo)} y art. 57.f.`));
    nodos.push(sec);
  }

  // Planeamiento municipal
  if (instrumento) {
    const sec = el('section', 'secundario');
    sec.append(el('h3', null, 'Planeamiento de ' + (instrumento.n_mun ?? datos.municipio)));
    const nombre = instrumento.n_instrum ?? instrumento.c_instrum;
    const p = el('p', null, instrumento.c_instrum === 'SPG'
      ? `${nombre}: no hay plan municipal que clasifique el suelo, así que se aplica directamente el Reglamento.`
      : instrumento.c_instrum === 'DSU' && t.sinPlaneamiento
        ? `${nombre}${instrumento.f_aprob ? ` (${fecha(instrumento.f_aprob)})` : ''}: solo delimita el casco urbano. Fuera de él rige el régimen del rústico de los municipios sin planeamiento (Ley 5/1999 de Urbanismo de Castilla y León, disposición transitoria cuarta).`
        : `${nombre}${instrumento.f_aprob ? `, aprobado el ${fecha(instrumento.f_aprob)}` : ''}. Sus normas pueden ser más estrictas que el Reglamento (parcela mínima, alturas, cubierta, materiales).`);
    sec.append(p);
    if (instrumento.url_doc_info) sec.append(enlace(instrumento.url_doc_info, 'Documentos del plan en la Junta'));
    nodos.push(sec);
  }

  const aviso = el('p', 'aviso', `Esto es un cribado con datos públicos, no un certificado. Antes de comprar, pide la cédula urbanística al Ayuntamiento de ${datos.municipio ?? 'tu municipio'}.`);
  nodos.push(aviso);

  const fuentes = el('p', 'fuentes', 'Fuentes: Catastro (Sede Electrónica), Junta de Castilla y León (información sin validez jurídica), Ministerio para la Transición Ecológica (SNCZI), CartoCiudad e IGN, BOE.');
  nodos.push(fuentes);
  mostrar(...nodos);
}
