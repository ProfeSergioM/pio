# 🐤 Pío

Una red social donde cada mensaje entra en **100 caracteres**. Ni uno más.
Si no entra, no era tan importante.

Servidor en Node **sin una sola dependencia** y cliente en HTML/CSS/JS a mano.
Todo se guarda en `datos/pio.json`, en tu propia máquina.

## Arrancar

```bash
npm start
```

Abre <http://localhost:3100> y crea tu pollito. El sitio arranca vacío: no hay
cuentas ni píos de ejemplo, y `datos/pio.json` se crea solo con el primer
registro.

Para volver a empezar de cero, borra `datos/pio.json`. El puerto se cambia con
`PUERTO=4000 npm start` (también acepta `PORT`).

## Pruebas

```bash
npm test
```

Levanta un servidor real en un puerto libre, con datos en una carpeta
temporal, y le pega por HTTP igual que el cliente. 822 comprobaciones: el
límite de 100, cuentas, nido, repíos, hilos, borrado, avisos, búsqueda,
persistencia, altas masivas, nombres reservados, respuestas en cascada, píos bomba, escrito a mano, horario de silencio, buzón, cadenas, exportación y RSS, roles y ajustes del sitio,
adjuntos, depósitos, subida de imágenes, búsqueda de GIF y verificación de
tokens de Google. Ninguna sale a internet: los servicios externos se inyectan
falseados.
No hay framework ni dependencias: si algo falla, la salida te dice qué y el
proceso termina en 1.

## Ajustes

Todo opcional: sin nada de esto Pío arranca igual.

Hay dos formas de configurarlo, y se pueden mezclar: variables de entorno, o
un archivo `datos/config.json`. **La variable de entorno siempre gana.** El
archivo es la comodidad para trabajar en tu máquina —  `datos/` ya está fuera
del control de versiones, así que las claves no se escapan a un commit por
descuido— y las variables son para el despliegue.

```json
{
  "imgbbClave": "...",
  "giphyClave": "...",
  "cloudinary": { "nube": "...", "clave": "...", "secreto": "..." }
}
```

| Variable | Clave en el archivo | Para qué |
|---|---|---|
| `PUERTO` | — | El puerto. Por defecto 3100 (también acepta `PORT`). |
| `PIO_ALTAS_POR_HORA` | `altas` | Cuentas nuevas por IP y por hora. Por defecto 5. |
| `PIO_SUBIDAS_POR_HORA` | `subidas` | Imágenes por IP y por hora. Por defecto 20. |
| `PIO_GOOGLE_CLIENT_ID` | `googleClienteId` | Enciende el acceso con Google. |
| `PIO_IMGBB_KEY` | `imgbbClave` | Enciende la subida de imágenes vía ImgBB. |
| `PIO_CLOUDINARY_NUBE` | `cloudinary.nube` | Enciende la subida vía Cloudinary. |
| `PIO_CLOUDINARY_CLAVE` | `cloudinary.clave` | Su API key. |
| `PIO_CLOUDINARY_SECRETO` | `cloudinary.secreto` | Su API secret. Nunca sale del servidor. |
| `PIO_IMAGENES_PROVEEDOR` | `proveedor` | Cuál gana si están los dos: `imgbb` o `cloudinary`. |
| `PIO_GIPHY_KEY` | `giphyClave` | Enciende el buscador de GIF. |
| `PIO_ACORTADOR` | `acortador` | `no` apaga el acortador de direcciones. |
| `SUPABASE_URL` | `supabase.url` | Guarda en Supabase en vez de en un archivo. |
| `SUPABASE_SERVICE_KEY` | `supabase.clave` | La `service_role`, nunca la `anon`. |
| `PIO_DEPOSITO` | `deposito` | `archivo` fuerza el JSON local aunque haya credenciales. |
| `PIO_PROXIES` | `proxies` | Cuántos proxies de confianza hay delante. En tu máquina 0, en Render 1. |
| `PIO_OWNER` | `owner` | El owner del sitio: nombra administradores y toca las configuraciones. |
| `PIO_ADMINS` | `admins` | Administradores fijos, separados por coma. Sin owner, hacen de owner. |
| `PIO_LATIDO_CLAVE` | `latidoClave` | Abre `/api/latido`. Sin ella esa puerta no existe. |
| `PIOBOT_USUARIO` | `piobotUsuario` | A nombre de quién pía el latido. |

Sin ninguna de estas, Pío arranca igual: cada función que necesita una clave
queda apagada y lo dice.

## Qué hay adentro

