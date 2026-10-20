// Galicia: la Xunta no publica el planeamiento vigente por recintos (su capa homogeneizada, IURB_V9, es de
// 2011 y solo de los concellos del litoral): las clases salen del SIU del Ministerio (276 de 313 concellos
// el 20/10/2026), que marca los núcleos rurales pero no separa el rústico de protección ordinaria del de
// especial protección. En rústico da igual para la vivienda: solo cabe la ligada a una explotación agrícola
// o ganadera, en cualquier categoría (arts. 35 y 36). La transitoria primera lleva al régimen del rústico el
// no urbanizable de los planes antiguos.

import { clasesSiu, fuenteSiu, SIU_TESELAS } from '../siu.js';

// Cualquier edificación en suelo rústico: 2.000 m² como mínimo (art. 39)
const MINIMA = 2000;

export default {
  id: 'galicia',
  nombre: 'Galicia',
  provincias: ['15', '27', '32', '36'],
  normas: 'normas/galicia.json',
  capaSuelo: {
    teselas: SIU_TESELAS,
    limites: [-9.31, 41.8, -6.73, 43.8],
    atribucion: '© Ministerio de Vivienda y Agenda Urbana (SIU)',
  },
  fuentes: fuenteSiu,
  consultadas: null,
  pendientes: 'Red Natura 2000, montes vecinales y públicos, costas, carreteras ni patrimonio',

  async suelo(cajaUtm, _utm, superficie) {
    const grande = (superficie ?? 0) >= MINIMA;
    const recintos = (await clasesSiu(cajaUtm)).map((r) => {
      let codigo = r.codigo;
      // El SIU pone el núcleo rural gallego como urbano o no urbanizable con la marca: es una clase propia
      if ((codigo === 'SU' || codigo === 'SNU') && r.nucleoRural) codigo = 'NR';
      else if (codigo === 'SNU') codigo = grande ? 'SR' : 'SR-PEQ';
      return { geometry: r.geometry, codigo, nombre: 'Sin clasificar' };
    });
    return { recintos };
  },

  seccionPlaneamiento(_plan, _suelo, _t, datos) {
    return {
      titulo: `Planeamiento de ${datos.municipio}`,
      texto: `La clase de suelo sale del ${fuenteSiu}, que recoge el plan de cada concello y marca los núcleos rurales, pero no distingue el rústico de protección ordinaria del de especial protección. El plan puede ser más estricto que la ley (parcela mínima, distancias, alturas).`,
      enlace: null,
    };
  },
};
