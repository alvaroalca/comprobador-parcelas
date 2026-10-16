// Vigilancia de los servicios públicos: carga un ejemplo por comunidad en Chrome sin interfaz, con la CSP
// del portfolio (tools/servir.py), y compara veredicto y categoría con lo grabado en tools/vigilancia.json.
// Falla si cambian, si una consulta de afecciones queda incompleta o si hay errores de consola de un
// servicio. Motivo: la Junta de CyL renombró un campo sin avisar (16/10/2026) y su consulta daba 400.
//
// Uso: node tools/vigilar.mjs            (sale con 1 si algo falla)
//      node tools/vigilar.mjs --grabar   (guarda lo que sale ahora como esperado)
// Necesita Node 22 (WebSocket) y Chrome; otra ruta de Chrome con la variable CHROME.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ESPERADO = join(RAIZ, 'tools', 'vigilancia.json');
const BASE = 'http://localhost:8765/';
const PUERTO_CDP = 9333;
const grabar = process.argv.includes('--grabar');
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Errores de consola que no son de un servicio del comprobador: teselas del fondo del IGN
const AJENO = /ign\.es\/wmts|favicon/;

const responde = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };

async function arrancar() {
  const hijos = [];
  if (!(await responde(BASE))) {
    hijos.push(spawn('python', ['-I', join(RAIZ, 'tools', 'servir.py')], { cwd: RAIZ, stdio: 'ignore' }));
    for (let i = 0; i < 40 && !(await responde(BASE)); i++) await pausa(250);
  }
  const chrome = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find(existsSync);
  if (!chrome) throw new Error('No encuentro Chrome: dime dónde con la variable CHROME');
  const perfil = mkdtempSync(join(tmpdir(), 'vigilar-'));
  hijos.push(spawn(chrome, ['--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' }));
  let paginas = [];
  for (let i = 0; i < 40 && !paginas.length; i++) {
    await pausa(250);
    try { paginas = (await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { /* aún arrancando */ }
  }
  if (!paginas.length) throw new Error('Chrome no abrió el puerto de depuración');
  return { hijos, perfil, ws: paginas[0].webSocketDebuggerUrl };
}

async function main() {
  const casos = JSON.parse(readFileSync(ESPERADO, 'utf8'));
  const { hijos, perfil, ws: url } = await arrancar();
  const ws = new WebSocket(url);
  await new Promise((ok) => ws.addEventListener('open', ok));
  let id = 0;
  const pendientes = new Map();
  const errores = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errores.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !AJENO.test(`${m.params.entry.text} ${m.params.entry.url ?? ''}`)) errores.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  const cmd = (method, params = {}) => new Promise((ok) => { const i = ++id; pendientes.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalua = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Page.enable');

  let fallos = 0;
  for (const c of casos) {
    errores.length = 0;
    const t0 = Date.now();
    if (c.caso.startsWith('q:')) {
      await cmd('Page.navigate', { url: `${BASE}?t=${t0}` });
      await pausa(2500);
      await evalua(`(() => { const e = document.querySelector('#q'); e.value = ${JSON.stringify(c.caso.slice(2))}; e.dispatchEvent(new Event('input')); })()`);
      await pausa(1500);
      await evalua(`(() => { document.querySelector('#q').blur(); document.querySelector('#buscador').requestSubmit(); })()`);
    } else await cmd('Page.navigate', { url: `${BASE}?t=${t0}#${c.caso}` });
    let r = null;
    for (let i = 0; i < 160 && !r?.listo; i++) {
      await pausa(250);
      r = await evalua(`(() => {
        const s = document.querySelector('#resultado');
        if (!s || s.hidden || s.querySelector('.cargando')) return null;
        const t = (q) => s.querySelector(q)?.innerText.trim() ?? null;
        return { listo: !s.querySelector('.veredicto') || !!s.querySelector('.afecciones[data-listo]'),
          respuesta: t('.respuesta'), categoria: t('.categoria'), afecciones: t('.afecciones h3') };
      })()`);
    }
    const segundos = ((Date.now() - t0) / 1000).toFixed(1);
    if (grabar) {
      Object.assign(c, { respuesta: r?.respuesta ?? null, categoria: r?.categoria ?? null });
      console.log(`grabado  ${c.nombre}: ${c.respuesta} · ${c.categoria} (${segundos} s)`);
      continue;
    }
    const problemas = [];
    if (!r?.listo) problemas.push('no terminó en 40 s');
    if (r?.respuesta !== c.respuesta) problemas.push(`veredicto «${r?.respuesta}», se esperaba «${c.respuesta}»`);
    if (r?.categoria !== c.categoria) problemas.push(`categoría «${r?.categoria}», se esperaba «${c.categoria}»`);
    if (/incompleta/i.test(r?.afecciones ?? '')) problemas.push('consulta de afecciones incompleta');
    if (errores.length) problemas.push(`consola: ${[...new Set(errores)].join(' | ').slice(0, 300)}`);
    fallos += problemas.length > 0;
    console.log(`${problemas.length ? 'FALLA' : 'ok   '} ${c.comunidad.padEnd(18)} ${c.nombre} (${segundos} s)${problemas.map((p) => `\n        ${p}`).join('')}`);
  }
  ws.close();
  for (const h of hijos) h.kill();
  await pausa(500);
  try { rmSync(perfil, { recursive: true, force: true }); } catch { /* Chrome aún suelta archivos */ }
  if (grabar) writeFileSync(ESPERADO, JSON.stringify(casos, null, 2) + '\n');
  else console.log(`\n${casos.length - fallos}/${casos.length} casos como se esperaba`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
