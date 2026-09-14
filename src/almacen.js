'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const M = require('./modelo');

const VACIO = { usuarios: [], pios: [], sesiones: {}, secuencia: 0 };

// Persistencia en un unico JSON. Alcanza de sobra para el tamano de Pio y
// deja el estado legible a ojo, que es comodo para depurar.
class Almacen {
  constructor(directorio) {
    this.directorio = directorio;
    this.archivo = path.join(directorio, 'pio.json');
    this.datos = JSON.parse(JSON.stringify(VACIO));
    this.cargar();
  }

  cargar() {
    try {
      const crudo = fs.readFileSync(this.archivo, 'utf8');
      const leido = JSON.parse(crudo);
      this.datos = Object.assign(JSON.parse(JSON.stringify(VACIO)), leido);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  guardar() {
    fs.mkdirSync(this.directorio, { recursive: true });
    const temporal = this.archivo + '.tmp';
    fs.writeFileSync(temporal, JSON.stringify(this.datos, null, 2), 'utf8');
    fs.renameSync(temporal, this.archivo);
  }

  proximoId(prefijo) {
    this.datos.secuencia += 1;
    return `${prefijo}${this.datos.secuencia.toString(36)}`;
  }

  // --- usuarios -----------------------------------------------------------

  buscarUsuario(usuario) {
    const u = M.normalizarUsuario(usuario);
    return this.datos.usuarios.find((x) => x.usuario === u) || null;
  }

  crearUsuario(usuario, nombre, clave) {
    const u = M.normalizarUsuario(usuario);
    const error = M.validarUsuario(u) || M.validarNombre(nombre) || M.validarClave(clave);
    if (error) throw new ErrorPio(400, error);
    if (this.buscarUsuario(u)) throw new ErrorPio(409, 'Ese nido ya esta ocupado.');

    const sal = crypto.randomBytes(16).toString('hex');
    const nuevo = {
      id: this.proximoId('u'),
      usuario: u,
      nombre: M.normalizarTexto(nombre),
      bio: '',
      sal,
      hash: hashear(clave, sal),
      creado: Date.now(),
      siguiendo: [],
    };
    this.datos.usuarios.push(nuevo);
    this.guardar();
    return nuevo;
  }

  verificarClave(usuario, clave) {
    const cuenta = this.buscarUsuario(usuario);
    if (!cuenta) return null;
    const intento = Buffer.from(hashear(clave, cuenta.sal), 'hex');
    const guardado = Buffer.from(cuenta.hash, 'hex');
    if (intento.length !== guardado.length) return null;
    if (!crypto.timingSafeEqual(intento, guardado)) return null;
    return cuenta;
  }

  abrirSesion(cuenta) {
    const token = crypto.randomBytes(24).toString('hex');
    this.datos.sesiones[token] = { usuario: cuenta.usuario, creada: Date.now() };
    this.guardar();
    return token;
  }

  cerrarSesion(token) {
    if (token && this.datos.sesiones[token]) {
      delete this.datos.sesiones[token];
      this.guardar();
    }
  }

  porToken(token) {
    const sesion = token ? this.datos.sesiones[token] : null;
    return sesion ? this.buscarUsuario(sesion.usuario) : null;
  }

  actualizarPerfil(cuenta, cambios) {
    if (cambios.nombre !== undefined) {
      const error = M.validarNombre(cambios.nombre);
      if (error) throw new ErrorPio(400, error);
      cuenta.nombre = M.normalizarTexto(cambios.nombre);
    }
    if (cambios.bio !== undefined) {
      const error = M.validarBio(cambios.bio);
      if (error) throw new ErrorPio(400, error);
      cuenta.bio = M.normalizarTexto(cambios.bio);
    }
    this.guardar();
    return cuenta;
  }

  alternarSeguir(cuenta, objetivoUsuario) {
    const objetivo = this.buscarUsuario(objetivoUsuario);
    if (!objetivo) throw new ErrorPio(404, 'No existe ese pollito.');
    if (objetivo.usuario === cuenta.usuario) throw new ErrorPio(400, 'No podes seguirte a vos mismo.');
    const i = cuenta.siguiendo.indexOf(objetivo.usuario);
    if (i === -1) cuenta.siguiendo.push(objetivo.usuario);
    else cuenta.siguiendo.splice(i, 1);
    this.guardar();
    return i === -1;
  }

  seguidores(usuario) {
    const u = M.normalizarUsuario(usuario);
    return this.datos.usuarios.filter((x) => x.siguiendo.includes(u));
  }

  // --- pios ---------------------------------------------------------------

  buscarPio(id) {
    return this.datos.pios.find((p) => p.id === id) || null;
  }

  publicar(cuenta, texto, respuestaA) {
    const error = M.validarPio(texto);
    if (error) throw new ErrorPio(400, error);
    if (respuestaA && !this.buscarPio(respuestaA)) {
      throw new ErrorPio(404, 'Ese pio ya no esta.');
    }
    const limpio = M.normalizarTexto(texto);
    const nuevo = {
      id: this.proximoId('p'),
      autor: cuenta.usuario,
      texto: limpio,
      creado: Date.now(),
      respuestaA: respuestaA || null,
      etiquetas: M.etiquetas(limpio),
      menciones: M.menciones(limpio),
      meGusta: [],
      repios: [],
    };
    this.datos.pios.push(nuevo);
    this.guardar();
    return nuevo;
  }

  borrar(cuenta, id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pio ya no esta.');
    if (pio.autor !== cuenta.usuario) throw new ErrorPio(403, 'Solo podes borrar tus propios pios.');
    // Las respuestas quedan huerfanas a proposito: se muestran sueltas.
    this.datos.pios = this.datos.pios.filter((p) => p.id !== id);
    this.guardar();
    return true;
  }

  alternarMeGusta(cuenta, id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pio ya no esta.');
    const i = pio.meGusta.indexOf(cuenta.usuario);
    if (i === -1) pio.meGusta.push(cuenta.usuario);
    else pio.meGusta.splice(i, 1);
    this.guardar();
    return i === -1;
  }

  alternarRepio(cuenta, id) {
    const pio = this.buscarPio(id);
    if (!pio) throw new ErrorPio(404, 'Ese pio ya no esta.');
    if (pio.autor === cuenta.usuario) throw new ErrorPio(400, 'Repiar lo tuyo es hacer trampa.');
    const i = pio.repios.findIndex((r) => r.usuario === cuenta.usuario);
    if (i === -1) pio.repios.push({ usuario: cuenta.usuario, fecha: Date.now() });
    else pio.repios.splice(i, 1);
    this.guardar();
    return i === -1;
  }

  respuestasDe(id) {
    return this.datos.pios.filter((p) => p.respuestaA === id);
  }

  contarRespuestas(id) {
    return this.respuestasDe(id).length;
  }
}

function hashear(clave, sal) {
  return crypto.scryptSync(String(clave), sal, 32).toString('hex');
}

class ErrorPio extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

module.exports = { Almacen, ErrorPio };
