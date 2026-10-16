import {
  sugerencias, coordenadas, referenciaEnPunto, datosParcela, geometriaParcela, centroDeReferencia, normalizarReferencia,
  municipios, leerPoligonoParcela, referenciaPorPoligono,
} from './servicios.js';
import { caja, reparto, veredicto } from './veredicto.js';
import { afecciones } from './afecciones.js';
import { COMUNIDADES, comunidadDe, normasDe } from './comunidades/index.js';

/* global maplibregl */
maplibregl.setWorkerUrl('vendor/maplibre-gl-csp-worker.js');

const normasAfecciones = await (await fetch('normas/afecciones.json')).json();
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

// Una capa de suelo por comunidad, limitada a su caja para no pedir teselas fuera de ella. Una comunidad
// puede dar su propia plantilla de teselas en vez de un WMS (Baleares)
// Asturias no tiene capa: su WMS solo va por http y tarda 5 s por tesela (pinta el concejo entero)
const conCapa = COMUNIDADES.filter((c) => c.capaSuelo);
const fuentesSuelo = Object.fromEntries(conCapa.map((c) => [`suelo-${c.id}`, {
  type: 'raster', tiles: [c.capaSuelo.teselas ?? wms(c.capaSuelo.wms, c.capaSuelo.capa)], tileSize: 256, bounds: c.capaSuelo.limites, attribution: c.capaSuelo.atribucion,
}]));
const capasSuelo = conCapa.map((c) => ({ id: `suelo-${c.id}`, type: 'raster', source: `suelo-${c.id}`, minzoom: 11, paint: { 'raster-opacity': 0.5 } }));

