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
- **16/10/2026**: la Junta renombró la geometría de la capa de categorías (`geom` → `geometry`) y la consulta daba 400; arreglado en `cyl.js`, mismos resultados en los ejemplos.
- Portales: de las parcelas a menos de 15 m se elige la que tiene ese número según Catastro (`<pnp>`); si no existe, la más cercana marcada como aproximada (caso real: Beas de Segura, A-5 nº 5, que no está en Catastro).

## Madrid (14/10/2026, en local, sin desplegar)

- Arquitectura por comunidades: `web/comunidades/<id>.js` + `web/normas/<id>.json`. Castilla y León pasada a adaptador sin cambios de resultado (mismos veredictos y porcentajes en los ejemplos).
- Madrid: clasificación del refundido de la Comunidad (2025, con caída a 2023 y al plan original para los 13 municipios que faltan, Madrid capital incluida), tabla de la Ley 9/2001 y afecciones de la IDEM (montes de UP, montes preservados, vías pecuarias, ZEC y ZEPA). 48/48 citas verificadas; el verificador falla con una cita alterada y con una cita en otro artículo.
- Buscador: «polígono N parcela M municipio» para fincas rústicas (Catastro por código INE). Municipio ambiguo («Villanueva») → pide elegir. Lo que se pincha en el mapa queda escrito en el buscador.
- Titular del veredicto con umbral del 10 %: los roces de borde ya no deciden (Becerril, Moralzarzal, Colmenar Viejo y Guadarrama daban titulares falsos).
- Batería en Chrome sin interfaz contra `servir.py`: 22 parcelas al azar y 19 por código. Sin errores de consola ni de CSP. Veredicto en 1-2 s, ficha completa en 1,3-5,7 s.
- Smoke test de Álvaro superado (14/10). Al integrar: copiar a `public/parcelas/` del portfolio y añadir `https://idem.comunidad.madrid` al `connect-src` de `_headers`.
- Abierto: espacios naturales protegidos de Madrid (`LugaresProtegidos:IDEM_MA_ENP`) sin consultar; la superficie mínima del art. 26.1.d (legislación forestal y agraria) no se calcula.

## Cantabria (14/10/2026, en local, sin desplegar)

- Adaptador ArcGIS REST del SIUCAN y tabla de la Ley 5/2022 (67/67 citas en total). Rústico ordinario con la distancia al suelo urbano medida (art. 51.1: 200 m) y aviso del art. 51.2 en los 41 municipios con NNSS tipo A, delimitación o sin plan. Afecciones: montes de UP, ZEC y ZEPA.
- Probado en Chrome: 28 parcelas por categoría y al azar, más 3 buscadas a más de 200 m del suelo urbano. Sin errores de consola; veredicto en 0,8-1,6 s (dos casos de 5-7 s fueron lentitud puntual del servidor, al repetir 0,8 s).
- Arreglado de paso: las referencias de diseminado (`000300500VP70A`) no se reconocían.
- Abierto: en municipios del art. 51.2 el titular sigue en «Solo ligada» y la ficha añade el aviso, porque no se sabe si la protección es sectorial; no está claro si el límite de 200 m sigue valiendo ahí. Costas (servidumbre de protección), espacios naturales protegidos y patrimonio (entornos de BIC, capa 3 de `Patrimonio_y_Cultura`) sin consultar.
- Smoke test de Álvaro superado (14/10). Al integrar: `https://idem.comunidad.madrid` y `https://geoservicios.cantabria.es` en el `connect-src` del portfolio.

## Cataluña (14/10/2026, en local, sin desplegar)

- Adaptador del MUC de la Generalitat y tabla del Texto refundido de la Ley de urbanismo (DL 1/2010): 93/93 citas en total. No urbanizable por calificación (N1 ordinario, N2 protección local, N3 protección reglada, N4 actividad autorizada) con la presunción del art. 47.6 bis; sistemas públicos con «No»; urbanizable no delimitado con régimen de no urbanizable (art. 52.2). Rehabilitación como vivienda solo para masías y casas rurales del catálogo. Afecciones: montes del CUP y Red Natura.
- Probado en Chrome: 25 parcelas por clase, calificación y al azar. Veredicto en 0,5-1,6 s; una parcela alargada (canal, 42 ha en 17 × 19 km) tarda 7 s.
- Arreglado de paso, para todas las comunidades: recorte a la caja de la parcela antes de polygon-clipping (fallaba con recintos enormes); referencias urbanas con letra entre las primeras cifras; atribuciones del mapa plegadas abajo a la izquierda.
- Smoke test de Álvaro superado (14/10). Al integrar: `https://sig.gencat.cat` en el `connect-src` del portfolio (además de Madrid y Cantabria).
- Abierto: costas, carreteras y patrimonio sin consultar. Cantabria sigue pidiendo por caja (ArcGIS): una parcela alargada traería recintos de más.

## Baleares (14/10/2026, en local, sin desplegar)

- Adaptador del MUIB del Govern (ArcGIS REST de la IDEIB) y tabla con tres normas: la matriz de ordenación del suelo rústico (anexo I de la Ley 6/1999 de Directrices, en la redacción de la Ley 7/2024), la Ley 6/1997 del Suelo Rústico y la Ley 12/2017 de urbanismo. 151/151 citas en total; el verificador acepta ya varias normas por tabla (`otras_fuentes` y `norma` en cada cita) y citas de anexos, y falla con una cita alterada o en otro artículo.
- Matriz para la vivienda: prohibida en AANP, ANEI y APT; ARIP depende del plan territorial insular; AIA solo anexa a explotación; SRG, SRG forestal y AT, vivienda aislada. Parcela mínima de 14.000 m² en todo el rústico (art. 25), comparada con la superficie del Catastro: por debajo, «No».
- El Govern tiene deshabilitadas las capas de APT y de APR de inundación, erosión y desprendimientos. La franja de 500 m de costa (100 m en Formentera) se calcula con el contorno de las islas (`web/datos/costa-baleares.json`, de `tools/costa_baleares.py`): entera dentro, la parcela pasa a APT; en parte, aviso con la distancia al mar. Preguntárselo al servidor tardaba 1,4-6 s.
- La zona inundable del Ministerio en Baleares son 4 recintos: se usa el ARPSI de 500 años de la IDEIB (`aguaPropia` en el adaptador). Afecciones: zona inundable, Red Natura 2000 y aviso de riesgo de incendio.
- Mapa: el WMS del MUIB pinta repetido el aviso de que las categorías no están al día y tapa el mapa; se usa el `export` de ArcGIS sin etiquetas.
- Probado en Chrome: 21 parcelas por categoría, 22 al azar repartidas por las cuatro islas y 4 búsquedas escritas. Sin errores de consola; veredicto en menos de 1,2 s, ficha completa en 0,8-2,5 s (más cuando el Ministerio va lento). Regresión de los ejemplos de las otras comunidades: mismos resultados.
- Smoke test de Álvaro superado (14/10). Al integrar: `https://ideib.caib.es` en el `connect-src` del portfolio.
- Abierto: el propio Govern avisa de que las categorías del rústico del MUIB no recogen las últimas modificaciones de los planes territoriales; la ficha lo dice. Montes de utilidad pública, espacios naturales protegidos, APR deshabilitadas, franja de carreteras, costas y patrimonio sin consultar. Con la APT parcial el titular no cambia (se avisa), igual que la distancia en Cantabria.
- Visto de paso, general: con Enter el buscador toma la primera sugerencia de CartoCiudad, que a veces es un comercio o una calle de otra provincia («Carrer de Sant Miquel 30, Palma» da un estanco; «Calle Mayor 5 Ciutadella», una calle de La Rioja).

