// La Rioja: planeamiento urbanístico del sistema de información urbanística (SIU) y Directriz de Protección
// del Suelo No Urbanizable, más montes de utilidad pública, vías pecuarias y Red Natura 2000. MapServer
// del Gobierno de La Rioja: WFS 1.1 solo en GML 3, nativo en 25830, CORS abierto.
//
// Medido el 16/10/2026: 2.091 recintos en 124 de los 174 municipios (falta Logroño). La clase y la categoría
// vienen escritas: los planes anteriores a la ley dicen «Suelo No Urbanizable» sin separar especial y
// genérico. La Directriz (Decreto 18/2019) cubre toda la comunidad: sus 136 áreas prohíben la vivienda
// autónoma y, en vivienda, obligan también a los planes municipales (art. 8); fuera de ellas rige su
// régimen de no urbanizable genérico. Donde no hay plan publicado y el Catastro dice rústica, se aplica ese.

import { area, caja, cuotas, wfsGml } from '../geo.js';

const WFS = 'https://ogc.larioja.org/wfs/request.php';
const PLAN = 'urbanismo_planeamiento_urbanistico';
const DIRECTRIZ = 'directriz_de_proteccion_de_suelo_no_urbanizable_de_la_rioja';

// Art. 52.2.c: 5.000 m² en regadío, 20.000 m² en secano
const REGADIO = 5000;
const SECANO = 20000;

const norma = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
// «VILLAR DE ARNEDO (EL)» en el Catastro, «El Villar de Arnedo» en el SIU
const mismoMunicipio = (a, b) => {
  const limpio = (t) => norma(t).replace(/[()]/g, ' ').split(' ').filter((w) => w && !['EL', 'LA', 'LOS', 'LAS'].includes(w)).sort().join(' ');
  return limpio(a) === limpio(b);
};
const porSuperficie = (c, s) => `${c}${s < REGADIO ? '-PEQ' : s < SECANO ? '-MEDIA' : ''}`;

// Clase y categoría del SIU → código de normas/rioja.json. Los recintos de clase «Afecciones» (zonas de
// carreteras, cauces) se superponen a la clasificación y no la deciden.
function codigo(p, superficie) {
  const clase = norma(p.NOMBRE_CLASE_SUELO), cat = norma(p.NOMBRE_CATEGORIA_SUELO);
  if (clase === 'AFECCIONES') return null;
  if (/SISTEMAS? GENERAL/.test(cat)) return 'SG';
  if (clase.startsWith('SUELO URBANO')) return /NO CONSOLIDADO/.test(cat) ? 'SUNC' : /CONSOLIDADO/.test(cat) ? 'SUC' : 'SU';
  if (clase.startsWith('SUELO URBANIZABLE')) return /NO DELIMITADO/.test(cat) ? porSuperficie('SUZND', superficie) : 'SUZD';
  if (clase === 'SUELO NO URBANIZABLE ESPECIAL') return 'SNUE';
  if (clase === 'SUELO NO URBANIZABLE GENERICO' || cat === 'GENERICO') return porSuperficie('SNUG', superficie);
  if (clase === 'SUELO NO URBANIZABLE') return superficie < REGADIO ? 'SNU-PEQ' : 'SNU';
  return null;
}

