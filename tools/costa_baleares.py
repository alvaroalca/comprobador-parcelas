"""Genera web/datos/costa-baleares.json: el contorno de las islas Baleares de más de 1 km², simplificado a
10 m y en metros enteros de EPSG:25830, para medir en el navegador la franja de 500 m de costa (APT).

Medido el 14/10/2026: pedirle el contorno de Mallorca a la IDEIB en cada consulta tardaba 3-6 s (simplifica
la geometría en cada petición) y preguntarle si la parcela con su búfer cabe en la isla, 1,4-4,5 s. La costa
no cambia: se baja una vez. Fuente: «Illa 2018 Illes Balears» (BTIB, Govern de les Illes Balears).

Uso: python -I tools/costa_baleares.py
"""
import json, urllib.parse, urllib.request
from pathlib import Path

CAPA = 'https://ideib.caib.es/geoserveis/rest/services/public/GOIB_BTIB_IB/MapServer/27/query'
SALIDA = Path(__file__).resolve().parent.parent / 'web' / 'datos' / 'costa-baleares.json'


def consulta(**q):
    url = CAPA + '?' + urllib.parse.urlencode({'f': 'geojson', 'outSR': '25830', **q})
    return json.loads(urllib.request.urlopen(url, timeout=300).read())['features']


islas = []
for f in consulta(where='SHAPE_Area > 1000000', outFields='OBJECTID_1,ILLA,NOMBRE', returnGeometry='false'):
    p = f['properties']
    [g] = consulta(where=f"OBJECTID_1={p['OBJECTID_1']}", outFields='OBJECTID_1', maxAllowableOffset='10', geometryPrecision='0')
    poligonos = [g['geometry']['coordinates']] if g['geometry']['type'] == 'Polygon' else g['geometry']['coordinates']
    # Solo los anillos exteriores: los huecos de la isla no son mar
    anillos = [[[round(x), round(y)] for x, y in pol[0]] for pol in poligonos]
    xs = [x for a in anillos for x, _ in a]
    ys = [y for a in anillos for _, y in a]
    islas.append({'nombre': p['NOMBRE'], 'isla': p['ILLA'], 'caja': [min(xs), min(ys), max(xs), max(ys)], 'anillos': anillos})
    print(p['NOMBRE'], sum(len(a) for a in anillos), 'vértices')

SALIDA.parent.mkdir(exist_ok=True)
SALIDA.write_text(json.dumps({'fuente': 'Govern de les Illes Balears, BTIB «Illa 2018», simplificado a 10 m', 'islas': islas},
                             separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
print(SALIDA, SALIDA.stat().st_size // 1024, 'kB')
