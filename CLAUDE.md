# CLAUDE.md — Comprobador de parcelas

Página del portfolio (alvaroalcaraz.com) estilo buscador: buscas una dirección o pinchas una finca de Castilla y León y dice si cabe una casa (también prefabricada), con el artículo del Reglamento de Urbanismo que lo decide. Cribado previo a la compra, nunca certificado: siempre termina en «pide la cédula urbanística». Estado y pendientes en `docs/STATUS.md`.

## Arquitectura

- **Estática, sin backend ni LLM.** `web/` son archivos planos; el navegador llama directo a los servicios públicos (todos con `Access-Control-Allow-Origin: *`, comprobado el 13/10/2026: Catastro, Junta, Ministerio, CartoCiudad, IGN).
- **Cadena**: punto → Catastro `Consulta_RCCOOR` (referencia) → `Consulta_DNPRC` (datos) + INSPIRE `GetParcel` (polígono) → WFS de la Junta `plau_cyl_categorias_desagrupa` (categorías en la caja) + `plau_cyl_instrumentos_ambito` (plan) → recorte en el navegador → `reglamento.json` → veredicto.
- **Búsqueda**: CartoCiudad `candidates` + `find`. Resuelve también referencias catastrales.
- **Mapa**: MapLibre 4.7.1 **build CSP** en `web/vendor/` (worker servido desde el propio origen), fondo IGN Base / PNOA, WMS de la Junta y de Catastro.
- `polygon-clipping@0.15.7` (UMD) también en `web/vendor/`. A las librerías copiadas se les quita el comentario `sourceMappingURL` para que DevTools no pida los `.map` y salten violaciones de CSP.
- **Afecciones**: `web/afecciones.js` en paralelo con las categorías; agua del Ministerio, montes y vías pecuarias de la Junta.

## Gotchas medidos

- **Ejes**: Catastro en EPSG:4326 devuelve **lat/lon**; la Junta en GeoJSON, **lon/lat**.
- **Las áreas se miden en EPSG:25830**: la Junta da los grados con 4 decimales (~10 m), inservible para repartir una parcela entre categorías. En metros da 0,1 mm. El polígono se pide dos veces a Catastro: 4326 para dibujar, 25830 para medir. 25830 vale también en el huso 29 (oeste de CyL): 0,15 % de deformación de área.
- **El código de municipio del Catastro no es el del INE** (Tremedal de Tormes: 37332 frente a 37329). No cruzar por código: cruzar por geometría. La provincia sí coincide.
- **El punto de portal de CartoCiudad cae en la acera.** Para portales se usa `Consulta_RCCOOR_Distancia` con 15 m de tolerancia. Un clic en el mapa exige caer dentro de la finca.
- La capa de instrumentos llama `geometry` a su geometría; la de categorías, `geom`.
- La Junta avisa de que su capa no tiene validez jurídica: se cita como fuente y la página lo dice.
- **Afecciones del agua (Ministerio, `gis.miteco.gob.es/geoserver/agua`)**: sus capas están en EPSG:4258 y **no reproyectan el `SRID` de un filtro CQL** (con `SRID=25830` siempre sale vacío; hay que preguntar en grados, x = lon). Sus recintos son ríos enteros: `INTERSECTS` exacto tarda 3-9 s por capa y en paralelo el servidor corta conexiones (`ECONNRESET`); no admite varias capas en una petición (lo toma por *join*, 500). Por eso: `BBOX` sin geometría para candidatos (~0,1 s), y por candidato un `GetMap` WMS con `featureid` y relleno sólido (`SLD_BODY`) recortado a la parcela, contando píxeles dentro del polígono (~0,2 s). Contrastado con shapely: 42 % frente a 41,3 % exacto. Todo en serie y con un reintento.
- **El Ministerio manda `Access-Control-Allow-Origin: *, *` (duplicada) y el navegador rechaza todas sus respuestas.** curl no se queja: el CORS se comprueba en un navegador, no con curl. Se le llama por un proxy del mismo origen, `/api/miteco/geoserver/agua/{wfs,wms}` (solo esas dos rutas): `tools/servir.py` en local y el Worker del portfolio en producción.
- **Zona inundable legal = avenida de 500 años** (RDPH art. 14). La T100 es un subconjunto y no se consulta.
- **Montes de utilidad pública y vías pecuarias** (Junta, `montes`): nativos en 25830, ahí el `SRID` sí funciona. Las vías pecuarias son ejes con `ancho_m`: se traen a menos de 40 m y se compara la distancia con la mitad de la anchura.
- **Red Natura 2000 sin fuente válida**: el Ministerio solo la publica como WMS de visualización y la capa de la Junta (`vegetacion_cyl_rednatura2000_vw`) son hábitats dentro de los espacios, no su perímetro.
- **Si una consulta de afecciones falla, la ficha lo dice.** Nunca se presenta como «sin afecciones» algo que no se pudo consultar.

## Reglas

- **`reglamento.json` y `afecciones.json` son la única fuente de lo que afirma la ficha.** Cada `cita` debe estar literal dentro de su artículo del texto consolidado del BOE de su norma (Reglamento de Urbanismo de CyL, RDPH, Ley de Vías Pecuarias, Ley de Montes). Tras tocarlos: `python -I -X utf8 tools/verificar_citas.py` (necesita `pdftotext`). Cita que no aparece = no se publica.
- **CSP del portfolio**: nada inline (ni `style=""` en HTML; `element.style` desde JS sí vale). Probar siempre con `python -I tools/servir.py` (http://localhost:8765), que sirve con la CSP que tendrá en el portfolio. Al integrar, añadir a `public/_headers` del portfolio los `connect-src` y `worker-src 'self'` que lista `tools/servir.py`, y al Worker (`src/index.js`) la ruta `/api/miteco/` con las mismas dos rutas permitidas que el proxy de `servir.py`.
- Paleta: hoja impresa del MTN25 del IGN (papel, sepia de curvas, azul de hidrografía, verde de vegetación, rojo de carreteras). IBM Plex Sans + Mono.
