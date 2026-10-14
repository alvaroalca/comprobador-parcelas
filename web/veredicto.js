// Del polígono de la parcela y los recintos de categoría a un veredicto con su artículo.
// Sin LLM: todo sale de la tabla de normas de la comunidad (normas/*.json), cuyas citas comprueba
// tools/verificar_citas.py.

import { aCaja, area, caja, comoMulti, poligonos, recorteSeguro } from './geo.js';

export { caja } from './geo.js';

// Reparto de la parcela entre categorías: { partes: [{codigo, nombre, detalle, cuota}], solape }. Todo en EPSG:25830.
// Los recintos llegan normalizados por el adaptador de la comunidad: { geometry, codigo, nombre, detalle? }.
// Pueden solaparse (en Castilla y León, protección natural sobre protección de infraestructuras): en el
// solape prevalece la categoría más protectora, así que se reparte de la más protectora a la menos y a
// cada una solo le toca lo que no tenía ya otra.
export function reparto(parcela, recintos, proteccion) {
  const total = area(parcela);
  const marco = caja(parcela);
  const p = aCaja(parcela, marco);
  const rango = (codigo) => { const i = proteccion.indexOf(codigo); return i < 0 ? proteccion.length : i; };
  const ordenados = [...recintos].sort((a, b) => rango(a.codigo) - rango(b.codigo));
  const porCodigo = new Map();
  let cubierto = [];
  let bruto = 0;
  for (const r of ordenados) {
    const g = aCaja(comoMulti(r.geometry), marco);
    if (!g.length) continue;
    const dentro = recorteSeguro(poligonos.intersection, p, g, marco);
    if (!dentro.length) continue;
    bruto += area(dentro);
    const nuevo = cubierto.length ? recorteSeguro(poligonos.difference, dentro, cubierto, marco) : dentro;
    cubierto = recorteSeguro(poligonos.union, cubierto, dentro, marco);
    const a = area(nuevo);
    if (a <= 0) continue;
    const previo = porCodigo.get(r.codigo) ?? { codigo: r.codigo, nombre: r.nombre, detalles: new Map(), area: 0 };
    previo.area += a;
    if (r.detalle) previo.detalles.set(r.detalle, (previo.detalles.get(r.detalle) ?? 0) + a);
    porCodigo.set(r.codigo, previo);
  }
  const partes = [...porCodigo.values()]
    .map(({ detalles, ...c }) => ({
      ...c,
      cuota: c.area / total,
      // El nombre que le da el plan municipal, si lo hay: el del trozo mayor
      detalle: [...detalles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .filter((c) => c.cuota >= 0.005) // menos del 0,5 %: roce de bordes entre capas
    .sort((a, b) => b.cuota - a.cuota);
  return { partes, solape: bruto - area(cubierto) > 0.005 * total };
}

// Veredicto por categoría y titular: lo más favorable que permite alguna parte de la parcela.
export function veredicto(normas, { partes: cats, solape }, parcela) {
  // Sin planeamiento que la clasifique (Castilla y León: arts. 67 y 73). Donde la tabla no tiene ese
  // régimen, la parcela sin recintos queda «sin dato».
  const sp = normas.sin_planeamiento;
  const sinPlan = sp ? { ...(parcela.clase === 'UR' ? sp.urbano : sp.rustico), sinPlaneamiento: true } : null;

  const partes = cats.map((c) => {
    const regla = normas.categorias[c.codigo] ?? (c.codigo === 'SIN' ? sinPlan : null);
    return regla ? { ...c, ...regla } : { ...c, vivienda: 'sin_dato', explicacion: 'Categoría sin regla en la tabla.' };
  });
  if (!partes.length) {
    partes.push(sinPlan
      ? { codigo: null, nombre: 'Sin clasificar por el planeamiento', cuota: 1, ...sinPlan }
      : { codigo: null, nombre: 'Sin datos de planeamiento', cuota: 1, vivienda: 'sin_dato', explicacion: normas.sin_datos });
  }

  // Manda la parte más favorable, pero solo entre las que tienen entidad: un trozo de menos del 10 % suele
  // ser roce entre el dibujo del plan y el del Catastro (Madrid, 14/10/2026: un 2 % de urbano ponía «Sí» en
  // una parcela 97 % no consolidada). Esos trozos siguen saliendo en el reparto.
  const orden = normas.orden;
  const conEntidad = partes.filter((p) => p.cuota >= 0.1);
  const mejor = [...(conEntidad.length ? conEntidad : partes)].sort((a, b) => orden.indexOf(a.vivienda) - orden.indexOf(b.vivienda))[0];
  return { partes, solape, titular: mejor, nivel: normas.niveles[mejor.vivienda] };
}
