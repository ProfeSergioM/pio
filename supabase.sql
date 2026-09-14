-- Esquema de Pío en Supabase.
-- Pegar entero en Supabase → SQL Editor → New query → Run.
--
-- Por qué jsonb y no una columna por campo: hoy todo Pío vive en un único JSON
-- y el código de dominio lee objetos con esa forma exacta. Guardando el objeto
-- entero en jsonb, ese código no se entera del cambio. Las columnas sueltas de
-- cada tabla son las que de verdad se consultan o se ordenan; el resto viaja
-- adentro. Si algún día una consulta necesita otro campo, se sube a columna.

create table if not exists pio_usuarios (
  usuario   text primary key,
  creado    bigint not null,
  google    text,
  datos     jsonb  not null
);

-- Para que entrar con Google encuentre la cuenta por su identificador estable.
create unique index if not exists pio_usuarios_google_idx
  on pio_usuarios (google) where google is not null;

create table if not exists pio_pios (
  id          text   primary key,
  autor       text   not null,
  creado      bigint not null,
  respuesta_a text,
  datos       jsonb  not null
);

create index if not exists pio_pios_autor_idx  on pio_pios (autor);
create index if not exists pio_pios_creado_idx on pio_pios (creado desc);
-- El árbol de respuestas pregunta "¿quién le respondió a este?" todo el tiempo.
create index if not exists pio_pios_respuesta_idx on pio_pios (respuesta_a) where respuesta_a is not null;

create table if not exists pio_sesiones (
  token   text primary key,
  usuario text   not null,
  creada  bigint not null
);

create index if not exists pio_sesiones_usuario_idx on pio_sesiones (usuario);

create table if not exists pio_avisos (
  id     text   primary key,
  para   text   not null,
  creado bigint not null,
  datos  jsonb  not null
);

create index if not exists pio_avisos_para_idx on pio_avisos (para, creado desc);

-- Un solo renglón, para el contador de identificadores.
create table if not exists pio_meta (
  clave text primary key,
  valor jsonb not null
);

-- Nadie entra a estas tablas desde el navegador: Pío habla con Supabase desde
-- el servidor y con la clave service_role. Se deja RLS encendido igual, para
-- que la clave anon no pueda leer nada aunque se filtre.
alter table pio_usuarios enable row level security;
alter table pio_pios enable row level security;
alter table pio_sesiones enable row level security;
alter table pio_avisos enable row level security;
alter table pio_meta enable row level security;
