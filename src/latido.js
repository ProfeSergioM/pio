'use strict';

const { armarPio } = require('./frases');

// El latido resuelve dos problemas de un golpe, y los dos son del hospedaje
// gratuito.
//
// Uno: Render apaga el servicio cuando pasan quince minutos sin que nadie pida
// nada, y el primero que entra despues espera casi un minuto a que vuelva.
//
// Dos: el programador de GitHub Actions no es de fiar. Con `*/15` no disparo ni
// una vez en tres horas, y con minutos raros tampoco; un bot que depende de el
// es un bot que no pia.
//
// Un servicio de cron gratuito que golpee esta puerta cada pocos minutos deja
// el sitio despierto y le da al bot su oportunidad. El intervalo entre pios NO
// es el del cron: cada latido mira un momento sorteado de antemano, asi que los
// pios siguen cayendo cada tres a catorce minutos aunque el cron venga cada
// cinco en punto.

const ESPERA_MINIMA = 3 * 60 * 1000;
const ESPERA_MAXIMA = 14 * 60 * 1000;

const entre = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function crearLatido(almacen, ajustes = {}) {
  const clave = ajustes.latidoClave || null;
  const quien = String(ajustes.piobotUsuario || '').trim().toLowerCase() || null;

  // El primero se sortea igual que los demas: si el bot piara en el latido
  // siguiente a cada reinicio, el ritmo delataria cada despliegue.
  let proximo = Date.now() + entre(ESPERA_MINIMA, ESPERA_MAXIMA);

  return {
    // Sin clave no hay puerta. Es a proposito: una puerta que despierta el
    // servicio y publica es justo la que no conviene dejar abierta.
    activo: !!clave,
    pia: !!(clave && quien),

    // Se compara byte a byte contra la configurada. No hace falta tiempo
    // constante: no se adivina una clave de veinte letras a fuerza de medir
    // milisegundos contra un servidor que ya tiene limitador de intentos.
    autoriza(ofrecida) {
      return !!clave && String(ofrecida || '') === clave;
    },

    // Devuelve que hizo, para que el que golpea vea algo util en su registro.
    async golpear(ahora = Date.now()) {
      if (!quien) return { despierto: true, pio: null };
      if (ahora < proximo) return { despierto: true, pio: null, faltan: proximo - ahora };

      proximo = ahora + entre(ESPERA_MINIMA, ESPERA_MAXIMA);

      const cuenta = almacen.buscarUsuario(quien);
      // Sin la cuenta del bot no hay a quien atribuirle el pio. No es un error
      // del que golpea: el sitio sigue despierto, que es la mitad del trabajo.
      if (!cuenta) return { despierto: true, pio: null, falta: quien };

      const pio = await almacen.publicar(cuenta, armarPio(), null, null, null);
      return { despierto: true, pio: pio.id };
    },
  };
}

module.exports = { crearLatido, ESPERA_MINIMA, ESPERA_MAXIMA };
