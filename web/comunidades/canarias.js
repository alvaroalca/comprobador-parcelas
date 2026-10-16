// Canarias: planeamiento urbanístico de GRAFCAN (IDECanarias), solo WMS. La capa de categorías (CLA) trae
// un código normalizado por recinto (`cod`, el de la leyenda: 20 urbano consolidado, 53 asentamiento rural,
// 48 protección agraria...) y GRAFCAN ya aplica las equivalencias de la Ley 4/2017 a los planes antiguos.
//
// Medido el 16/10/2026: sin WFS ni atributos geométricos, así que el reparto se cuenta en píxeles, como el
// agua del Ministerio: un GetMap recortado a la parcela con un color exacto por código (SLD_BODY) y una
// máscara de la parcela. El SLD no cabe en la URL (414 a partir de ~8 kB): va por POST de formulario, que es
// petición simple y el servidor contesta con CORS abierto. Después, una consulta de punto por categoría para
// el nombre que le da el plan y el documento del que sale. Red Natura (LIC/ZEC y ZEPA) igual, sin nombres:
// esas capas no publican atributos.

import { caja, conReintento } from '../geo.js';

const IDECAN = 'https://idecan2.grafcan.es/ServicioWMS';

// Código de la leyenda de CLA → clave de normas/canarias.json
const CODIGOS = {
  10: 'SU', 11: 'SUz', 12: 'SRPA', 13: 'SRPE', 14: 'SRA', 15: 'SRC', 20: 'SUCO', 25: 'SUNCO', 29: 'SUOR',
  41: 'SRPN', 42: 'SRPP', 43: 'SRPCU', 44: 'SRPEN', 47: 'SRPCO', 48: 'SRPAG', 49: 'SRPF', 50: 'SRPH', 51: 'SRPM',
  52: 'SRPI', 53: 'SRAR', 54: 'SRAG', 56: 'SRCR', 57: 'SUNOR', 58: 'SRCO', 90: 'SUSP',
};
// Un color exacto por código, con los canales muy separados: los píxeles de borde mezclados no casan con ninguno
const NIVELES = [0, 64, 128, 192, 255];
const COLORES = Object.keys(CODIGOS).map((cod, i) => [cod, [NIVELES[Math.floor(i / 10)], NIVELES[Math.floor(i / 2) % 5], i % 2 ? 224 : 32]]);
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const regla = (filtro, color) => `<Rule>${filtro}<PolygonSymbolizer><Fill><CssParameter name="fill">${color}</CssParameter></Fill></PolygonSymbolizer></Rule>`;
const sld = (capa, reglas) => `<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>${capa}</Name><UserStyle><FeatureTypeStyle>${reglas}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
const SLD_CLA = sld('CLA', COLORES.map(([cod, rgb]) => regla(`<Filter><PropertyIsEqualTo><PropertyName>cod</PropertyName><Literal>${cod}</Literal></PropertyIsEqualTo></Filter>`, hex(rgb))).join(''));
const NEGRO = [0, 0, 0];

// Píxeles de la parcela pintados de cada color en un GetMap de `capa` con `estilo`. Devuelve
// { cuotas: Map(color 'r,g,b' → fracción), punto: Map(color → [lon, lat] de un píxel de ese color) }.
async function pintado(servicio, capa, estilo, lonlat) {
  const [o, s, e, n] = caja(lonlat);
  const lat = (s + n) / 2;
  const ancho = (e - o) * 111320 * Math.cos((lat * Math.PI) / 180), alto = (n - s) * 110574;
  const escala = Math.min(2, 1024 / Math.max(ancho, alto)); // hasta 0,5 m por píxel en fincas pequeñas
  const w = Math.max(16, Math.ceil(ancho * escala)), h = Math.max(16, Math.ceil(alto * escala));
  const cuerpo = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: capa, styles: '', srs: 'EPSG:4326',
    bbox: [o, s, e, n].join(','), width: w, height: h, format: 'image/png', transparent: 'true', SLD_BODY: estilo,
  });
  const imagen = await conReintento(async () => {
    const r = await fetch(`${IDECAN}/${servicio}`, { method: 'POST', body: cuerpo });
    if (!r.ok || !r.headers.get('content-type')?.startsWith('image/')) throw new Error('GRAFCAN no devolvió imagen');
    return createImageBitmap(await r.blob());
  });
  const lienzo = new OffscreenCanvas(w, h);
  const c = lienzo.getContext('2d', { willReadFrequently: true });
  c.drawImage(imagen, 0, 0);
  const px = c.getImageData(0, 0, w, h).data;
  c.clearRect(0, 0, w, h);
  c.beginPath();
  for (const poligono of lonlat) {
    for (const anillo of poligono) {
      anillo.forEach(([x, y], i) => {
        const a = ((x - o) / (e - o)) * w, b = ((n - y) / (n - s)) * h;
        if (i) c.lineTo(a, b); else c.moveTo(a, b);
      });
      c.closePath();
    }
  }
  c.fill('evenodd');
  const mascara = c.getImageData(0, 0, w, h).data;
  let dentro = 0;
  const cuenta = new Map(), punto = new Map();
  for (let i = 0; i < mascara.length; i += 4) {
    if (mascara[i + 3] < 128) continue;
    dentro++;
    // Alguna capa sale semitransparente (LIC_ZEC con alfa 179): basta el color, con alfa apreciable
    if (px[i + 3] < 64) continue;
    const k = `${px[i]},${px[i + 1]},${px[i + 2]}`;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    if (!punto.has(k)) {
      const j = i / 4;
      punto.set(k, [o + ((j % w) + 0.5) / w * (e - o), n - (Math.floor(j / w) + 0.5) / h * (n - s)]);
    }
  }
  // Menos de 2 px: borde suelto
  const cuotas = new Map([...cuenta].filter(([, v]) => v >= 2).map(([k, v]) => [k, v / dentro]));
  return { cuotas, punto };
}

// Atributos de los recintos de `capa` en un punto (GetFeatureInfo en GML de MapServer)
async function enPunto(servicio, capa, [lon, lat]) {
  const d = 0.00005;
  const q = new URLSearchParams({
    service: 'WMS', version: '1.3.0', request: 'GetFeatureInfo', layers: capa, query_layers: capa, crs: 'EPSG:4326',
    bbox: [lat - d, lon - d, lat + d, lon + d].join(','), width: 11, height: 11, i: 5, j: 5,
    info_format: 'application/vnd.ogc.gml', feature_count: 10, styles: '', format: 'image/png',
  });
  const r = await conReintento(() => fetch(`${IDECAN}/${servicio}?${q}`));
  const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
  return [...doc.getElementsByTagName(`${capa}_feature`)].map((f) => Object.fromEntries([...f.children].map((c) => [c.tagName, c.textContent.trim()])));
}

export default {
  id: 'canarias',
  nombre: 'Canarias',
  provincias: ['35', '38'],
  normas: 'normas/canarias.json',
  capaSuelo: {
    wms: `${IDECAN}/Planeamiento`,
    capa: 'CLA',
    limites: [-18.2, 27.6, -13.3, 29.45],
    atribucion: '© GRAFCAN, Gobierno de Canarias',
  },
  fuentes: 'Gobierno de Canarias (planeamiento urbanístico y Red Natura 2000 de IDECanarias, GRAFCAN)',
  consultadas: 'Red Natura 2000 (GRAFCAN)',
  pendientes: 'cauces y zona de policía de los barrancos, espacios naturales protegidos, montes, costas, carreteras ni patrimonio',
  // El dominio público hidráulico del Ministerio en Canarias son 67 tramos (medido el 16/10/2026) para miles
  // de barrancos que llevan los consejos insulares de aguas: daría «sin afecciones» falsos. La zona inundable
  // (34 áreas de riesgo) sí se consulta.
  aguaPropia: ['dphEstimado', 'dphDeslindado'],
  consultadasAgua: 'Zonas inundables (Ministerio para la Transición Ecológica, SNCZI)',

  async suelo(_caja, _utm, _superficie, _datos, lonlat) {
    const { cuotas, punto } = await pintado('Planeamiento', 'CLA', SLD_CLA, lonlat);
    const porColor = new Map(COLORES.map(([cod, rgb]) => [rgb.join(','), CODIGOS[cod]]));
    const halladas = [...cuotas].filter(([k, c]) => porColor.has(k) && c >= 0.005).map(([k, cuota]) => ({ codigo: porColor.get(k), cuota, punto: punto.get(k) }));
    // El nombre que le da el plan y el documento: una consulta de punto por categoría
    const fichas = await Promise.all(halladas.map((p) => enPunto('Planeamiento', 'CLA', p.punto).catch(() => [])));
    const partes = halladas.map((p, i) => {
      const f = fichas[i].find((x) => CODIGOS[x.cod] === p.codigo) ?? fichas[i][0];
      return { codigo: p.codigo, nombre: f?.TxtCLA ?? p.codigo, detalle: f?.TxtCLA || null, cuota: p.cuota, doc: f?.DocCLA, ambito: f?.Ambito };
    }).sort((a, b) => b.cuota - a.cuota);
    return { recintos: [], partes, plan: partes[0] ?? null, notas: {} };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    if (!p?.doc) return null;
    return {
      titulo: `Planeamiento: ${p.ambito ?? datos.municipio}`,
      texto: `${p.doc}. La categoría sale del planeamiento urbanístico de IDECanarias (GRAFCAN), con las equivalencias de la Ley 4/2017. Las normas del plan pueden ser más estrictas que la ley: parcela mínima, alturas o materiales.`,
      enlace: null,
    };
  },

  afecciones(lonlat) {
    const pct = (x) => `${Math.round(x * 100)} %`;
    const relleno = (capa) => sld(capa, regla('', hex(NEGRO)));
    const cuota = async (servicio, capa) => (await pintado(servicio, capa, relleno(capa), lonlat)).cuotas.get(NEGRO.join(',')) ?? 0;
    return {
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const [zec, zepa] = await Promise.all([cuota('LIC', 'LIC_ZEC'), cuota('ZEPA', 'ZEPA_terrestre_2022')]);
          const partes = [zec >= 0.005 && `LIC o ZEC: ${pct(zec)}`, zepa >= 0.005 && `ZEPA: ${pct(zepa)}`].filter(Boolean);
          return partes.length ? [{ tipo: 'natura', detalle: partes.join(', ') }] : [];
        },
      },
    };
  },
};