| Archivo | Qué hace |
|---|---|
| [`src/modelo.js`](src/modelo.js) | Reglas puras: el límite, validaciones, etiquetas, menciones |
| [`src/almacen.js`](src/almacen.js) | Cuentas, píos y persistencia en un único JSON |
| [`src/api.js`](src/api.js) | Rutas HTTP, líneas de tiempo y serialización |
| [`src/limite.js`](src/limite.js) | Ventana deslizante contra las altas en masa |
| [`src/google.js`](src/google.js) | Verificación del ID token de Google, a mano |
| [`src/ajustes.js`](src/ajustes.js) | Claves y opciones, de entorno o de archivo |
| [`src/imagenes.js`](src/imagenes.js) | Subida de imágenes: ImgBB o Cloudinary |
| [`src/gifs.js`](src/gifs.js) | Búsqueda de GIF en Giphy |
| [`src/enlaces.js`](src/enlaces.js) | Acortar direcciones, con proveedor de repuesto |
| [`src/emojis.js`](src/emojis.js) | Los emojis propios del sitio |
| [`src/medallas.js`](src/medallas.js) | Medallitas por cantidad de seguidores |
| [`src/recuperacion.js`](src/recuperacion.js) | Códigos para volver a entrar si se olvida la clave |
| [`src/corrales.js`](src/corrales.js) | Reglas de los corrales, los subtemas |
| [`src/mensajes.js`](src/mensajes.js) | Reglas del chat de cada corral |
| [`src/deposito.js`](src/deposito.js) | Dónde vive todo: archivo JSON o Supabase |
| [`src/frases.js`](src/frases.js) | De qué habla el piobot |
| [`src/latido.js`](src/latido.js) | La puerta que mantiene el sitio despierto y hace piar al bot |
| [`src/compartir.js`](src/compartir.js) | La página de `/p/<id>`, con la vista previa para las redes |
| [`src/logo.js`](src/logo.js) | El logo, en un solo lugar: de acá salen el SVG de la página y los PNG |
| [`src/portada.js`](src/portada.js) | Los PNG: la imagen para compartir y los íconos de la app |
| [`supabase.sql`](supabase.sql) | Las tablas, listas para pegar y ejecutar |
| [`supabase-corrales.sql`](supabase-corrales.sql) | Las tablas de corrales y del chat |
| [`servidor.js`](servidor.js) | Servidor: API + archivos estáticos |
| [`publico/`](publico) | El cliente (una sola página, ruteo por `#`) |
| [`publico/idiomas.js`](publico/idiomas.js) | Español e inglés, en un solo archivo |
| [`src/reservados.js`](src/reservados.js) | Nombres de usuario que nadie puede tomar |
| [`src/descanso.js`](src/descanso.js) | La granja duerme: horario de silencio y tope de píos |
| [`src/buzon.js`](src/buzon.js) | Las reglas del buzón de preguntas |
| [`src/cadenas.js`](src/cadenas.js) | Las reglas de las cadenas: turnos y tope |
| [`src/rss.js`](src/rss.js) | Los RSS de cada perfil y cada corral |
| [`src/sitio.js`](src/sitio.js) | Roles y configuraciones del owner: funciones, límites, registro, anuncio |
| [`pruebas/`](pruebas) | La batería de pruebas |

## Decisiones que vale la pena conocer

**La plaza termina.** No hay desplazamiento infinito: donde empieza lo que ya
viste aparece "Hasta aquí lo nuevo", y si no hay nada nuevo, "Estás al día".
Más atrás se sigue con un botón. Lo visto se recuerda en el navegador.

**Una pregunta del día**, la misma para todos, arriba de la plaza. Son cuarenta
([`src/preguntas.js`](src/preguntas.js)) y cambian a medianoche de
`PIO_ZONA_HORARIA` (por defecto `America/Santiago`). La fecha de la respuesta la
pone el servidor.

**Los me gusta no tienen marcador público.** El número sólo lo ve quien escribió
el pío; los demás ven si ellos dieron el suyo.

**💯 Cien justos.** Un pío de exactamente cien caracteres lleva la marca. Es un
guiño, no un puntaje.

**✍️ Escrito a mano.** Un pío tecleado, sin pegar texto, lleva el sello. Mientras
se escribe, el ✍️ está junto al anillo y se apaga en cuanto se pega o se arrastra
texto, o cuando entra de golpe un bloque de más de 25 caracteres, que es como
escriben los teclados que redactan solos. Pegar sólo una dirección no lo apaga:
un enlace no son palabras de otro. Si se borra todo, se empieza de cero. En la
plaza, "Sólo a mano" (`#/plaza?mano=1`) deja ver únicamente esos píos, y el
filtro `mano=1` sirve en cualquier línea de la API.

Como el 💯, es un guiño y no un control: lo avisa el cliente y desde la consola
se engaña en un segundo. No hay forma honesta de comprobarlo en el servidor, y
fingir que sí sería peor que decirlo.

**🌙 La granja duerme.** Arriba de Avisos, plegado, hay dos ajustes de cada
cuenta ([`src/descanso.js`](src/descanso.js)):

- **Silencio de noche**, encendido de fábrica de 23:00 a 07:00. En ese horario
  los avisos siguen llegando a la campana, pero el teléfono no suena. No se
  guardan para la mañana: a las siete nadie quiere diez notificaciones de golpe,
  y la campana ya las tiene. Se cuenta en la hora de quien duerme: al entrar, la
  app anota una sola vez la zona horaria del navegador, y quien no la tiene usa
  la del sitio. Sirve también para una siesta, de 14 a 16.
- **Tope suave de píos por día**: 5, 10, 20 o ninguno, que es lo de fábrica.
  Al llegar, el diálogo de piar dice "Hoy ya piaste 5 veces, tu tope. ¿Seguimos
  mañana?" y el botón pasa a "Piar igual". No se prohíbe nada; el servidor ni
  siquiera lo mira. Lo que se deshace mientras es huevo no cuenta.

