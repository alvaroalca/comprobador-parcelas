// Andalucía: la Junta no publica el planeamiento por recintos (solo WMS de algunos municipios y documentos
// escaneados): las clases salen del SIU del Ministerio (618 de 785 municipios el 19/10/2026), que no separa
// el rústico protegido del común.
//
// La LISTA (Ley 7/2021) deja dos clases: urbano y rústico. Sus transitorias reparten lo de los planes
// antiguos: el urbano sigue siendo urbano; el no consolidado y el urbanizable sectorizado, actuaciones de
// transformación ya delimitadas; el resto, rústico (el urbanizable no sectorizado, hasta que se delimite).

import { clasesSiu, fuenteSiu, SIU_TESELAS } from '../siu.js';

// Vivienda aislada no vinculada: 2,5 ha como mínimo (Reglamento, art. 31.1.b)
const MINIMA = 25000;

export default {
  id: 'andalucia',
  nombre: 'Andalucía',
  provincias: ['04', '11', '14', '18', '21', '23', '29', '41'],
  normas: 'normas/andalucia.json',
  capaSuelo: {
    teselas: SIU_TESELAS,
    limites: [-7.6, 35.9, -1.6, 38.8],
    atribucion: '© Ministerio de Vivienda y Agenda Urbana (SIU)',
  },
  fuentes: fuenteSiu,
  consultadas: null,
  pendientes: 'Red Natura 2000, montes públicos, vías pecuarias, carreteras ni patrimonio',

  async suelo(cajaUtm, _utm, superficie) {
    const grande = (superficie ?? 0) >= MINIMA;
    const recintos = (await clasesSiu(cajaUtm)).map((r) => {
      let codigo = r.codigo;
      // Núcleo rural en no urbanizable: hábitat rural diseminado (art. 23); en urbano, núcleo rural tradicional, que es urbano
      if (codigo === 'SNU' && r.nucleoRural) codigo = 'HRD';
      else if ((codigo === 'SNU' || codigo === 'SUZND') && !grande) codigo += '-PEQ';
      return { geometry: r.geometry, codigo, nombre: 'Sin clasificar' };
    });
    return { recintos };
  },

  seccionPlaneamiento(_plan, _suelo, _t, datos) {
    return {
      titulo: `Planeamiento de ${datos.municipio}`,
      texto: `La clase de suelo sale del ${fuenteSiu}, que recoge el plan general de cada municipio sin distinguir el rústico común del protegido. El plan puede proteger la finca o ser más estricto que la ley (parcela mínima, distancias, alturas).`,
      enlace: { href: 'https://ws132.juntadeandalucia.es/situadifusion/pages/search.jsf', texto: 'Consulta del planeamiento de la Junta de Andalucía' },
    };
  },
};
