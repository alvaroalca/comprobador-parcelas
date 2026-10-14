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

## Madrid (14/10/2026, en local, sin desplegar)

- Arquitectura por comunidades: `web/comunidades/<id>.js` + `web/normas/<id>.json`. Castilla y León pasada a adaptador sin cambios de resultado (mismos veredictos y porcentajes en los ejemplos).
- Madrid: clasificación del refundido de la Comunidad (2025, con caída a 2023 y al plan original para los 13 municipios que faltan, Madrid capital incluida), tabla de la Ley 9/2001 y afecciones de la IDEM (montes de UP, montes preservados, vías pecuarias, ZEC y ZEPA). 48/48 citas verificadas; el verificador falla con una cita alterada y con una cita en otro artículo.
- Buscador: «polígono N parcela M municipio» para fincas rústicas (Catastro por código INE). Municipio ambiguo («Villanueva») → pide elegir. Lo que se pincha en el mapa queda escrito en el buscador.
- Titular del veredicto con umbral del 10 %: los roces de borde ya no deciden (Becerril, Moralzarzal, Colmenar Viejo y Guadarrama daban titulares falsos).
- Batería en Chrome sin interfaz contra `servir.py`: 22 parcelas al azar y 19 por código. Sin errores de consola ni de CSP. Veredicto en 1-2 s, ficha completa en 1,3-5,7 s.
- Falta: smoke test de Álvaro, copiar a `public/parcelas/` del portfolio y añadir `https://idem.comunidad.madrid` al `connect-src` de `_headers`.
- Abierto: espacios naturales protegidos de Madrid (`LugaresProtegidos:IDEM_MA_ENP`) sin consultar; la superficie mínima del art. 26.1.d (legislación forestal y agraria) no se calcula.

## Cantabria (14/10/2026, en local, sin desplegar)

- Adaptador ArcGIS REST del SIUCAN y tabla de la Ley 5/2022 (67/67 citas en total). Rústico ordinario con la distancia al suelo urbano medida (art. 51.1: 200 m) y aviso del art. 51.2 en los 41 municipios con NNSS tipo A, delimitación o sin plan. Afecciones: montes de UP, ZEC y ZEPA.
- Probado en Chrome: 28 parcelas por categoría y al azar, más 3 buscadas a más de 200 m del suelo urbano. Sin errores de consola; veredicto en 0,8-1,6 s (dos casos de 5-7 s fueron lentitud puntual del servidor, al repetir 0,8 s).
- Arreglado de paso: las referencias de diseminado (`000300500VP70A`) no se reconocían.
- Abierto: en municipios del art. 51.2 el titular sigue en «Solo ligada» y la ficha añade el aviso, porque no se sabe si la protección es sectorial; no está claro si el límite de 200 m sigue valiendo ahí. Costas (servidumbre de protección), espacios naturales protegidos y patrimonio (entornos de BIC, capa 3 de `Patrimonio_y_Cultura`) sin consultar.
- Falta: smoke test de Álvaro. Al integrar: `https://idem.comunidad.madrid` y `https://geoservicios.cantabria.es` en el `connect-src` del portfolio.

## Cataluña (14/10/2026, en local, sin desplegar)

- Adaptador del MUC de la Generalitat y tabla del Texto refundido de la Ley de urbanismo (DL 1/2010): 93/93 citas en total. No urbanizable por calificación (N1 ordinario, N2 protección local, N3 protección reglada, N4 actividad autorizada) con la presunción del art. 47.6 bis; sistemas públicos con «No»; urbanizable no delimitado con régimen de no urbanizable (art. 52.2). Rehabilitación como vivienda solo para masías y casas rurales del catálogo. Afecciones: montes del CUP y Red Natura.
- Probado en Chrome: 25 parcelas por clase, calificación y al azar. Veredicto en 0,5-1,6 s; una parcela alargada (canal, 42 ha en 17 × 19 km) tarda 7 s.
- Arreglado de paso, para todas las comunidades: recorte a la caja de la parcela antes de polygon-clipping (fallaba con recintos enormes); referencias urbanas con letra entre las primeras cifras; atribuciones del mapa plegadas abajo a la izquierda.
- Falta: smoke test de Álvaro. Al integrar: `https://sig.gencat.cat` en el `connect-src` del portfolio (además de Madrid y Cantabria).
- Abierto: costas, carreteras y patrimonio sin consultar. Cantabria sigue pidiendo por caja (ArcGIS): una parcela alargada traería recintos de más.

## Pendiente

- [ ] SR-AI sale como «Depende del plan municipal»; en realidad solo admite residencial para regularizar el asentamiento (art. 61 bis). Valorar un nivel propio si aparece en casos reales.