## Comunitat Valenciana (14/10/2026, en local, sin desplegar)

- Adaptador del planeamiento refundido de la Generalitat (ICV, `terramapas.icv.gva.es/0702_Planeamiento`): WFS de MapServer nativo en 25830, con GeoJSON (el sondeo anterior decía solo GML) y CORS abierto. 122.840 recintos con la zona normalizada de la LOTUP (`zon_suelo`) y la dotación (`dotacion`); toda la comunidad cabe en 23 combinaciones.
- Tabla del Texto refundido de la LOTUP (Decreto Legislativo 1/2021): 21 citas, 172/172 en total. Zona urbanizada por solar (art. 187; industrial y terciaria, según el plan); nuevo desarrollo, «Todavía no» (art. 28.4); rural común agropecuaria o forestal, vivienda aislada si el plan la prevé, con 1 ha y el 2 % de ocupación (art. 211.1.b); por debajo de 1 ha, solo la ligada a una explotación profesional; explotación de recursos, «No»; rural protegida por el municipio o agrícola, según el plan (art. 26.c); por legislación ambiental, riesgos, patrimonio o franjas de dominio público, «No»; dotaciones, «No».
- En Valencia «vivienda aislada» se ordena por delante de «depende del plan» para el titular: una finca 60 % rural común y 34 % protegida municipal salía «Depende».
- Probado en Chrome: 21 parcelas por zona y 20 al azar por las tres provincias. Sin errores de consola; veredicto en 0,5-0,9 s (3 s en dos casos), ficha completa en 0,8-4 s.
- Smoke test de Álvaro superado (22/10). Al integrar: `https://terramapas.icv.gva.es` en el `connect-src` del portfolio.
- Abierto: Red Natura 2000, montes de utilidad pública y espacios naturales sin fuente WFS localizada (las protecciones ambientales que recoge el plan sí entran en el veredicto). Sin sección de rehabilitación. Se pide por caja (MapServer no entiende `CQL_FILTER`): una parcela alargada traerá recintos de más.

## Proxy para servicios sin CORS (14/10/2026)

- `tools/servir.py` tiene ahora una tabla `PROXIES` (prefijo local → servidor y rutas permitidas): `/api/miteco/` (agua), `/api/carm/` (Murcia: `wfs` y `wms` de `SIT_USU_PLA_URB_CARM`) y `/api/aragon/` (`SIUa/wfs`, `SIUa/wms`, `VISOR2D/wfs`). Cualquier otra ruta da 403. Las teselas del mapa también pasan por el proxy: MapLibre las pide con `fetch`.
- Al integrar, el Worker del portfolio necesita las mismas rutas.

## Región de Murcia (14/10/2026, en local, sin desplegar)

- Clases de suelo del SITMurcia (`clases_plu_ze_37mun`): 9.469 recintos en 33 de los 45 municipios; los demás salen «sin datos» con el aviso de cobertura. Por el proxy `/api/carm/`.
- Tabla de la Ley 13/2015: 14 citas. Urbano consolidado por solar (art. 89); sin consolidar y urbanizable sectorizado, «Todavía no»; núcleo rural y urbano especial, según el plan (arts. 90 y 91); urbanizable sin sectorizar, vivienda ligada a explotación en parcela de más de 5.000 m² (arts. 101-102; por debajo, «No»); no urbanizable protegido por el planeamiento, explotación de 20.000 m², e inadecuado, 10.000 m² en regadío (art. 95); protección específica, «No» (art. 94); sistemas generales, «No». La DT 5ª equipara las clases de los planes sin adaptar (no programado, apto para urbanizar, no urbanizable a secas) y la tabla lo recoge.
- Probado en Chrome: 22 parcelas por clase y 10 al azar. Sin errores; veredicto en 0,8-1,8 s.
- Smoke test de Álvaro superado (22/10). Abierto: Red Natura, montes y vías pecuarias (la capa `plu_prot_vp` da error), espacios naturales.

## Aragón (14/10/2026, en local, sin desplegar)

- SIUa del Gobierno de Aragón (`clasificacion_idearagon`): 54.312 recintos en 711 de 731 municipios, con la clase normalizada (`notepa`) y el sistema general (`dot_sg`). Por el proxy `/api/aragon/`. Con `INTERSECTS`, 0,1 s.
- En 119 municipios el único plan publicado figura como «No aprobada/Denegada/Obsoleta» (`fiab_geom`): ahí la ficha dice «Sin dato» y pide preguntar en el ayuntamiento. Las geometrías marcadas como dudosas llevan aviso.
- Tabla del Texto refundido de la Ley de Urbanismo de Aragón (DL 1/2014): 16 citas, 202/202 en total. No urbanizable genérico, vivienda aislada si el plan no la prohíbe: 10.000 m², 300 m² construidos y sin dos viviendas a menos de 150 m (art. 34.2; por debajo de 1 ha, solo ligada a explotación); urbanizable no delimitado, igual (art. 33); no urbanizable especial, «No» (art. 37); sistemas generales, «No». En municipios sin plan general se avisa de la autorización especial (art. 35.1.b) y de la zona de borde (art. 289). Rehabilitación de bordas y edificios rurales tradicionales (art. 35.1.c).
- Afecciones: montes de utilidad pública, vías pecuarias y Red Natura (LIC y ZEPA) del Gobierno de Aragón.
- Probado en Chrome: 16 parcelas por clase y 15 al azar. Sin errores; veredicto en 0,8-1,8 s.
- Smoke test de Álvaro superado (22/10). No se mide la distancia a otras viviendas (núcleo de población): la ficha la explica.

## Castilla-La Mancha (16/10/2026, en local, sin desplegar)

