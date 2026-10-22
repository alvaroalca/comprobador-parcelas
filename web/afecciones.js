// Afecciones sectoriales de una parcela: las del agua (Ministerio, toda España) y las que aporta
// cada comunidad (montes, vías pecuarias, espacios protegidos) desde su adaptador.
//
// Agua, medido el 13/10/2026: los recintos del Ministerio son ríos enteros (130 km en una entidad).
// - INTERSECTS exacto tarda 3-9 s por capa en su servidor y, con varias a la vez, corta conexiones.
// - BBOX solo compara cajas envolventes: rápido (~0,1 s) pero devuelve ríos que no tocan la parcela.
// Así que: BBOX sin geometría para sacar candidatos y, por cada candidato, su dibujo WMS recortado a la
// caja de la parcela (1 px ≈ 1 m, relleno sólido) para contar qué parte de la parcela pinta (~0,2 s).

import { agrupar, caja, conReintento, traer, wfs } from './geo.js';

// El Ministerio manda la cabecera CORS duplicada («*, *») y el navegador rechaza sus respuestas
// (curl no se queja). Se le llega por un proxy del mismo origen: el Worker del portfolio en
// producción y tools/servir.py en local. Solo deja pasar estas dos rutas.
const MITECO_WFS = '/api/miteco/geoserver/agua/wfs';
const MITECO_WMS = '/api/miteco/geoserver/agua/wms';

const relleno = (capa) => '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">' +
  `<NamedLayer><Name>${capa}</Name><UserStyle><FeatureTypeStyle><Rule><PolygonSymbolizer><Fill>` +
  '<CssParameter name="fill">#000000</CssParameter></Fill></PolygonSymbolizer></Rule></FeatureTypeStyle>' +
  '</UserStyle></NamedLayer></StyledLayerDescriptor>';

// Fracción de la parcela (EPSG:25830) que cubren las entidades `fids` (separadas por comas) de `capa`, contando píxeles.
async function cuotaPintada(capa, fids, utm) {
  const [x0, y0, x1, y1] = caja(utm);
  const escala = Math.min(1, 1024 / Math.max(x1 - x0, y1 - y0)); // 1 px = 1 m hasta 1 km de lado
  const w = Math.max(8, Math.ceil((x1 - x0) * escala));
  const h = Math.max(8, Math.ceil((y1 - y0) * escala));
  const q = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: capa, styles: '', featureid: fids,
    srs: 'EPSG:25830', bbox: [x0, y0, x1, y1].join(','), width: w, height: h,
    format: 'image/png', transparent: 'true', SLD_BODY: relleno(capa),
  });
  const imagen = await conReintento(async () => {
    const r = await traer(`${MITECO_WMS}?${q}`);
    if (!r.ok || !r.headers.get('content-type')?.startsWith('image/')) throw new Error('El WMS del Ministerio no devolvió imagen');
    return createImageBitmap(await r.blob());
  });

  const lienzo = new OffscreenCanvas(w, h);
  const c = lienzo.getContext('2d', { willReadFrequently: true });
  c.drawImage(imagen, 0, 0);
  const capaPx = c.getImageData(0, 0, w, h).data;
  c.clearRect(0, 0, w, h);
  c.beginPath();
  for (const poligono of utm) {
    for (const anillo of poligono) {
      anillo.forEach(([x, y], i) => {
        const px = ((x - x0) / (x1 - x0)) * w, py = ((y1 - y) / (y1 - y0)) * h;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      });
      c.closePath();
    }
  }
  c.fill('evenodd');
  const mascara = c.getImageData(0, 0, w, h).data;
  let dentro = 0, pintados = 0;
  for (let i = 3; i < mascara.length; i += 4) {
    if (mascara[i] < 128) continue;
    dentro++;
    if (capaPx[i] >= 128) pintados++;
  }
  return pintados >= 2 ? pintados / dentro : 0; // 1 px suelto es borde antialiasado
}