**📮 El buzón.** Cada perfil puede abrir uno para recibir preguntas de
cualquier pollito con sesión ([`src/buzon.js`](src/buzon.js)). Quien lo abre
elige si acepta anónimas. Las preguntas son privadas: sólo las ve quien las
recibe, en `#/buzon`, y si responde sale un pío con la pregunta arriba. Lo
anónimo es anónimo en todos lados: en el buzón, en el aviso, en la notificación
del teléfono y en el pío publicado. Quien preguntó recibe aviso de la respuesta.

Cómo se modera:

- **Viene cerrado.** Nadie recibe preguntas sin haberlo pedido.
- **Tres preguntas por persona, por buzón, por día.** Borrar o responder no
  devuelve el cupo.
- **Desde cada pregunta se borra o se bloquea.** El bloqueo es sólo para el
  buzón, por los mismos plazos que el del perfil, y se lleva todas las
  preguntas pendientes de esa persona. Va aparte del bloqueo del perfil a
  propósito: si fuera el mismo, el perfil de quien preguntó anónimo diría
  "bloqueado hasta…" y lo delataría.
- **A quien está bloqueado o silenciado no se le avisa.** Su pregunta responde
  lo mismo que cualquier otra y se tira callada.
- **Quien administra ve el autor real.** En la solapa Buzones del panel, las
  pendientes de todo el sitio con quién las hizo, y en Píos, quién hizo la
  anónima que se respondió. El anonimato es entre quien pregunta y quien
  responde, no un escudo para acosar.

Las preguntas viven dentro de la cuenta de quien las recibe, así que no hace
falta otra tabla en Supabase. Deshacer la respuesta mientras es huevo devuelve
la pregunta al buzón; cambiar de nombre lleva consigo las preguntas y el cupo,
y borrar una cuenta se lleva sus preguntas pendientes.

**⛓️ La cadena.** Un cuento escrito entre varios. Al piar, el botón ⛓️ convierte
el pío en el primer eslabón, y cualquiera suma el siguiente, de cien caracteres
como todo ([`src/cadenas.js`](src/cadenas.js)). Se lee entera en
`#/cadena/<id>`, numerada de arriba a abajo.

- **Nadie pone dos seguidos,** ni sigue desde un eslabón que todavía es huevo:
  sería contestarle a algo que nadie más ve.
- **A los veinte se termina sola.** Quien la empezó puede terminarla antes. Si
  el vigésimo se deshace, la cadena se reabre.
- **Los eslabones no van sueltos por las líneas:** una cadena de veinte llenaría
  la plaza. Va el primero, con cuántos lleva y a quién le toca, y sube cada vez
  que alguien suma. En el perfil de cada uno sí están los suyos.
- **Sólo se borra el último eslabón.** Sacar uno del medio rompe el cuento que
  escribieron los demás.
- Quien la empezó y quien puso el eslabón anterior reciben aviso. Una cadena
  bomba explota entera, y una de corral vive en su corral.

**🧺 Tu nido es tuyo.** Lo que uno escribe no queda encerrado en Pío.

- **Mis datos**, en el perfil propio, descarga un JSON con todo lo de la cuenta:
  los píos —con sus bombas, cadenas y respuestas del buzón—, a quién sigue, sus
  corrales y ajustes, lo que marcó con me gusta o repió, las preguntas
  pendientes y las que hizo, y sus mensajes de chat. No van la clave, su sal, el
  código de recuperación, las sesiones ni las suscripciones del teléfono; de
  los me gusta recibidos va el número, no quién, y de una pregunta anónima no va
  quién la hizo.
- **RSS** en cada perfil (`/rss/u/<usuario>`) y cada corral (`/rss/c/<nombre>`),
  para seguirlos desde cualquier lector sin cuenta. Los últimos cincuenta, con
  enlaces a la página para compartir de cada pío. No van huevos, cuentas
  ocultas ni píos bomba: una bomba explota en un día, pero un lector la
  guardaría para siempre.

**Bloquear es suave y por tiempo.** Desde el perfil de alguien se elige una hora,
un día, una semana o un mes. Mientras dura, sus píos se ven borrosos —con un
"Ver igual" por si se quiere leer uno— y sus avisos no llegan. No se le avisa a
quien fue bloqueado, y vence solo. Silenciar, en cambio, esconde del todo y
no vence.

**Todo pío nace como huevo.** Durante 10 segundos sólo lo ve quien lo escribió,
con un "Deshacer" que lo borra y devuelve el texto al borrador para corregirlo.
Nadie más lo ve: ni en las líneas, ni en la búsqueda, ni en las tendencias, y
los avisos de menciones y respuestas esperan a que nazca. Es la pausa que frena
lo que se escribe en caliente sin necesidad de un botón de editar. La espera se
cambia con `PIO_INCUBACION_SEGUNDOS`; las pruebas la ponen en cero.

**💣 El pío bomba explota a las 24 horas.** Al piar se arma con el botón 💣, y
la tarjeta lleva la cuenta regresiva. Cuando llega a cero se va de todos lados
y de la base: líneas, perfil de quien la repió, búsqueda, tendencias, la
dirección para compartir y los avisos que provocó. No hay papelera.

Tres decisiones:

- **La conversación explota entera.** Lo que se contesta a una bomba es bomba,
  lo pida o no, y explota a la misma hora. Si no, las respuestas quedarían
  citando justo lo que se quiso borrar. Una bomba que contesta a un pío común
  no lo arrastra; si contesta a otra bomba, se queda con la mecha más corta.