- Sistema de Información Urbana de la Junta (ArcGIS REST, `Sistema_Informacion_Urbana/MapServer/1`): 29.941 recintos en los 919 municipios, también en los 284 sin planeamiento (ahí la Junta clasifica el casco como urbano, las protecciones sectoriales como especial protección y el resto como reserva; la ficha lo explica). 59 de 60 puntos al azar caen en un recinto. Clase y categoría con erratas que se normalizan; `URBANIZADO` marca 612 recintos urbanizables ya urbanizados, que salen como solar (art. 45). Figura de planeamiento, fecha, habitantes y zip del plan de `Planeamiento_Municipal`.
- Tabla del Texto refundido de la LOTAU (DL 1/2023) y de la Instrucción Técnica de Planeamiento de suelo rústico (Orden 4/2020, DOCM núm. 15): 36 citas, 238/238 en total. **Primera norma citada fuera del BOE** (decisión de Álvaro, 16/10): el BOE no consolida la orden; el verificador lee el PDF del DOCM (quita sus cabeceras de página y acepta «Disposición adicional.» sin ordinal) y la ficha enlaza «texto en el DOCM». Falla con una cita alterada, en otro artículo o en otra disposición.
- Veredicto: urbano consolidado por solar (art. 51); no consolidado y urbano de reserva, «Todavía no» (art. 69); urbanizable sin programa, «Todavía no» (art. 67); rústico de reserva, vivienda aislada con 1,5 ha y el 2 % de ocupación (art. 54.1.2º.f, ITP art. 5); entre 1 y 1,5 ha, solo ligada a explotación; por debajo, «No». Especial protección: la ley no la prohíbe (art. 54.4), depende de la norma de la protección y del plan, con calificación y 3 ha (1,5 ha ligada a explotación; por debajo, «No»). Sistemas generales, «No». Rehabilitación: art. 54.1.2º.d y la disposición adicional de la ITP (arquitectura popular sin superficie mínima). La ficha dice la diferenciación de la protección (natural, ambiental, estructural...) y si el municipio pasa de 5.000 habitantes (regla de los 200 m al suelo urbano, art. 54.3).
- Afecciones: montes de utilidad pública, vías pecuarias (ejes con anchura legal) y Red Natura 2000 de la Junta.
- Probado en Chrome: 16 parcelas por categoría, 20 al azar por las cinco provincias, 2 búsquedas escritas y regresión de Aragón, Baleares y Cantabria. Sin errores de consola ni de CSP; ficha completa en 0,5-3 s (una de 8,7 s por el Ministerio).
- Smoke test de Álvaro superado (16/10). Al integrar: `https://geoservicios.castillalamancha.es` en el `connect-src` del portfolio.
- Abierto: no se mide la distancia de 200 m al suelo urbano (solo se avisa en municipios de más de 5.000 habitantes). Espacios naturales protegidos (capa `Espacios_Naturales_Protegidos` localizada), carreteras y patrimonio (`Patrimonio_Cultural`) sin consultar como afección; el plan sí los recoge en la especial protección. La Junta tiene en consulta pública (mayo de 2026) una Norma Técnica de Planeamiento que podría sustituir la ITP: revisar.

## La Rioja (16/10/2026, en local, sin desplegar)

- Dos fuentes del Gobierno de La Rioja en el mismo MapServer (WFS 1.1, solo GML 3, ISO-8859-1): el planeamiento urbanístico del SIU (2.091 recintos en 124 de los 174 municipios; **falta Logroño**) y la Directriz de Protección del Suelo No Urbanizable (136 áreas en ocho espacios: cumbres, sierras, riberas, espacios agrarios, vegetación singular, parajes geomorfológicos, embalses y zonas húmedas). Lector de GML nuevo en `geo.js` (`wfsGml`). 0,2-0,4 s por consulta.
- Con la capa de planeamiento sola, dos de cada tres fincas rústicas al azar se quedaban sin veredicto claro: 30 % sin recinto y la mayoría del resto en planes antiguos («Suelo No Urbanizable» más un motivo, sin especial ni genérico). Con la Directriz (decisión de Álvaro, 16/10): sus áreas prohíben la vivienda autónoma y en vivienda obligan al plan municipal (art. 8); fuera de ellas, en rústica sin plan publicado, rige su no urbanizable genérico supletorio, que va como relleno de lo que no clasifica ningún plan.
- Tabla de la Ley 5/2006 (BOE) y de la Directriz (anexo, volumen I, del Decreto 18/2019 en el BOR; el texto del decreto no trae la normativa, va como adjunto del anuncio): 33 citas, 271/271 en total. El verificador admite ya una `cabecera` de página propia por fuente. Urbano consolidado, y el urbano sin categoría (art. 42.b: lo no marcado como no consolidado es consolidado), por solar; no consolidado y urbanizable delimitado, «Todavía no» (arts. 44 y 56); urbanizable no delimitado y no urbanizable genérico, vivienda autónoma con 20.000 m² en secano o 5.000 en regadío y a más de 150 m de otra edificación (arts. 52 y 57; entre 5.000 y 20.000 m², «Solo si la finca es de regadío»; por debajo, «No»); especial y áreas de la Directriz, «No»; plan antiguo sin categoría, «Depende del plan» (por debajo de 5.000 m², «No»); sistemas generales, «No».
- Afecciones: montes de utilidad pública, vías pecuarias (polígonos) y Red Natura 2000.
- Arreglado al probar: el no urbanizable de Lardero se pasa del término y cubría fincas de Logroño (se filtra por municipio; los 124 nombres casan con el Catastro); con varios bienes el Catastro no da la clase de la finca (se deduce de la referencia).
- Probado en Chrome: 9 parcelas por clase, 35 al azar, 3 búsquedas escritas y fincas de Logroño (rústica: genérico de la Directriz; urbana: sin dato). Sin errores de consola propios; veredicto en 0,8 s, ficha completa en 1-2,6 s. Un fallo de CORS en una tesela del IGN (fondo del mapa), ajeno.
- Smoke test de Álvaro superado (16/10). Al integrar: `https://ogc.larioja.org` en el `connect-src` del portfolio.
- Abierto: urbano de Logroño y de los otros 49 municipios sin plan publicado, «Sin dato» (el Ayuntamiento de Logroño publica su plan aparte: mirar). No se mide la distancia de 150 m a otras edificaciones ni se sabe si la finca es de regadío (el cultivo del Catastro lo diría: `datos.cultivo`). Espacios naturales protegidos, carreteras y patrimonio sin consultar.

## Canarias (16/10/2026, en local, sin desplegar)