// Candidatos por caja (rápido, sin geometría) y comprobación de cada uno por píxeles.
async function aguaEnParcela(capa, lonlat, utm) {
  const [o, s, e, n] = caja(lonlat);
  const candidatos = await wfs(MITECO_WFS, capa, `BBOX(shape,${o},${s},${e},${n},'EPSG:4326')`, 'rio,tipo_zona');
  const tocan = [];
  for (const f of candidatos) {
    const cuota = await cuotaPintada(capa, f.id, utm);
    if (cuota > 0) tocan.push({ ...f.properties, cuota, capa, fid: f.id });
  }
  return tocan;
}

const unicos = (xs) => [...new Set(xs.filter(Boolean))];

// Devuelve { halladas: [{tipo, detalle}], fallidas: [nombre de la fuente] }. Cada comunidad aporta
// con `comunidad.afecciones(lonlat, utm)` un mapa { clave: { nombre, consulta } } cuya consulta
// devuelve ya sus hallazgos [{tipo, detalle}].
export async function afecciones(lonlat, utm, comunidad) {
  // Las del Ministerio van en serie: en paralelo su servidor corta conexiones.
  let cola = Promise.resolve();
  const enSerie = (f) => { const p = cola.then(f); cola = p.catch(() => {}); return p; };
  const agua = {
    zfp: { nombre: 'flujo preferente', consulta: () => enSerie(() => aguaEnParcela('agua:ZI_Laminas_ZFP', lonlat, utm)) },
    q500: { nombre: 'zona inundable', consulta: () => enSerie(() => aguaEnParcela('agua:Zi_laminas_q500', lonlat, utm)) },
    dphEstimado: { nombre: 'dominio público hidráulico', consulta: () => enSerie(() => aguaEnParcela('agua:DPH_Estimado', lonlat, utm)) },
    dphDeslindado: { nombre: 'dominio público hidráulico', consulta: () => enSerie(() => aguaEnParcela('agua:DPH_Deslindado', lonlat, utm)) },
  };
  // Donde el Ministerio está incompleto la comunidad pone su propia capa (Baleares: la zona inundable)
  for (const k of comunidad.aguaPropia ?? []) delete agua[k];
  const propias = comunidad.afecciones?.(lonlat, utm) ?? {};
  const consultas = { ...agua, ...propias };

  const claves = Object.keys(consultas);
  const resultados = await Promise.allSettled(claves.map((k) => consultas[k].consulta()));
  const r = {};
  const fallidas = new Set();
  resultados.forEach((res, i) => {
    if (res.status === 'fulfilled') r[claves[i]] = res.value;
    else { console.error(claves[i], res.reason); fallidas.add(consultas[claves[i]].nombre); r[claves[i]] = []; }
  });

  const halladas = [];
  // Ríos afectados y parte de la parcela cubierta. Si un tipo son varios recintos (la zona de policía
  // de un río puede venir en dos piezas), se pintan juntos para medir su unión y no solo el mayor.
  const rios = async (xs) => {
    const porCapa = agrupar(xs, (x) => x.capa);
    const cuotas = await Promise.all([...porCapa].map(([capa, ys]) => (ys.length === 1 ? ys[0].cuota
      : enSerie(() => cuotaPintada(capa, ys.map((y) => y.fid).join(','), utm)).catch(() => Math.max(...ys.map((y) => y.cuota))))));
    const pct = Math.max(...cuotas) * 100;
    return `${unicos(xs.map((x) => x.rio)).join(', ')}: ${pct < 1 ? 'menos del 1' : Math.round(pct)} % de la parcela`;
  };

  if (r.zfp?.length) halladas.push({ tipo: 'zfp', detalle: await rios(r.zfp) });

  const dph = [...(r.dphEstimado ?? []), ...(r.dphDeslindado ?? [])];
  const cauce = dph.filter((x) => !/polic/i.test(x.tipo_zona ?? ''));
  const policia = dph.filter((x) => /polic/i.test(x.tipo_zona ?? ''));
  if (cauce.length) halladas.push({ tipo: 'dph', detalle: await rios(cauce) });

  for (const k of Object.keys(propias)) halladas.push(...r[k]);

  if (r.q500?.length) halladas.push({ tipo: 'inundable', detalle: await rios(r.q500) });
  if (policia.length) halladas.push({ tipo: 'policia', detalle: await rios(policia) });

  return { halladas, fallidas: [...fallidas] };
}
