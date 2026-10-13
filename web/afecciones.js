// Afecciones sectoriales de una parcela: agua (Ministerio), montes públicos y vías pecuarias (Junta).
//
// Agua, medido el 13/10/2026: los recintos del Ministerio son ríos enteros (130 km en una entidad).
// - INTERSECTS exacto tarda 3-9 s por capa en su servidor y, con varias a la vez, corta conexiones.
// - BBOX solo compara cajas envolventes: rápido (~0,1 s) pero devuelve ríos que no tocan la parcela.
// Así que: BBOX sin geometría para sacar candidatos y, por cada candidato, su dibujo WMS recortado a la
// caja de la parcela (1 px ≈ 1 m, relleno sólido) para contar qué parte de la parcela pinta (~0,2 s).

// El Ministerio manda la cabecera CORS duplicada («*, *») y el navegador rechaza sus respuestas
// (curl no se queja). Se le llega por un proxy del mismo origen: el Worker del portfolio en
// producción y tools/servir.py en local. Solo deja pasar estas dos rutas.
const MITECO_WFS = '/api/miteco/geoserver/agua/wfs';
const MITECO_WMS = '/api/miteco/geoserver/agua/wms';
const MONTES = 'https://idecyl.jcyl.es/geoserver/montes/wfs';

// Área plana de un MultiPolygon en metros (EPSG:25830)
function area(multi) {
  let total = 0;
  for (const poligono of multi) {
    poligono.forEach((anillo, i) => {
      let s = 0;
      for (let k = 0; k < anillo.length - 1; k++) s += anillo[k][0] * anillo[k + 1][1] - anillo[k + 1][0] * anillo[k][1];
      total += (i ? -1 : 1) * Math.abs(s / 2);
    });
  }
  return total;
}

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Un reintento: el servidor del Ministerio corta conexiones (ECONNRESET) a ráfagas.
async function conReintento(f) {
  try { return await f(); } catch { await pausa(1500); return f(); }
}

// POST de formulario: petición «simple» (sin preflight) que admite polígonos largos.
function wfs(base, capa, filtro, propiedades, srs) {
  return conReintento(async () => {
    const cuerpo = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: capa,
      outputFormat: 'application/json', propertyName: propiedades, CQL_FILTER: filtro,
    });
    if (srs) cuerpo.set('srsName', srs);
    const r = await fetch(base, { method: 'POST', body: cuerpo });
    if (!r.ok) throw new Error(`${new URL(base).host} respondió ${r.status}`);
    return (await r.json()).features;
  });
}

const wkt = (multi, decimales) =>
  `MULTIPOLYGON(${multi.map((p) => `(${p.map((a) => `(${a.map(([x, y]) => `${x.toFixed(decimales)} ${y.toFixed(decimales)}`).join(',')})`).join(',')})`).join(',')})`;