- Planeamiento de IDECanarias (GRAFCAN), solo WMS: la capa de categorías trae un código normalizado por recinto (`cod`, el de la leyenda) con las categorías de la Ley 4/2017 y sus equivalencias ya aplicadas a los planes antiguos. Sin geometría que descargar, el reparto se cuenta en píxeles: un `GetMap` recortado a la parcela con un color exacto por código (por POST: el estilo no cabe en la URL) y una consulta de punto por categoría para el nombre que le da el plan y el documento. `main.js` acepta ya un reparto calculado por el adaptador.
- Tabla de la Ley 4/2017 (BOE): 49 citas, 320/320 en total. La vivienda nueva en rústico solo cabe en asentamiento rural (con las condiciones del plan: unidad apta, nada de promociones de más de dos ni adosadas) o agrícola (ligada a una explotación efectiva); en el resto del rústico, «No» (art. 60.1.a; en protección agraria, además, art. 66.3). Urbano consolidado por solar; no consolidado y urbanizable, «Todavía no». Rehabilitación de edificios de valor etnográfico o arquitectónico, incluso para vivienda (art. 60.6.a).
- Afecciones: Red Natura 2000 (LIC/ZEC y ZEPA de GRAFCAN, sin nombres: esas capas no publican atributos) y la zona inundable del Ministerio (34 áreas de riesgo). El cauce y la policía del Ministerio en Canarias son 67 tramos para miles de barrancos: se quitan y van a pendientes, y la línea de fuentes lo dice.
- Probado en Chrome: 8 parcelas por categoría (asentamientos, urbanizables, no consolidado), 16 al azar por las islas y búsquedas por polígono y parcela (Teide, Caldera de Taburiente). Sin errores; ficha completa en 1-2 s (4 s la primera).
- Smoke test de Álvaro superado (16/10). Al integrar: `https://idecan2.grafcan.es` en el `connect-src` del portfolio.
- Abierto: cauces de barrancos (consejos insulares de aguas), espacios naturales protegidos (WMS `EspNat`, sin atributos), costas, montes y patrimonio. La parcela mínima y las condiciones de los asentamientos las fija cada plan general.

## Asturias (16/10/2026, en local, sin desplegar)

- Los dos bloqueos del 14/10, resueltos. **Norma**: el BOE publica consolidado y al día (edición del 16/12/2025) el Código de Urbanismo del Principado, con el texto refundido (DL 1/2004) como §2 y el Reglamento de 2022 como §7; el verificador lee solo las páginas de la sección (`seccion`). No hace falta el BOPA. La LOITA, que sustituiría al texto refundido, seguía en anteproyecto en junio de 2026: vigilar. **Lentitud**: el GetMap tampoco sirve (5-6 s, el servidor pinta el concejo entero), así que va de un extracto estático (decisión de Álvaro, 16/10): 2.866 teselas de 2 km, 43 MB (16 MB comprimido), mediana 13 kB por tesela; `tools/extracto_asturias.py` lo regenera.
- Tabla del texto refundido: 22 citas, 342/342 en total; el verificador falla también con una frase que solo está en el Reglamento. Fuera de los núcleos rurales no hay vivienda nueva, salvo donde el plan la permita en el no urbanizable de interés (art. 124.1): núcleo rural, «Sí, con las condiciones del plan» (art. 138); interés, «Depende del plan»; especial protección, costas e infraestructuras, «No». Urbano consolidado por solar (art. 118); no consolidado, prioritario y sectorizado, «Todavía no» (arts. 119 y 139); no sectorizado, «Depende del plan» (art. 139.3). Rehabilitación y quintana tradicional (art. 124.2).
- Probado en Chrome: 20 parcelas al azar por los concejos y 3 búsquedas (Oviedo, Gijón, Lena). Veredicto en 0,5-0,9 s. 28/28 en la vigilancia, con tres casos de Asturias.
- Smoke test de Álvaro superado (16/10). Al integrar: nada en `connect-src` (todo es del mismo origen), pero sí copiar `web/datos/asturias/`.
- Abierto: sin capa de suelo en el mapa. Sin afecciones propias (montes, vías pecuarias, Red Natura: la IDE de Asturias no tiene un WFS localizable). El extracto envejece: regenerarlo cuando cambien planes.

## País Vasco (19/10/2026, en local, sin desplegar)

- **Catastro foral** (`web/catastro-foral.js`): los WFS INSPIRE de Araba y Gipuzkoa y, en Bizkaia, la consulta REST del ArcGIS que hay debajo de su WFS (capa 8). Todos con CORS y 0,3-1,5 s por petición. El WFS de Bizkaia pasó una hora contestando con un 200 vacío a 23 de cada 30 peticiones; la consulta REST no falló ninguna. Una respuesta vacía cuenta como error, nunca como «sin parcela». No hay consulta de punto a finca: se pide una caja de 1 m alrededor del punto (22 m con la tolerancia de un portal) y se busca la parcela que lo contiene. Solo se pregunta si el Catastro estatal no tiene finca en el punto, así los enclaves de otras provincias (Treviño) siguen yendo por el estatal. Gipuzkoa devuelve todas las versiones de cada parcela: vale la que no tiene `endLifespanVersion`. El enlace de una finca foral es el punto (`#@lon,lat`). Funcionan el clic, los ejemplos y la búsqueda de portal; la referencia y el «polígono y parcela» forales no (cada diputación tiene su formato). El municipio sale de Udalplan (`COD_IDEN`, código INE) con los nombres del INE de 2026 (`web/datos/municipios-euskadi.json`).
- **Planeamiento**: Udalplan del Gobierno Vasco (GeoEuskadi, ArcGIS REST en 25830). Nueve capas que forman un mosaico sin solapes (60 puntos al azar): suelo residencial y de actividades económicas con su clase, seis de sistemas generales y el no urbanizable con las categorías de las DOT. 251 de 252 municipios; Usansolo sigue con el plan de Galdakao. Planes de 1986 a 2023.
- Tabla de la Ley 2/2006 (BOE, consolidada a 29/12/2025) y de las DOT (Decreto 128/2019, anexo II de las normas, del PDF del BOPV): 47 citas, 389/389 en total. El verificador admite `fin` en una fuente (el BOPV repite «ANEXO II» después). En el no urbanizable la vivienda nueva está prohibida salvo la ligada a una explotación hortícola o ganadera (art. 28.1.a, requisitos del art. 31). Según la matriz de las DOT, esa vivienda ligada cabe en forestal y en agroganadera y campiña (también en alto valor estratégico), y está prohibida en especial protección, mejora ambiental, pastos montanos y protección de aguas superficiales. Núcleo rural, «Depende del plan» (art. 29.3). Urbano no consolidado y urbanizables, «Todavía no» (art. 32.1.a; se cita la letra a para no citar el «programa de actuación urbanizadora», que la Ley 6/2025 sustituye). Urbano de actividades económicas, «Depende del plan» (art. 34). Rehabilitación: reconstrucción de caseríos (art. 30).
- Probado en Chrome: 14 casos dirigidos (las tres capitales, cada categoría, Treviño y un portal de Bilbao) y 36 parcelas al azar por los tres territorios. Sin errores propios; veredicto en 0,5-4,9 s. En el oeste de Álava salen en consola teselas del WMS de Cantabria con 500 y sin CORS: ese servidor falla fuera de su comunidad y su caja (`limites`) llega a -3,1.
- Mapa: el WMS de parcelas de Bizkaia y Álava, con el estilo `LabelOnReferencePoint` (el de por defecto repetía el número en cada tesela); Gipuzkoa no lo atiende y va con el suyo.
- Smoke test de Álvaro superado (19/10). Cinco casos en `tools/vigilancia.json`. Al integrar: `https://geo.araba.eus https://geo.bizkaia.eus https://b5m.gipuzkoa.eus https://www.geo.euskadi.eus` en el `connect-src` del portfolio.
- Abierto: sin afecciones propias (Red Natura, montes de utilidad pública). Navarra: su catastro foral funciona igual (WFS INSPIRE con CORS, `inspire.navarra.es/services/CP/wfs`), pero sigue sin capa de clasificación.

