// Castilla y León: categorías de suelo e instrumentos de planeamiento de la Junta, montes de utilidad
// pública y vías pecuarias. La Junta avisa de que su capa no tiene validez jurídica.

import { cuotas, distancia, wfs, wkt } from '../geo.js';

const URBANISMO = 'https://idecyl.jcyl.es/geoserver/urbanismo/wfs';
const MONTES = 'https://idecyl.jcyl.es/geoserver/montes/wfs';

async function pedirWfs(capa, filtro, propiedades, srs) {
  const q = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: `urbanismo:${capa}`, outputFormat: 'application/json',
    srsName: srs, propertyName: propiedades, CQL_FILTER: filtro,
  });
  const r = await fetch(`${URBANISMO}?${q}`);
  if (!r.ok) throw new Error(`idecyl.jcyl.es respondió ${r.status}`);
  return r.json();
}

const fecha = (iso) => iso && new Date(iso.replace('Z', '')).toLocaleDateString('es-ES');

export default {
  id: 'cyl',
  nombre: 'Castilla y León',
  provincias: ['05', '09', '24', '34', '37', '40', '42', '47', '49'],
  normas: 'normas/cyl.json',
  capaSuelo: {
    wms: 'https://idecyl.jcyl.es/geoserver/urbanismo/wms',
    capa: 'plau_cyl_categorias_desagrupa',
    limites: [-7.1, 40.0, -1.7, 43.3],
    atribucion: '© Junta de Castilla y León',
  },
  fuentes: 'Junta de Castilla y León (información sin validez jurídica)',
  consultadas: 'montes de utilidad pública y vías pecuarias (Junta de Castilla y León)',
  pendientes: 'Red Natura 2000, carreteras ni patrimonio',

  // Recintos de categoría que tocan la caja de la parcela (EPSG:25830). El recorte exacto se hace en el navegador.
  async suelo([oeste, sur, este, norte]) {
    const r = await pedirWfs('plau_cyl_categorias_desagrupa',
      `BBOX(geom,${oeste},${sur},${este},${norte},'EPSG:25830')`, 'geom,c_categ_sue,n_categ_sue', 'EPSG:25830');
    return {
      recintos: r.features.map((f) => ({ geometry: f.geometry, codigo: f.properties.c_categ_sue, nombre: f.properties.n_categ_sue })),
    };
  },

  async planeamiento(lon, lat) {
    const r = await pedirWfs('plau_cyl_instrumentos_ambito', `INTERSECTS(geometry,SRID=4326;POINT(${lon} ${lat}))`,
      'c_instrum,n_instrum,n_mun,f_aprob,url_doc_info', 'EPSG:4326');
    return r.features[0]?.properties ?? null;
  },

  // Texto de la sección «Planeamiento de …» de la ficha.
  seccionPlaneamiento(instrumento, _suelo, t, datos) {
    if (!instrumento) return null;
    const nombre = instrumento.n_instrum ?? instrumento.c_instrum;
    const texto = instrumento.c_instrum === 'SPG'
      ? `${nombre}: no hay plan municipal que clasifique el suelo, así que se aplica directamente el Reglamento.`
      : instrumento.c_instrum === 'DSU' && t.sinPlaneamiento
        ? `${nombre}${instrumento.f_aprob ? ` (${fecha(instrumento.f_aprob)})` : ''}: solo delimita el casco urbano. Fuera de él rige el régimen del rústico de los municipios sin planeamiento (Ley 5/1999 de Urbanismo de Castilla y León, disposición transitoria cuarta).`
        : `${nombre}${instrumento.f_aprob ? `, aprobado el ${fecha(instrumento.f_aprob)}` : ''}. Sus normas pueden ser más estrictas que el Reglamento (parcela mínima, alturas, cubierta, materiales).`;
    return {
      titulo: `Planeamiento de ${instrumento.n_mun ?? datos.municipio}`,
      texto,
      enlace: instrumento.url_doc_info && { href: instrumento.url_doc_info, texto: 'Documentos del plan en la Junta' },
    };
  },

  afecciones(_lonlat, utm) {
    const enMetros = `SRID=25830;${wkt(utm, 2)}`;
    return {
      mup: {
        nombre: 'montes de utilidad pública',
        consulta: async () => {
          const fs = await wfs(MONTES, 'montes:montes_cyl_mup_vw', `INTERSECTS(geometry,${enMetros})`, 'geometry,n_monte,v_mup', 'EPSG:25830');
          const montes = cuotas(fs, utm);
          return montes.length
            ? [{ tipo: 'mup', detalle: montes.map((m) => `nº ${m.v_mup} «${m.n_monte}»: ${Math.round(m.cuota * 100)} %`).join(', ') }]
            : [];
        },
      },
      // La anchura legal llega con cada vía (hasta 75 m en una cañada): se traen las que pasan a menos
      // de 40 m y se mide aquí la distancia contra la mitad de su anchura.
      vvpp: {
        nombre: 'vías pecuarias',
        consulta: async () => {
          const fs = await wfs(MONTES, 'montes:znie_cyl_vvpp_ejes', `DWITHIN(geometry,${enMetros},40,meters)`,
            'geometry,nombre,categoria,ancho_m', 'EPSG:25830');
          const vias = fs.filter((f) => {
            const lineas = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
            return distancia(utm, lineas) <= (Number(f.properties.ancho_m) || 0) / 2;
          });
          const nombres = [...new Set(vias.map((f) => `${f.properties.nombre}${f.properties.ancho_m ? ` (${Math.round(f.properties.ancho_m)} m de ancho)` : ''}`))];
          return nombres.length ? [{ tipo: 'vvpp', detalle: nombres.join(', ') }] : [];
        },
      },
    };
  },
};
