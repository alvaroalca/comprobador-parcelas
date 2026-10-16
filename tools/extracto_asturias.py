"""Extracto estático del planeamiento de Asturias para web/datos/asturias/.

El GeoServer del RPGUR (visorrpgur.asturias.es:8090, solo http) tarda 5-15 s por parcela: el no urbanizable
de cada concejo es un recinto de varios MB y el servidor lo lee entero también para pintarlo (GetMap, 5-6 s).
Medido el 16/10/2026: 259 MB de no urbanizable con 6,7 millones de vértices. Aquí se descargan las capas una
vez, se simplifican a 0,5 m (por debajo del desajuste entre el dibujo del plan y el del Catastro), se recortan
en teselas de 2 km y se guardan en enteros de decímetro con deltas. La página pide solo las teselas que toca
la parcela.

Uso: python -I tools/extracto_asturias.py [carpeta con las descargas]   (sin carpeta, descarga)
"""
import json, math, shutil, sys, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'web' / 'datos' / 'asturias'
WFS = 'http://visorrpgur.asturias.es:8090/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=json&srsName=EPSG:25830&typeName='
TESELA = 2000  # m
TOLERANCIA = 0.5  # m


def arregla(t):
    """El servidor manda UTF-8 leído como cp1252 («AGRÃ\x8dCOLA»)."""
    if not isinstance(t, str):
        return t
    try:
        return t.encode('cp1252').decode('utf-8').strip()
    except (UnicodeEncodeError, UnicodeDecodeError):
        return t.strip()


def capa(nombre, carpeta):
    f = carpeta / f'{nombre}.json' if carpeta else None
    if f and f.exists():
        return json.loads(f.read_text(encoding='utf-8'))['features']
    espacio = 'E79_ESTADO_PLANEAMIENTO:' if nombre == 'PG_VIGENTES' else 'E79_ENTIDADES_URBANISTICAS:'
    return json.loads(urllib.request.urlopen(WFS + espacio + nombre, timeout=1800).read())['features']


def _dp(pts):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        a, b = pila.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        largo = math.hypot(dx, dy)
        mx, mi = 0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * (x - ax) - dx * (y - ay)) / largo if largo else math.hypot(x - ax, y - ay)
            if d > mx:
                mx, mi = d, i
        if mx > TOLERANCIA:
            keep[mi] = True
            pila += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplifica(anillo):
    # Cerrado: se parte por el vértice más lejano al primero (si no, Douglas-Peucker lo deja en dos puntos)
    if len(anillo) < 5:
        return anillo
    x0, y0 = anillo[0]
    k = max(range(len(anillo)), key=lambda i: (anillo[i][0] - x0) ** 2 + (anillo[i][1] - y0) ** 2)
    s = _dp(anillo[:k + 1]) + _dp(anillo[k:])[1:]
    return s if len(s) >= 4 else anillo


def recorta(anillo, x0, y0, x1, y1):
    """Sutherland-Hodgman contra la caja de la tesela."""
    def corta(pts, dentro, cruce):
        sal = []
        for i, p in enumerate(pts):
            q = pts[i - 1]
            if dentro(p):
                if not dentro(q):
                    sal.append(cruce(q, p))
                sal.append(p)
            elif dentro(q):
                sal.append(cruce(q, p))
        return sal
    en_x = lambda x: lambda q, p: (x, q[1] + (p[1] - q[1]) * (x - q[0]) / (p[0] - q[0]))
    en_y = lambda y: lambda q, p: (q[0] + (p[0] - q[0]) * (y - q[1]) / (p[1] - q[1]), y)
    pts = anillo[:-1]
    for dentro, cruce in [(lambda p: p[0] >= x0, en_x(x0)), (lambda p: p[0] <= x1, en_x(x1)),
                          (lambda p: p[1] >= y0, en_y(y0)), (lambda p: p[1] <= y1, en_y(y1))]:
        if not pts:
            break
        pts = corta(pts, dentro, cruce)
    return pts + pts[:1] if len(pts) >= 3 else []