## Extremadura (19/10/2026, en local, sin desplegar)

- **SIU del Ministerio** (`web/siu.js`): capa nacional de clases de suelo (`mapas.fomento.gob.es/arcgis/rest/services/SIU/CLASES_DE_SUELO/MapServer/0`), con CORS, 0,14-0,25 s y 11-235 kB por parcela. 5.900 municipios: Galicia 276 de 313, Andalucía 618 de 785, Extremadura 375 de 388, Ceuta, Melilla, Navarra 83 de 272. Solo la clase (urbano, no consolidado, urbanizable delimitado o no, no urbanizable, sistemas generales) y una marca de núcleo rural: no separa el no urbanizable protegido. Es la base para lo que falta de España (decisión de Álvaro, 19/10).
- **Extremadura**: categorías de la IDE de Extremadura (MapServer `mapas.ideex.es/CICTEX/urbanismo`, nueve capas sin atributos, sin CORS: por el proxy `/api/ideex/`), con el SIU de respaldo donde no hay recintos. Una petición para las nueve capas (`wfsGml` admite ya una lista). En 30 puntos al azar, la IDEEX dio categoría en los 20 de Extremadura, igual que el SIU.
- Tabla de la LOTUS (Ley 11/2018, BOE consolidado a 04/08/2026): 31 citas, 420/420 en total. La DT 2ª equipara las categorías de los planes antiguos (no urbanizable → rústico; protegido → rústico protegido) y hace autorizable todo uso que el plan no prohíba expresamente. Rústico común con 1,5 ha o más, «Con condiciones: vivienda aislada» (calificación rústica, art. 70.3; 300 m del suelo urbano, art. 66.1.c); por debajo, «Solo ligada a una explotación» (uso vinculado, art. 67.3.b, sin calificación ni superficie mínima). Rústico protegido, «Depende de la protección y del plan» (la Junta califica con informe del órgano que protege). Urbano, por solar (art. 8); no consolidado y urbanizable, «Todavía no» (art. 8.2). Rehabilitación de edificaciones tradicionales de más de 30 años en parcela menor (art. 70.3).
- Probado en Chrome: 8 casos dirigidos (común, protegidos, Cáceres y Mérida) y 26 puntos al azar en Extremadura, todos con veredicto, 1-10 s. Sin errores propios (el Ministerio de agua daba 404 a 4 de cada 10 peticiones ese día). Sin probar todavía el respaldo del SIU dentro de Extremadura: en las muestras no hubo ningún punto sin IDEEX.
- Smoke test de Álvaro superado (20/10). Tres casos en `tools/vigilancia.json`. Al integrar: `https://mapas.fomento.gob.es` en el `connect-src` y el prefijo `/api/ideex/` (`https://mapas.ideex.es`, ruta `/CICTEX/urbanismo`) en el Worker.
- Abierto: sin afecciones propias. Los municipios de 10.000 habitantes o más se rigen por su propio plan (DT 2ª.1.b): la ficha lo avisa, no lo distingue. No se mide la distancia de 300 m al suelo urbano.

## Andalucía (19/10/2026, en local, sin desplegar)

- Sin capa regional: las clases salen del SIU del Ministerio (618 de 785 municipios). Fuera de ellos, «Sin dato». Mapa: el `export` del MapServer del SIU.
- Tabla de la LISTA (Ley 7/2021, BOE consolidado a 07/04/2026) y de su Reglamento General (Decreto 550/2022, PDF firmado del BOJA 232; el verificador lo lee con su `cabecera`): 20 citas, 440/440 en total. La DT 1ª reparte los planes antiguos: urbano sigue urbano (solar, art. 18.1.a); no consolidado y urbanizable sectorizado, actuaciones de transformación delimitadas («Todavía no»); el resto, rústico con su categoría, y el urbanizable no sectorizado, rústico hasta que se delimite. Rústico de 2,5 ha o más, «Depende de la protección y del plan»: en rústico común cabe la vivienda unifamiliar aislada no vinculada (art. 22.2 y Reglamento art. 31: 2,5 ha, 5 en forestal; 100 m a otra vivienda; 200 m a un núcleo; 1 % de ocupación; 25 m a linderos; prestación del 15 %), pero el SIU no dice si es común o protegido. Menos de 2,5 ha, «Solo ligada a una explotación» (art. 21.2.b; Reglamento art. 29). Núcleo rural del SIU en no urbanizable, hábitat rural diseminado (art. 23). Sistemas generales, «No» (art. 116).
- Probado en Chrome: 5 casos dirigidos y 30 puntos al azar: de las 20 parcelas andaluzas, 18 con veredicto y 2 en municipios sin SIU («Sin dato»: Cañaveral de León y Algodonales). Hallazgo: el SIU contesta 500 sin CORS al user-agent `HeadlessChrome`; `vigilar.mjs` se presenta ya como un Chrome normal. Un navegador de verdad no tiene el problema.
- Smoke test de Álvaro superado (20/10). Tres casos en `tools/vigilancia.json`. Al integrar: nada nuevo en `connect-src` (`https://mapas.fomento.gob.es` ya entra con Extremadura).
- Abierto: sin afecciones propias; la categoría del rústico (común, preservado, protegido) no está en ninguna fuente abierta encontrada; no se mide la distancia a otras viviendas ni a los núcleos.