- **La barrida no recorre los píos en cada petición.** Se guarda la hora de la
  próxima explosión, y hasta entonces cada pedido sólo compara dos números.
  Al arrancar se barre enseguida, por lo que haya explotado con el sitio
  apagado.
- **Una bomba vencida no se ve aunque la barrida no haya pasado.** La
  visibilidad mira la hora, no si el pío sigue en memoria. La página para
  compartir, que no pasa por la API, lo comprueba por su cuenta.

La mecha se guarda con el pío (`explota`), así que un reinicio no la apaga. Se
cambia con `PIO_MECHA_SEGUNDOS`.


**El límite se cuenta en puntos de código, no en unidades UTF-16.** Un emoji
vale 1, no 2: `[...texto].length`. Entran 100 🐤 justos, y 101 no. La misma
cuenta la hace el cliente (para el anillo) y el servidor (para decidir).

**El servidor nunca confía en el cliente.** El anillo rojo es cortesía; quien
rechaza los 101 caracteres es `validarPio` en el servidor, y hay una prueba
que le pega por HTTP para comprobarlo.

**Las sesiones vencen a los dos meses**, contados desde que se abrieron. Es
absoluto y no deslizante a propósito: renovarlo con cada uso obligaría a
escribir en la base en cada petición. Las vencidas se barren de la base, y esa
barrida recorre la lista una vez por hora como mucho — hacerlo en cada pedido
sería trabajo tirado mil veces por minuto.

**Las claves van con `scrypt` + sal por cuenta** y se comparan con
`timingSafeEqual`. Las sesiones son un token al portador guardado junto a los
datos, así sobreviven a un reinicio. Es suficiente para algo que corre en tu
máquina; para exponerlo a internet haría falta HTTPS y expiración de tokens.
El límite de altas ya está, más abajo.

**El repío no crea un pío nuevo.** Se guarda como `{usuario, fecha}` dentro
del pío original, y esa fecha es la que ordena la línea de tiempo. Por eso un
repío puede aparecer arriba de todo sin duplicar el texto ni perder al autor.

**Las respuestas no ensucian la plaza.** Sólo se ven dentro del hilo o en el
perfil de quien las escribió.

**Los avisos son derivados, no hechos históricos.** Si alguien saca el me
gusta, deja de seguirte o borra el pío donde te mencionó, el aviso se va con
la acción. Nadie queda mirando un "le gustó tu pío" de algo que ya nadie
marcó. Un pío que te responde *y* te menciona avisa una sola vez: gana la
respuesta, que dice más. Y mencionarse a uno mismo no avisa nada.

## Altas masivas

Cinco cuentas nuevas por hora y por IP, con una ventana deslizante en memoria.
Se cuentan las altas que salieron bien, **no los intentos**: un pedido mal
formado no crea nada, así que no gasta cupo. Entrar con Google pasa por el
mismo límite, para que no sea la puerta de atrás.

El dato de quién pide sale de `req.socket` y de ningún otro lado.
`X-Forwarded-For` la escribe cualquiera con `curl`; si Pío le creyera,
estaría publicando el modo de saltearse el límite. El día que esto viva detrás
de un proxy de verdad, ahí habrá que decidir en cuál confiar.

No se guarda en el JSON: son marcas que se vencen solas, y ensuciar los datos
con basura que caduca en una hora no vale la pena. Si reiniciás el servidor, el
castigo se levanta.

## Entrar con Google

Apagado por defecto. Para encenderlo hace falta un client ID, que se saca en
Google Cloud Console → APIs y servicios → Credenciales → ID de cliente de
OAuth, tipo "Aplicación web", con `http://localhost:3100` en los orígenes
autorizados de JavaScript. No hace falta client secret.

```bash
PIO_GOOGLE_CLIENT_ID=tu-id.apps.googleusercontent.com npm start
```

El servidor verifica el ID token a mano, con lo que Node ya trae: firma RS256
contra las claves públicas de Google, emisor, destinatario, vencimiento y
correo verificado. **El algoritmo lo fija el servidor, no el token**: aceptar
el `alg` que viene adentro sería como preguntarle al sobre si hay que revisar
el sello.

La cuenta se ata al `sub` de Google, no al correo. Un correo se cambia, se
libera y se lo puede quedar otro; el `sub` no. El usuario sale del correo y si
está tomado se numera. A una cuenta de Google no se entra con clave, porque no
tiene ninguna.

Vale decirlo: con esto Pío deja de correr sólo en tu máquina. El navegador
carga el script de Google y Google ve a cualquiera que abra la portada, entre o
no. Si eso no te cierra, dejalo apagado y no se carga nada de afuera.

## Español e inglés

El selector está arriba en la portada y en el menú lateral (🌐). Lo elegido se
guarda en el navegador; si nunca elegiste, se mira el idioma del navegador.

**La jerga no se traduce.** Pío, piar, nido, plaza, repío y pollito son la
marca, y quedan igual en los dos idiomas: "Create nido", "3 píos", "repiado by
@pato". Se traduce todo lo que las rodea. Es lo que hizo Twitter con "tweet",
que nunca se tradujo en ningún idioma.

