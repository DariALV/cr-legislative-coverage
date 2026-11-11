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

## 2026-11-08 19:22 — pendiente: diseño de las preguntas a Jev (evaluador TypeSafe) (#34 #39 #35)

- El usuario quiere integrar Jev (TypeSafe, modelo System One) como evaluador: recibe una noticia más un expediente candidato (top-K del ranker) y contesta preguntas tipadas con probabilidades. Embeddings y GA solo sirven para no preguntar por todos los expedientes. Nada de código escrito (regla «diseño antes de código»).
- Idea del usuario: puerta de entrada con 3 preguntas (¿se habla del expediente explícita, implícita, o solo del mismo tema sin mencionarlo?) y, si alguna se cumple, una segunda ráfaga (centralidad: central/secundario/de paso; connotación con score; etc.).
- Propuesta de Claude (sin respuesta aún): 3 `Noul` independientes en la puerta (no un `Choice`, porque no son excluyentes); etapa 2 solo para pares que pasan; cada pregunta atómica y con el mismo vocabulario que la muestra manual (tipo de mención, centralidad, subtipos de negativa) para que la muestra sirva de test de Jev (#39). Lo exacto (número citado, diputados, etapa real del trámite, tipo de expediente) se queda en código. Decisiones abiertas: tema como positivo o no, un request por par vs. noticia con varios expedientes, esquema de tablas para guardar las probabilidades crudas, permiso para probar con la API real (datos enviados a un tercero), y si se crea el tema `jev.md` (la lista de temas es cerrada).

## 2026-11-08 19:40 — Costo de Jev para 29.698 noticias × K y primera prueba real con 126 pares (#34 #39 #41)

- Corrección: el «~8.000» que usé antes era el conteo de noticias que pasan el filtro amplio de palabras (sample.md 2026-11-07 13:18), no el corpus. El corpus tiene 29.875 noticias (29.698 con extracción Success, 177 Partial); promedio 3.493 caracteres, mediana 2.952, p99 13.448.
- Precio (docs.typesafe.ai/go/models): Jev 1.14, $0,042 por millón de tokens de entrada; la salida es gratis. Contexto: 64k por request, 32k por pregunta. Límites de tasa por organización, en la consola (no publicados). El estado se cobra una vez por request, las preguntas del mismo request lo comparten.
- Calibración con la prueba real (126 requests, 285.412 tokens, ~$0,012): ~3,8 caracteres por token (supuse 3,3) y ~732 tokens fijos por 7 preguntas (~330 para 3 Nouls). Ficha de expediente: 2.042 caracteres (nombre, materias, proponentes, fecha, 1.500 de exposición).
- Costo estimado (un request por par; tabla completa en results/jev/cost_estimate.csv): K=30: $68–83; K=50: $113 (solo 3 preguntas de puerta) a $138 (7 preguntas en todos), o $122 con puerta + 7 preguntas solo en ~3 pares por noticia; K=100: $227–277. 1,48 millones de requests con K=50. Sin medir: tiempo (depende del límite de tasa).
- Prueba (script desechable en el scratchpad): 21 noticias (11 de la hoja con Revisión = Correcto, 10 de Delfino con 1–2 links), 126 pares: 20 oro, 1 negativo forzado (alternativo de la hoja), 84 negativos duros (top-4 TF-IDF no oro) y 21 al azar. 7 preguntas: explicit, implicit, same_topic (puerta); centrality (Score 3), stance (Score 5), author_judges, new_development. Resultados en results/jev/probe_v1.csv (solo probabilidades, sin texto de noticias).
- Resultados: explicit mediana 0,98 en oro contra 0,04 en negativos duros y 0,02 al azar; con puerta (explicit o implicit > 0,7; zona 0,3–0,7 incierta) 19 de 20 oro dan match, 21 de 21 al azar «none», y de 84 negativos duros 3 match, 7 inciertos, 13 solo tema, 61 none. Los tres falsos match son expedientes hermanos (plataformas de transporte 21587, Ley de Minería Crucitas 22007 contra 24717, 21270 anticorrupción): implicit sube a 0,74–0,90 por tema parecido, no hay umbral que separe del oro implícito (0,92–0,98). El único oro perdido (24180, derecho a la alimentación) es un link de Delfino probablemente sobrante: la noticia habla de 25874.
- Stance y author_judges salen coherentes (columnas de opinión y titulares críticos con author_judges > 0,8; la nota «Laura Fernández a favor…» con stance 3,86; titular «deja indefensos a choferes» con stance 0,01). Centralidad ~2,0 en casi todo el oro; baja a ~1,1–1,2 y 0,06 donde la mención es secundaria o de paso. Faltó probar casos «de paso» etiquetados y negativas de tipo decreto/anunciado/ley vigente.
- pendiente: elegir K (STATUS), incluir pregunta de hermanos (elegir entre candidatos parecidos), probar con más noticias de la hoja, decidir si «mismo tema» abre la segunda ráfaga, crear el tema jev.md.

## 2026-11-08 19:54 — Filtro previo de noticias antes de Jev: secciones y palabras (#34 #43)

- Corpus: 29.698 noticias Success (24.301 de medios generales, 5.397 de Delfino). Filtro estricto de palabras (proyecto de ley, expediente, Asamblea Legislativa, diputad, plenario, comisión legislativa, primer/segundo debate): 8.081 (27 %). Por medio: crhoy nacionales 24 %, nacion política 78 %, elmundo costa rica 55 %, semanario país 54 %, delfino hoy 42 %; sin hits casi: ciencia, tecnología, cultura, negocios.
- Excluir secciones claramente no legislativas (ciencia, tecnología, cultura, negocios/economía de crhoy y elmundo, en tendencia, la jornada, super reporte, sostenibilidad, etc.): quita 5.571 (19 %); de ellas solo 238 tienen palabra estricta y 17 de 532 noticias con link de oro de Delfino (3 %). Combinado con el filtro de palabras quedan 7.843: la sección casi no agrega al filtro de palabras. La mayoría de lo que sobra es sucesos/nacionales de crimen sin palabras legislativas.
- Recall del filtro de palabras en el oro de Delfino: 520 de 532 noticias lo pasan (98 %). Es oro de links explícitos; no mide menciones implícitas (eso lo mediría la muestra manual, con los positivos de pool B). Pendiente medirlo ahí.
- Por qué sale caro: 29.698 noticias × 50 candidatos = 1,48 millones de requests, y cada uno reenvía la noticia completa (~950 tokens, más de la mitad del request) más la ficha (~540) y las preguntas (~330).

## 2026-11-08 20:05 — Prueba v2 de Jev: un request por noticia con K=50 candidatos y 150 preguntas (#34 #41)

- Pedido del usuario: ¿se pueden mandar todas las preguntas de una noticia en un solo request sin perder contexto? Sí: las preguntas de un request comparten el estado, y los tokens del estado se cobran una vez. Probado con las mismas 21 noticias: estado = noticia + 50 candidatos (los 6 de la prueba v1 + relleno con el top TF-IDF), 3 preguntas de puerta por candidato (150 por request). Script desechable en el scratchpad; probabilidades en results/jev/probe_v2_short.csv.
- Ficha corta (nombre, fecha, proponentes, materias; sin exposición): 21 de 21 requests ok, 25.508 tokens por request (máx. 27.958), 6 segundos en total con 3 hilos, $0,0225 total ($0,00107 por noticia). Contra v1 en los mismos 126 pares: las probabilidades cambian poco (|Δ| medio 0,03 explicit, 0,07 implicit, 0,09 same_topic), la decisión de la puerta coincide en 107/126 y casi todos los cambios son negativos duros que pasan a «none» (menos falsos match, no más). Oro detectado 18/20 (v1: 19/20; el de menos es el 24180 dudoso y uno que baja a incierto).
- Los 924 candidatos de relleno: 908 none, 11 solo tema, 5 inciertos, 0 match. Matches por noticia (de 50): media 0,9, casi todos el oro. O sea m ≈ 1, no 3: la segunda ráfaga cuesta aún menos.
- Ficha con exposición (1.500 caracteres): falla con error max_tokens_exceeded en 7 de 21 noticias (estado de ~41k tokens). El límite efectivo es ~32k tokens por pregunta (estado + pregunta), no 64k. Con ficha corta una noticia muy larga también puede pasarse (cap sugerido: noticia a ~15.000 caracteres o dividir los 50 candidatos en dos requests).
- Costo proyectado con ficha corta: 29.698 noticias ≈ $32 (puerta) + ~$3 (segunda ráfaga con ~1 par por noticia) ≈ $35; con las 8.081 del filtro de palabras ≈ $9–10. Tiempo a ~3,5 requests/s: ~2,4 h todo el corpus, ~40 min el filtrado. Antes: $113–138 con un request por par.
- Caveats: los candidatos de relleno vienen de TF-IDF, no del ranker real; solo se probó la puerta (la segunda ráfaga se probó por par en v1); 21 noticias, 11 de ellas de Delfino.

## 2026-11-08 20:18 — Filtro de palabras permisivo contra estricto, medido en la muestra y en el oro (#34 #43)

- Idea del usuario: filtro de palabras gratis más permisivo (partidos, candidat, propone…) y encima un filtro de Jev por noticia, antes de la puerta por expediente. Medido sobre las 29.698 noticias, los 102 positivos de la muestra (tipo de mención de la hoja, leído con Sheets, incluye correcciones de revisión) y el oro de Delfino.
- Estricto (proyecto de ley, expediente, Asamblea Legislativa, diputad, plenario, comisión legislativa, primer/segundo debate): pasa 8.081 (27 %); positivos 102/102; oro 520/532.
- Permisivo (estricto + asamblea, congreso, legislativ, ley/leyes, proyecto, reforma, iniciativa, moción, fracción, bancada, votación, dictamen, veto, Sala IV, magistrad, presupuesto, candidat, propone/propuesta, oficialismo, oposición, nombres de partidos): pasa 17.120 (58 %); positivos 102/102; oro 531/532. Cuesta el doble y gana 1 noticia de oro.
- Un tercer filtro «muy permisivo» (gobierno, ministr, comisión…) dio 100 % por un error mío de regex (alternativas vacías); no sirve de todos modos.
- Lectura: el filtro estricto no perdió ningún positivo de la muestra (límite superior ~3 % al 95 %, regla de tres); las noticias del pool B (fuera del filtro amplio) resultaron todas negativas. Caveat: los positivos se buscaron leyendo y con TF-IDF, no con el filtro, pero la muestra es chica (102) y no mide menciones implícitas muy sutiles.
- Costo con ficha corta y un request por noticia: estricto ≈ $8,7; permisivo ≈ $18,4; sin filtro ≈ $31,8 (más ~$0,4–0,8 si se agrega el filtro de Jev por noticia sobre lo que sobrevive). Pendiente: probar el filtro de Jev por noticia sobre la muestra para ver cuántos negativos descarta sin perder positivos.

## 2026-11-08 20:23 — pendiente: diseño de las pruebas del filtro de Jev por noticia (#34 #43)

- El usuario pide 3 pruebas: (1) filtro de Jev sobre las noticias de la muestra marcadas «Correcto» y el oro de Delfino, sin filtro de palabras; (2) filtro estricto y luego Jev; (3) comparar lo que filtra Jev, el estricto solo y la prueba 2. Antes quiere hablar del diseño; no se corrió nada ni se llamó a la API.
- Propuesta de Claude (sin respuesta): la prueba 2 es post-proceso de la 1 (Jev contesta cada noticia por separado, así que no hace falta llamar otra vez); una pregunta ancha («toca la Asamblea o una ley en trámite») y una angosta («habla de un proyecto de ley o reforma, nombrado o descrito») en el mismo request para comparar redacciones; verdad terreno: los positivos DEBEN pasar, las «Sin relación» deberían caer, las negativas duras (actividad legislativa, decreto, mismo tema) pueden pasar; usar las 300 de la muestra (no solo las «Correcto», marcando cuáles) + 532 de oro + ~500 al azar del corpus para estimar la tasa de paso; umbral calibrado en un conjunto y validado en el otro; tope de gasto ~$0,15 (estimado ~$0,08).
- Decisiones abiertas: qué noticias entran (solo «Correcto» o las 300), redacción de la pregunta, regla del umbral, tope de gasto, enviar textos de ~1.300 noticias (incluye medios con muro y texto de Delfino) a TypeSafe, y si el script vive en el repo.

## 2026-11-08 20:52 — decisión: pruebas del filtro de Jev por noticia sin las 500 al azar; resultados (#34 #43)

- Decisión del usuario: se quitan las ~500 noticias al azar (no evalúan nada: la tasa de paso del corpus se conoce al correr el filtro sobre todo el corpus por ~$1,7); el resto del diseño se aprueba. Script desechable en el scratchpad; por noticia, un request con 2 preguntas Noul (assembly: ancha; bill: angosta). 832 noticias (300 de la muestra con etiqueta y Revisión de la hoja; 532 del oro de Delfino), 1,54 M tokens, $0,0645, ~5 min a ~2,8 requests/s, sin errores. Por noticia: results/jev/filter_v1.csv (sin texto).
- Prueba 1 (Jev solo, assembly): los 102 positivos de la muestra pasan con assembly ≥ 0,58 (los 62 «Correcto» también); oro 526 de 532 pasan con umbral 0,2 o 0,3 (99 %); no pasan 6, que parecen links tangenciales de Delfino (homenaje al voto femenino, Hogar Buen Samaritano, Sugef, Defensoría, magistradas). La pregunta angosta (bill) pierde 14–23 % de los positivos de la muestra (descripciones e implícitas): descartada. Pasa assembly > 0,3: Sin relación 14 %, Decreto 21 %, Ley vigente 33 %, Mismo tema 69 %, Actividad legislativa 100 %, Anunciado 100 %.
- Prueba 2 (estricto y luego Jev): positivos 102/102; oro pierde 13 de 532 (2,4 %; el estricto solo pierde 12). Prueba 3: el estricto deja pasar 56 % de las «Sin relación» de la muestra, Jev 14 % (ojo: la muestra tiene 80 % de noticias que pasan el estricto, así que esa cifra de Sin relación no es del corpus). Solo-Jev vs estricto: en el oro 7 pasan solo por Jev, 1 solo por el estricto; unión (estricto o Jev) pierde 5.
- Costo proyectado del pipeline (ficha corta, un request por noticia, supuestos: Jev pasa ~75 % de las que pasan el estricto y ~2 % de las que no, estimado con 244 y 56 noticias de la muestra): solo estricto ≈ $8,3; solo Jev (t=0,2) ≈ $8,3 (pasan ~22 % del corpus); estricto → Jev ≈ $6,7; estricto o Jev ≈ $10,4. Las diferencias son de $2–4; la elección se hace por recall.
- Caveats: positivos solo 102 (el 0 % de pérdida tiene cota ~3 %); la tasa de paso de las noticias que no pasan el estricto sale de 56 noticias; el oro es de links explícitos; la pregunta se probó con un solo umbral fijo y una redacción.
- pendiente: elegir el filtro (recomendación de Claude: Jev solo con assembly > 0,2, por mejor recall al mismo costo; cascada si el presupuesto aprieta), fijar el umbral, y correr sobre las 29.698.

## 2026-11-08 21:06 — decisión: el filtro de Jev se queda con las preguntas en inglés; comparación inglés/español (#34 #43)

- Pregunta del usuario: ¿afecta que las preguntas estén en inglés si el texto está en español? La documentación no dice nada de idiomas. Se repitió la prueba del filtro con las mismas 832 noticias y las dos preguntas traducidas al español ($0,065; results/jev/filter_v1_es.csv, solo probabilidades).
- Resultado: correlación 0,988 (assembly) y 0,989 (bill); diferencia media absoluta 0,022; la decisión cambia en 9 de 832 noticias con umbral 0,2 y en 11 con 0,3. El español da probabilidades algo más bajas (media 0,804 contra 0,826). Positivos de la muestra: 102/102 en ambos, pero el mínimo baja de 0,58 (inglés) a 0,36 (español). Oro perdido con umbral 0,2: 6 (inglés) contra 8 (español); con 0,3: 6 contra 9. «Sin relación» que pasa (0,3): 14 % contra 10 %; actividad legislativa que pasa: 100 % contra 92 %. O sea, el español filtra un poco más pero pierde un poco más de oro.
- Decisión: sin diferencia que justifique cambiar; se mantiene el inglés (algo más de recall y cumple la regla del repo de código en inglés). Nota: en la prueba la pregunta decía `news` pero el estado era {outlet, date_published, title, text}, sin una clave `news`; funcionó igual, pero para producción conviene anidar la noticia bajo `news` o nombrarla como «la noticia».

## 2026-11-08 21:21 — Prueba de Jev contra las etiquetas de la muestra («Correcto», 187 filas) (#39 #27 #28)

- Pedido del usuario: preguntarle a Jev por los tipos de la hoja (Choice) y ver si se alinean; sobre las filas Correcto, con las preguntas que hicieran falta. Script desechable en el scratchpad; 311 requests, $0,0226, 83 s, sin errores; results/jev/types_v1.csv (solo probabilidades). (a) Choice por noticia (siete opciones: bill_discussed, legislative_activity_no_bill, executive_action, same_topic_no_bill, announced_not_filed, law_in_force, unrelated) en las 187; (b) en las 62 positivas, un Noul por tipo de mención (cites_number, uses_official_name, uses_nickname, describes_content, by_proponent_or_step) y centralidad (Score 3), con el expediente de oro y un expediente parecido incorrecto como control.
- (a) Acierto 141/187 = 75 %: actividad legislativa 24/26, decreto/Ejecutivo 17/21, ley vigente 5/6, sin relación 46/64, positiva 46/62, anunciado 2/3, mismo tema 1/5. Positiva contra no positiva: VP 46, FN 16, FP 1, VN 124. De los 16 FN, ~14 son expedientes que no son proyectos de ley (elección de magistrados suplentes 25258, comisión investigadora 25400, reelecciones) que nuestra hoja cuenta como positivos y que mi opción legislative_activity_no_bill (nombramientos y comisiones) describe como «sin proyecto»: el desacuerdo es de definición (decisión pendiente en STATUS), no un error de Jev. 15 de las 64 «Sin relación» caen en executive_action (noticias de gobierno sin contenido legislativo): la frontera sin relación / ejecutivo es difusa, y también está pendiente.
- (b) cites_number coincide exacto con una regex del número en el texto (22/22 con etiqueta Número, 0/40 en el resto): en producción va en código. uses_official_name 9/12; uses_nickname 1/3 (n chico); describes_content solo 4/21 y by_proponent_or_step dispara en 52/62 (permisiva): las etiquetas «Descripción» mezclan alusiones a proyectos con alusiones a nombramientos o comisiones, y mi redacción de by_proponent_or_step no discrimina; no son un buen reflejo de esa etiqueta. Controles: ninguna pregunta de tipo pasa 0,5 salvo 2 de nickname y 6 de describes_content y 4 de by_proponent_or_step.
- Centralidad: media de Jev De paso 0,48 (n 9), Secundario 0,82 (n 3), Central 1,79 (n 50); Central acierta 42/50 al redondear; el orden es coherente.
- Lectura: los tipos de mención positivos no hacen falta para el pipeline (match, centralidad y postura sí); sirven como diagnóstico y las discrepancias son una lista de filas para el protocolo de adjudicación. Caveat: los desacuerdos no se usaron para retocar la redacción (sería ajustar contra nuestras propias etiquetas).

## 2026-11-08 21:31 — decisión: los expedientes que no son proyectos de ley cuentan como positivos (#27 #29)

- Decisión del usuario: comisiones investigadoras, nombramientos (p. ej. magistrados suplentes 25258), reformas al Reglamento y demás expedientes del SIL que no son proyectos de ley cuentan como positivos cuando la noticia los menciona; se mantiene la columna «Tipo de expediente» para poder filtrarlos o reportarlos aparte. Alternativa descartada: tratarlos como «Actividad legislativa sin expediente».
- Consecuencia: las etiquetas actuales de la hoja ya estaban así (positivas con tipo de expediente), así que no hay que cambiar filas; sí hay que corregir la definición de las opciones de Jev: bill_discussed debe incluir cualquier expediente (nombramiento, comisión), y legislative_activity_no_bill significa actividad de la Asamblea sin ningún expediente (control político sin número). Con eso, ~14 de los 16 falsos negativos de la prueba de tipos pasarían a ser aciertos (por confirmar con una nueva corrida). El filtro de Jev por noticia (assembly) no cambia: ya los dejaba pasar.

## 2026-11-09 15:22 — Pull con choque resuelto: los logs locales se mezclaron con los 3 commits de la otra máquina

- Los diarios y STATUS sin commitear chocaban con 5bae38c, 9d2bfab y 42516ae (barrido de K, pruebas de Jev, diario jev.md). Se resolvió con stash, pull --ff-only y stash pop. En embeddings.md y ranker.md se conservaron las entradas de los dos lados. STATUS se mezcló a mano: los pendientes que la otra máquina ya había cerrado (no proyectos de ley = positivos, K = 50) salieron de Pendiente, y #32 ya estaba cerrado.

## 2026-11-09 15:24 — decisión: no se registra qué máquina es cuál

- El usuario pide quitar las menciones de máquinas, porque adivinar cuál es cuál enreda. En STATUS se quitó la línea «Esta máquina (MSI)…» (quedó solo la indicación del `.venv`) y «Entre máquinas a mano» pasó a «Fuera de git». También se borró la memoria de Claude `machines.md`.

## 2026-11-10 12:39 — decisión: regla de privacidad y ética antes de commitear
- Pedido del usuario: nunca commitear lo que pueda ser un problema ético o de privacidad (ej.: cuerpo de noticias, `.env`) y advertir siempre que haya riesgo. Nueva sección en CLAUDE.md, «Privacy and ethics before committing (always)»: incluye llaves/tokens, datos personales y respuestas crudas de API que traigan el texto.
- Revisión hecha: los archivos sin commitear (results/jev/corpus/, test100*, scripts) solo traen ids, expedientes, puntajes y probabilidades; ningún texto largo ni llaves (los scripts leen TYPESAFE_API_KEY de .env). En lo ya commiteado tampoco hay strings de 400+ caracteres ni archivos tipo .env. `.env`, raw/ y las bases ya están en .gitignore.

## 2026-11-10 16:11 — pendiente: el análisis por medio y por partido choca con el plan del entregable 1 («queda fuera valorar, comparar o rankear medios, diputados o partidos»); falta el corpus público y el sitio (#44–#53)

- Contraste del plan del 21 de octubre con lo hecho al 10 de noviembre. Cumplido o superado: 5 medios y 29.698 noticias (estimado: 3–6k), cruce decidido (ranker + Jev) y K ajustado, muestra de 300, precisión medida, corrida sobre todo el corpus, preguntas extra (estaban fuera «si sobra tiempo»).
- Pendiente con fecha: corpus público (#44 #45) y cuaderno (#46) para el 10 de noviembre; sitio (#48–#51) y prueba de uso (#52 #53) para el 13; informe, ética y diapositivas (#54–#61) para el 15. También #30 (acuerdo entre anotadores) y #40 (comparación con la línea base).
- Propuesta de Claude: el análisis sirve como validación (precisión por nivel, 95 % contra las votaciones) y como descripción de la cobertura por expediente. Las comparaciones entre medios y partidos se presentan solo de forma descriptiva y con caveats, o se dejan fuera del sitio. Prioridad: corpus público + sitio.

## 2026-11-10 18:52 — Para el informe: universo de expedientes del análisis y trabajo futuro (bajar K mejorando el ranker) (#56)

- El usuario: no tiene sentido medir la cobertura sobre los 5.898 expedientes (2018–2026) con noticias de mayo a octubre de 2026; en el informe, el universo comparable es el de los expedientes con actividad en el período (924 con pasos en el SIL, 306 presentados, 110 votados).
- Trabajo futuro según el usuario: ampliar el período de noticias choca con el costo de Jev; la vía es mejorar el ranker para bajar K sin perder recall. Datos: el costo de la puerta es casi proporcional a K (~650 tokens por candidato); recall del ranker en el oro: @10 0,852, @20 0,911, @30 0,927, @50 0,954 (ranker 2026-11-07). Costo de este corpus: filtro $1,54 + puerta $10,08 + detalle $1,44 = $13,06 por 6 meses (~29,7k noticias).

## 2026-11-10 18:58 — decisión: nuevo tema de diario future.md (trabajo a futuro), a pedido del usuario

- El usuario pidió un claude_logs específico para el trabajo a futuro. Se agregó claude_logs/future.md y la fila correspondiente en la tabla de temas de CLAUDE.md (tabla cerrada; este es un tema nuevo autorizado por el usuario).

## 2026-11-10 21:10 — Pull del scaffold del sitio Astro (18d064b) y commits pendientes hechos (#69 #43)
- Entró 1 commit remoto de andrik: `site/` (Astro) y `.gitignore` (quita `/site`, agrega `!site/src/lib/`). Sin conflictos; hubo que hacer stash porque el rename app.js → bills.js en staging trababa el merge.
- Revisión de privacidad: sin texto de noticias ni llaves; los datos de los visores van a `private_visuals/output/` (ignorado).
- Commits: grafos (#69), visor de respuestas de Jev (#69), modelo de costos (#43), logs + CLAUDE.md (#22 #56). `databases/private_corpus.backup_*.db` agregado al .gitignore.
- Fuera de git a propósito: `results/jev/corpus/` y `results/jev/jev_corpus.zip` (decisión pendiente, STATUS «Para retomar» 3).