## Navarra (20/10/2026, en local, sin desplegar)

- IDENA sigue sin clasificación por recintos (WFS y WMS revisados el 20/10: solo indicadores por municipio, el inventario de planes y el ámbito de los POT, sin categorías del no urbanizable). Las clases salen del SIU: 83 de 272 municipios, pero todos los de más de 1.300 habitantes (unos 626.000 de 684.000 habitantes, el 91 %); el mayor sin dato es Mendigorría (1.275). Por territorio la cobertura es mucho menor: en 30 puntos al azar, 9 de 16 parcelas navarras salieron «Sin dato». Las Bardenas Reales no son municipio y tampoco tienen SIU. Sin núcleos rurales marcados en Navarra.
- Parcela del catastro foral (`inspire.navarra.es/services/CP/wfs`, CORS, 0,2-0,6 s). Municipio, figura de plan y enlace a su ficha del SIUN, de `INFOTU_Pol_PlanUrbMun` de IDENA por geometría (0,1 s). El código de municipio del catastro y de IDENA es el del INE, también en los 9xx.
- Tabla del texto refundido (DFL 1/2017, BOE consolidado a 12/03/2026): 19 citas, 459/459 en total. En el no urbanizable la vivienda unifamiliar aislada solo cabe en el de preservación, si el plan municipal la prevé expresamente y en las áreas que fijen el reglamento o los POT, con 1 ha como mínimo (art. 115): de 1 ha en adelante, «Depende de la protección y del plan»; por debajo, «No» (salvo barrio rural tradicional delimitado por el plan, 1.500 m², art. 116, que el SIU no marca). No hay vivienda vinculada a explotación en la ley navarra. Urbano por solar (arts. 91 y 95); no consolidado y urbanizables, «Todavía no» (arts. 93, 95 y 97); sistemas generales, «No» (art. 121). Rehabilitar: obras sin cambio de uso permitidas, cambio de uso autorizable (art. 110).
- Afecciones de IDENA: montes de utilidad pública (`FOREST_Pol_MUP1912`), vías pecuarias (ejes sin anchura más lindes) y Red Natura (ZEC y ZEPA). Probadas: cañada en Tudela, ZEC de Bardenas en Arguedas, montes en Aranguren.
- Probado en Chrome: 7 casos dirigidos, 5 ejemplos y 30 puntos al azar. Sin errores propios; veredicto en 1-6 s. El IGN falló alguna tesela de zoom 18 y MapLibre la repite en consola como «Failed to fetch» sin URL: `vigilar.mjs` ignora ese eco (la tesela fallida ya sale con su URL como error de red).
- Smoke test de Álvaro superado (20/10). Tres casos en `tools/vigilancia.json`. Al integrar: `https://inspire.navarra.es https://idena.navarra.es` en el `connect-src`.
- Abierto: espacios naturales protegidos (IDENA los tiene: `BIODIV_Pol_RENA`). Sin consulta por referencia ni por polígono y parcela forales.

## Galicia (20/10/2026, en local, sin desplegar)

- Sin capa autonómica vigente (IURB_V9 es de 2011 y solo del litoral): las clases salen del SIU, 276 de 313 concellos (A Coruña 89/93, Lugo 57/67, Ourense 70/92, Pontevedra 60/61). El SIU marca los núcleos rurales (`NuclRural = '1'`) en urbano y en no urbanizable: se tratan como suelo de núcleo rural, que en la ley gallega es clase propia.
- Tabla de la Ley 2/2016 del suelo de Galicia (BOE, consolidada a 16/02/2026): 24 citas. En rústico, de cualquier categoría, la única vivienda nueva es la ligada a una explotación agrícola o ganadera, con autorización de la Xunta (arts. 35.1.n y 36.3), y cualquier edificación pide 2.000 m² (art. 39): por encima, «Solo ligada a una explotación»; por debajo, «No». La transitoria primera lleva al rústico el no urbanizable de los planes antiguos y, en los no adaptados a la Ley 9/2002, el urbanizable no delimitado. Núcleo rural, «Sí, con las condiciones del plan» (art. 25, DT 1ª). Urbano por solar (arts. 18 y 19); no consolidado y urbanizable, «Todavía no» (arts. 18.2 y 28.2); sistemas generales, «No» (art. 129). Edificaciones anteriores a 1975: rehabilitación y ampliación del 50 % para vivienda (art. 40).
- Probado en Chrome: 25 puntos al azar (12 rústico, 2 núcleo rural, 3 sin SIU, el resto mar o calle), 8 dirigidos y la búsqueda en A Coruña. Sin errores; 0,8-5 s.
- Smoke test de Álvaro superado (20/10). Tres casos en `tools/vigilancia.json`. Nada nuevo en `connect-src`.
- Abierto: sin afecciones propias (Red Natura, montes vecinales, costas).

## Ceuta y Melilla (20/10/2026, en local, sin desplegar)

- Sin ley urbanística propia: rige la del Estado y, para el régimen de cada clase de suelo, el texto refundido de 1976 (RD 1346/1976, consolidado en el BOE a 10/06/2026, vigente de forma supletoria) con el plan general de cada ciudad. Clases del SIU, que tiene las dos ciudades.
- Tabla del texto de 1976: 10 citas, 493/493 en total. El texto numera con letra («Artículo ochenta y cinco»): `verificar_citas.py` pasa esos números a cifras; el control negativo (artículo cambiado) falla como debe. No urbanizable y urbanizable no programado: solo construcciones agrícolas y, excepcionalmente, un edificio aislado de vivienda familiar donde no haya posibilidad de formar un núcleo de población (arts. 85 y 86.1); en especial protección, nada que cambie su naturaleza (art. 86.2). Urbano por solar (arts. 82 y 83); programado, «Todavía no» (art. 84); sistemas generales, «No» (art. 134).
- La referencia catastral empieza por 55 (Ceuta) y 56 (Melilla), pero el Catastro da la provincia del INE (51, 52). Probado por punto y por referencia en las dos.
- Smoke test de Álvaro superado (20/10). Un caso por ciudad en `tools/vigilancia.json`.

## QA en Chrome sin interfaz (22/10/2026)

