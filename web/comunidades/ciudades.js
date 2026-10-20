// Ceuta y Melilla: sin ley urbanística propia (sus estatutos no les dan potestad legislativa), rige la del
// Estado. Para el régimen de cada clase de suelo se aplica de forma supletoria el texto refundido de 1976,
// que sigue en vigor y consolidado en el BOE, y el plan general de cada ciudad. Las clases salen del SIU del
// Ministerio, que tiene las dos.

import { clasesSiu, fuenteSiu, SIU_TESELAS } from '../siu.js';

const ciudad = (id, nombre, provincia, limites) => ({
  id,
  nombre,
  provincias: [provincia],
  normas: 'normas/ceuta-melilla.json',
  capaSuelo: { teselas: SIU_TESELAS, limites, atribucion: '© Ministerio de Vivienda y Agenda Urbana (SIU)' },
  fuentes: fuenteSiu,
  consultadas: null,
  pendientes: 'espacios protegidos, montes, costas, carreteras ni patrimonio',

  async suelo(cajaUtm) {
    const recintos = (await clasesSiu(cajaUtm)).map((r) => ({ geometry: r.geometry, codigo: r.codigo, nombre: 'Sin clasificar' }));
    return { recintos };
  },

  seccionPlaneamiento() {
    return {
      titulo: `Planeamiento de ${nombre}`,
      texto: `${nombre} no tiene ley urbanística propia: rige la del Estado, y para el régimen de cada clase de suelo, el texto refundido de 1976 y el Plan General de Ordenación Urbana de la ciudad. La clase sale del ${fuenteSiu}, que no distingue el no urbanizable protegido del común.`,
      enlace: null,
    };
  },
});

export const ceuta = ciudad('ceuta', 'Ceuta', '51', [-5.42, 35.85, -5.26, 35.94]);
export const melilla = ciudad('melilla', 'Melilla', '52', [-2.99, 35.26, -2.91, 35.33]);