const mapa = new maplibregl.Map({
  container: 'mapa',
  center: [-4.5, 41.3],
  zoom: 6.2,
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [wmts('ign-base', 'IGNBaseTodo', 'image/png')], tileSize: 256, maxzoom: 19, attribution: 'CC BY 4.0 <a href="https://www.ign.es">IGN</a>' },
      orto: { type: 'raster', tiles: [wmts('pnoa-ma', 'OI.OrthoimageCoverage', 'image/jpeg')], tileSize: 256, maxzoom: 20, attribution: 'PNOA CC BY 4.0 <a href="https://www.ign.es">IGN</a>' },
      ...fuentesSuelo,
      catastro: { type: 'raster', tiles: [wms('https://ovc.catastro.meh.es/cartografia/INSPIRE/spadgcwms.aspx', 'CP.CadastralParcel')], tileSize: 256, attribution: 'Dirección General del Catastro' },
      parcela: { type: 'geojson', data: VACIO },
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'orto', type: 'raster', source: 'orto', layout: { visibility: 'none' } },
      ...capasSuelo,
      { id: 'catastro', type: 'raster', source: 'catastro', minzoom: 15 },
      { id: 'parcela-relleno', type: 'fill', source: 'parcela', paint: { 'fill-color': css('--rojo'), 'fill-opacity': 0.12 } },
      { id: 'parcela-borde', type: 'line', source: 'parcela', paint: { 'line-color': css('--rojo'), 'line-width': 3 } },
    ],
  },
});
mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
// Con una fuente por comunidad las atribuciones ya ocupan dos líneas: abajo a la izquierda no tapan el panel de capas
mapa.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
// Plegadas desde el principio: el botón «i» las despliega
mapa.on('load', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
mapa.getCanvas().style.cursor = 'crosshair';
mapa.on('click', (e) => analizar(e.lngLat.lng, e.lngLat.lat));

// En móvil el panel de capas empieza plegado: abierto tapa un tercio del mapa
$('#capas').open = !matchMedia('(max-width: 820px)').matches;
// La casilla «suelo» enciende y apaga las capas de todas las comunidades
document.querySelectorAll('#capas input').forEach((casilla) => {
  casilla.addEventListener('change', () => {
    const ids = casilla.dataset.capa === 'suelo' ? capasSuelo.map((c) => c.id) : [casilla.dataset.capa];
    for (const id of ids) mapa.setLayoutProperty(id, 'visibility', casilla.checked ? 'visible' : 'none');
  });
});

// ---------- Buscador ----------

const entrada = $('#q');
const lista = $('#lista');
let opciones = [];
let opcionesDe = ''; // texto para el que se pidieron: Enter solo las usa si sigue siendo el mismo
let activa = -1;
let espera;

const TIPOS = { portal: 'Portal', callejero: 'Calle', Municipio: 'Municipio', poblacion: 'Población', toponimo: 'Lugar', refcatastral: 'Ref. catastral', carretera: 'Carretera', Codpost: 'Código postal', poligono: 'Rústica' };

// «Polígono 4, parcela 376» en cada municipio que case con el texto y donde el Catastro tenga esa finca
// (se pregunta a la vez por todos): la lista no ofrece fincas que no existen. Si el Catastro no
// responde para un municipio, se ofrece igual y se comprueba al elegirlo.
async function opcionesPoligono({ poligono, parcela, municipio }) {
  const munis = await municipios(municipio);
  const rcs = await Promise.all(munis.map((m) => referenciaPorPoligono(m.muniCode, poligono, parcela).catch(() => undefined)));
  return munis
    .map((m, i) => ({
      type: 'poligono', address: `Polígono ${poligono}, parcela ${parcela}`, muni: `${m.muni} (${m.provincia})`,
      muniCode: m.muniCode, poligono, parcela, rc: rcs[i],
    }))
    .filter((o) => o.rc !== null);
}

// Lo que se ve en la lista y lo que queda en la caja al elegir es lo mismo
const etiqueta = (o) => (o.type === 'refcatastral' ? o.address : `${o.address}${o.muni && !o.address.includes(o.muni) ? `, ${o.muni}` : ''}`);

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
    texto.textContent = etiqueta(o);
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
  if (texto.length < 3) { opciones = []; opcionesDe = ''; cerrarLista(); return; }
  // Una referencia catastral se reconoce aquí mismo: CartoCiudad no entiende minúsculas ni espacios
  const rc = normalizarReferencia(texto);
  if (rc) { opciones = [{ type: 'refcatastral', address: rc }]; opcionesDe = texto; activa = -1; pintarLista(); return; }
  const pp = leerPoligonoParcela(texto);
  if (pp && !pp.municipio) { opciones = []; opcionesDe = ''; cerrarLista(); return; }
  espera = setTimeout(async () => {
    try {
      const nuevas = pp ? await opcionesPoligono(pp) : await sugerencias(texto);
      // Una respuesta lenta de un texto anterior no pisa la del actual
      if (entrada.value.trim() !== texto) return;
      opciones = nuevas; opcionesDe = texto; activa = -1;
      pintarLista();
    } catch { opciones = []; opcionesDe = ''; cerrarLista(); }
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
  const pp = leerPoligonoParcela(texto);
  if (pp && !pp.municipio) {
    return pintarAviso('Falta el municipio', `Escríbelo detrás: «polígono ${pp.poligono} parcela ${pp.parcela} Villaquilambre». Hay un polígono ${pp.poligono} en casi cada pueblo.`);
  }
  // Una opción marcada con las flechas se respeta: es lo que el usuario ha visto y elegido. Sin marcar,
  // las sugerencias solo valen si son de este mismo texto (al pegar o teclear deprisa aún no han llegado).
  let o = activa >= 0 ? opciones[activa] : null;
  const frescas = opcionesDe === texto ? opciones : [];
  if (!o && pp) {
    // Con polígono y parcela, el municipio equivocado es otra finca: si el nombre no casa con uno solo, se pregunta
    let ops = frescas;
    if (!ops.length) { try { ops = await opcionesPoligono(pp); } catch (err) { return pintarError(err); } }
    if (!ops.length) return pintarAviso(`No encuentro el polígono ${pp.poligono}, parcela ${pp.parcela} en «${pp.municipio}»`, 'Revisa el nombre del pueblo (completo, sin abreviar) y los números de la escritura, la nota simple o el anuncio.');
    const plano = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const exactos = ops.filter((x) => plano(x.muni.replace(/ \(.*\)$/, '')) === plano(pp.municipio));
    o = exactos.length === 1 ? exactos[0] : ops.length === 1 ? ops[0] : null;
    if (!o) {
      opciones = ops; opcionesDe = texto; activa = -1; pintarLista(); entrada.focus();
      return pintarAviso(`Hay varios municipios «${pp.municipio}»`, 'Elige el tuyo en la lista del buscador. Si no está, escribe el nombre completo.');
    }
  }
  o ??= frescas[0];
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
  entrada.value = etiqueta(o);
  if (o.type === 'refcatastral') return analizarReferencia(normalizarReferencia(o.address) ?? o.address);
  if (o.type === 'poligono') return analizarPoligono(o);
  try {
    const { lon, lat } = await coordenadas(o);
    if (o.type === 'portal') return analizar(lon, lat, { tolerancia: 15, portal: o.portalNumber, buscado: o.address });
    mapa.flyTo({ center: [lon, lat], zoom: o.type === 'callejero' ? 17 : 15 });
    pintarAviso('Ahora pincha la finca', 'Una calle o un pueblo no son una parcela. Acércate y pincha dentro de la finca que te interesa.');
  } catch (err) { pintarError(err); }
}

// Ejemplos: por punto, por referencia o como una búsqueda escrita (data-q)
document.querySelectorAll('#ejemplos button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.q) { entrada.value = b.dataset.q; opciones = []; opcionesDe = ''; return $('#buscador').requestSubmit(); }
  if (b.dataset.rc) return analizarReferencia(b.dataset.rc);
  analizar(Number(b.dataset.lon), Number(b.dataset.lat), b.dataset.portal ? { tolerancia: 15, portal: b.dataset.portal } : {});
}));

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

