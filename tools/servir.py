"""Sirve web/ en http://localhost:8765 con la CSP que tendrá la página dentro del portfolio.
Lo que funcione aquí funciona allí; una violación de CSP sale en la consola del navegador.

También hace de proxy, con rutas cerradas, de los servicios que el navegador no puede llamar directo (lo
que en producción hará el Worker del portfolio): el Ministerio manda «Access-Control-Allow-Origin: *, *»
y el navegador rechaza sus respuestas; Murcia y Aragón no mandan cabecera CORS.

Uso: python -I tools/servir.py [puerto]   (8765 por defecto)
"""
import http.server, functools, json, re, sys, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

WEB = Path(__file__).resolve().parent.parent / 'web'

# Política del portfolio (public/_headers) más lo que necesita esta página:
# connect-src para los servicios públicos y worker-src 'self' para el worker de MapLibre.
CSP = '; '.join([
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://ovc.catastro.meh.es https://idecyl.jcyl.es https://idem.comunidad.madrid https://geoservicios.cantabria.es https://sig.gencat.cat https://ideib.caib.es https://terramapas.icv.gva.es https://geoservicios.castillalamancha.es https://ogc.larioja.org https://idecan2.grafcan.es https://geo.araba.eus https://geo.bizkaia.eus https://b5m.gipuzkoa.eus https://www.geo.euskadi.eus https://inspire.navarra.es https://idena.navarra.es https://mapas.fomento.gob.es https://www.cartociudad.es https://www.ign.es",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


# Prefijo local -> servidor, rutas y, por ruta, las formas de petición que deja pasar: tools/proxies.json, que el
# Worker del portfolio lleva copiado (src/parcelas-proxies.json). Hasta el 22/10/2026 pasaba cualquier petición a
# esas rutas: un mapa de 4096 px de toda España, un GetFeatureInfo en HTML servido desde el dominio del portfolio
# o un SLD con imágenes externas que el Ministerio iría a buscar. Con las reglas aquí, la vigilancia falla si la
# página cambia sus peticiones y el Worker las cortaría.
PROXIES = {k: v for k, v in json.loads((Path(__file__).resolve().parent / 'proxies.json').read_text('utf-8')).items()
           if k.startswith('/')}
CUERPO_MAX = 262144  # la geometría de una parcela grande en el filtro CQL ocupa decenas de kB


def destino_de(ruta_completa):
    """(prefijo, ruta) si la ruta es de un proxy; ('', '') si es de un proxy pero no está permitida; None si no."""
    for prefijo, proxy in PROXIES.items():
        if ruta_completa.startswith(prefijo):
            ruta = ruta_completa[len(prefijo) - 1:].split('?')[0]
            return (prefijo, ruta) if ruta in proxy['rutas'] else ('', '')
    return None


def tipo_permitido(formas, query, cuerpo):
    """Tipo de respuesta de la forma con la que casa la petición; None si no casa con ninguna. GeoServer no
    distingue mayúsculas en los nombres: uno repetido es ambiguo y se rechaza, igual que uno de más."""
    pares = parse_qsl(query, keep_blank_values=True)
    if cuerpo is not None:
        if len(cuerpo) > CUERPO_MAX:
            return None
        pares += parse_qsl(cuerpo.decode('utf-8', 'replace'), keep_blank_values=True)
    p = {}
    for k, v in pares:
        if k.lower() in p:
            return None
        p[k.lower()] = v
    for forma in formas:
        reglas = forma['params']
        if p.keys() == reglas.keys() and all(re.fullmatch(patron, p[k]) for k, patron in reglas.items()):
            return forma['tipo']
    return None


class ConCSP(http.server.SimpleHTTPRequestHandler):
    def _proxy(self, prefijo, ruta, cuerpo=None):
        if not prefijo:
            return self.send_error(403, 'Ruta no permitida en el proxy')
        query = urlsplit(self.path).query
        esperado = tipo_permitido(PROXIES[prefijo]['rutas'][ruta], query, cuerpo)
        if not esperado:
            return self.send_error(400, 'Petición no permitida en el proxy')
        destino = PROXIES[prefijo]['servidor'] + ruta + (f'?{query}' if query else '')
        cabeceras = {'Content-Type': 'application/x-www-form-urlencoded'} if cuerpo is not None else {}
        try:
            with urllib.request.urlopen(urllib.request.Request(destino, data=cuerpo, headers=cabeceras), timeout=60) as r:
                estado, tipo, datos = r.status, r.headers.get('Content-Type', ''), r.read()
        except urllib.error.HTTPError as e:
            estado, tipo, datos = e.code, e.headers.get('Content-Type', ''), e.read()
        except Exception as e:
            return self.send_error(502, f'{destino.split("/")[2]} inalcanzable: {e}')
        # Como el Worker: solo se reenvía el tipo esperado (GeoServer da sus errores con 200 y en XML)
        if not tipo.startswith(esperado):
            return self.send_error(502, f'{destino.split("/")[2]} no devolvió {esperado} ({estado})')
        self.send_response(estado)
        self.send_header('Content-Type', esperado)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        proxy = destino_de(self.path)
        if proxy is not None:
            return self._proxy(*proxy)
        return super().do_GET()

    def do_POST(self):
        proxy = destino_de(self.path)
        if proxy is not None:
            return self._proxy(*proxy, self.rfile.read(int(self.headers.get('Content-Length', 0))))
        self.send_error(405)

    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


ConCSP.extensions_map['.js'] = 'text/javascript'
# La página pide unos 30 módulos a la vez y la cola por defecto es de 5: en Windows las conexiones de más se
# rechazaban y la página se quedaba sin cargar (4 de 132 cargas en la batería del 22/10/2026)
http.server.ThreadingHTTPServer.request_queue_size = 128
puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Sirviendo en http://localhost:{puerto} (Ctrl+C para parar)', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', puerto), functools.partial(ConCSP, directory=str(WEB))).serve_forever()