function caja(multi) {
  const ps = multi.flat(2);
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

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
    const r = await fetch(`${MITECO_WMS}?${q}`);
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

// Distancia mínima entre el polígono (metros) y una polilínea; 0 si la línea entra en él.
function distancia(multi, lineas) {
  const seg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const dentro = (p, anillo) => {
    let c = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const giro = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const cruzan = (a, b, c, d) => giro(a, b, c) !== giro(a, b, d) && giro(c, d, a) !== giro(c, d, b);
  const bordes = multi.flat();
  let min = Infinity;
  for (const linea of lineas) {
    for (const p of linea) if (multi.some((pol) => dentro(p, pol[0]) && !pol.slice(1).some((h) => dentro(p, h)))) return 0;
    for (let i = 0; i < linea.length - 1; i++) {
      for (const anillo of bordes) {
        for (const q of anillo) min = Math.min(min, seg(q, linea[i], linea[i + 1]));
        for (let k = 0; k < anillo.length - 1; k++) {
          // Un tramo largo puede atravesar la parcela sin dejar ningún vértice dentro
          if (cruzan(linea[i], linea[i + 1], anillo[k], anillo[k + 1])) return 0;
          min = Math.min(min, seg(linea[i], anillo[k], anillo[k + 1]), seg(linea[i + 1], anillo[k], anillo[k + 1]));
        }
      }
    }
  }
  return min;
}

const unicos = (xs) => [...new Set(xs.filter(Boolean))];

// Devuelve { halladas: [{tipo, detalle}], fallidas: [nombre de la fuente] }.
export async function afecciones(lonlat, utm) {
  const enMetros = `SRID=25830;${wkt(utm, 2)}`;

  // Las del Ministerio van en serie: en paralelo su servidor corta conexiones.
  let cola = Promise.resolve();
  const enSerie = (f) => { const p = cola.then(f); cola = p.catch(() => {}); return p; };
  const consultas = {
    zfp: () => enSerie(() => aguaEnParcela('agua:ZI_Laminas_ZFP', lonlat, utm)),
    q500: () => enSerie(() => aguaEnParcela('agua:Zi_laminas_q500', lonlat, utm)),
    dphEstimado: () => enSerie(() => aguaEnParcela('agua:DPH_Estimado', lonlat, utm)),
    dphDeslindado: () => enSerie(() => aguaEnParcela('agua:DPH_Deslindado', lonlat, utm)),
    // Con geometría: monte y parcela se digitalizaron por separado y en los bordes se pisan unos metros.
    // Solo cuenta un monte que ocupe al menos el 0,5 % de la parcela (como con las categorías de suelo).
    mup: () => wfs(MONTES, 'montes:montes_cyl_mup_vw', `INTERSECTS(geometry,${enMetros})`, 'geometry,n_monte,v_mup', 'EPSG:25830'),
    // La anchura legal llega con cada vía (hasta 75 m en una cañada): se traen las que pasan a menos
    // de 40 m y se mide aquí la distancia contra la mitad de su anchura.
    vvpp: () => wfs(MONTES, 'montes:znie_cyl_vvpp_ejes', `DWITHIN(geometry,${enMetros},40,meters)`,
      'geometry,nombre,categoria,ancho_m', 'EPSG:25830'),
  };
  const nombres = { zfp: 'flujo preferente', q500: 'zona inundable', dphEstimado: 'dominio público hidráulico', dphDeslindado: 'dominio público hidráulico', mup: 'montes de utilidad pública', vvpp: 'vías pecuarias' };

  const claves = Object.keys(consultas);
  const resultados = await Promise.allSettled(claves.map((k) => consultas[k]()));
  const r = {};
  const fallidas = new Set();
  resultados.forEach((res, i) => {
    if (res.status === 'fulfilled') r[claves[i]] = res.value;
    else { console.error(claves[i], res.reason); fallidas.add(nombres[claves[i]]); r[claves[i]] = []; }
  });

  const halladas = [];
  // Ríos afectados y parte de la parcela cubierta. Si un tipo son varios recintos (la zona de policía
  // de un río puede venir en dos piezas), se pintan juntos para medir su unión y no solo el mayor.
  const rios = async (xs) => {
    const porCapa = Map.groupBy(xs, (x) => x.capa);
    const cuotas = await Promise.all([...porCapa].map(([capa, ys]) => (ys.length === 1 ? ys[0].cuota
      : enSerie(() => cuotaPintada(capa, ys.map((y) => y.fid).join(','), utm)).catch(() => Math.max(...ys.map((y) => y.cuota))))));
    const pct = Math.max(...cuotas) * 100;
    return `${unicos(xs.map((x) => x.rio)).join(', ')}: ${pct < 1 ? 'menos del 1' : Math.round(pct)} % de la parcela`;
  };

  if (r.zfp.length) halladas.push({ tipo: 'zfp', detalle: await rios(r.zfp) });

  const dph = [...r.dphEstimado, ...r.dphDeslindado];
  const cauce = dph.filter((x) => !/polic/i.test(x.tipo_zona ?? ''));
  const policia = dph.filter((x) => /polic/i.test(x.tipo_zona ?? ''));
  if (cauce.length) halladas.push({ tipo: 'dph', detalle: await rios(cauce) });

  const total = area(utm);
  const montes = r.mup
    .map((f) => {
      const g = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return { ...f.properties, cuota: area(globalThis.polygonClipping.intersection(utm, g)) / total };
    })
    .filter((m) => m.cuota >= 0.005)
    .sort((a, b) => b.cuota - a.cuota);
  if (montes.length) {
    halladas.push({ tipo: 'mup', detalle: montes.map((m) => `nº ${m.v_mup} «${m.n_monte}»: ${Math.round(m.cuota * 100)} %`).join(', ') });
  }

  const vias = r.vvpp.filter((f) => {
    const g = f.geometry;
    const lineas = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    return distancia(utm, lineas) <= (Number(f.properties.ancho_m) || 0) / 2;
  });
  if (vias.length) {
    halladas.push({ tipo: 'vvpp', detalle: unicos(vias.map((f) => `${f.properties.nombre}${f.properties.ancho_m ? ` (${Math.round(f.properties.ancho_m)} m de ancho)` : ''}`)).join(', ') });
  }

  if (r.q500.length) halladas.push({ tipo: 'inundable', detalle: await rios(r.q500) });
  if (policia.length) halladas.push({ tipo: 'policia', detalle: await rios(policia) });

  return { halladas, fallidas: [...fallidas] };
}