// Por polígono y parcela: el Catastro da la referencia y se sigue como con ella.
async function analizarPoligono(o) {
  const mio = ++turno;
  pintarCargando();
  try {
    const rc = o.rc ?? await referenciaPorPoligono(o.muniCode, o.poligono, o.parcela);
    if (mio !== turno) return;
    if (!rc) return pintarAviso(`No existe el polígono ${o.poligono}, parcela ${o.parcela} en ${o.muni}`, 'Revisa los números en la escritura, la nota simple o el anuncio. También puedes pinchar la finca en el mapa.');
    await porReferencia(mio, rc);
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
    await porReferencia(mio, rc);
  } catch (err) {
    if (mio === turno) pintarError(err);
  }
}

async function porReferencia(mio, rc) {
  const centro = await centroDeReferencia(rc);
  if (mio !== turno) return;
  if (!centro) return pintarAviso(`La referencia ${rc} no existe`, 'Revisa que esté bien copiada: son 14 caracteres (o 20, con el inmueble).');
  await completar(mio, rc, centro.lon, centro.lat, false);
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
  // Buscador y mapa son la misma herramienta: lo que se pincha queda escrito en la caja
  if (document.activeElement !== entrada) entrada.value = datos.localizacion ?? rc;

  const comunidad = comunidadDe(datos.provincia);
  if (datos.publica || !comunidad) return pintarResultado(datos, geo, {});
  // Las afecciones del agua tardan 2-3 s cerca de un río: el veredicto se pinta antes y ellas llegan después
  const af = afecciones(geo.lonlat, geo.utm, comunidad);
  const [normas, suelo, plan] = await Promise.all([
    normasDe(comunidad), comunidad.suelo(caja(geo.utm), geo.utm, geo.superficie, datos, geo.lonlat), comunidad.planeamiento?.(lon, lat) ?? null,
  ]);
  if (!vigente()) return;
  // Sin recintos vectoriales (Canarias: solo WMS) el adaptador trae el reparto ya contado
  const v = veredicto(normas, suelo.partes ? { partes: suelo.partes, solape: false } : reparto(geo.utm, suelo.recintos, normas.proteccion), datos);
  pintarResultado(datos, geo, { v, comunidad, normas, suelo, plan, af, vigente });
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
  mostrar(el('p', 'cargando', 'Consultando Catastro y planeamiento…'));
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
// «Art. 59 del Reglamento…» o «Disposición transitoria primera de la Ley…»
const articulo = (n, fuente) => (/^\d/.test(n) ? `Art. ${n}` : n[0].toUpperCase() + n.slice(1)) + ` ${fuente.de}`;

// La norma de una cita: la de la tabla, salvo que la cita diga otra (`norma`, en `otras_fuentes`)
const fuenteDe = (normas, clave) => (clave ? normas.otras_fuentes[clave] : normas.fuente);

function bloqueCita(cita, art, fuente) {
  const f = el('figure', 'cita');
  f.append(el('blockquote', null, `«${cita}»`));
  const pie = el('figcaption', null, `${articulo(art, fuente)} · `);
  pie.append(enlace(fuente.url, `texto en el ${fuente.boletin ?? 'BOE'}`));
  f.append(pie);
  return f;
}

function pintarAfecciones(secAf, bloque, t, af, comunidad) {
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
  // Donde el Ministerio está incompleto la comunidad dice qué parte del agua se consulta de verdad (Canarias)
  nodos.push(el('p', 'consultadas', `Consultado: ${[comunidad.consultadasAgua ?? normasAfecciones.consultadas, comunidad.consultadas].filter(Boolean).join(', ')}. Aún no: ${comunidad.pendientes}.`));
  secAf.replaceChildren(...nodos);
  secAf.dataset.listo = '';
}

const cubiertas = new Intl.ListFormat('es').format(COMUNIDADES.map((c) => c.nombre));
const ref = (art) => (!art ? '' : /^\d/.test(art) ? `art. ${art}` : art);
const mismo = (a, b) => a?.toLowerCase().trim() === b?.toLowerCase().trim();

function pintarResultado(datos, geo, { v, comunidad, normas, suelo, plan, af, vigente }) {
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
    nodos.push(el('p', 'fuera', `Por ahora el veredicto cubre ${cubiertas}. Esta parcela está en ${datos.provinciaNombre}.`));
    return mostrar(...nodos);
  }

  // Veredicto principal
  const t = v.titular;
  const bloque = el('section', `veredicto tono-${v.nivel.tono}`);
  bloque.append(el('p', 'pregunta', '¿Casa nueva, también prefabricada?'), el('p', 'respuesta', v.nivel.titulo));
  // La sigla visible puede no ser el código interno (Cantabria separa SRPO cerca y lejos del suelo urbano)
  const sigla = t.sigla ?? t.codigo;
  const nombre = sigla && !t.nombre.toUpperCase().includes(sigla) ? `${t.nombre} (${sigla})` : t.nombre;
  if (v.partes.length === 1) bloque.append(el('p', 'categoria', nombre));
  else bloque.append(el('p', 'categoria', `En la parte de ${t.nombre.toLowerCase()}: ${Math.round(t.cuota * 100)} % de la parcela`));
  // El nombre que usa el plan municipal, cuando dice más que la clase común
  if (t.detalle && !mismo(t.detalle, t.nombre)) bloque.append(el('p', 'detalle-plan', `En el plan municipal: «${t.detalle}»`));
  bloque.append(el('p', 'explicacion', t.explicacion));
  // Lo que el adaptador ha medido para esta parcela (p. ej. la distancia al suelo urbano en Cantabria)
  const nota = suelo.notas?.[t.codigo]?.trim();
  if (nota) bloque.append(el('p', 'nota-medida', nota));
  if (t.cita) bloque.append(bloqueCita(t.cita, t.articulo, fuenteDe(normas, t.norma)));
  for (const extra of t.mas ?? []) bloque.append(bloqueCita(extra.cita, extra.articulo, fuenteDe(normas, extra.norma)));
  if (t.vivienda === 'vinculada' && normas.vinculada) {
    bloque.append(bloqueCita(normas.vinculada.cita, normas.vinculada.articulo, fuenteDe(normas, normas.vinculada.norma)));
  }
  nodos.push(bloque);

  // Afecciones sectoriales: llegan después; mientras, se dice que se están comprobando
  const secAf = el('section', 'afecciones');
  secAf.append(el('h3', null, 'Afecciones'), el('p', 'cargando-af', 'Comprobando ríos, montes públicos y vías pecuarias…'));
  nodos.push(secAf);
  af.then((r) => { if (vigente()) pintarAfecciones(secAf, bloque, t, r, comunidad); })
    .catch((err) => { if (vigente()) pintarAfecciones(secAf, bloque, t, { halladas: [], fallidas: [err.message] }, comunidad); });

  // Parcela partida entre categorías
  if (v.partes.length > 1) {
    const sec = el('section', 'partes');
    sec.append(el('h3', null, 'La parcela está partida entre categorías'));
    const ul = el('ul');
    for (const p of v.partes) {
      const nivel = normas.niveles[p.vivienda];
      const li = el('li', `tono-${nivel.tono}`);
      const barra = el('span', 'barra');
      barra.style.setProperty('--cuota', p.cuota);
      li.append(el('span', 'pct', `${Math.round(p.cuota * 100)} %`), el('span', 'nombre', `${p.nombre}`),
        el('span', 'nivel', [nivel.titulo, ref(p.articulo)].filter(Boolean).join(' · ')), barra);
      ul.append(li);
    }
    sec.append(ul);
    nodos.push(sec);
  }
  if (v.solape && normas.concurrencia) {
    const sec = el('section', 'secundario');
    sec.append(el('h3', null, 'Categorías superpuestas'), el('p', null, normas.concurrencia.explicacion),
      bloqueCita(normas.concurrencia.cita, normas.concurrencia.articulo, fuenteDe(normas, normas.concurrencia.norma)));
    nodos.push(sec);
  }

  // Rehabilitar lo existente (solo rústico)
  const rehab = normas.rehabilitar?.[t.rehabilitar];
  if (rehab) {
    const art = t.articulo_rehabilitar ?? t.articulo;
    // `norma_rehabilitar: null`: la rehabilitación sale de la norma principal aunque la categoría cite otra
    const fuente = fuenteDe(normas, 'norma_rehabilitar' in t ? t.norma_rehabilitar : t.norma);
    const sec = el('section', 'secundario');
    sec.append(el('h3', null, '¿Y rehabilitar o ampliar lo que ya hay?'),
      el('p', null, `${rehab} ${articulo(art, fuente)}${normas.rehabilitar.sufijo ?? ''}.`));
    if (t.cita_rehabilitar) sec.append(bloqueCita(t.cita_rehabilitar, art, fuente));
    for (const extra of t.mas_rehabilitar ?? []) sec.append(bloqueCita(extra.cita, extra.articulo, fuenteDe(normas, extra.norma)));
    nodos.push(sec);
  }

  // Planeamiento municipal
  const planeamiento = comunidad.seccionPlaneamiento(plan, suelo, t, datos);
  if (planeamiento) {
    const sec = el('section', 'secundario');
    sec.append(el('h3', null, planeamiento.titulo), el('p', null, planeamiento.texto));
    if (planeamiento.enlace) sec.append(enlace(planeamiento.enlace.href, planeamiento.enlace.texto));
    nodos.push(sec);
  }

  const aviso = el('p', 'aviso', `Esto es un cribado con datos públicos, no un certificado. Antes de comprar, pide la cédula urbanística al Ayuntamiento de ${datos.municipio ?? 'tu municipio'}.`);
  nodos.push(aviso);

  const fuentes = el('p', 'fuentes', `Fuentes: Catastro (Sede Electrónica), ${comunidad.fuentes}, Ministerio para la Transición Ecológica (SNCZI), CartoCiudad e IGN, BOE.`);
  nodos.push(fuentes);
  mostrar(...nodos);
}