def codifica(anillo):
    """Enteros de decímetro, el primer punto absoluto y el resto en diferencias."""
    plano, px, py = [], 0, 0
    for x, y in anillo:
        ix, iy = round(x * 10), round(y * 10)
        if plano and ix == px and iy == py:
            continue
        plano += [ix - px, iy - py]
        px, py = ix, iy
    return plano


def recintos(carpeta):
    """(código, detalle, id_municipio, MultiPolygon) de las cuatro capas."""
    def clase_snu(p):
        return {'SNU-EP': 'SNU-EP', 'SNU-I': 'SNU-I', 'SNU-C': 'SNU-C', 'SNU-IF': 'SNU-IF', 'SNU-NR': 'NR'}.get(p.get('Categoría_Suelo_No_Urbanizable'))
    fuentes = [
        ('n05_SUELOS_NO_URBANIZABLES', clase_snu, lambda p: arregla(p.get('Subcategoría'))),
        ('n06_NUCLEOS_RURALES', lambda p: 'NR', lambda p: arregla(p.get('Nombre_Oficial'))),
        ('n03_SUELOS_URBANOS', lambda p: {'SU-C': 'SU-C', 'SU-NC': 'SU-NC'}.get(p.get('Categoría_de_Suelo_Urbano')), lambda p: arregla(p.get('Nombre'))),
        ('n04_SUELOS_URBANIZABLES', lambda p: {'SUR-S': 'SUR-S', 'SUR-NS': 'SUR-NS', 'SUR-PR': 'SUR-PR'}.get(p.get('Tipo_de_Suelo_Urbanizable')), lambda p: arregla(p.get('Nombre'))),
    ]
    for nombre, codigo, detalle in fuentes:
        for f in capa(nombre, carpeta):
            g, p = f.get('geometry') or {}, f['properties']
            c = codigo(p)
            if not c or 'coordinates' not in g:
                continue
            d = detalle(p)
            yield c, d if d not in ('', '-', None) else None, p.get('id_municipio'), g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]


def main():
    carpeta = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    teselas = {}
    for codigo, detalle, municipio, multi in recintos(carpeta):
        for poligono in multi:
            anillos = [simplifica([tuple(p[:2]) for p in a]) for a in poligono]
            xs = [x for x, _ in anillos[0]]
            ys = [y for _, y in anillos[0]]
            for tx in range(int(min(xs) // TESELA), int(max(xs) // TESELA) + 1):
                for ty in range(int(min(ys) // TESELA), int(max(ys) // TESELA) + 1):
                    caja = (tx * TESELA, ty * TESELA, (tx + 1) * TESELA, (ty + 1) * TESELA)
                    trozos = [r for r in (recorta(a, *caja) for a in anillos) if r]
                    # Sin anillo exterior dentro de la tesela, los huecos no pintan nada
                    if not trozos or not recorta(anillos[0], *caja):
                        continue
                    teselas.setdefault((tx, ty), []).append([codigo, detalle, municipio, [codifica(r) for r in trozos]])
    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    SALIDA.mkdir(parents=True)
    total = 0
    for (tx, ty), rs in teselas.items():
        f = SALIDA / f'{tx}_{ty}.json'
        f.write_text(json.dumps(rs, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        total += f.stat().st_size
    # Plan general vigente de cada concejo (código INE), para la ficha
    planes = {}
    for f in capa('PG_VIGENTES', carpeta):
        q = f['properties']
        if q.get('ESTADO') == 'V' and q.get('id_municipio'):
            planes[str(q['id_municipio'])] = {'nombre': arregla(q.get('NOMBRE')), 'aprobado': (q.get('AD_BOPA') or '')[:10] or None}
    (SALIDA / 'planes.json').write_text(json.dumps(planes, ensure_ascii=False, indent=0), encoding='utf-8')
    print(f'{len(teselas)} teselas de {TESELA} m, {total / 1e6:.1f} MB; la mayor, {max(f.stat().st_size for f in SALIDA.iterdir()) / 1e3:.0f} kB')


if __name__ == '__main__':
    main()