Los errores del servidor viajan con una clave y sus datos —
`{clave: 'pio.largo', datos: {sobra: 3, limite: 100}}` — y no como una frase
ya armada. El cliente la dice en el idioma que corresponda; si no conoce la
clave, muestra el español que vino de respaldo. Así el servidor no necesita
saber nada de idiomas.

## Imágenes y GIF

Apagadas por defecto. Se encienden con la clave del proveedor que elijas:
**ImgBB** (una API key y listo) o **Cloudinary** (nube, key y secret, pero da
recorte y miniaturas sin trabajo extra). Los GIF salen de **Giphy**.

Las tres comparten una regla: **la clave nunca llega al navegador**. El cliente
le manda la imagen a nuestro servidor y el servidor habla con el proveedor. Si
el navegador llamara directo, la clave estaría a la vista de cualquiera que
abra el inspector. Por eso también `/api/gifs` pide sesión: sin eso sería un
proxy abierto a Giphy pagado con nuestra clave.

Dos cuidados más, del lado de la validación:

**No se le cree al tipo que declara el cliente.** Se lee la firma real del
archivo —`\x89PNG`, `GIF8`, `RIFF…WEBP`—. Un `data:image/png` delante de un
ejecutable sigue siendo un ejecutable.

**La URL que devuelve el proveedor se sanea antes de usarla.** Sólo `https` y
sólo sus dominios. Esa dirección termina en un `<img src>`, y si algún día la
respuesta viniera manipulada, no queremos que se convierta en algo ejecutable
dentro de la página.

## Dónde vive todo

Dos depósitos con la misma boca. El de **archivo** guarda en `datos/pio.json`,
que es cómodo para trabajar en tu máquina y es lo que usan las pruebas. El de
**Supabase** habla por HTTP con `fetch`, sin una sola dependencia de npm, y es
el que hace falta para desplegar: los hostings gratuitos borran el disco en
cada reinicio.

Se elige solo. Si hay credenciales de Supabase, las usa; si no, el archivo.
`PIO_DEPOSITO=archivo npm start` fuerza el archivo, que es lo que conviene
para trabajar sin ensuciar la base de verdad.

Para armar las tablas, pega [`supabase.sql`](supabase.sql) en el SQL Editor de
Supabase. Todas llevan prefijo `pio_`, así que conviven con cualquier otra
cosa que ya tengas en ese proyecto.

**Las lecturas van a memoria, las escrituras a la base.** Al arrancar se carga
todo y las consultas se responden desde ahí, que es instantáneo; sólo los
cambios salen a Supabase, y sólo el registro que cambió. Reescribir todo en
cada pío, que es lo que hace el depósito de archivo, sobre HTTP sería
insostenible.

Esto alcanza de sobra para un sitio chico y tiene un límite que conviene decir
en voz alta: **no sirve para varios procesos a la vez**, porque cada uno
tendría su propia copia en memoria y no se enteraría de los cambios del otro.
Un solo proceso, que es lo que hay.

En `jsonb` va el objeto entero con la misma forma que tenía en el JSON, y en
columnas sueltas sólo lo que de verdad se consulta u ordena. Por eso el código
de dominio no se enteró del cambio.

## Desplegar

El archivo [`render.yaml`](render.yaml) ya describe el servicio. En Render:
**New → Blueprint**, se elige el repositorio, y Render lo lee y arma todo solo.
No hay nada que compilar: el proyecto no tiene dependencias, así que el build
es un no-op y el arranque es `node servidor.js`.

Las claves no están en el archivo. Van marcadas como `sync: false`, que
significa "preguntámelo en el panel"; Render las pide al desplegar y las guarda
de su lado. Las dos imprescindibles son `SUPABASE_URL` y
`SUPABASE_SERVICE_KEY`; el resto enciende funciones sueltas.

**`PIO_PROXIES=1` no es opcional en Render.** Hay un balanceador delante, y sin
eso el límite de altas vería siempre la IP del proxy y metería a todos los
visitantes en el mismo cubo: cinco altas por hora para el sitio entero.

Dos cosas del plan gratuito que conviene saber de antemano, porque van a pasar:

- **El servicio de Render se duerme tras 15 minutos sin visitas.** La primera
  visita después de eso tarda cerca de un minuto en responder.
- **Los proyectos de Supabase se pausan tras una semana sin actividad** y hay
  que reactivarlos a mano desde su panel.

## Acortar direcciones

Encendido por defecto: ni is.gd ni TinyURL piden credenciales. En el diálogo de
piar hay un botón 🔗 que busca las direcciones del texto y las reemplaza por su
versión corta, lo cual importa bastante cuando el pío entero son cien
caracteres.

**Son dos proveedores a propósito.** El día que se escribió esto, is.gd
respondía `Error, database insert failed` con código 200 y tipo `text/html` —
ni siquiera el JSON de error que promete su documentación. Se prueba is.gd y,
si no contesta algo usable, TinyURL. Hay prueba de ese caso exacto.

Y lo mismo que con todo lo demás: **sólo se acortan direcciones `http` y
`https`**. Un `javascript:` acortado sería una trampa con aspecto inofensivo,
que es justamente para lo que sirve un acortador. La dirección que vuelve se
comprueba contra el dominio del proveedor al que se le preguntó.

## Claves y códigos de recuperación

