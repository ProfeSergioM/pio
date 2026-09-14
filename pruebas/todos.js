'use strict';

// Batería de pruebas de Pío. Levanta un servidor real en un puerto libre,
// con datos en una carpeta temporal, y le pega por HTTP como lo haría el cliente.
//   node pruebas/todos.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearServidor } = require('../servidor');
const M = require('../src/modelo');

let pasadas = 0;
const fallas = [];

function probar(nombre, condicion, detalle) {
  if (condicion) {
    pasadas += 1;
    console.log(`  ok   ${nombre}`);
  } else {
    fallas.push(nombre);
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

function grupo(titulo) {
  console.log(`\n${titulo}`);
}

async function main() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'pio-pruebas-'));
  const servidor = crearServidor({ datos: carpeta });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function pedir(ruta, { metodo = 'GET', cuerpo, token } = {}) {
    const respuesta = await fetch(`${base}/api${ruta}`, {
      method: metodo,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: `Bearer ${token}` } : {}
      ),
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { estado: respuesta.status, datos: await respuesta.json().catch(() => ({})) };
  }

  // --- modelo puro --------------------------------------------------------

  grupo('Modelo: el límite de 100');
  probar('100 caracteres pasan', M.validarPio('a'.repeat(100)) === null);
  probar('101 caracteres no pasan', M.validarPio('a'.repeat(101)) !== null);
  probar('el error dice por cuánto te pasaste', /por 3\b/.test(M.validarPio('a'.repeat(103)) || ''));
  probar('un emoji cuenta como 1 carácter', M.largo('🐤') === 1, `contó ${M.largo('🐤')}`);
  probar('100 emojis entran justo', M.validarPio('🐤'.repeat(100)) === null);
  probar('101 emojis no entran', M.validarPio('🐤'.repeat(101)) !== null);
  probar('un pío vacío no vale', M.validarPio('   ') !== null);
  probar('usuario con mayúsculas se normaliza', M.normalizarUsuario('@PolLito') === 'pollito');
  probar('usuario de 2 letras se rechaza', M.validarUsuario('ab') !== null);
  probar('usuario con guion se rechaza', M.validarUsuario('po-llito') !== null);
  probar('etiquetas se extraen sin repetir', JSON.stringify(M.etiquetas('#Pio #pio #granja')) === '["pio","granja"]');
  probar('menciones se extraen en minúscula', JSON.stringify(M.menciones('hola @Pollito')) === '["pollito"]');

  // --- cuentas ------------------------------------------------------------

  grupo('Cuentas');
  const alta = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'Pollito', nombre: 'Pollito Uno', clave: 'semillas' },
  });
  probar('registro devuelve 201 y token', alta.estado === 201 && !!alta.datos.token, `estado ${alta.estado}`);
  probar('el usuario queda en minúsculas', alta.datos.yo.usuario === 'pollito');
  const tokenA = alta.datos.token;

  const repetido = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'pollito', nombre: 'Otro', clave: 'semillas' },
  });
  probar('usuario repetido devuelve 409', repetido.estado === 409, `estado ${repetido.estado}`);

  const claveCorta = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'gallina', nombre: 'Gallina', clave: '123' },
  });
  probar('clave corta se rechaza', claveCorta.estado === 400);

  const malLogin = await pedir('/sesion', { metodo: 'POST', cuerpo: { usuario: 'pollito', clave: 'mala' } });
  probar('clave equivocada devuelve 401', malLogin.estado === 401);

  const login = await pedir('/sesion', { metodo: 'POST', cuerpo: { usuario: '@Pollito', clave: 'semillas' } });
  probar('se puede entrar con @ y mayúsculas', login.estado === 200 && !!login.datos.token);

  const alta2 = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'gansa', nombre: 'Gansa', clave: 'semillas' },
  });
  const tokenB = alta2.datos.token;

  const sinToken = await pedir('/pios', { metodo: 'POST', cuerpo: { texto: 'hola' } });
  probar('publicar sin sesión devuelve 401', sinToken.estado === 401);

  // --- publicar -----------------------------------------------------------

  grupo('Píos');
  const largo = await pedir('/pios', { metodo: 'POST', token: tokenA, cuerpo: { texto: 'a'.repeat(101) } });
  probar('el servidor rechaza 101 caracteres', largo.estado === 400, `estado ${largo.estado}`);

  const uno = await pedir('/pios', {
    metodo: 'POST',
    token: tokenA,
    cuerpo: { texto: 'Primer pío del gallinero #pio' },
  });
  probar('publicar devuelve 201', uno.estado === 201, `estado ${uno.estado}`);
  probar('el pío arranca sin me gusta', uno.datos.pio.meGusta === 0);
  const pioA = uno.datos.pio.id;

  await pedir('/pios', { metodo: 'POST', token: tokenB, cuerpo: { texto: 'Yo también pío #pio #granja' } });

  const plaza = await pedir('/pios?tipo=plaza');
  probar('la plaza muestra los dos píos', plaza.datos.pios.length === 2, `vio ${plaza.datos.pios.length}`);
  probar('la plaza ordena del más nuevo al más viejo',
    plaza.datos.pios[0].creado >= plaza.datos.pios[1].creado);

  // --- nido y seguir ------------------------------------------------------

  grupo('Nido y seguidores');
  const nidoSolo = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('el nido propio solo trae lo propio', nidoSolo.datos.pios.length === 1);

  await pedir('/usuarios/gansa/seguir', { metodo: 'POST', token: tokenA });
  const nidoConGansa = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('al seguir aparecen sus píos en el nido', nidoConGansa.datos.pios.length === 2);

  const perfilGansa = await pedir('/usuarios/gansa', { token: tokenA });
  probar('el perfil informa que la sigo', perfilGansa.datos.perfil.loSigo === true);
  probar('el perfil cuenta un seguidor', perfilGansa.datos.perfil.seguidores === 1);

  const autoSeguir = await pedir('/usuarios/pollito/seguir', { metodo: 'POST', token: tokenA });
  probar('no te podés seguir a vos mismo', autoSeguir.estado === 400);

  await pedir('/usuarios/gansa/seguir', { metodo: 'POST', token: tokenA });
  const nidoSinGansa = await pedir('/pios?tipo=nido', { token: tokenA });
  probar('dejar de seguir saca sus píos del nido', nidoSinGansa.datos.pios.length === 1);
  await pedir('/usuarios/gansa/seguir', { metodo: 'POST', token: tokenA });

  // --- me gusta y repío ---------------------------------------------------

  grupo('Me gusta y repíos');
  const gusto = await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  probar('me gusta suma 1', gusto.datos.pio.meGusta === 1 && gusto.datos.pio.yoMeGusta === true);
  const noGusto = await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });
  probar('volver a tocar lo saca', noGusto.datos.pio.meGusta === 0 && noGusto.datos.pio.yoMeGusta === false);
  await pedir(`/pios/${pioA}/megusta`, { metodo: 'POST', token: tokenB });

  const meGustaDeB = await pedir('/pios?tipo=megusta&usuario=gansa', { token: tokenB });
  probar('la solapa "me gusta" lista lo marcado', meGustaDeB.datos.pios.length === 1);

  const repioPropio = await pedir(`/pios/${pioA}/repio`, { metodo: 'POST', token: tokenA });
  probar('repiar lo propio se rechaza', repioPropio.estado === 400);

  const repio = await pedir(`/pios/${pioA}/repio`, { metodo: 'POST', token: tokenB });
  probar('repiar ajeno suma 1', repio.datos.pio.repios === 1 && repio.datos.pio.yoRepio === true);

  const alta3 = await pedir('/registro', {
    metodo: 'POST',
    cuerpo: { usuario: 'pato', nombre: 'Pato', clave: 'semillas' },
  });
  const tokenC = alta3.datos.token;
  await pedir('/usuarios/gansa/seguir', { metodo: 'POST', token: tokenC });
  const nidoPato = await pedir('/pios?tipo=nido', { token: tokenC });
  const repiado = nidoPato.datos.pios.find((p) => p.repiadoPor === 'gansa');
  probar('el repío llega al nido de quien sigue a la repiadora', !!repiado);
  probar('el repío conserva al autor original', repiado && repiado.autor.usuario === 'pollito');

  // --- respuestas e hilos -------------------------------------------------

  grupo('Respuestas');
  const respuesta = await pedir('/pios', {
    metodo: 'POST',
    token: tokenB,
    cuerpo: { texto: 'Qué lindo pío', respuestaA: pioA },
  });
  probar('responder devuelve 201', respuesta.estado === 201);

  const hilo = await pedir(`/pios/${pioA}/hilo`, { token: tokenA });
  probar('el hilo trae la respuesta', hilo.datos.despues.length === 1);
  probar('el pío raíz cuenta 1 respuesta', hilo.datos.pio.respuestas === 1);
  probar('el hilo de la respuesta trae el pío anterior',
    (await pedir(`/pios/${respuesta.datos.pio.id}/hilo`)).datos.antes.length === 1);

  const plazaConRespuesta = await pedir('/pios?tipo=plaza');
  probar('las respuestas no ensucian la plaza', plazaConRespuesta.datos.pios.length === 2,
    `vio ${plazaConRespuesta.datos.pios.length}`);

  const respuestaFantasma = await pedir('/pios', {
    metodo: 'POST',
    token: tokenB,
    cuerpo: { texto: 'a un pío que no existe', respuestaA: 'pzzz' },
  });
  probar('responder a un pío inexistente devuelve 404', respuestaFantasma.estado === 404);

  // --- borrar -------------------------------------------------------------

  grupo('Borrar');
  const borrarAjeno = await pedir(`/pios/${pioA}`, { metodo: 'DELETE', token: tokenB });
  probar('no podés borrar un pío ajeno', borrarAjeno.estado === 403);

  const propio = await pedir('/pios', { metodo: 'POST', token: tokenC, cuerpo: { texto: 'me arrepiento' } });
  const borrado = await pedir(`/pios/${propio.datos.pio.id}`, { metodo: 'DELETE', token: tokenC });
  probar('borrar el propio funciona', borrado.estado === 200);
  const trasBorrar = await pedir(`/pios/${propio.datos.pio.id}/hilo`);
  probar('el pío borrado ya no está', trasBorrar.estado === 404);

  // --- descubrir ----------------------------------------------------------

  grupo('Buscar y tendencias');
  const busqueda = await pedir('/buscar?q=gallinero');
  probar('la búsqueda encuentra por texto', busqueda.datos.pios.length === 1);
  const busquedaGente = await pedir('/buscar?q=gan');
  probar('la búsqueda encuentra pollitos', busquedaGente.datos.usuarios.some((u) => u.usuario === 'gansa'));

  const tendencias = await pedir('/tendencias');
  probar('#pio lidera las tendencias', tendencias.datos.tendencias[0].etiqueta === 'pio'
    && tendencias.datos.tendencias[0].total === 2,
    JSON.stringify(tendencias.datos.tendencias[0]));

  const rutaRara = await pedir('/gallinas');
  probar('una ruta desconocida devuelve 404', rutaRara.estado === 404);

  // --- persistencia -------------------------------------------------------

  grupo('Persistencia');
  await new Promise((listo) => servidor.close(listo));
  const revivido = crearServidor({ datos: carpeta });
  await new Promise((listo) => revivido.listen(0, '127.0.0.1', listo));
  const base2 = `http://127.0.0.1:${revivido.address().port}`;

  const plazaTrasReinicio = await fetch(`${base2}/api/pios?tipo=plaza`).then((r) => r.json());
  probar('los píos sobreviven al reinicio', plazaTrasReinicio.pios.length === 2);

  const sesionViva = await fetch(`${base2}/api/yo`, { headers: { Authorization: `Bearer ${tokenA}` } });
  probar('la sesión sobrevive al reinicio', sesionViva.status === 200);

  const portada = await fetch(`${base2}/`);
  probar('la portada se sirve', portada.status === 200
    && (await portada.text()).includes('Pío'));

  const escapeRuta = await fetch(`${base2}/../servidor.js`);
  probar('no se puede salir de publico/', !(await escapeRuta.text()).includes('crearServidor'));

  await new Promise((listo) => revivido.close(listo));
  fs.rmSync(carpeta, { recursive: true, force: true });

  // --- resumen ------------------------------------------------------------

  console.log(`\n${'─'.repeat(46)}`);
  if (fallas.length) {
    console.log(`${pasadas} bien, ${fallas.length} mal:`);
    for (const f of fallas) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log(`🐤 ${pasadas} pruebas, todas en verde.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
