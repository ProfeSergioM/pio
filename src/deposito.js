'use strict';

const fs = require('fs');
const path = require('path');

// Dos depositos con la misma boca: uno guarda en un archivo JSON —para trabajar
// en tu maquina y para las pruebas— y el otro en Supabase por HTTP, para el
// sitio desplegado, donde el disco se borra en cada reinicio.
//
// Los dos reciben lo mismo: el estado completo y la lista de lo que cambio. El
// de archivo usa el estado y descarta la lista; el de Supabase hace al reves.
// Asi ninguno obliga al otro a trabajar de mas, y cambiar de uno a otro no
// toca ni una linea del codigo de dominio.

const vacio = () => ({
  usuarios: [], pios: [], sesiones: {}, notificaciones: [], secuencia: 0,
  // Vacío significa "los de fábrica"; el panel de administración lo llena.
  emojis: [],
  corrales: [],
  // Solo los recientes. Un corral activo junta miles y no tiene sentido
  // tenerlos todos en memoria: el chat mira lo de ahora.
  mensajes: [],
});

// Que columna es la llave y como se arma la fila. Lo que de verdad se consulta
// va en columnas propias; el objeto entero viaja en `datos`, con la misma forma
// que tenia en el JSON, para que el dominio no se entere del cambio.
const TABLAS = {
  pio_usuarios: {
    llave: 'usuario',
    fila: (u) => ({ usuario: u.usuario, creado: u.creado, google: u.google || null, datos: u }),
  },
  pio_pios: {
    llave: 'id',
    fila: (p) => ({ id: p.id, autor: p.autor, creado: p.creado, respuesta_a: p.respuestaA || null, datos: p }),
  },
  pio_sesiones: {
    llave: 'token',
    fila: (s) => ({ token: s.token, usuario: s.usuario, creada: s.creada }),
  },
  pio_avisos: {
    llave: 'id',
    fila: (a) => ({ id: a.id, para: a.para, creado: a.creado, datos: a }),
  },
  pio_meta: {
    llave: 'clave',
    fila: (m) => ({ clave: m.clave, valor: m.valor }),
  },
  pio_corrales: {
    llave: 'nombre',
    fila: (c) => ({ nombre: c.nombre, creado: c.creado, dueno: c.dueno, datos: c }),
  },
  pio_mensajes: {
    llave: 'id',
    fila: (m) => ({ id: m.id, corral: m.corral, autor: m.autor, creado: m.creado, datos: m }),
  },
};

class DepositoArchivo {
  constructor(directorio) {
    this.directorio = directorio;
    this.archivo = path.join(directorio, 'pio.json');
  }

  get nombre() {
    return 'archivo';
  }

