'use strict';

// Limitador de ventana deslizante, en memoria y nada mas. No se guarda en el
// JSON a proposito: son marcas que caducan solas, y ensuciar los datos con
// basura que se vence en una hora no vale la pena. Si el servidor se
// reinicia el castigo se levanta, y para algo que corre en tu maquina es el
// intercambio correcto.
class Limite {
  constructor({ cuantos, ventana }) {
    this.cuantos = cuantos;
    this.ventana = ventana;
    this.marcas = new Map();
  }

  // Milisegundos que faltan para poder reintentar, o 0 si puede pasar.
  esperaDe(clave, ahora = Date.now()) {
    const vigentes = this.vigentes(clave, ahora);
    if (vigentes.length < this.cuantos) return 0;
    return this.ventana - (ahora - vigentes[0]);
  }

  anotar(clave, ahora = Date.now()) {
    const vigentes = this.vigentes(clave, ahora);
    vigentes.push(ahora);
    this.marcas.set(clave, vigentes);
    // Sin esto el Map crece para siempre con claves que ya no vuelven.
    if (this.marcas.size > 5000) this.limpiar(ahora);
    return vigentes.length;
  }

  vigentes(clave, ahora = Date.now()) {
    return (this.marcas.get(clave) || []).filter((t) => ahora - t < this.ventana);
  }

  limpiar(ahora = Date.now()) {
    for (const [clave, marcas] of this.marcas) {
      if (marcas.every((t) => ahora - t >= this.ventana)) this.marcas.delete(clave);
    }
  }

  olvidar(clave) {
    this.marcas.delete(clave);
  }
}

// De donde viene el pedido. Sin proxy, el unico dato confiable es el socket:
// X-Forwarded-For la escribe cualquiera que sepa usar curl, y creerle seria
// publicar el modo de saltear el limite.
//
// Detras de un proxy, en cambio, el socket es siempre la IP del proxy y todo
// el mundo caeria en el mismo cubo. La salida no es confiar en la cabecera,
// sino CONTAR SALTOS: cada proxy agrega al final la IP de quien le hablo, asi
// que con N proxies de confianza delante, la IP real esta N posiciones desde
// el final. Lo que el cliente haya inventado queda a la izquierda de eso y no
// se mira nunca.
//
//   sin proxy   (proxies = 0) -> el socket, la cabecera se ignora
//   un proxy    (proxies = 1) -> "cliente"                  -> cliente
//   mintiendo   (proxies = 1) -> "inventada, cliente"        -> cliente
//   dos proxies (proxies = 2) -> "cliente, proxy1"           -> cliente
// Hay plataformas que ponen una cabecera propia con la IP del visitante y la
// sobrescriben siempre, asi que el cliente no puede falsificarla. En Render,
// que tiene Cloudflare delante, es 'cf-connecting-ip'. Cuando se configura una,
// gana: es mas firme que contar saltos, porque no depende de cuantos proxies
// haya ni de que no cambien manana.
//
// Solo se mira si esta configurada a mano. Por defecto no se le cree a ninguna
// cabecera, porque cualquiera puede inventarla.
function deDonde(req, opciones = 0) {
  const conf = (opciones && typeof opciones === 'object') ? opciones : { proxies: opciones };

  if (conf.cabecera) {
    const valor = req.headers && req.headers[String(conf.cabecera).toLowerCase()];
    if (valor) {
      const primera = String(valor).split(',')[0].trim();
      if (primera) return primera.replace(/^::ffff:/, '');
    }
  }

  const saltos = Number(conf.proxies) || 0;
  if (saltos > 0) {
    const cabecera = (req.headers && req.headers['x-forwarded-for']) || '';
    const partes = String(cabecera).split(',').map((x) => x.trim()).filter(Boolean);
    if (partes.length) {
      const cual = partes[Math.max(0, partes.length - saltos)];
      if (cual) return cual.replace(/^::ffff:/, '');
    }
  }
  const ip = (req.socket && req.socket.remoteAddress) || 'desconocido';
  return ip.replace(/^::ffff:/, '');
}

function enEspera(ms) {
  const minutos = Math.ceil(ms / 60000);
  return minutos <= 1 ? 'en un minuto' : `en ${minutos} minutos`;
}

module.exports = { Limite, deDonde, enEspera };
