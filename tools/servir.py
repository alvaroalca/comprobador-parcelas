"""Sirve web/ en http://localhost:8765 con la CSP que tendrá la página dentro del portfolio.
Lo que funcione aquí funciona allí; una violación de CSP sale en la consola del navegador.

También hace de proxy de /api/miteco/ (lo que en producción hará el Worker del portfolio): el
Ministerio manda «Access-Control-Allow-Origin: *, *» y el navegador rechaza sus respuestas.

Uso: python -I tools/servir.py [puerto]   (8765 por defecto)
"""
import http.server, functools, sys, urllib.request, urllib.error
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / 'web'

# Política del portfolio (public/_headers) más lo que necesita esta página:
# connect-src para los servicios públicos y worker-src 'self' para el worker de MapLibre.
CSP = '; '.join([
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://ovc.catastro.meh.es https://idecyl.jcyl.es https://idem.comunidad.madrid https://geoservicios.cantabria.es https://sig.gencat.cat https://www.cartociudad.es https://www.ign.es",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


PROXY = '/api/miteco/'
PERMITIDAS = ('/api/miteco/geoserver/agua/wfs', '/api/miteco/geoserver/agua/wms')


class ConCSP(http.server.SimpleHTTPRequestHandler):
    def _proxy(self, cuerpo=None):
        ruta = self.path.split('?')[0]
        if ruta not in PERMITIDAS:
            return self.send_error(403, 'Ruta no permitida en el proxy')
        destino = 'https://gis.miteco.gob.es' + self.path[len(PROXY) - 1:]
        cabeceras = {'Content-Type': self.headers.get('Content-Type', '')} if cuerpo is not None else {}
        try:
            with urllib.request.urlopen(urllib.request.Request(destino, data=cuerpo, headers=cabeceras), timeout=60) as r:
                estado, tipo, datos = r.status, r.headers.get('Content-Type', ''), r.read()
        except urllib.error.HTTPError as e:
            estado, tipo, datos = e.code, e.headers.get('Content-Type', ''), e.read()
        except Exception as e:
            return self.send_error(502, f'Ministerio inalcanzable: {e}')
        self.send_response(estado)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        if self.path.startswith(PROXY):
            return self._proxy()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith(PROXY):
            return self._proxy(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        self.send_error(405)

    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


ConCSP.extensions_map['.js'] = 'text/javascript'
puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f'Sirviendo en http://localhost:{puerto} (Ctrl+C para parar)', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', puerto), functools.partial(ConCSP, directory=str(WEB))).serve_forever()
