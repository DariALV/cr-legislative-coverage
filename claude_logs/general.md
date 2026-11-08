# general

## 2026-11-06 21:51 — Se crean los claude_logs

- Decisión del usuario: toda observación o decisión nueva se registra en `claude_logs/`, con fecha y hora y la explicación de por qué. Sirve como memoria persistente entre chats e historial de la evolución del proyecto.
- Diferencia con la documentación: los docs se actualizan y pierden cosas; los logs nunca se borran ni se editan (solo se agregan entradas, incluso para corregir una anterior).
- Formato elegido: un archivo por día (`YYYY-MM-DD.md`), entradas con `## HH:MM — título`, hora local de Costa Rica.
- La regla quedó fija en `CLAUDE.md` (sección "Claude logs (always)") para que aplique siempre.
- Contexto al empezar: los últimos commits del día fueron SIL bills + votos de Delfino (#66, #22, #24) y datos de prueba de embeddings desde SIL (#32). Lo previo a esta entrada no está en los logs.

## 2026-11-06 22:28 — Regla: atento a issues relacionados y commits frecuentes

- Pedido del usuario: estar siempre atento a qué issues se relacionan con el tema que se discute (p. ej. si lo que se habla es justo el #60, comentar en ese issue), y al terminar de programar algo, ver a qué issue se vincula.
- Objetivo: commitear lo mejor posible y siempre que se pueda, para que no se acumulen cambios sin commit.
- Quedó en `CLAUDE.md`, sección nueva "Stay issue-aware and commit often (always)". Se mantiene la regla existente de mostrar el mensaje de commit propuesto antes de commitear.

## 2026-11-07 02:10 — Qué copiar para pasar a la máquina de la RTX 2060 (#32)

- Pregunta del usuario: qué datos mover a la otra compu para embeddings. Lo no versionado: `databases/private_corpus.db` (234 MB, la única base; `public_corpus.db` no existe), `.env` (TYPESAFE_API_KEY), `raw/` (6,4 GB: `html` 6,1 GB, `text` 179 MB, `csv` 75 MB, `links` 4 MB), `logs/`, `private_visuals/output/`.
- Recomendado: la base + `.env`; `raw/text` (+ `csv`, `links`) solo si se va a re-parsear allá (la recuperación de exposiciones #66 lee `raw/text/asamblea/bills/`). `raw/html` no hace falta salvo re-scrapear sin red.
- Ojo: hay cambios sin commit en `asamblea_parser.py` y archivos sin rastrear (`claude_logs/2026-11-07.md`, `private_visuals/db_explorer/`) que no viajan por git hasta hacer commit/push. La memoria de Claude (`~/.claude/projects/...`) es local de esta máquina.

## 2026-11-07 01:38 — Regla: hora de los logs leída del reloj

- Pregunta del usuario: por qué los logs a veces muestran horas incorrectas. Causa: Claude no tiene reloj propio y escribía la hora estimándola, sin consultarla (p. ej. "01:55" y "02:30" de hoy, que en realidad fueron antes de la 01:37).
- Pedido del usuario: usar siempre una función de tiempo. Quedó en `CLAUDE.md` (sección "Claude logs"): leer `date -u -d '-6 hours' "+%Y-%m-%d %H:%M"` justo antes de cada entrada, también para el nombre del archivo.
- Observación: `TZ=America/Costa_Rica date` en Git Bash devuelve la hora UTC (07:38 en vez de 01:38) porque no tiene datos de zonas horarias, así que no sirve.

## 2026-11-07 01:39 — Commit de la regla de hora

- Commit `feature: claude md rule for log times from the clock` (CLAUDE.md y este log, incluida la entrada del commit 2a8c593). Sin issue: es una regla de trabajo.

## 2026-11-07 08:53 — Corrección de hora

- La entrada anterior ("08:58 — Por qué la barra...") se escribió a las 08:53; la hora del título está mal.

## 2026-11-07 15:31 — Corrección de hora

- La entrada "15:30 — Chunks de 256 por noticia y por medio" se escribió a las 15:31.

## 2026-11-07 19:18 — Repaso de issues que se pueden cerrar

- Pedido del usuario: listar los issues abiertos que ya se pueden cerrar. No se cerró nada; queda a decisión del usuario.
- Cerrables: #65 (tablas completas: 235 diputados, 1.880 órganos, 1.094 organ_bills, 27.937 deputy_bills), #17 (las 29.875 noticias caen entre el 1/5 y el 31/10/2026), #20 (período fijado en `Config.DATA_PERIOD`, cd48b15; falta solo dejar el porqué en un comentario), #6 (78 configuraciones, gana qwen3-0.6b), #38 (analizador y resultados comentados), #26 (hoja armada), #25 (pestaña Guía de la hoja), #23 (obsoleto: Delfino ya no da los expedientes, los da el SIL de #66).
- No cerrables todavía: #66 (falta marcar expedientes vivos en el período), #68 (falta comparar con el ranker por gradiente), #32 (falta la corrida real de `--all-news`), #27/#28/#29 (revisión humana pendiente; 47 negativas de confianza alta sin re-revisar), #41 (K se debe afinar con la muestra), #19 (noticias y votos siguen saliendo de Delfino), #16 (data line de El Mundo).

## 2026-11-07 19:24 — Cerrados #65, #17, #20, #6, #38, #26, #25 y #23

- Por pedido del usuario, se cerraron los ocho issues del repaso anterior, cada uno con un comentario que dice por qué. #23 se cerró como "not planned" (obsoleto por #66).
- Porqué del período (#20), según el usuario: la idea original era 1 año, pero eran demasiadas noticias y se complicaba; 3 meses le pareció muy corto para un análisis real; 6 meses es el balance entre los dos. Quedó en el comentario de cierre de #20.

## 2026-11-08 00:26 — decisión: memoria en STATUS.md + diarios por tema

- Problema: el log diario del 07 llegó a 980 líneas / 155 KB (~40–50k tokens) y se leía entero en cada chat.
- Decisión del usuario: dos capas. `STATUS.md` (estado actual, decisiones vigentes y pendientes, acciones en espera; se reescribe, se lee siempre al inicio y se vuelve a leer antes de escribirlo) + diarios append-only por tema (`data`, `explorer`, `embeddings`, `sample`, `ranker`, `general`; lista cerrada). Se agregan con `cat >>` sin leer y se leen solo por títulos o entradas puntuales. Títulos con `decisión:` / `pendiente:`.
- Descartado: seguir con un archivo por día; ADRs aparte (duplicarían los issues y los diarios).
- Migración: las 144 entradas de los logs diarios se copiaron tal cual a los diarios por tema (agregando la fecha al encabezado; un subagente clasificó cada entrada por tema) y los originales quedaron en `claude_logs/archive/`. Ojo: las entradas de después de medianoche del archivo del 06 llevan fecha 2026-11-06 aunque son del 07.
- STATUS inicial armado a partir de una revisión completa de los logs buscando decisiones que quedaron abiertas: 5 del ranker, 4 de datos, 5 de la muestra, 3 de embeddings (detalles elegidos por Claude sin confirmar), más 6 acciones en espera.
- CLAUDE.md: la sección "Claude logs" se reemplazó por "Claude memory: STATUS and topic logs".

## 2026-11-08 00:29 — Commit c9bf284: STATUS y diarios por tema

Commit `feature: status file and per-topic claude logs` (sin issue: no hay ninguno de logs/memoria). `results/sample/negatives_review_pilot.csv` quedó fuera, va en un commit de la muestra (#27 #28).
