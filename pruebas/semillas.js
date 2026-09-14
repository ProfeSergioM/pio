'use strict';

// Llena el gallinero con píos de ejemplo para mirar la interfaz con algo adentro.
//   node pruebas/semillas.js            -> carpeta datos/
//   node pruebas/semillas.js --reiniciar -> borra lo que había antes
//
// Todas las cuentas de ejemplo usan la clave "semillas".

const fs = require('fs');
const path = require('path');
const { Almacen } = require('../src/almacen');

const CLAVE = 'semillas';
const carpeta = path.join(__dirname, '..', 'datos');

if (process.argv.includes('--reiniciar')) {
  fs.rmSync(path.join(carpeta, 'pio.json'), { force: true });
}

const almacen = new Almacen(carpeta);

const gente = [
  ['pollito', 'Pollito Primero', 'Recién salido del huevo. Pío mucho, pienso poco.'],
  ['gansa', 'Gansa Mayor', 'Vigilo el corral. No me despierten antes de las 7.'],
  ['pato', 'Pato Criollo', 'Nado, vuelo y camino mal. Tres talentos.'],
  ['gallo', 'Gallo Despertador', 'Trabajo de madrugada. #matutino'],
];

for (const [usuario, nombre, bio] of gente) {
  if (almacen.buscarUsuario(usuario)) continue;
  const cuenta = almacen.crearUsuario(usuario, nombre, CLAVE);
  almacen.actualizarPerfil(cuenta, { bio });
}

const guion = [
  ['pollito', 'Estreno el nido. Cien caracteres alcanzan para casi todo. #pio'],
  ['gansa', 'Cien caracteres es el mejor filtro: si no entra, no era tan importante. #pio'],
  ['gallo', 'Son las 5 de la mañana y ya estoy trabajando. #matutino #quejas'],
  ['pato', 'Probé volar en la lluvia. Diez sobre diez, recomiendo. #granja'],
  ['pollito', 'Pregunta seria: ¿el maíz pisado sigue siendo maíz? #granja'],
  ['gansa', 'Respuesta seria: sí, pero triste.'],
  ['gallo', 'Nadie me avisó que hoy era feriado. Canté igual. #matutino'],
  ['pato', 'Mi biografía tiene 100 caracteres y todavía me sobran. #pio'],
];

const relaciones = [
  ['pollito', ['gansa', 'pato', 'gallo']],
  ['gansa', ['pollito', 'gallo']],
  ['pato', ['pollito', 'gansa']],
  ['gallo', ['gansa']],
];

if (almacen.datos.pios.length === 0) {
  const ahora = Date.now();
  let minutos = guion.length * 37;

  for (const [usuario, texto] of guion) {
    const cuenta = almacen.buscarUsuario(usuario);
    const pio = almacen.publicar(cuenta, texto);
    pio.creado = ahora - minutos * 60 * 1000;
    minutos -= 37;
  }

  const pios = almacen.datos.pios;
  // Un hilo y algo de cariño repartido, para que las vistas no se vean vacías.
  almacen.publicar(almacen.buscarUsuario('gansa'), 'Sigue siendo maíz. Con historia.', pios[4].id);
  almacen.publicar(almacen.buscarUsuario('gallo'), 'A mí me alcanza con 40. @pollito', pios[0].id);

  almacen.alternarMeGusta(almacen.buscarUsuario('gansa'), pios[0].id);
  almacen.alternarMeGusta(almacen.buscarUsuario('pato'), pios[0].id);
  almacen.alternarMeGusta(almacen.buscarUsuario('pollito'), pios[1].id);
  almacen.alternarMeGusta(almacen.buscarUsuario('gallo'), pios[3].id);
  almacen.alternarRepio(almacen.buscarUsuario('pato'), pios[1].id);
  almacen.alternarRepio(almacen.buscarUsuario('pollito'), pios[2].id);
}

for (const [quien, aQuienes] of relaciones) {
  const cuenta = almacen.buscarUsuario(quien);
  for (const otro of aQuienes) {
    if (!cuenta.siguiendo.includes(otro)) almacen.alternarSeguir(cuenta, otro);
  }
}

almacen.guardar();

console.log('Gallinero poblado:');
console.log(`  ${almacen.datos.usuarios.length} cuentas — clave de todas: "${CLAVE}"`);
console.log(`  ${almacen.datos.pios.length} píos`);
console.log(`  entrá como @pollito para ver el nido lleno`);