**Pío no guarda el correo de nadie**, así que no hay a dónde mandar un enlace
de recuperación. En su lugar, al crear la cuenta se entrega un código —
`PIO-XXXXX-XXXXX-XXXXX`— que sirve una sola vez para poner una clave nueva.

Se muestra una única vez. Del lado del servidor sólo queda su hash, con
`scrypt` y sal propia, igual que las claves: si alguien se lleva la base, se
lleva hashes, no la llave de todas las cuentas.

Tres decisiones que vale la pena conocer:

**El código se acepta escrito como salga.** En minúsculas, sin guiones, con
espacios de más. Está pensado para copiarse de un papel, así que el alfabeto no
tiene `0`, `1`, `I`, `L` ni `O`: son las que se copian mal.

**Cambiar la clave cierra las demás sesiones**, menos la que hizo el cambio.
Dejarlas abiertas sería dejar adentro justamente a quien uno está tratando de
sacar. Recuperar con el código las cierra todas, porque quien llega por ahí
viene de haber perdido el control de la cuenta.

**Un usuario que no existe y un código equivocado dan exactamente el mismo
error.** Distinguirlos le regalaría a cualquiera la lista de qué cuentas hay.

Las cuentas de Google no tienen clave, y no la necesitan. Si igual quieren
ponerse una, pueden: no hay clave actual que demostrar porque no había ninguna,
y ahí estrenan su código.

## Vocabulario

| En Pío | En el resto del mundo |
|---|---|
| pío | el mensaje |
| piar | publicar |
| nido | tu línea de tiempo (lo tuyo y lo de quienes sigues) |
| plaza | todo lo público |
| repío | compartir el pío de otro |
| pollito | el que usa Pío |
| aviso | la notificación |

## La API

Todas las respuestas son JSON. Las rutas que piden sesión esperan
`Authorization: Bearer <token>`.

```
GET    /api/config       qué hay encendido         ->     {google}
POST   /api/registro     {usuario, nombre, clave}  -> 201 {token, yo}
POST   /api/sesion/google {credencial}             ->     {token, yo}
POST   /api/sesion       {usuario, clave}          ->     {token, yo}
DELETE /api/sesion       cierra la sesión          ->     {ok}
GET    /api/yo           tu perfil                 ->     {yo}
GET    /api/yo/exportar  todo lo tuyo, en JSON     ->     {formato, cuenta, pios, …}
PATCH  /api/yo           {nombre?, bio?, descanso?} ->    {yo}

GET    /api/pios?tipo=plaza[&mano=1]              ->     {tipo, pios, hayMas}
GET    /api/pios?tipo=nido                               (pide sesión)
GET    /api/pios?tipo=usuario&usuario=pollito
GET    /api/pios?tipo=etiqueta&etiqueta=granja
GET    /api/pios?tipo=megusta&usuario=pollito
POST   /api/pios         {texto, respuestaA?, bomba?, aMano?, cadena?} -> 201 {pio}
DELETE /api/pios/:id     sólo los propios          ->     {ok}
POST   /api/pios/:id/megusta   alterna             ->     {pio}
POST   /api/pios/:id/repio     alterna, no el propio ->   {pio}
POST   /api/pios/:id/eslabon   {texto, aMano?}     -> 201 {pio}
POST   /api/pios/:id/terminar  sólo quien la empezó ->    {pio}
GET    /api/pios/:id/cadena    la cadena entera    ->     {pio, eslabones}
GET    /api/pios/:id/hilo                          ->     {antes, pio, despues}

GET    /api/notificaciones                         ->     {notificaciones, sinLeer}
POST   /api/notificaciones/leidas  marca todo leído ->     {ok, sinLeer}

GET    /api/usuarios/:usuario                      ->     {perfil}
POST   /api/usuarios/:usuario/seguir   alterna     ->     {perfil}
GET    /api/buscar?q=                              ->     {pios, usuarios}

POST   /api/usuarios/:usuario/buzon {texto, anonima?} -> 201 {ok}
GET    /api/buzon        el propio, con preguntas   ->     {buzon}
PATCH  /api/buzon        {abierto?, anonimas?}      ->     {buzon}
POST   /api/buzon/:id/responder {texto, bomba?, aMano?} -> 201 {pio}
POST   /api/buzon/:id/bloquear  {minutos}           ->     {hasta}
DELETE /api/buzon/:id    borra sin responder        ->     {ok}
GET    /api/tendencias   etiquetas de 7 días       ->     {tendencias}

GET    /api/admin/resumen      cuántos hay de cada cosa  ->  {resumen}
GET    /api/admin/usuarios     todas las cuentas         ->  {usuarios}
GET    /api/admin/pios         los últimos 50, corrales incluidos -> {pios}
DELETE /api/admin/usuarios/:u  borra la cuenta y lo suyo ->  {borrado}
DELETE /api/admin/pios/:id     borra cualquier pío       ->  {borrado}
DELETE /api/admin/corrales/:n  borra el corral, no sus píos -> {borrado}
GET    /api/admin/buzones      las pendientes, con autor real -> {preguntas, total}
DELETE /api/admin/buzones/:id  borra una pregunta        ->  {borrado}
POST   /api/admin/equipo/:u   owner: nombra o saca un admin -> {usuario, rol}
GET    /api/admin/sitio       owner: la configuración    ->  {sitio, rangos, base}
PUT    /api/admin/sitio       owner: {funciones?, limites?, registro?, anuncio?} -> {sitio, rangos, base}
GET    /api/admin/emojis       los guardados y los de fábrica -> {emojis, enUso, defecto}
PUT    /api/admin/emojis       {emojis}                  ->  {emojis, enUso}
```

