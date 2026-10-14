# STATUS — Comprobador de parcelas

## Hecho (13/10/2026)

- Viabilidad medida: Catastro, la Junta y CartoCiudad con CORS abierto; la capa de categorías cubre la comunidad por geometría; consulta por polígono validada (1.768 m² iguales a los de Catastro).
- `reglamento.json`: 13 categorías + régimen sin planeamiento, con 27 citas verificadas contra el BOE. El verificador falla con una cita alterada y con una cita del artículo equivocado.
- v1 de la página (`web/`): búsqueda, clic en mapa, ficha con veredicto, cita, parcela partida, rehabilitación, plan municipal y aviso.
- Cadena probada en Node con los cuatro ejemplos y dos controles negativos (Madrid sale fuera de CyL; un punto en la calle sale sin parcela).

| Ejemplo | Categoría | Veredicto |
|---|---|---|
| Quintanilla (Villaquilambre) | SR-PA 100 % | No (art. 62) |
| Puebla de Sanabria | SR-C 100 % | Solo ligada a una explotación (art. 59) |
| Tremedal de Tormes | sin categoría, DSU | Solo ligada a una explotación (art. 73) |
| León, c/ Ancha 5 | SU-C 100 % | Sí, si es solar (art. 40) |

- Smoke test en navegador con la CSP real superado (13/10): ejemplos, búsqueda, clic, capas y consola limpia.
- **DSU verificado**: fuera de la delimitación rige el rústico de municipios sin planeamiento (Ley 5/1999, DT 4ª.1.b; Ley 4/2008, DT 5ª). El art. 73 es correcto para Tremedal; la ficha lo explica.
- **Las categorías de la Junta se solapan** (p. ej. `24226A00409001`: 85 % SR-PN y 97 % SR-PI a la vez). Reparto por orden de protección (`proteccion` en `reglamento.json`, art. 39): cada trozo va a la categoría más protectora. Probado con 4 parcelas reales; todas suman 100 %. Caso partido de ejemplo: `24226A00400033` (53,5 % SR-C, 46,5 % SR-PA).
- **Afecciones** (`web/afecciones.js`, `web/afecciones.json`): flujo preferente, cauce y servidumbre, zona inundable (T500), zona de policía, montes de utilidad pública y vías pecuarias, cada una con su cita del BOE (34/34 citas verificadas). Probado en Node con canvas emulado: vega del Torío (pol. 14 parc. 221: inundable 42 %, policía 100 %; pol. 13 parc. 58: las cuatro del agua), monte «Urdiales y La Hoja», Vereda León-Matallana y control negativo (prado 376: ninguna). Porcentaje por píxeles contrastado con cálculo exacto (42 % frente a 41,3 %). 1-2 s por parcela.
- **Batería en Chrome sin interfaz (13/10)**: 25 parcelas al azar repartidas por CyL y 16 búsquedas por la caja. Arreglado lo que salió: el enlace `#referencia` fallaba un 12 % por errores 500 de CartoCiudad (ahora va directo al Catastro); montes vecinos que solo rozaban la parcela (ahora cuenta desde el 0,5 %, con porcentaje); caminos y arroyos (VT, HG) tratados como fincas; Enter sin sugerencias no hacía nada (ahora busca y, si no hay resultados, avisa); referencias en minúsculas, con espacios o de 20 caracteres; portal desconocido (se busca la calle sin número); panel de capas, texto del buscador, hectáreas y márgenes en móvil. El veredicto se pinta antes que las afecciones: 0,4-1,9 s hasta el veredicto, 0,4-3,4 s la ficha completa.
- Portales: de las parcelas a menos de 15 m se elige la que tiene ese número según Catastro (`<pnp>`); si no existe, la más cercana marcada como aproximada (caso real: Beas de Segura, A-5 nº 5, que no está en Catastro).

## Pendiente

- [ ] SR-AI sale como «Depende del plan municipal»; en realidad solo admite residencial para regularizar el asentamiento (art. 61 bis). Valorar un nivel propio si aparece en casos reales.

- [x] Afecciones probadas en Chrome sin interfaz (puppeteer) contra `servir.py`: mismos resultados que en Node. Hizo falta un proxy porque el Ministerio duplica la cabecera CORS.
- [ ] **Red Natura 2000**: buscar una fuente con los límites de los espacios (WFS). La de la Junta son hábitats; la del Ministerio, solo WMS de visualización.
- [ ] Afecciones aún no miradas: carreteras (zona de afección y línea límite de edificación), patrimonio (BIC y su entorno).
- [x] Integrado en el portfolio (14/10, sin desplegar): `public/parcelas/` es copia de `web/` (al cambiar `web/`, volver a copiar), CSP en `_headers`, proxy `/api/miteco/` en el Worker y ficha en `public/projects/parcelas/` (05 · Webs, tras el juguete). Smoke test con `wrangler dev` superado.
- [ ] Reel de la ficha.

## Ideas para después (no ahora: primero afinar el buscador)

- **Nota simple del Registro de la Propiedad como servicio adicional** (idea de Javier, 13/10). Unos 9 € por finca en el Colegio de Registradores. La da el Registro, no el Catastro, y trae titular, cargas y descripción de la finca, nunca teléfonos. Se pide con interés legítimo, y la doctrina registral va contra usarla para montar bases de datos de titulares. Encaje posible: un botón que lleve a pedirla o que la gestione para esa finca concreta. No sirve para sacar contactos de dueños o herederos.
- **Normas municipales en PDF** (parcela mínima, alturas, cubierta, materiales) ayuntamiento por ayuntamiento, con la skill de lectura de documentos y citas verificadas.

