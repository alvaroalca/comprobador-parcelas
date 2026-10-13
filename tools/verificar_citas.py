"""Comprueba que cada cita de web/reglamento.json y web/afecciones.json está, literal, dentro
de su artículo en el texto consolidado del BOE de su norma. Sale con código 1 si alguna no aparece.

Uso: python -I tools/verificar_citas.py   (necesita pdftotext en el PATH)
"""
import json, re, subprocess, sys, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / 'tools' / '.cache'
reglamento = json.loads((RAIZ / 'web' / 'reglamento.json').read_text(encoding='utf-8'))
afecciones = json.loads((RAIZ / 'web' / 'afecciones.json').read_text(encoding='utf-8'))
PDFS = {'rucyl': reglamento['fuente']['pdf'], **{k: f['pdf'] for k, f in afecciones['fuentes'].items()}}


def texto_boe(norma='rucyl'):
    CACHE.mkdir(exist_ok=True)
    pdf, txt = CACHE / f'{norma}.pdf', CACHE / f'{norma}.txt'
    if not txt.exists():
        if not pdf.exists():
            urllib.request.urlretrieve(PDFS[norma], pdf)
        subprocess.run(['pdftotext', '-enc', 'UTF-8', str(pdf), str(txt)], check=True)
    texto = txt.read_text(encoding='utf-8')
    # Fuera la paginación del BOE, que corta frases a mitad
    texto = re.sub(r'(?m)^(LEGISLACIÓN CONSOLIDADA|BOLETÍN OFICIAL DEL ESTADO|Página \d+)\s*$', '', texto)
    return re.sub(r'\s+', ' ', texto)


def articulos(texto):
    """Mapa 'número' -> texto del artículo, tomado de su última aparición (la primera es el índice)."""
    trozos = re.split(r'(?=Artículo \d+(?: bis| ter)?\. )', texto)
    mapa = {}
    for t in trozos:
        m = re.match(r'Artículo (\d+(?: bis| ter)?)\. ', t)
        if m:
            mapa[m.group(1)] = t
    return mapa


def main():
    comprobar = [('art57e', reglamento['art57e']['articulo'], reglamento['art57e']['cita']),
                 ('concurrencia', reglamento['concurrencia']['articulo'], reglamento['concurrencia']['cita'])]
    for cod, c in reglamento['categorias'].items():
        comprobar.append((cod, c['articulo'], c['cita']))
        if c.get('cita_rehabilitar'):
            comprobar.append((cod + ' rehabilitar', c['articulo'], c['cita_rehabilitar']))
    sp = reglamento['sin_planeamiento']
    comprobar += [('sin_planeamiento', sp['articulo'], sp['cita']),
                  ('sin_planeamiento rústico', sp['rustico']['articulo'], sp['rustico']['cita']),
                  ('sin_planeamiento urbano', sp['urbano']['articulo'], sp['urbano']['cita'])]

    comprobar = [('rucyl', *c) for c in comprobar]
    for cod, t in afecciones['tipos'].items():
        comprobar.append((t['fuente'], 'afección ' + cod, t['articulo'], t['cita']))

    normas = {n: articulos(texto_boe(n)) for n in {c[0] for c in comprobar}}
    fallos = 0
    for norma, nombre, art, cita in comprobar:
        cuerpo = normas[norma].get(art)
        ok = cuerpo is not None and re.sub(r'\s+', ' ', cita) in cuerpo
        fallos += not ok
        print(f"{'ok   ' if ok else 'FALLA'} {nombre:28} {norma:7} art. {art}")
    print(f'\n{len(comprobar) - fallos}/{len(comprobar)} citas encontradas en su artículo')
    sys.exit(1 if fallos else 0)


if __name__ == '__main__':
    main()