- Unas 230 cargas: 37 entradas raras en el buscador, 40 casos límite (enclaves, islas, fronteras, parques, fincas de cientos de hectáreas, servicios bloqueados, 3 s de latencia, clics seguidos, móvil) y 132 puntos al azar. Sin errores propios. Con veredicto (62 de los 132): veredicto en 1,5 s de mediana (p90 2,7 s), ficha completa en 1,8 s (p90 3,2 s).
- Arreglado:
  - «polígono 1 parcela 1 Tudela» daba Tudela de Duero sin preguntar: solo se elige sin preguntar el municipio que se llama como lo escrito, y en los forales se avisa de que no se puede buscar así.
  - Enter con texto ambiguo tomaba la primera sugerencia, aunque fuera de otra provincia: ahora toma la del pueblo escrito (un portal antes que un comercio) o pide elegir. El ejemplo «Rúa Real 10, A Coruña» iba a Oleiros (con «Rúa» CartoCiudad no da calles de A Coruña) y la vigilancia no lo veía porque allí también sale «Suelo urbano»: pasa a «Calle Real 10».
  - Con varios bienes el Catastro no da `<cn>` y una finca urbana de CyL sin planeamiento iba al régimen del rústico (art. 73 en vez de 67): la clase sale de la forma de la referencia.
  - Un enlace pegado en la pestaña abierta (`hashchange`) no hacía nada.
  - Las llamadas al Catastro tienen un reintento: un 404 suelto de su WFS tumbaba la consulta.
  - `servir.py` rechazaba conexiones (cola de 5) y la página no cargaba en 4 de 132 cargas, y en la vigilancia: cola de 128.
- Arreglado después, de cara al público (22/10): los errores de red dicen qué servidor no responde (salían en inglés, «Failed to fetch»); en móvil el mapa encoge con una ficha abierta y el veredicto queda en la primera pantalla; el mapa empieza en la península y Baleares (estaba centrado en CyL); `Map.groupBy`, que Safari no tiene hasta la 17.4, sustituido por `agrupar` (`geo.js`: el mínimo queda en Safari 16.4 por `OffscreenCanvas`); `normasDe` ya no guarda una carga fallida; `meta description` sin lista de comunidades, coma en la nota de cobertura, `maxlength` de 200 en el buscador y el apóstrofo que CartoCiudad escribe como comillas dobles.
- Abierto:
  - Red Natura en las comunidades sin capa propia: una finca de 1.639 ha en Doñana sale «Depende» y «sin afecciones en las capas consultadas». Probar el WMS de Red Natura del Ministerio contado por píxeles, como el agua.
  - Si cae el servicio de una comunidad, cae el veredicto: el SIU podría hacer de respaldo.
  - Con muchos bienes, `Consulta_DNPRC` pesa 124 kB y tarda 5,6 s.
  - La capa de montes de CyL tardó dos veces más de 19 s.

## Seguridad (22/10/2026)

- Secretos: gitleaks sobre todo el historial de este repo y del portfolio, sin hallazgos. `.dev.vars` del portfolio tiene una clave, pero está ignorado y nunca se commiteó. En los ficheros, ni rutas locales ni del vault.
- La página no tiene sumideros de HTML (todo por `textContent`), los filtros CQL solo llevan números y la CSP no admite scripts en línea. Los enlaces que llegan de los servicios solo se pintan si son http(s).
- Lo único que gasta a nombre del portfolio es el Worker: lo demás lo pide el navegador del visitante directamente a cada servicio. Su proxy al Ministerio dejaba pasar cualquier petición a sus dos rutas (en producción sirvió un mapa de 4096 px de toda España, 1,3 MB y 9 s, y un `GetFeatureInfo` en `text/html` desde alvaroalcaraz.com sin CSP: `_headers` no cubre las respuestas del Worker) y admitía SLD con imágenes externas. Ahora solo pasa lo que pide `afecciones.js`, con el tipo de respuesta fijo, `nosniff` y `Content-Security-Policy: default-src 'none'; sandbox`, y hay un límite por IP: 200/min en el proxy y 30/min en `/api/track`. Probado con `wrangler dev` y en producción (desplegado el 22/10, `b56a493` del portfolio): las peticiones legítimas pasan y 13 abusos dan 400, 403, 405 o 413. El límite cuenta por centro de datos y de forma aproximada: con 220 peticiones seguidas no saltó; con 800 en 1,9 s pasaron 351 y el resto dio 429.
- Access aguanta una cabecera `cf-access-jwt-assertion` falsificada en `/api/stats` y `/api/trading` (redirige al login).
- Antes de hacer público este repo: falta la licencia MIT de `polygon-clipping` en `web/vendor/` y una licencia propia.

## Vigilancia de servicios (16/10/2026)

- 20/10: 39 casos con los seis de Extremadura y Andalucía. Ese día GeoEuskadi no respondía (`ERR_CONNECTION_TIMED_OUT`): los cinco casos del País Vasco fallaban y cuatro dejaban la ficha cargando más de 40 s, sin aviso al usuario. Arreglado: toda llamada a un servicio pasa por `traer` (`geo.js`), que la corta a los 20 s sin reintento y la ficha dice qué servidor no respondió. `--grabar` reescribe todos los casos, también los que fallan: grabar solo con la vigilancia limpia o revisar el diff.
- 19/10: la Junta de CyL movió las vías pecuarias a `viaspecuarias:vvpp_cyl_ejes` y renombró sus campos. Fallaban los cinco casos de CyL; arreglado.
- `tools/vigilar.mjs` y `tools/vigilancia.json`: 25 casos, de dos a cinco por comunidad, con su veredicto y categoría grabados. 25/25 en 1-7 s por caso. Probado con el fallo real de la Junta de CyL (campo `geom` en lugar de `geometry`): los cinco casos de CyL salen con el 400 y el resto pasa.

## Pendiente

- [ ] SR-AI sale como «Depende del plan municipal»; en realidad solo admite residencial para regularizar el asentamiento (art. 61 bis). Valorar un nivel propio si aparece en casos reales.

- [x] Afecciones probadas en Chrome sin interfaz (puppeteer) contra `servir.py`: mismos resultados que en Node. Hizo falta un proxy porque el Ministerio duplica la cabecera CORS.
- [ ] **Red Natura 2000**: buscar una fuente con los límites de los espacios (WFS). La de la Junta son hábitats; la del Ministerio, solo WMS de visualización.
- [ ] Afecciones aún no miradas: carreteras (zona de afección y línea límite de edificación), patrimonio (BIC y su entorno).
- [x] Integrado en el portfolio (14/10, sin desplegar): `public/parcelas/` es copia de `web/` (al cambiar `web/`, volver a copiar), CSP en `_headers`, proxy `/api/miteco/` en el Worker y ficha en `public/projects/parcelas/` (05 · Webs, tras el juguete). Smoke test con `wrangler dev` superado.
- [x] Integración de toda España (22/10, desplegada ese día: `de631e9` y `29b88af` del portfolio): `public/parcelas/` vuelve a ser copia de `web/` (la de producción era la primera, solo CyL), `_headers` con los 20 hosts de `connect-src`, y el Worker con los cuatro proxies desde `src/parcelas-proxies.json`, copia de `tools/proxies.json`. Probado con `wrangler dev`: los 47 casos de la vigilancia bien (dos, al repetir: la IDEIB y el catastro de Navarra fallaban a ratos ese día) y los abusos a los proxies de Murcia, Aragón e IDEEX cortados. El límite del proxy sube a 600/min: las teselas de suelo de esas tres comunidades también pasan por él.
- En producción, 46 de 47 casos de la vigilancia bien (Santanyí: la IDEIB no respondía) y 1,5 s de mediana hasta el veredicto. Desde Cloudflare, 1 de cada 60 peticiones al Ministerio se colgaba más de 30 s (directo, 0 de 60): el Worker corta a los 8 s con un 504, que la página reintenta. Repo público: github.com/alvaroalca/comprobador-parcelas (MIT).
- [x] Reel de la ficha (22/10): 24,7 s grabados contra los servicios en vivo, en `C:\Mis Proyectos\promo-videos\comprobador-parcelas` (`capture.cjs`, `scripts/cortar.mjs`). Publicado en la ficha, y su póster es la imagen de la portada del portfolio.