- [x] Afecciones probadas en Chrome sin interfaz (puppeteer) contra `servir.py`: mismos resultados que en Node. Hizo falta un proxy porque el Ministerio duplica la cabecera CORS.
- [ ] **Red Natura 2000**: buscar una fuente con los límites de los espacios (WFS). La de la Junta son hábitats; la del Ministerio, solo WMS de visualización.
- [ ] Afecciones aún no miradas: carreteras (zona de afección y línea límite de edificación), patrimonio (BIC y su entorno).
- [x] Integrado en el portfolio (14/10, sin desplegar): `public/parcelas/` es copia de `web/` (al cambiar `web/`, volver a copiar), CSP en `_headers`, proxy `/api/miteco/` en el Worker y ficha en `public/projects/parcelas/` (05 · Webs, tras el juguete). Smoke test con `wrangler dev` superado.
- [ ] Reel de la ficha.

## Resto de España (prioridad actual)

Objetivo: cerrar comunidad por comunidad hasta que cada una funcione igual que Castilla y León (fuente geométrica de categorías, tabla de su ley con citas verificadas, afecciones propias, batería de parcelas). Las ideas de después esperan a eso. La página está fuera de la portada del portfolio hasta entonces (accesible por URL).

No hay fuente nacional: el SIU del Ministerio agrega lo que mandan las comunidades y no tiene servicio por parcela. Sondeo del 14/10 (GetCapabilities + un recinto de muestra):

| Comunidad | Servicio y capa | CORS | Detalle |
|---|---|---|---|
| Cataluña | `sig.gencat.cat/ows/PLANEJAMENT/wfs` · `MUC_CLASSIFICACIONS`, `MUC_QUALIFICACIONS` | `*` | 25831. Bloquea el user-agent de curl (el navegador pasa). |
| Madrid | `idem.comunidad.madrid/geoidem/UsoDelSuelo/wfs` · `VPLA_V_CLASIFICACION_REF_25` | `*` | Refundido 2025, clase y categoría detallada. |
| Cantabria | ArcGIS `geoservicios.cantabria.es/inspire/rest/services/Urbanismo/MapServer/6` (SIUCAN) | sí | Clase, categoría y subcategoría normalizadas; 0,1 s. |
| Baleares | ArcGIS `ideib.caib.es/.../GOIB_MUIB/MapServer` · 12 clasificación, 11 categorías del rústico | sí | |
| C. Valenciana | `terramapas.icv.gva.es/0702_Planeamiento` · `Planeamiento.Clasificacion` | `*` | Solo GML (sin GeoJSON). |
| Murcia | `mapas-gis-inter.carm.es/geoserver/SIT_USU_PLA_URB_CARM/wfs` · `plu_clasific_tipos_*` | no | Proxy. |
| Aragón | `idearagon.aragon.es/geoserver/ows` · `SIUa:clasificacion_idearagon` | no | Proxy. 6 s por petición sin filtro. |
| Asturias | `visorrpgur.asturias.es:8090/geoserver` · `n02_CLASIFICACION_SUELO` | sí | Solo http: proxy obligatorio (contenido mixto). |
| País Vasco | `geo.euskadi.eus/WMS_PLANGINTZA` (Udalplan) | `*` | Solo WMS + descarga shp: píxeles o datos propios. |
| Canarias | `idecan2.grafcan.es/ServicioWMS/Planeamiento` | | Solo WMS encontrado. |
| Extremadura | `mapas.ideex.es/CICTEX/planeamientoRefundido` | | Solo WMS de planos escaneados por municipio. |
| Navarra | IDENA solo tiene el inventario de instrumentos | | Clasificación (SIUN) no localizada. |
| Galicia | Xunta: Plan Básico Autonómico (afecciones, núcleos) | | Clasificación municipal no localizada. |
| Andalucía | Solo WMS de algunos municipios (Córdoba, Sevilla) | | Sin capa regional. |
| Castilla-La Mancha | Visor encargado a Tragsatec en 2024 | | No localizado; 291 municipios sin plan general. |
| La Rioja | | | No localizado. |

## Ideas para después (no ahora: primero el resto de España)

- **Nota simple del Registro de la Propiedad como servicio adicional** (idea de Javier, 13/10). Unos 9 € por finca en el Colegio de Registradores. La da el Registro, no el Catastro, y trae titular, cargas y descripción de la finca, nunca teléfonos. Se pide con interés legítimo, y la doctrina registral va contra usarla para montar bases de datos de titulares. Encaje posible: un botón que lleve a pedirla o que la gestione para esa finca concreta. No sirve para sacar contactos de dueños o herederos.
- **Normas municipales en PDF** (parcela mínima, alturas, cubierta, materiales) ayuntamiento por ayuntamiento, con la skill de lectura de documentos y citas verificadas.

