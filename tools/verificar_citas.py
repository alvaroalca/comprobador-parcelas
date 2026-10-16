"""Comprueba que cada cita de web/normas/*.json está, literal, dentro de su artículo (o disposición)
en el texto consolidado del BOE de su norma (o en el PDF de su diario oficial, si el BOE no la consolida:
Orden 4/2020 en el DOCM). Sale con código 1 si alguna no aparece.

Uso: python -I tools/verificar_citas.py   (necesita pdftotext en el PATH)
"""
import json, re, subprocess, sys, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
NORMAS = RAIZ / 'web' / 'normas'
CACHE = RAIZ / 'tools' / '.cache'
afecciones = json.loads((NORMAS / 'afecciones.json').read_text(encoding='utf-8'))
# Una tabla por comunidad (cyl.json, madrid.json...): su clave es el nombre del archivo
tablas = {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in sorted(NORMAS.glob('*.json')) if p.stem != 'afecciones'}
# Una tabla puede citar más de una norma (Baleares: directrices, suelo rústico y urbanismo): las demás van
# en `otras_fuentes` y cada cita que sale de ellas lo dice con `norma`
PDFS = {
    **{k: t['fuente']['pdf'] for k, t in tablas.items()},
    **{k: f['pdf'] for t in tablas.values() for k, f in t.get('otras_fuentes', {}).items()},
    **{k: f['pdf'] for k, f in afecciones['fuentes'].items()},
}
FUENTES = {**{k: t['fuente'] for k, t in tablas.items()}, **{k: f for t in tablas.values() for k, f in t.get('otras_fuentes', {}).items()}}
# Cabecera de página propia de un PDF que no sale del BOE (la Directriz de La Rioja): `cabecera` en su fuente
CABECERAS = {k: f['cabecera'] for k, f in FUENTES.items() if f.get('cabecera')}
# Norma dentro de un código electrónico del BOE, que junta varias (Asturias): `seccion` es su «§ N», que
# encabeza cada una de sus páginas
SECCIONES = {k: f['seccion'] for k, f in FUENTES.items() if f.get('seccion')}
# La caché de antes se llamaba rucyl
ALIAS = {'cyl': 'rucyl'}


def texto_boe(norma):
    CACHE.mkdir(exist_ok=True)
    nombre = ALIAS.get(norma, norma)
    pdf, txt = CACHE / f'{nombre}.pdf', CACHE / f'{nombre}.txt'
    if not txt.exists():
        if not pdf.exists():
            # El DOCM no sirve el PDF sin user-agent de navegador
            peticion = urllib.request.Request(PDFS[norma], headers={'User-Agent': 'Mozilla/5.0'})
            pdf.write_bytes(urllib.request.urlopen(peticion).read())
        subprocess.run(['pdftotext', '-enc', 'UTF-8', str(pdf), str(txt)], check=True)
    texto = txt.read_text(encoding='utf-8')
    if norma in SECCIONES:
        marca = re.compile(rf'(?m)^{re.escape(SECCIONES[norma])} ')
        texto = '\f'.join(pagina for pagina in texto.split('\f') if marca.search(pagina))
        # Cabecera y pie de página del código: «CÓDIGO DE URBANISMO…», «§ 2 Título» y «– 102 –»
        texto = re.sub(r'(?m)^\f?(CÓDIGO [A-ZÁÉÍÓÚÑ ,]+|§ \d+ .*|– \d+ –)\s*$', '', texto)
    # Fuera la paginación del BOE, que corta frases a mitad (la cabecera puede llevar delante el salto de página)
    texto = re.sub(r'(?m)^\f?(LEGISLACIÓN CONSOLIDADA|BOLETÍN OFICIAL DEL ESTADO|Página \d+)\s*$', '', texto)
    # Y la de un diario autonómico sin texto consolidado en el BOE (DOCM: «AÑO XXXIX Núm. 15», fecha y página)
    if re.match(r'\f?AÑO [IVXLC]+ Núm\. \d+', texto):
        texto = re.sub(r'(?m)^\f?AÑO [IVXLC]+ Núm\. \d+ ?', '', texto)
        texto = re.sub(r'(?m)^(\d{1,2} de \w+ de \d{4}|\d{3,5})\s*$', '', texto)
    if norma in CABECERAS:
        texto = re.sub(CABECERAS[norma], ' ', texto)
    return re.sub(r'\s+', ' ', texto)


# La disposición puede no llevar ordinal cuando es la única de su clase (DOCM: «Disposición adicional.»)
CABECERA = r'Artículo (\d+(?: bis| ter)?)\. |(Disposición (?:adicional|transitoria|final|derogatoria)(?: \w+)?)\. |(ANEXO [IVX]+)\b'


def articulos(texto):
    """Mapa 'número' (o 'disposición transitoria primera', o 'anexo i') -> texto, tomado de su última
    aparición (la primera es el índice)."""
    trozos = re.split(r'(?=Artículo \d+(?: bis| ter)?\. |Disposición (?:adicional|transitoria|final|derogatoria)(?: \w+)?\. |ANEXO [IVX]+\b)', texto)
    mapa = {}
    for t in trozos:
        m = re.match(CABECERA, t)
        if m:
            mapa[(m.group(1) or m.group(2) or m.group(3)).lower()] = t
    return mapa


def citas_de_tabla(clave, t):
    sueltas = [('vinculada', t.get('vinculada')), ('concurrencia', t.get('concurrencia'))]
    if t.get('sin_planeamiento'):
        sp = t['sin_planeamiento']
        sueltas += [('sin_planeamiento', sp), ('sin_planeamiento rústico', sp['rustico']), ('sin_planeamiento urbano', sp['urbano'])]
    salida = [(c.get('norma', clave), nombre, c['articulo'], c['cita']) for nombre, c in sueltas if c]
    for cod, c in t['categorias'].items():
        if c.get('cita'):
            salida.append((c.get('norma', clave), cod, c['articulo'], c['cita']))
        if c.get('cita_rehabilitar'):
            # `norma_rehabilitar: null`: la rehabilitación sale de la norma principal aunque la categoría cite otra
            norma_rehab = c['norma_rehabilitar'] if 'norma_rehabilitar' in c else c.get('norma')
            salida.append((norma_rehab or clave, cod + ' rehabilitar',
                           c.get('articulo_rehabilitar', c['articulo']), c['cita_rehabilitar']))
        for i, extra in enumerate(c.get('mas', [])):
            salida.append((extra.get('norma', clave), f'{cod} más {i + 1}', extra['articulo'], extra['cita']))
        for i, extra in enumerate(c.get('mas_rehabilitar', [])):
            salida.append((extra.get('norma', clave), f'{cod} rehabilitar {i + 2}', extra['articulo'], extra['cita']))
    return salida


def main():
    comprobar = [c for clave, t in tablas.items() for c in citas_de_tabla(clave, t)]
    for cod, t in afecciones['tipos'].items():
        comprobar.append((t['fuente'], 'afección ' + cod, t['articulo'], t['cita']))

    normas = {n: articulos(texto_boe(n)) for n in {c[0] for c in comprobar}}
    fallos = 0
    for norma, nombre, art, cita in comprobar:
        cuerpo = normas[norma].get(art.lower())
        ok = cuerpo is not None and re.sub(r'\s+', ' ', cita) in cuerpo
        fallos += not ok
        print(f"{'ok   ' if ok else 'FALLA'} {nombre:28} {norma:7} {art}")
    print(f'\n{len(comprobar) - fallos}/{len(comprobar)} citas encontradas en su artículo')
    sys.exit(1 if fallos else 0)


if __name__ == '__main__':
    main()