Las líneas de tiempo vienen de a 50. Para pedir la siguiente página agrega
`&antes=<orden del último pío que recibiste>`; `hayMas` te dice si vale la pena.
Los errores son `{error}` con el código HTTP correspondiente: 400 si el pedido
está mal, 401 si falta o venció la sesión, 404 si no existe.

## Los límites

| Qué | Cuánto |
|---|---|
| pío | **100 caracteres** |
| bio | 100 |
| nombre | 30 |
| usuario | de 3 a 15: minúsculas, números y `_` |
| clave | de 6 a 200 |
| página | 50 píos |
| cuerpo del pedido | 64 KB |

El único que importa de verdad es el primero. Los demás están para que nada
crezca sin control.

## El panel de administración

Hay dos roles, y los dos se fijan en la configuración del despliegue, no en la
base: así nadie se vuelve owner desde adentro de la aplicación, ni
comprometiendo la base de datos.

```
PIO_OWNER=sergi
PIO_ADMINS=otro_nombre
```

- **Owner** (`PIO_OWNER`). Todo lo del panel, más lo que no tiene vuelta
  atrás: borrar cuentas y editar los emojis. Nombra y saca administradores
  desde **Pollitos**, y tiene la solapa **Ajustes**. Nadie actúa sobre el owner.
- **Administradores**. Los de `PIO_ADMINS` y los que el owner nombra desde el
  panel. Moderan: borran píos y preguntas del buzón, ocultan cuentas, borran
  corrales. No borran cuentas, no tocan los emojis ni los ajustes, y un
  administrador no actúa sobre otro. A los de `PIO_ADMINS` no se los saca
  desde el panel; a los nombrados, sí.

**Sin `PIO_OWNER`, los de `PIO_ADMINS` hacen de owner**, como antes de que
hubiera roles: un despliegue que ya existía no pierde nada al actualizar. Sin
ninguna de las dos no hay panel para nadie, que es el estado seguro.

A quien tenga rol le aparece 🎛️ en el menú y entra por `#/admin`. Las
solapas: el resumen, las cuentas, los últimos píos —los de los corrales
incluidos, porque lo que no se ve no se modera—, los corrales, los buzones y,
para el owner, los emojis y los ajustes. Cada ruta lo hace cumplir en el
servidor; que el cliente esconda un botón es cortesía.

**Ajustes**, sólo del owner ([`src/sitio.js`](src/sitio.js)). Se guardan en la
base y rigen enseguida, sin reiniciar:

- **Funciones.** Bomba, escrito a mano, buzón, cadenas, GIF, imágenes y chat de
  los corrales, cada una con su interruptor. Lo apagado desaparece de la app y
  el servidor lo rechaza, pero lo que ya existe se queda: una bomba armada
  igual explota.
- **Límites y tiempos.** Altas e imágenes por hora, segundos del huevo, horas de
  la bomba, eslabones por cadena, preguntas por persona al día en el buzón y la
  zona horaria del sitio. Cada uno con su rango; un campo vacío vuelve a lo del
  despliegue o a lo de fábrica, que el panel muestra en gris.
- **Registro.** Abierto, cerrado —sólo entran las cuentas que ya existen— o con
  invitación, que pide un código de ocho letras. El código se acepta escrito
  como salga, uno nuevo anula el anterior, y nunca viaja en la configuración
  pública. Entrar con Google por primera vez pasa por la misma puerta.
- **Anuncio.** Un aviso del sitio, de cien caracteres, arriba de la plaza y del
  nido.

En **Pollitos** se puede **Ocultar** una cuenta para todo el
mundo. Sus píos se siguen guardando y puede seguir piando, pero no aparecen en
la plaza, el nido, las etiquetas, la búsqueda, los avisos ni las tendencias de
nadie; sólo en su propio perfil y en el panel. Está pensado para el piobot.

Tres cosas que conviene saber antes de apretar **Borrar**:

- Borrar una cuenta se lleva sus píos, sus me gusta, sus repíos, sus avisos,
  sus mensajes y sus sesiones. No hay papelera.
- Borrar un corral **no** borra sus píos: se quedan sin corral, o sea en la
  plaza. Que se evapore lo que la gente escribió sería peor que el desorden.
- Borrar cuentas es sólo del owner, y al owner no se lo puede borrar desde el
  panel. Sería la forma más rápida de quedarse sin nadie que administre el sitio.

El editor de emojis reemplaza la lista entera: lo que quede escrito al
guardar es lo que va a andar. Si se guarda vacía, vuelven los cinco de
fábrica. En el valor de cada uno va un emoji suelto o una dirección `https`
de una imagen; lo que no tenga nombre válido —minúsculas, números y guión
bajo— se descarta en silencio, porque un emoji roto rompe el texto de todos
los píos.

## El piobot y el latido

La plaza vacía no se prueba bien, así que hay un bot que pía cada tanto: una
cuenta normal del sitio que publica frases armadas por partes, con esperas al
azar de tres a catorce minutos. Lo que dice vive en
[`src/frases.js`](src/frases.js).