  async cargar() {
    try {
      return Object.assign(vacio(), JSON.parse(fs.readFileSync(this.archivo, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return vacio();
    }
  }

  // Temporal y rename: si el proceso muere a mitad de la escritura, el archivo
  // bueno sigue entero. Nunca queda un JSON cortado por la mitad.
  async guardar(datos) {
    fs.mkdirSync(this.directorio, { recursive: true });
    const temporal = `${this.archivo}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), 'utf8');
    fs.renameSync(temporal, this.archivo);
  }
}

class DepositoSupabase {
  constructor(ajustes, opciones = {}) {
    this.base = `${String(ajustes.url || '').replace(/\/+$/, '')}/rest/v1`;
    this.clave = ajustes.clave;
    this.enviar = opciones.enviar || ((u, o) => fetch(u, o));
  }

  get nombre() {
    return 'supabase';
  }

  async pedir(camino, opciones = {}) {
    const respuesta = await this.enviar(`${this.base}/${camino}`, {
      method: opciones.metodo || 'GET',
      headers: Object.assign({
        apikey: this.clave,
        Authorization: `Bearer ${this.clave}`,
        'Content-Type': 'application/json',
      }, opciones.cabeceras),
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    });
    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new Error(`Supabase respondió ${respuesta.status}: ${String(detalle).slice(0, 300)}`);
    }
    if (respuesta.status === 204) return null;
    return respuesta.json().catch(() => null);
  }

  async cargar() {
    const [usuarios, pios, sesiones, avisos, meta, corrales, mensajes] = await Promise.all([
      this.pedir('pio_usuarios?select=datos'),
      this.pedir('pio_pios?select=datos'),
      this.pedir('pio_sesiones?select=token,usuario,creada'),
      this.pedir('pio_avisos?select=datos'),
      this.pedir('pio_meta?select=clave,valor'),
      // Opcional a proposito: si la tabla todavia no existe porque falta
      // correr la migracion, el sitio arranca igual y sin corrales, en vez de
      // no arrancar. Una funcion que falta es mejor que un sitio caido.
      this.pedir('pio_corrales?select=datos').catch(() => null),
      // Los ultimos, no todos: se piden ordenados al reves y se dan vuelta.
      this.pedir('pio_mensajes?select=datos&order=creado.desc&limit=500').catch(() => null),
    ]);

    const datos = vacio();
    datos.usuarios = (usuarios || []).map((f) => f.datos).filter(Boolean);
    datos.pios = (pios || []).map((f) => f.datos).filter(Boolean);
    for (const s of sesiones || []) {
      datos.sesiones[s.token] = { usuario: s.usuario, creada: Number(s.creada) };
    }
    datos.notificaciones = (avisos || []).map((f) => f.datos).filter(Boolean);
    const enMeta = (clave) => ((meta || []).find((f) => f.clave === clave) || {}).valor;
    datos.secuencia = Number(enMeta('secuencia')) || 0;
    const guardados = enMeta('emojis');
    datos.emojis = Array.isArray(guardados) ? guardados : [];
    datos.corrales = (corrales || []).map((f) => f.datos).filter(Boolean);
    datos.mensajes = (mensajes || []).map((f) => f.datos).filter(Boolean).reverse();
    return datos;
  }

  // Solo se escribe lo que cambio. Reescribir todo en cada pio, que es lo que
  // hace el deposito de archivo, sobre HTTP seria insostenible.
  async guardar(datos, cambios) {
    if (!cambios || !cambios.length) return;

    // Un mismo registro puede cambiar dos veces en una sola operación —el
    // contador de identificadores, por ejemplo—. Postgres rechaza un upsert
    // que toca la misma fila dos veces en el mismo lote, así que se queda el
    // último valor, que es el bueno.
    const ultimo = new Map();
    for (const c of cambios) ultimo.set(`${c.tabla}\u0000${c.clave}`, c);
    cambios = [...ultimo.values()];

    const altas = new Map();
    const bajas = new Map();
    const renombres = [];
    for (const cambio of cambios) {
      const tabla = TABLAS[cambio.tabla];
      if (!tabla) throw new Error(`Tabla desconocida: ${cambio.tabla}`);
      // Un cambio con `desde` mueve una fila de una llave a otra. Va aparte
      // porque NO se puede hacer con un alta y una baja: entre las dos habria
      // dos filas vivas a la vez, y cualquier indice unico de la tabla —el de
      // google, sin ir mas lejos— rechaza el lote entero.
      if (cambio.desde && cambio.desde !== cambio.clave) {
        renombres.push(cambio);
        continue;
      }
      const donde = cambio.valor === null ? bajas : altas;
      if (!donde.has(cambio.tabla)) donde.set(cambio.tabla, []);
      donde.get(cambio.tabla).push(cambio);
    }

    // Primero los renombres: es un UPDATE sobre la fila que ya existe, asi que
    // en ningun momento hay dos.
    for (const cambio of renombres) {
      const tabla = TABLAS[cambio.tabla];
      await this.pedir(`${cambio.tabla}?${tabla.llave}=eq.${encodeURIComponent(cambio.desde)}`, {
        metodo: 'PATCH',
        cabeceras: { Prefer: 'return=minimal' },
        cuerpo: tabla.fila(cambio.valor),
      });
    }

    for (const [nombre, lista] of altas) {
      await this.pedir(nombre, {
        metodo: 'POST',
        // Un alta que ya existe es una actualizacion, no un choque de llaves.
        cabeceras: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        cuerpo: lista.map((c) => TABLAS[nombre].fila(c.valor)),
      });
    }

    for (const [nombre, lista] of bajas) {
      const llave = TABLAS[nombre].llave;
      const cuales = lista.map((c) => `"${String(c.clave).replace(/"/g, '')}"`).join(',');
      await this.pedir(`${nombre}?${llave}=in.(${encodeURIComponent(cuales)})`, {
        metodo: 'DELETE',
        cabeceras: { Prefer: 'return=minimal' },
      });
    }
  }
}

function crearDeposito(directorio, ajustes = {}, opciones = {}) {
  // Un pedido explicito gana sobre las credenciales que haya configuradas.
  if (ajustes.deposito === 'archivo') return new DepositoArchivo(directorio);
  const sup = ajustes.supabase;
  if (sup && sup.url && sup.clave) return new DepositoSupabase(sup, opciones);
  return new DepositoArchivo(directorio);
}

module.exports = { DepositoArchivo, DepositoSupabase, crearDeposito, TABLAS, vacio };
