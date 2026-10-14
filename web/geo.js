// Geometría plana compartida. Todo en metros (EPSG:25830) salvo donde se diga.

/* global polygonClipping */
export const poligonos = globalThis.polygonClipping; // vendor/polygon-clipping.umd.min.js

// Área de un MultiPolygon
export function area(multi) {
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

export function caja(multi) {
  const ps = multi.flat(2);
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export const comoMulti = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

// Recorte de un MultiPolygon a una caja (Sutherland-Hodgman por anillo), con coordenadas redondeadas.
// Medido el 14/10/2026 en Cataluña: un recinto de no urbanizable puede ser la zona entera de un municipio,
// con miles de vértices, y polygon-clipping tardaba 20 s y acababa fallando («Unable to find segment … in
// SweepLine tree»). Recortado a la caja de la parcela con un margen, la intersección con la parcela es la
// misma y la librería trabaja con polígonos pequeños; el redondeo evita los segmentos casi coincidentes.
export function aCaja(multi, [x0, y0, x1, y1], margen = 1, decimales = 2) {
  const f = 10 ** decimales;
  const r = (v) => Math.round(v * f) / f;
  const lados = [
    [(p) => p[0] >= x0 - margen, (a, b) => { const x = x0 - margen; return [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]; }],
    [(p) => p[0] <= x1 + margen, (a, b) => { const x = x1 + margen; return [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]; }],
    [(p) => p[1] >= y0 - margen, (a, b) => { const y = y0 - margen; return [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y]; }],
    [(p) => p[1] <= y1 + margen, (a, b) => { const y = y1 + margen; return [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y]; }],
  ];
  const recortarAnillo = (anillo) => {
    let pts = anillo.slice(0, -1);
    for (const [dentro, corte] of lados) {
      const sale = [];
      pts.forEach((b, i) => {
        const a = pts[(i + pts.length - 1) % pts.length];
        if (dentro(b)) { if (!dentro(a)) sale.push(corte(a, b)); sale.push(b); } else if (dentro(a)) sale.push(corte(a, b));
      });
      pts = sale;
      if (!pts.length) return null;
    }
    const redondo = pts.map(([x, y]) => [r(x), r(y)]).filter((p, i, xs) => i === 0 || p[0] !== xs[i - 1][0] || p[1] !== xs[i - 1][1]);
    return redondo.length >= 3 ? [...redondo, redondo[0]] : null;
  };
  return multi
    .map((poligono) => {
      const exterior = recortarAnillo(poligono[0]);
      return exterior && [exterior, ...poligono.slice(1).map(recortarAnillo).filter(Boolean)];
    })
    .filter(Boolean);
}

// Una operación de polygon-clipping que, si la librería falla por precisión, se reintenta con 10 cm.
export function recorteSeguro(op, a, b, cajaRef) {
  try { return op(a, b); } catch {
    return op(aCaja(a, cajaRef, 1, 1), aCaja(b, cajaRef, 1, 1));
  }
}

export const wkt = (multi, decimales) =>
  `MULTIPOLYGON(${multi.map((p) => `(${p.map((a) => `(${a.map(([x, y]) => `${x.toFixed(decimales)} ${y.toFixed(decimales)}`).join(',')})`).join(',')})`).join(',')})`;

// Parte de la parcela que cubre cada entidad poligonal. Entidad y parcela se digitalizaron por separado
// y en los bordes se pisan unos metros: solo cuentan las que ocupan al menos el 0,5 % de la parcela.
export function cuotas(features, utm) {
  const total = area(utm);
  const marco = caja(utm);
  const p = aCaja(utm, marco);
  return features
    .map((f) => {
      const g = aCaja(comoMulti(f.geometry), marco);
      return { ...f.properties, cuota: g.length ? area(recorteSeguro(poligonos.intersection, p, g, marco)) / total : 0 };
    })
    .filter((x) => x.cuota >= 0.005)
    .sort((a, b) => b.cuota - a.cuota);
}

// Distancia de un punto a un segmento
const seg = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

// ¿Está el punto dentro del anillo? (par-impar)
export function dentroDe(p, anillo) {
  let c = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Distancia mínima de un punto a unas polilíneas
export function distanciaPunto(p, lineas) {
  let min = Infinity;
  for (const linea of lineas) for (let i = 0; i < linea.length - 1; i++) min = Math.min(min, seg(p, linea[i], linea[i + 1]));
  return min;
}

// Distancia mínima entre el polígono y una polilínea; 0 si la línea entra en él.
export function distancia(multi, lineas) {
  const giro = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const cruzan = (a, b, c, d) => giro(a, b, c) !== giro(a, b, d) && giro(c, d, a) !== giro(c, d, b);
  const bordes = multi.flat();
  let min = Infinity;
  for (const linea of lineas) {
    for (const p of linea) if (multi.some((pol) => dentroDe(p, pol[0]) && !pol.slice(1).some((h) => dentroDe(p, h)))) return 0;
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

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Un reintento: algunos servidores públicos cortan conexiones a ráfagas.
export async function conReintento(f) {
  try { return await f(); } catch { await pausa(1500); return f(); }
}

// Consulta a una capa ArcGIS REST (MapServer/<id>) por caja en EPSG:25830. Devuelve GeoJSON en 25830.
// ArcGIS responde 200 también cuando falla: el error viene dentro del cuerpo. `extra` añade o sustituye
// parámetros (otra geometría, un búfer); con él la respuesta puede no ser una lista de recintos (un recuento).
export function arcgis(capa, [x0, y0, x1, y1], { where = '1=1', campos = '*', geometria = true, extra = {} } = {}) {
  return conReintento(async () => {
    const q = new URLSearchParams({
      geometry: [x0, y0, x1, y1].join(','), geometryType: 'esriGeometryEnvelope', inSR: '25830', outSR: '25830',
      spatialRel: 'esriSpatialRelIntersects', where, outFields: campos, returnGeometry: String(geometria), f: 'geojson', ...extra,
    });
    // Un polígono largo no cabe en la URL (IIS corta hacia los 2 kB, y su error llega sin CORS): por POST
    // de formulario, que es petición simple, sin preflight
    const largo = q.toString().length > 1800;
    const r = await (largo ? fetch(`${capa}/query`, { method: 'POST', body: q }) : fetch(`${capa}/query?${q}`));
    const host = new URL(capa).host;
    if (!r.ok) throw new Error(`${host} respondió ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error(`${host}: ${d.error.message}`);
    return d.features ?? d;
  });
}

// WFS por POST de formulario: petición «simple» (sin preflight) que admite polígonos largos.
export function wfs(base, capa, filtro, propiedades, srs) {
  return conReintento(async () => {
    const cuerpo = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: capa,
      outputFormat: 'application/json', propertyName: propiedades, CQL_FILTER: filtro,
    });
    if (srs) cuerpo.set('srsName', srs);
    const r = await fetch(base, { method: 'POST', body: cuerpo });
    if (!r.ok) throw new Error(`${new URL(base, location.href).host} respondió ${r.status}`);
    return (await r.json()).features;
  });
}