Puede correr de dos maneras, y no se estorban.

**Desde GitHub Actions** ([`.github/workflows/piobot.yml`](.github/workflows/piobot.yml)).
Cada ejecución se queda su ronda dando vueltas y va piando; el cron sólo tiene
que arrancarla. Necesita las variables `PIO_SITIO` y `PIOBOT_USUARIO`, y el
secreto `PIOBOT_CLAVE`. Aviso por experiencia: el programador de GitHub es
poco de fiar. Con `*/15` no disparó ni una vez en tres horas, y con minutos
raros tampoco. Anda cuando anda.

**Desde afuera, golpeando `/api/latido`.** Esta es la que conviene, porque
resuelve dos problemas de un golpe: el hospedaje gratuito apaga el servicio
cuando pasan quince minutos sin que nadie pida nada —y el primero que entra
después espera casi un minuto a que vuelva—, y el bot deja de depender de un
cron ajeno.

```
PIO_LATIDO_CLAVE=una_clave_larga_cualquiera
PIOBOT_USUARIO=PioBot
```

Después, en cualquier servicio de cron gratuito (cron-job.org, por ejemplo),
una tarea cada cinco minutos contra:

```
GET https://tu-sitio.onrender.com/api/latido
Authorization: Bearer una_clave_larga_cualquiera
```

La clave va en la cabecera y no en la dirección a propósito: una dirección con
la clave adentro queda escrita en todos los registros por los que pasa.

El intervalo entre píos no es el del cron. Cada latido mira un momento
sorteado de antemano, así que los píos siguen cayendo cada tres a catorce
minutos aunque el cron venga cada cinco en punto, y el primero después de un
reinicio también se sortea: si el bot piara en el latido siguiente a cada
despliegue, el ritmo delataría cada uno.

Sin `PIO_LATIDO_CLAVE` la puerta devuelve 404, que es el estado seguro: una
puerta que despierta el servicio y publica es justo la que no conviene dejar
abierta.

## Como app

Pío se puede instalar en el teléfono o la computadora como una app: abre a
pantalla completa, con su ícono, y sin barra del navegador. No pasa por ninguna
tienda y cada cambio que se sube llega solo.

- **Android y computadora (Chrome, Edge):** cuando el navegador decide que se
  puede instalar, aparece 📲 "Instalar app" en el menú.
- **iPhone:** Safari no avisa, así que el botón explica cómo: Compartir →
  "Agregar a inicio".

Lo que lo hace posible:

- [`publico/manifest.webmanifest`](publico/manifest.webmanifest): nombre, colores, cómo abre.
- [`publico/sw.js`](publico/sw.js): el trabajador. **Primero la red**, siempre: lo
  guardado sólo se usa si no hay conexión, para que la app abra y diga que no
  hay red. Nunca guarda la API ni las páginas para compartir: mostrar píos
  viejos como si fueran de ahora sería peor que no mostrar nada.
- Los íconos (`/iconos/*.png`) se dibujan con el mismo pollito que la imagen
  para compartir, en [`src/portada.js`](src/portada.js). El "enmascarable" deja
  más aire, porque cada Android lo recorta con su forma.

Si alguna vez hace falta obligar a todos a tirar lo guardado, se cambia
`VERSION` en `sw.js`.


## Notificaciones al teléfono

En **Avisos** está "🔔 Activar notificaciones". Con eso, cada aviso de la campana
llega también al teléfono o la computadora, aunque Pío esté cerrado. Tocar la
notificación abre el pío. En el iPhone sólo funcionan con Pío agregado a la
pantalla de inicio.

Es el estándar de la web (Web Push), hecho sin dependencias en
[`src/push.js`](src/push.js): cada envío se firma con claves VAPID (RFC 8292) y
se cifra con las claves del navegador (RFC 8291), de modo que Google o Apple lo
llevan sin poder leerlo. Las pruebas comparan el cifrado, byte por byte, con el
ejemplo del propio estándar.

- **Sin configurar nada funciona:** si no hay claves, Pío arma unas y las guarda en
  la base. Para fijarlas en el despliegue: `PIO_VAPID_PUBLICA`, `PIO_VAPID_PRIVADA`
  y `PIO_VAPID_CONTACTO` (un `mailto:` al que Google o Apple pueden escribir).
  Cambiarlas obliga a cada navegador a suscribirse de nuevo, cosa que la app hace
  sola al abrirse.
- **Sólo a servicios conocidos:** la dirección a la que se manda la da el
  navegador, así que se acepta sólo si es de Google, Mozilla, Apple o Microsoft.
  Si no, cualquiera podría hacer que el servidor le pegue a la dirección que quiera.
- **Respeta lo de siempre:** nada de cuentas bloqueadas, silenciadas u ocultas; lo
  que es huevo espera a nacer, y lo que se deshace no suena nunca. Los me gusta de
  un mismo pío se reemplazan entre sí. Y de noche, dentro del horario de
  silencio de cada cuenta, no suena nada.
- Un navegador queda con una sola cuenta, cerrar sesión lo da de baja, y los que
  el servicio declara muertos se borran solos.


## Lo que todavía no está

- Varios procesos a la vez: cada uno tendría su propia copia en memoria.
