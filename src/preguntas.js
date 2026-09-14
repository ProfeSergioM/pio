'use strict';

// La pregunta del dia: una sola, la misma para todo el sitio, que cambia a
// medianoche. Arma una conversacion compartida sin tener que seguir a nadie,
// que es justo lo que le falta a un sitio con poca gente.
//
// Cuarenta, y el orden se salta de a diecisiete: asi dos dias seguidos no
// caen en preguntas vecinas de la lista, que suelen parecerse. Diecisiete y
// cuarenta no tienen divisores en comun, de modo que pasan todas antes de
// repetir alguna.

const PREGUNTAS = [
  ['¿Qué desayunaste hoy?', 'What did you have for breakfast today?'],
  ['Una canción para empezar la semana.', 'A song to start the week.'],
  ['¿Qué aprendiste hace poco?', 'What did you learn recently?'],
  ['El mejor consejo que te han dado.', 'The best advice anyone gave you.'],
  ['¿Qué te hizo reír esta semana?', 'What made you laugh this week?'],
  ['Un lugar al que siempre vuelves.', 'A place you always go back to.'],
  ['¿Qué estás leyendo?', 'What are you reading?'],
  ['Una comida que te recuerda a tu infancia.', 'A food that reminds you of childhood.'],
  ['¿Qué harías con un día libre de sorpresa?', 'What would you do with a surprise day off?'],
  ['Una palabra que te guste cómo suena.', 'A word you like the sound of.'],
  ['¿Qué pequeño lujo te das?', 'What small luxury do you allow yourself?'],
  ['La película que podrías ver mil veces.', 'The movie you could watch a thousand times.'],
  ['¿Qué te gustaría saber hacer?', 'What would you like to know how to do?'],
  ['Un olor que te pone de buen humor.', 'A smell that puts you in a good mood.'],
  ['¿Cuál fue tu primer trabajo?', 'What was your first job?'],
  ['Algo que antes odiabas y ahora te gusta.', 'Something you used to hate and now like.'],
  ['¿Qué ruido te calma?', 'What sound calms you down?'],
  ['Un invento que falta en el mundo.', 'An invention the world is missing.'],
  ['¿Qué hiciste hoy que valió la pena?', 'What did you do today that was worth it?'],
  ['Tu fruta favorita, y defiéndela.', 'Your favorite fruit, and defend it.'],
  ['¿Qué te quita el sueño, para bien?', 'What keeps you up at night, in a good way?'],
  ['Un libro que regalarías.', 'A book you would give as a gift.'],
  ['¿Mar o montaña? ¿Por qué?', 'Sea or mountains? Why?'],
  ['La última foto que sacaste, sin mostrarla.', 'The last photo you took, without showing it.'],
  ['¿Qué te enseñó un animal?', 'What did an animal teach you?'],
  ['Un plan perfecto para un domingo.', 'A perfect plan for a Sunday.'],
  ['¿Qué opinión tuya es impopular?', 'What opinion of yours is unpopular?'],
  ['Un talento inútil que tengas.', 'A useless talent you have.'],
  ['¿A quién le darías las gracias hoy?', 'Who would you thank today?'],
  ['El mejor pan que has probado.', 'The best bread you have ever tried.'],
  ['¿Qué juego de niñez extrañas?', 'What childhood game do you miss?'],
  ['Una costumbre que te ordena el día.', 'A habit that keeps your day in order.'],
  ['¿Qué preguntarías a tu yo de hace diez años?', 'What would you ask yourself from ten years ago?'],
  ['Un ruido de tu casa que reconocerías en cualquier parte.', 'A sound from your home you would recognize anywhere.'],
  ['¿Qué te da nostalgia?', 'What makes you nostalgic?'],
  ['Una cosa simple que te hizo feliz hoy.', 'A simple thing that made you happy today.'],
  ['¿Qué parte de tu ciudad nadie conoce?', 'What part of your city does nobody know?'],
  ['Un apodo que hayas tenido.', 'A nickname you have had.'],
  ['¿Qué te gustaría que inventaran para la cocina?', 'What would you like invented for the kitchen?'],
  ['Describe tu día en tres palabras.', 'Describe your day in three words.'],
];

const SALTO = 17;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// La fecha de hoy donde vive el sitio, no donde corre el servidor: Render
// corre en UTC, y la pregunta cambiaria a las nueve de la noche.
function hoy(zona, ahora = Date.now()) {
  const formato = (tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ahora));
  try {
    return formato(zona || 'UTC');
  } catch (err) {
    // Una zona mal escrita en la configuracion no tira abajo la plaza.
    return formato('UTC');
  }
}

function esFecha(texto) {
  const m = FECHA.exec(String(texto || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1
    && d.getUTCDate() === Number(m[3]);
}

function preguntaDe(fecha) {
  if (!esFecha(fecha)) return null;
  const [a, m, d] = fecha.split('-').map(Number);
  const dia = Math.floor(Date.UTC(a, m - 1, d) / 86400000);
  const i = ((dia * SALTO) % PREGUNTAS.length + PREGUNTAS.length) % PREGUNTAS.length;
  const [es, en] = PREGUNTAS[i];
  return { fecha, es, en };
}

module.exports = { PREGUNTAS, hoy, esFecha, preguntaDe };
