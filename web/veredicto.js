// Del polígono de la parcela y los recintos de categoría a un veredicto con su artículo.
// Sin LLM: todo sale de la tabla reglamento.json, cuyas citas comprueba tools/verificar_citas.py.

/* global polygonClipping */
const poligonos = globalThis.polygonClipping; // vendor/polygon-clipping.umd.min.js

// Área plana de un MultiPolygon en metros (EPSG:25830).
function area(multi) {
  let total = 0;
  for (const poligono of multi) {
    poligono.forEach((anillo, i) => {
      let s = 0;
      for (let k = 0; k < anillo.length - 1; k++) {
        s += anillo[k][0] * anillo[k + 1][1] - anillo[k + 1][0] * anillo[k][1];
      }
      total += (i === 0 ? 1 : -1) * Math.abs(s / 2);
    });
  }
  return total;
}

export function caja(multi) {
  const xs = multi.flat(2).map((p) => p[0]);
  const ys = multi.flat(2).map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Reparto de la parcela entre categorías: { partes: [{codigo, nombre, cuota}], solape }. Todo en EPSG:25830.
// Los recintos de la Junta se solapan (p. ej. protección natural sobre protección de infraestructuras).
// Art. 39: en el solape prevalece la categoría más protectora, así que se reparte de la más protectora
// a la menos y a cada una solo le toca lo que no tenía ya otra.
export function reparto(parcela, recintos, proteccion) {
  const total = area(parcela);
  const rango = (codigo) => { const i = proteccion.indexOf(codigo); return i < 0 ? proteccion.length : i; };
  const ordenados = [...recintos].sort((a, b) => rango(a.properties.c_categ_sue) - rango(b.properties.c_categ_sue));
  const porCodigo = new Map();
  let cubierto = [];
  let bruto = 0;
  for (const f of ordenados) {
    const g = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const dentro = poligonos.intersection(parcela, g);
    if (!dentro.length) continue;
    bruto += area(dentro);
    const nuevo = cubierto.length ? poligonos.difference(dentro, cubierto) : dentro;
    cubierto = poligonos.union(cubierto, dentro);
    const a = area(nuevo);
    if (a <= 0) continue;
    const { c_categ_sue: codigo, n_categ_sue: nombre } = f.properties;
    const previo = porCodigo.get(codigo) ?? { codigo, nombre, area: 0 };
    previo.area += a;
    porCodigo.set(codigo, previo);
  }
  const partes = [...porCodigo.values()]
    .map((c) => ({ ...c, cuota: c.area / total }))
    .filter((c) => c.cuota >= 0.005) // menos del 0,5 %: roce de bordes entre capas
    .sort((a, b) => b.cuota - a.cuota);
  return { partes, solape: bruto - area(cubierto) > 0.005 * total };
}

// Veredicto por categoría y titular: lo más favorable que permite alguna parte de la parcela.
export function veredicto(reglamento, { partes: cats, solape }, parcela) {
  // Sin planeamiento que la clasifique (o recinto «sin clasificar»): arts. 67 y 73
  const sp = reglamento.sin_planeamiento;
  const sinPlan = { ...(parcela.clase === 'UR' ? sp.urbano : sp.rustico), sinPlaneamiento: true };

  const partes = cats.map((c) => {
    const regla = reglamento.categorias[c.codigo] ?? (c.codigo === 'SIN' ? sinPlan : null);
    return regla ? { ...c, ...regla } : { ...c, vivienda: 'sin_dato', explicacion: 'Categoría sin regla en la tabla.' };
  });
  if (!partes.length) partes.push({ codigo: null, nombre: 'Sin clasificar por el planeamiento', cuota: 1, ...sinPlan });

  const orden = reglamento.orden;
  const mejor = [...partes].sort((a, b) => orden.indexOf(a.vivienda) - orden.indexOf(b.vivienda))[0];
  return { partes, solape, titular: mejor, nivel: reglamento.niveles[mejor.vivienda] };
}
