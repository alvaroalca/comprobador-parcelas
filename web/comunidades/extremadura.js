// Extremadura: categorías de suelo de la IDE de Extremadura (Junta, MapServer `CICTEX/urbanismo`), con el SIU
// del Ministerio de respaldo donde no tiene recintos. Sin cabecera CORS: pasa por el proxy /api/ideex/
// (tools/servir.py y el Worker).
//
// Medido el 19/10/2026: nueve capas de categorías (urbano consolidado y no consolidado, urbanizable con y
// sin ordenación detallada, no urbanizable común y cuatro protegidos), sin atributos, en EPSG:25829 y
// servidas en 25830. Una petición con todas: 0,3-0,5 s. En 30 puntos al azar dio categoría en los 20 que
// caían en Extremadura, igual que el SIU. Son categorías de la Ley 15/2001: la LOTUS (DT 2ª) las equipara.

import { wfsGml } from '../geo.js';
import { clasesSiu, fuenteSiu } from '../siu.js';

const IDEEX = `${location.origin}/api/ideex/CICTEX/urbanismo`;
const CAPA = (c) => `CICTEX_URBANISMO_CATEGORIAS_SUELO_${c}`;
const CATEGORIAS = {
  URBANO_CONSOLIDADO: 'SU',
  URBANO_NO_CONSOLIDADO: 'SUNC',
  URBANIZABLE_CON_ORDENACION_DETALLADA: 'SUZ',
  URBANIZABLE_SIN_ORDENACION_DETALLADA: 'SUZ',
  NO_URBANIZABLE_COMUN: 'SR',
  NO_URBANIZABLE_PROTECCION_AMBIENTAL: 'SRP-A',
  NO_URBANIZABLE_PROTECCION_ESTRUCTURAL: 'SRP-E',
  NO_URBANIZABLE_INFRAESTRUCTURAS_EQUIPAMIENTO: 'SRP-I',
  NO_URBANIZABLE_PROTEGIDO: 'SRP',
};
const SIU = { SU: 'SU', SUNC: 'SUNC', SUZD: 'SUZ', SUZND: 'SUZ', SNU: 'SNU', SG: 'SG' };
// Superficie mínima para la calificación rústica de una vivienda autónoma (art. 70.3)
const MINIMA = 15000;

export default {
  id: 'extremadura',
  nombre: 'Extremadura',
  provincias: ['06', '10'],
  normas: 'normas/extremadura.json',
  capaSuelo: {
    // MapLibre pide las teselas con fetch: sin CORS en origen, también por el proxy
    teselas: `${IDEEX}?service=WMS&version=1.1.1&request=GetMap&layers=CICTEX_URBANISMO_CATEGORIAS&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`,
    limites: [-7.6, 37.9, -4.6, 40.5],
    atribucion: '© Junta de Extremadura (IDEEX)',
  },
  fuentes: 'Junta de Extremadura (categorías de suelo de la IDEEX)',
  consultadas: null,
  pendientes: 'Red Natura 2000, montes de utilidad pública, vías pecuarias, carreteras ni patrimonio',

  async suelo(cajaUtm, _utm, superficie) {
    const grande = (superficie ?? 0) >= MINIMA;
    const fs = await wfsGml(IDEEX, Object.keys(CATEGORIAS).map(CAPA), cajaUtm);
    if (fs.length) {
      return {
        recintos: fs.map((f) => {
          const codigo = CATEGORIAS[f.capa.replace(CAPA(''), '')];
          return { geometry: f.geometry, codigo: codigo === 'SR' && !grande ? 'SR-PEQ' : codigo, nombre: 'Sin clasificar' };
        }),
        fuente: 'IDEEX',
      };
    }
    // Sin recintos de la Junta (pocos municipios): las clases del SIU, que no separan el rústico protegido
    const siu = await clasesSiu(cajaUtm);
    return {
      recintos: siu.map((r) => {
        const codigo = SIU[r.codigo] ?? 'SIN-CODIGO';
        return { geometry: r.geometry, codigo: codigo === 'SNU' && !grande ? 'SNU-PEQ' : codigo, nombre: 'Sin clasificar' };
      }),
      fuente: 'SIU',
    };
  },

  seccionPlaneamiento(_plan, suelo, _t, datos) {
    const origen = suelo.fuente === 'SIU'
      ? `La clasificación sale del ${fuenteSiu}, que no distingue el rústico común del protegido.`
      : 'La clasificación sale de la IDE de Extremadura (Junta), que recoge el planeamiento de cada municipio con las categorías de la ley anterior.';
    return {
      titulo: `Planeamiento de ${datos.municipio}`,
      texto: `${origen} En los municipios de 10.000 habitantes o más rige el régimen del suelo de su propio plan, en lo que no contradiga a la ley. Las normas del municipio pueden ser más estrictas (parcela mínima, alturas, materiales).`,
      enlace: null,
    };
  },
};