export default {
  id: 'rioja',
  nombre: 'La Rioja',
  provincias: ['26'],
  normas: 'normas/rioja.json',
  capaSuelo: {
    wms: 'https://ogc.larioja.org/wms/request.php',
    capa: PLAN,
    limites: [-3.15, 41.9, -1.65, 42.65],
    atribucion: '© Gobierno de La Rioja',
  },
  fuentes: 'Gobierno de La Rioja (planeamiento urbanístico, Directriz de Protección del Suelo No Urbanizable, montes, vías pecuarias y Red Natura 2000)',
  consultadas: 'montes de utilidad pública, vías pecuarias y Red Natura 2000 (Gobierno de La Rioja)',
  pendientes: 'espacios naturales protegidos, carreteras ni patrimonio',

  async suelo(_caja, utm, superficieCatastro, datos) {
    const marco = caja(utm);
    const [todos, areas] = await Promise.all([wfsGml(WFS, PLAN, marco), wfsGml(WFS, DIRECTRIZ, marco)]);
    // Solo el plan del municipio de la finca: el no urbanizable de Lardero se pasa del término y cubre fincas
    // de Logroño (los 124 nombres del SIU casan con los del Catastro, medido el 16/10/2026)
    const planes = datos?.municipio ? todos.filter((f) => mismoMunicipio(f.properties.NOMBRE_MUNICIPIO, datos.municipio)) : todos;
    const superficie = superficieCatastro ?? area(utm);
    const notas = {};
    const recintos = planes.flatMap((f) => {
      const c = codigo(f.properties, superficie);
      return c ? [{ geometry: f.geometry, codigo: c, nombre: f.properties.NOMBRE_CATEGORIA_SUELO, detalle: f.properties.NOMBRE || null }] : [];
    });
    const plan = planes[0]?.properties ?? null;
    // Rústica en el Catastro: lo que no clasifica ningún plan publicado (Logroño entero, por ejemplo) es no
    // urbanizable genérico de la Directriz, que es supletorio. Va la parcela entera con la prioridad más baja
    // (último en `proteccion`): el reparto solo le da lo que no cubre otro recinto.
    // Con varios bienes (la finca y una construcción) el Catastro no da la clase: la dice la referencia
    const rustica = datos?.clase ? datos.clase === 'RU' : /^\d{5}[A-Z]\d{8}$/.test(datos?.rc ?? '');
    if (rustica) {
      const c = porSuperficie('SNUG', superficie);
      const cubierto = recintos.length ? cuotas(recintos.map((r) => ({ geometry: r.geometry, properties: {} })), utm).reduce((a, x) => a + x.cuota, 0) : 0;
      recintos.push({ geometry: { type: 'MultiPolygon', coordinates: utm }, codigo: c, nombre: 'Suelo no urbanizable genérico', detalle: null });
      if (cubierto < 0.95) notas[c] = `${recintos.length > 1 ? 'Parte de la parcela no la clasifica' : 'La parcela no la clasifica'} ningún plan publicado en el sistema de información urbanística: ahí se aplica el régimen de no urbanizable genérico de la Directriz, que suple al plan municipal. Confirma en el ayuntamiento que es no urbanizable.`;
    }
    // La Directriz solo ordena el no urbanizable: en una urbana sin plan publicado no se aplica
    if (recintos.length || rustica) {
      for (const f of areas) recintos.push({ geometry: f.geometry, codigo: 'DIR', nombre: 'Espacio protegido por la Directriz', detalle: null });
      // El área no es del plan municipal: va en la nota, no como nombre del plan
      const nombres = [...new Set(areas.map((f) => f.properties.T297_NOMBRE?.trim()).filter(Boolean))];
      if (nombres.length) notas.DIR = `${nombres.length > 1 ? 'Áreas' : 'Área'} de la Directriz: ${nombres.map((n) => `«${n}»`).join(', ')}.`;
    }
    const medida = `La parcela mide ${superficie >= 10000 ? `${(superficie / 10000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ha` : `${Math.round(superficie).toLocaleString('es-ES')} m²`} según el Catastro.`;
    for (const c of new Set(recintos.map((r) => r.codigo))) if (/^(SNUG|SUZND|SNU)(-|$)/.test(c)) notas[c] = `${medida} ${notas[c] ?? ''}`.trim();
    return { recintos, plan, notas };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const p = suelo.plan;
    return {
      titulo: `Planeamiento de ${p?.NOMBRE_MUNICIPIO ?? datos.municipio}`,
      texto: p
        ? 'La clasificación sale del sistema de información urbanística del Gobierno de La Rioja. En suelo no urbanizable manda además la Directriz de Protección del Suelo No Urbanizable (2019), que en vivienda obliga al plan municipal. Las normas del plan pueden ser más estrictas que la ley: parcela mínima, alturas o materiales.'
        : 'El plan de este municipio no está publicado en el sistema de información urbanística del Gobierno de La Rioja. En suelo no urbanizable rige en todo caso la Directriz de Protección del Suelo No Urbanizable (2019).',
      enlace: p?.URL_VISOR_SIU?.startsWith('https://') ? { href: p.URL_VISOR_SIU, texto: 'Plan del municipio en el visor del SIU' } : null,
    };
  },

  afecciones(_lonlat, utm) {
    const marco = caja(utm);
    const pct = (x) => `${Math.round(x.cuota * 100)} %`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const ms = cuotas(await wfsGml(WFS, 'montes_de_utilidad_publica_mups', marco), utm);
          return ms.length ? [{ tipo: 'mup', detalle: ms.map((m) => `nº ${m.T094_094_MO_COD} «${m.T094_NOMBRE}»: ${pct(m)}`).join(', ') }] : [];
        },
      },
      // Polígonos con la anchura legal ya dibujada: basta la cuota
      vvpp: {
        nombre: 'vías pecuarias',
        consulta: async () => {
          const vs = cuotas(await wfsGml(WFS, 'vias_pecuarias_poligonos', marco), utm);
          const nombres = [...new Set(vs.map((v) => v.NOMBRE))];
          return nombres.length ? [{ tipo: 'vvpp', detalle: nombres.join(', ') }] : [];
        },
      },
      natura: {
        nombre: 'Red Natura 2000',
        consulta: async () => {
          const es = cuotas(await wfsGml(WFS, 'espacios_protegidos_red_natura_2000', marco), utm);
          const nombres = [...new Map(es.map((e) => [e.T169_000_SITE_NAME, `${e.T169_000_FIG_PROT ? `${e.T169_000_FIG_PROT.replace(/^.*Natura 2000:\s*/i, '')} ` : ''}«${e.T169_000_SITE_NAME}»: ${pct(e)}`])).values()];
          return nombres.length ? [{ tipo: 'natura', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
