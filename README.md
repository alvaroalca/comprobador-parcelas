# Comprobador de parcelas

Buscas una dirección, una referencia catastral o el polígono y la parcela de una finca de cualquier parte de España, o la pinchas en el mapa, y te dice si cabe una casa (también prefabricada), con el artículo de la norma urbanística que lo decide.

**Pruébalo:** [alvaroalcaraz.com/parcelas](https://alvaroalcaraz.com/parcelas/) · **Ficha del proyecto:** [alvaroalcaraz.com/projects/parcelas](https://alvaroalcaraz.com/projects/parcelas/)

Es un cribado previo a la compra con datos públicos, nunca un certificado: la ficha termina siempre mandando a pedir la cédula urbanística al ayuntamiento.

## Cómo funciona

Una página estática, sin backend ni modelo de lenguaje. El navegador llama directamente a los servicios públicos:

1. **Catastro**: del punto a la referencia, los datos y el polígono de la finca (en el País Vasco y Navarra, el catastro foral de cada diputación).
2. **La comunidad**: la provincia elige su adaptador, que pide los recintos de clasificación a su geoportal (GeoServer, ArcGIS, MapServer o solo WMS, según la comunidad).
3. **El navegador** recorta los recintos con la parcela en EPSG:25830 y reparte la superficie entre categorías.
4. **La tabla de su ley** (`web/normas/<comunidad>.json`) da el veredicto de cada categoría con la cita literal del artículo.
5. **Afecciones**: agua del Ministerio en toda España, y montes, vías pecuarias o Red Natura donde la comunidad los publica.

Donde la comunidad no publica su planeamiento por recintos, las clases salen del Sistema de Información Urbana del Ministerio, que no tiene todos los municipios.

## Cobertura

Castilla y León, Comunidad de Madrid, Cantabria, Cataluña, Illes Balears, Comunitat Valenciana, Región de Murcia, Aragón, Castilla-La Mancha, La Rioja, Canarias, Asturias, País Vasco, Extremadura, Andalucía, Navarra, Galicia, Ceuta y Melilla. Los huecos de cada una están en [`docs/STATUS.md`](docs/STATUS.md).

## Estructura

| Ruta | Qué hay |
|---|---|
| `web/` | La página: `main.js` (buscador, mapa y ficha), `servicios.js` (Catastro y CartoCiudad), `veredicto.js`, `afecciones.js`, `geo.js` |
| `web/comunidades/` | Un adaptador por comunidad, registrado en `index.js` |
| `web/normas/` | Una tabla por comunidad con el régimen de cada categoría y sus citas |
| `web/datos/` | Extractos estáticos (planeamiento de Asturias, costa de Baleares, municipios del País Vasco) |
| `tools/` | Servidor local, verificador de citas, vigilancia de servicios y generadores de los extractos |

## Ejecutarlo en local

```bash
python -I tools/servir.py
```

Sirve `web/` en http://localhost:8765 con la misma CSP que tiene en producción, y hace de proxy de los servicios que el navegador no puede llamar directamente (el Ministerio duplica su cabecera CORS; Murcia, Aragón y Extremadura no la mandan). Los proxies solo dejan pasar las peticiones descritas en `tools/proxies.json`.

## Comprobaciones

```bash
python -I -X utf8 tools/verificar_citas.py
```

Busca cada cita de `web/normas/` dentro de su artículo en el texto consolidado del BOE, o en el PDF del boletín autonómico cuando el BOE no la consolida. Una cita que no aparece no se publica. Necesita `pdftotext`.

```bash
node tools/vigilar.mjs
```

Carga un caso por comunidad en Chrome sin interfaz y falla si cambia un veredicto, si una consulta de afecciones queda incompleta o si un servicio da error. Los servicios públicos cambian sin avisar. Necesita Node 22 y Chrome.

## Licencia

El código, [MIT](LICENSE). Lo que la licencia no cubre (librerías de `web/vendor/`, datos de `web/datos/` y citas de las leyes) está en [`NOTICE`](NOTICE).
