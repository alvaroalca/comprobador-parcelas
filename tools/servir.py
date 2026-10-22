"""Sirve web/ en http://localhost:8765 con la CSP que tendrá la página dentro del portfolio.
Lo que funcione aquí funciona allí; una violación de CSP sale en la consola del navegador.

También hace de proxy, con rutas cerradas, de los servicios que el navegador no puede llamar directo (lo
que en producción hará el Worker del portfolio): el Ministerio manda «Access-Control-Allow-Origin: *, *»
y el navegador rechaza sus respuestas; Murcia y Aragón no mandan cabecera CORS.

Uso: python -I tools/servir.py [puerto]   (8765 por defecto)
"""
import http.server, functools, re, sys, urllib.request, urllib.error
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


# Prefijo local -> (servidor, rutas permitidas en él). Lo mismo tiene que estar en el Worker del portfolio.
PROXIES = {
    '/api/miteco/': ('https://gis.miteco.gob.es', ('/geoserver/agua/wfs', '/geoserver/agua/wms')),
    '/api/carm/': ('https://mapas-gis-inter.carm.es', ('/geoserver/SIT_USU_PLA_URB_CARM/wfs', '/geoserver/SIT_USU_PLA_URB_CARM/wms')),
    '/api/aragon/': ('https://idearagon.aragon.es', ('/geoserver/SIUa/wfs', '/geoserver/SIUa/wms', '/geoserver/VISOR2D/wfs')),
    '/api/ideex/': ('https://mapas.ideex.es', ('/CICTEX/urbanismo',)),
}


# Del Ministerio solo pasa lo que pide afecciones.js, parámetro a parámetro: las mismas reglas que el Worker del
# portfolio (src/index.js, MITECO_REGLAS). Antes pasaba cualquier cosa: un mapa de 4096 px de toda España, un
# GetFeatureInfo en HTML servido desde el dominio del portfolio o un SLD con imágenes externas que el Ministerio
# iría a buscar (22/10/2026). Están aquí también para que la vigilancia falle si la página cambia sus peticiones.
NUM = r'-?\d+(?:\.\d+)?'
CAPAS_MITECO = {'agua:ZI_Laminas_ZFP', 'agua:Zi_laminas_q500', 'agua:DPH_Estimado', 'agua:DPH_Deslindado'}


def relleno(capa):
    return ('<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">'
            f'<NamedLayer><Name>{capa}</Name><UserStyle><FeatureTypeStyle><Rule><PolygonSymbolizer><Fill>'
            '<CssParameter name="fill">#000000</CssParameter></Fill></PolygonSymbolizer></Rule></FeatureTypeStyle>'
            '</UserStyle></NamedLayer></StyledLayerDescriptor>')


def lado(v, p):
    return bool(re.fullmatch(r'\d{1,4}', v)) and 1 <= int(v) <= 1024


REGLAS_MITECO = {
    '/geoserver/agua/wfs': ('application/json', {
        'service': lambda v, p: v == 'WFS', 'version': lambda v, p: v == '2.0.0', 'request': lambda v, p: v == 'GetFeature',
        'typenames': lambda v, p: v in CAPAS_MITECO, 'outputformat': lambda v, p: v == 'application/json',
        'propertyname': lambda v, p: v == 'rio,tipo_zona',
        'cql_filter': lambda v, p: bool(re.fullmatch(rf"BBOX\(shape,{NUM}(?:,{NUM}){{3}},'EPSG:4326'\)", v)),
    }),
    '/geoserver/agua/wms': ('image/png', {
        'service': lambda v, p: v == 'WMS', 'version': lambda v, p: v == '1.1.1', 'request': lambda v, p: v == 'GetMap',
        'layers': lambda v, p: v in CAPAS_MITECO, 'styles': lambda v, p: v == '',
        'featureid': lambda v, p: bool(re.fullmatch(r'[\w.]+(?:,[\w.]+)*', v)), 'srs': lambda v, p: v == 'EPSG:25830',
        'bbox': lambda v, p: bool(re.fullmatch(rf'{NUM}(?:,{NUM}){{3}}', v)), 'width': lado, 'height': lado,
        'format': lambda v, p: v == 'image/png', 'transparent': lambda v, p: v == 'true',
        'sld_body': lambda v, p: v == relleno(p.get('layers')),
    }),
}


def tipo_miteco(destino, cuerpo):
    """Tipo de respuesta esperado si la petición al Ministerio está permitida; None si no. Los nombres no
    distinguen mayúsculas en GeoServer: uno repetido es ambiguo y se rechaza, igual que uno fuera de la lista."""
    partes = urlsplit(destino)
    tipo, reglas = REGLAS_MITECO[partes.path]
    p = {}
    pares = parse_qsl(partes.query, keep_blank_values=True)
    if cuerpo is not None:
        if len(cuerpo) > 16384:
            return None
        pares += parse_qsl(cuerpo.decode('utf-8', 'replace'), keep_blank_values=True)
    for k, v in pares:
        k = k.lower()
        if k in p or k not in reglas:
            return None
        p[k] = v
    return tipo if all(k in p and ok(p[k], p) for k, ok in reglas.items()) else None


def destino_de(ruta_completa):
    for prefijo, (servidor, permitidas) in PROXIES.items():
        if ruta_completa.startswith(prefijo):
            resto = ruta_completa[len(prefijo) - 1:]
            return servidor + resto if resto.split('?')[0] in permitidas else ''
    return None


class ConCSP(http.server.SimpleHTTPRequestHandler):
    def _proxy(self, destino, cuerpo=None):
        if not destino:
            return self.send_error(403, 'Ruta no permitida en el proxy')
        esperado = None
        if destino.startswith('https://gis.miteco.gob.es/'):
            esperado = tipo_miteco(destino, cuerpo)
            if not esperado:
                return self.send_error(400, 'Petición no permitida en el proxy')
        cabeceras = {'Content-Type': self.headers.get('Content-Type', '')} if cuerpo is not None else {}
        try:
            with urllib.request.urlopen(urllib.request.Request(destino, data=cuerpo, headers=cabeceras), timeout=60) as r:
                estado, tipo, datos = r.status, r.headers.get('Content-Type', ''), r.read()
        except urllib.error.HTTPError as e:
            estado, tipo, datos = e.code, e.headers.get('Content-Type', ''), e.read()
        except Exception as e:
            return self.send_error(502, f'{destino.split("/")[2]} inalcanzable: {e}')
        # Como el Worker: del Ministerio solo se reenvía el tipo esperado (sus errores llegan con 200 y en XML)
        if esperado and not tipo.startswith(esperado):
            return self.send_error(502, f'El Ministerio no devolvió {esperado} ({estado})')
        self.send_response(estado)
        self.send_header('Content-Type', esperado or tipo)
        if esperado:
            self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_GET(self):
        destino = destino_de(self.path)
        if destino is not None:
            return self._proxy(destino)
        return super().do_GET()

    def do_POST(self):
        destino = destino_de(self.path)
        if destino is not None:
            return self._proxy(destino, self.rfile.read(int(self.headers.get('Content-Length', 0))))
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