## Resto de España (prioridad actual)

Objetivo: cerrar comunidad por comunidad hasta que cada una funcione igual que Castilla y León (fuente geométrica de categorías, tabla de su ley con citas verificadas, afecciones propias, batería de parcelas). Las ideas de después esperan a eso. No se despliega nada, tampoco en una ruta oculta, hasta que esté terminado (decisión de Álvaro, 14/10): la copia a `public/parcelas/` y la prueba con `wrangler dev` se hacen una sola vez, justo antes de publicar.

No hay fuente nacional: el SIU del Ministerio agrega lo que mandan las comunidades y no tiene servicio por parcela. Sondeo del 14/10 (GetCapabilities + un recinto de muestra):

| Comunidad | Servicio y capa | CORS | Detalle |
|---|---|---|---|
| Cataluña | `sig.gencat.cat/ows/PLANEJAMENT/wfs` · `MUC_CLASSIFICACIONS`, `MUC_QUALIFICACIONS` | `*` | 25831. Bloquea el user-agent de curl (el navegador pasa). |
| Madrid | `idem.comunidad.madrid/geoidem/UsoDelSuelo/wfs` · `VPLA_V_CLASIFICACION_REF_25` | `*` | Refundido 2025, clase y categoría detallada. |
| Cantabria | ArcGIS `geoservicios.cantabria.es/inspire/rest/services/Urbanismo/MapServer/6` (SIUCAN) | sí | Clase, categoría y subcategoría normalizadas; 0,1 s. |
| Baleares | ArcGIS `ideib.caib.es/.../GOIB_MUIB/MapServer` · 12 clasificación, 11 categorías del rústico | sí | Hecha. |
| C. Valenciana | `terramapas.icv.gva.es/0702_Planeamiento` · `Planeamiento.Clasificacion` | `*` | Hecha (GeoJSON sí). |
| Murcia | `mapas-gis-inter.carm.es/geoserver/SIT_USU_PLA_URB_CARM/wfs` · `clases_plu_ze_37mun` | no | Hecha, por proxy. |
| Aragón | `idearagon.aragon.es/geoserver/SIUa/wfs` · `SIUa:clasificacion_idearagon` | no | Hecha, por proxy. |
| Asturias | `visorrpgur.asturias.es:8090/geoserver` · `n03`-`n06` | no | Hecha (16/10), con extracto estático. |
| País Vasco | ArcGIS REST `www.geo.euskadi.eus/geoeuskadi/rest/services/U11/WMS_PLANGINTZA/MapServer` · Udalplan, capas 802-811 (residencial, actividades económicas, sistemas generales, no urbanizable con `SUBTIPO`) | `*` | Hecha (19/10), con los catastros forales de las tres diputaciones. |
| Canarias | `idecan2.grafcan.es/ServicioWMS/Planeamiento` · `CLA` (código `cod`) | `*` | Hecha (16/10), contando píxeles. |
| Extremadura | `mapas.ideex.es/CICTEX/planeamientoRefundido` | | Su WFS solo trae la división en hojas de los planos escaneados. Sin clasificación. |
| Navarra | IDENA (`idena.navarra.es/ogc/wfs`, 1.053 capas) | `*` | Hecha (20/10) con el SIU. Sin capa de clasificación: solo la figura de plan por municipio e indicadores. Su catastro foral sí sirve (19/10). |
| Galicia | ArcGIS `ideg.xunta.gal/servizos/rest/services/Ordenacion/POL_AD_PlaneamientoUrbanistico/MapServer/29` (IURB_V9) | sí | Clasificación homogeneizada (`SiglaHomog`) solo de los concellos del litoral y de 2011, con planes «no adaptados a la LOUGA». No sirve como fuente vigente. Hecha (20/10) con el SIU. |
| Andalucía | Solo WMS de algunos municipios y documentos escaneados (Consulta del Planeamiento) | | Sin capa regional (sondeo 14/10). |
| Castilla-La Mancha | ArcGIS REST `geoservicios.castillalamancha.es/arcgis/rest/services/Vector/Sistema_Informacion_Urbana/MapServer/1` (SIU) | sí | Hecha (16/10). |
| La Rioja | MapServer `ogc.larioja.org/wfs/request.php` · `urbanismo_planeamiento_urbanistico` | `*` | Hecha (16/10), con la Directriz de suelo no urbanizable. |

Orden propuesto tras el sondeo del 14/10: Castilla-La Mancha, La Rioja y Canarias (hechas el 16/10). País Vasco (hecho el 19/10, con catastro foral). Galicia, Andalucía y Extremadura no publican la clasificación (el 19/10, una búsqueda rápida tampoco encontró nada nuevo; en la Xunta sigue solo IURB_V9, de 2011).

Toda España cubierta (20/10), con huecos donde solo hay SIU: Navarra 83/272, Galicia 276/313, Andalucía 618/785 municipios.

## Ideas para después (no ahora: primero el resto de España)

- **Nota simple del Registro de la Propiedad como servicio adicional** (idea de Javier, 13/10). Unos 9 € por finca en el Colegio de Registradores. La da el Registro, no el Catastro, y trae titular, cargas y descripción de la finca, nunca teléfonos. Se pide con interés legítimo, y la doctrina registral va contra usarla para montar bases de datos de titulares. Encaje posible: un botón que lleve a pedirla o que la gestione para esa finca concreta. No sirve para sacar contactos de dueños o herederos.
- **Normas municipales en PDF** (parcela mínima, alturas, cubierta, materiales) ayuntamiento por ayuntamiento, con la skill de lectura de documentos y citas verificadas.

