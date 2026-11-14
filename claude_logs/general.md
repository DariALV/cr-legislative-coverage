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

## 2026-11-11 18:14 — hallazgo: las carpetas V1 sirven para el sitio, pero falta el exportador (#48–#51)

Revisión en la máquina del usuario de `databasesV1/`, `rawV1/` y `resultsV1/` contra el contrato de `site/src/lib/types.ts`. Solo lectura, sin cambios de código.
- `databasesV1/private_corpus.db` (328 MB, 18 tablas) trae todo lo que el sitio pide: 5.898 expedientes, pasos, proponentes, fracciones, 9.288 votaciones, 29.875 noticias. `public_corpus.db` pesa 0 bytes: está vacía, nunca se generó.
- Los vínculos noticia–expediente del sitio salen de `resultsV1/jev/corpus/gate.csv` (6.329 pares con match) y `details.csv`, no de `news_bill_links` (1.425, solo el oro de Delfino, source = `link`).
- `export_public.py`, que el sitio nombra como fuente de `site/src/data/`, no existe. Es lo que hay que escribir.
- Diferencias con el dummy: status `archived / in progress / law` (el sitio espera español); votos `for / against / absent` + «Abstención» (225) y «Ausente (pierde dieta)» (31); `file_type` en mayúsculas del SIL; medios reales crhoy, delfino, elmundo, nacion, semanario (el dummy tiene elobservador y teletica, no nacion); link_source real: `link` y Jev.
- Riesgo: las tres carpetas V1 no están en el `.gitignore` (este ignora `databases/` y `raw/`, no los nombres con V1). La base trae el cuerpo de las noticias y `answers.jsonl` las respuestas crudas.

## 2026-11-11 18:29 — decisión: el sitio usa los datos reales con `export_public.py` (#48–#51)

El usuario decidió: vínculos de cobertura sustantiva; solo noticias con expediente vinculado; expedientes con cobertura o actividad; todas las votaciones; valores como están en la base, con los vocabularios en inglés traducidos al español.
- `export_public.py` (raíz, nuevo): lee la base en solo lectura y `gate.csv` + `details.csv` de Jev, y escribe `site/src/data/`. Acá se corre con `--database databasesV1/private_corpus.db --jev-dir resultsV1/jev/corpus`. Nunca exporta `content`.
- Resultado: 3.462 vínculos (751 que además enlaza el medio, 2.711 solo del modelo), 2.620 noticias, 1.126 expedientes (570 con cobertura, 556 solo con actividad), 4.723 votaciones. `site/src/data/` pesa 33 MB.
- Lo que Claude eligió sin preguntar, todo en constantes del exportador: «actividad» = presentado, con un paso o con una votación en mayo–octubre; `link_source` = `enlace` si el par está en `news_bill_links`, si no `modelo`; confianza = el mayor entre explicit e implicit; votos `abstencion` y `ausente_pierde_dieta` como valores propios; `kind` de la votación traducido (Plenario / Comisión con potestad legislativa plena).
- Sitio: `vocab.ts`, `LinkBadge`, `VotesTable`, `Timeline`, `types.ts` (campo `kind`), textos de `datos` y `metodologia`, `IS_DUMMY_DATA = false`. `astro check` sin errores y `npm run build` arma 3.751 páginas en 19 s (dist 149 MB).
- Caveats: la página del expediente 24290 pesa 30 MB (2.625 votaciones, casi todas mociones) y la del 21182, 10 MB (857); los temas son los descriptores del SIL (1.965 distintos, mediana 14 por expediente, hasta 144); nombres y títulos van en mayúsculas como en el SIL; 157 proponentes sin fracción (Poder Ejecutivo y sin cruce); `make_dummy_data.mjs` quedó desfasado del vocabulario nuevo; metodología sigue con texto de relleno.
- `.gitignore`: agregadas `databasesV1/`, `rawV1/` y `resultsV1/`. Nada commiteado.

## 2026-11-11 19:00 — metodología del sitio reescrita con los datos reales (#48–#51)

A pedido del usuario, `site/src/pages/metodologia.astro` quedó sin texto de relleno. Sin commitear.
- Secciones: fuentes, qué se publica (cifras leídas de los datos al compilar), los cuatro pasos del cruce (filtro, candidatos, verificación, centralidad), regla de cobertura sustantiva, evaluación, limitaciones, ética.
- Métricas puestas, tomadas de STATUS y de `results/jev/corpus_analysis/README.md`: candidatos 95 %; precisión 88–91 % (190 pares revisados) y 92 % en la muestra; exhaustividad 67 %; noticias sin expediente sin vínculo 98 %. Van como preliminares, con los tres cuidados de «Para redactar el reporte» (62 positivas, revisión humana sin cerrar, preguntas ajustadas con la muestra).
- Las cifras del pipeline están en la constante `RUN` de la página: hay que actualizarlas si se recalcula con el CSV final de la muestra.
- Por confirmar con el compañero: que el recorte de noticias largas (15.000 caracteres) deja el inicio; que el nombre «Jev 1.14» se puede publicar. Sigue pendiente el formulario de reporte (`REPORT_FORM_URL` apunta a example.com) y la licencia en la página de datos («[por definir]»).

## 2026-11-11 19:12 — pendiente: qué hacer con las votaciones de mociones en el sitio (#48–#51)

El usuario preguntó por qué el expediente 24290 muestra cientos de «Votación (Plenario): Moción de fondo». No es un error del exportador: es lo que hay en la base.
- El 24290 (jornadas 4x3) tiene 2.625 votaciones: 2.569 mociones de fondo (2.544 rechazadas), 33 de orden y solo 1 «Primer debate». 1.697 son de agosto de 2026, hasta 301 en un día: es la táctica de presentar mociones en masa para atrasar el proyecto, y Delfino registra cada una como votación.
- En lo exportado, 4.106 de las 4.723 votaciones (87 %) son mociones; 12 expedientes de toda la base tienen más de 20 votaciones. El sitio se diseñó pensando en 1–3 votaciones por expediente.
- Opciones: (A) mostrar completas solo las votaciones de trámite (debates, dispensas, plazo cuatrienal, etc.) y resumir las mociones en una tabla por tipo y resultado, con enlace a Delfino; (B) lo mismo, con las mociones en una lista compacta sin nominal; (C) dejar todo y paginar. Recomendación de Claude: A, y contar el número de mociones como dato del expediente (es señal de conflicto). Sin decidir.
- El usuario pidió además guardar la lista de lo que falta para el reporte final y el sitio: quedó en STATUS, sección «Sitio y reporte final: lo que falta».

## 2026-11-11 19:21 — decisión: las mociones se publican resumidas en una tabla (#48–#51)

El usuario aprobó la opción A de la entrada de 19:12. Hecho y verificado, sin commitear.
- `export_public.py`: las votaciones cuyo nombre empieza con «Moción» ya no salen una por una. Cada expediente lleva `motions` (tipo, aprobadas, rechazadas, otras = anuladas o empatadas, primera y última fecha) y `motions_count`; `votes_count` cuenta solo las votaciones de trámite, que conservan el voto nominal.
- Sitio: tabla «Mociones votadas» arriba de las votaciones (`VotesTable.astro`), nota «y N mociones votadas» en la ficha, columna `motions_count` en el CSV de expedientes y dos filas en el diccionario de datos; la metodología lo explica.
- Resultado: 617 votaciones en detalle y 4.106 mociones resumidas. `site/src/data/` baja de 33 a 13 MB y dist de 149 a 103 MB. La página del 24290 pasa de 30 MB a menos de 0,6 MB; la más pesada ahora es la del 24037 (1,4 MB). El máximo de votaciones en detalle por expediente es 11.
- Caveat: la línea de tiempo del expediente ya no marca las mociones; la tabla no enlaza a Delfino porque no hay una URL por expediente en la base (solo por votación).
- Regla nueva de logs: no se escribe el nombre del usuario, se pone «el usuario». Se corrigieron las entradas de hoy desde las 18:14 (excepción puntual al append-only, pedida por el usuario).

## 2026-11-11 19:46 — pendiente: dónde y cómo se hostea el sitio (#48–#51)

El usuario preguntó los pasos para publicar el sitio y si hay que hostear la base. Hallazgos, sin cambios de código:
- No hay que hostear ninguna base: el sitio es estático (Astro, `output: 'static'`). `export_public.py` lee la base y los CSV de Jev y escribe `site/src/data/`; el build convierte eso en HTML, JSON y CSV. Lo privado (base, texto de noticias, embeddings, `raw/`, respuestas crudas de Jev) nunca sale de la máquina.
- El deploy que hay no corre tal como está: el workflow está en `site/.github/workflows/deploy.yml` y GitHub solo lee `.github/workflows/` en la raíz del repo; además no indica `path: site`, y `astro.config.mjs` usa la base `/cr-legislative-coverage-site`, que no coincide con este repo (`cr-legislative-coverage`). Parece pensado para un repo aparte.
- El build en GitHub necesita `site/src/data/` commiteado (13 MB), porque la base no está en git. Eso responde la decisión abierta 4 si se elige construir en GitHub.
- Opciones: (A) GitHub Pages desde este mismo repo: mover el workflow a la raíz, `path: site`, base `/cr-legislative-coverage`; el dueño del repo (el compañero) activa Pages. (B) repo aparte `cr-legislative-coverage-site` del usuario, con el contenido de `site/`: no hay que tocar la base ni el workflow. (C) Netlify o Cloudflare Pages subiendo `dist/`. Recomendación de Claude: A si el repo es público o se puede hacer público; si no, B. Sin decidir. En esta máquina no hay `gh`, así que no se pudo ver si el repo es público.
- Regla de logs ampliada: al compañero del usuario tampoco se le nombra; se escribe «el compañero» o «la contraparte».

## 2026-11-11 20:22 — decisión: hosting en GitHub Pages desde este repo; formulario y licencia ocultos (#48 #51)

El usuario eligió la opción A de la entrada anterior y pidió commitear en la rama `siteV1`.
- Deploy: el workflow pasó de `site/.github/workflows/` a `.github/workflows/deploy.yml` en la raíz, con `path: site` y disparo solo cuando cambia `site/` o el workflow; la base de `astro.config.mjs` es ahora `/cr-legislative-coverage`. Corre con push a `main` (o a mano), no desde `siteV1`: se publica al mezclar la rama.
- Falta, del lado del compañero (dueño del repo): Settings → Pages → Source «GitHub Actions». El repo es público (la API de GitHub responde sin autenticación).
- Formulario de reporte y licencia desactivados hasta que existan: `REPORT_FORM_URL` y `DATA_LICENSE` valen `null` en `site/src/lib/config.ts`, y con eso se ocultan el enlace «¿Este vínculo está mal?», sus menciones (ficha del expediente y metodología) y la línea de licencia de la página de datos. Para reactivar basta poner el valor.
- Revisión de privacidad antes del commit: `site/src/data/` solo trae campos públicos (sin `content`, `description` ni autor); las carpetas V1 están ignoradas; quedan fuera `.vscode/` y `site/.vscode/settings.json`.
- Issues leídos por la API: #48 hosting, #49 consulta por expediente, #50 por medio y fecha, #51 limitaciones. Ninguno se cierra todavía: #48 cierra cuando el sitio esté en línea.

## 2026-11-13 10:53 — pendiente: mostrar el texto del proyecto en la página de cada expediente (#49)

El usuario preguntó si se puede incrustar el texto de cada proyecto en su página. Solo se revisó la viabilidad, sin código.
- Hay texto para los 1.126 expedientes publicados en `raw/text/asamblea/bills/<number>.txt` (texto plano, una línea por párrafo, sin formato ni tablas): 1.046 con texto completo, 7 solo con una nota y 73 sin texto en el SIL. Pesan 44,6 MB (mediana 16 KB); 20 pasan de 200 KB y son casi todos presupuestos (el 25754 pesa 5,3 MB). Sin esos 20 son 28 MB.
- No se puede enlazar al documento en el SIL: el .docx sale de un POST con sesión, sin dirección fija, y los .docx no se guardaron.
- Es el «texto base» (como se presentó), no el texto vigente tras mociones o dictámenes: hay que rotularlo así.
- Opciones: (A) sección «Texto del proyecto» en la ficha, en un recuadro con scroll, que carga un archivo estático por expediente solo al abrirlo; (B) página aparte `/expediente/<n>/texto/`; (C) solo la exposición de motivos en la ficha. Recomendación de Claude: A, con tope de tamaño para los presupuestos (se muestra el inicio y se avisa). Sin decidir. Exige commitear los textos (repo público); son documentos oficiales públicos, a diferencia de las noticias.

## 2026-11-13 12:16 — decisión: el texto base del proyecto se lee en la ficha del expediente (#49)

El usuario aprobó la opción A de la entrada de 10:53 y pidió un enlace a la fuente, o un script para hacerlo después. Hecho y verificado con build, sin commitear (rama `main`).
- `export_public.py`: copia el texto base de cada expediente publicado a `site/public/textos/<number>.txt` (opciones `--texts-dir` y `--texts-out`) y agrega `text` (available, truncated, words) al JSON del expediente. Tope `TEXT_MAX_CHARS` = 150.000 caracteres, cortado en un párrafo.
- Resultado: 1.053 textos (33 cortados, casi todos presupuestos) y 73 expedientes sin texto en el SIL. `site/public/textos/` suma unos 28 MB de texto; dist pasa a 134 MB.
- Sitio: componente nuevo `BillText.astro`, sección «Texto del proyecto» al final de la ficha. Recuadro con scroll (70 % del alto de la pantalla) que baja el archivo solo al abrirlo; las líneas cortas en mayúsculas van en negrita como encabezados. Avisa que es el texto base, sin los cambios posteriores, y sin el formato original.
- Enlace a la fuente: va a la entrada del SIL (`SIL_URL` en `site/src/lib/config.ts`) y dice que se busca con el botón «Texto base». No hay enlace directo por documento: el .docx sale de una consulta con sesión.
- `download_bill_documents.py` (raíz, nuevo): baja los .docx originales de los expedientes publicados a `raw/docx/asamblea/bills/`, para ofrecerlos como descarga más adelante. Sin probar contra el SIL: necesita la caché `raw/csv/asamblea/bills/<n>/general`, que solo está en la máquina del compañero. Son unos 200 KB por archivo (~225 MB los 1.126), así que no caben bien en git: habría que decidir dónde alojarlos.
- No se probó en un navegador: se revisó el HTML generado, la ruta del archivo y que `astro check` y el build pasan.

## 2026-11-13 15:11 — decisión: texto del proyecto arriba en la página del expediente y aclaraciones a metodología (#49)

- A pedido del usuario, la sección «Texto del proyecto» pasó de después de Proponentes a justo después de las tarjetas de cifras, antes de «Cobertura y trámite».
- El aviso «Cada vínculo indica su origen…» ya no usa la clase `callout` (recuadro gris); es un párrafo `small muted`. La clase sigue en global.css, sin uso.
- Las aclaraciones del texto base (qué texto es, sin formato, botón «Texto base», sin enlace directo) y la nota de fuentes del pie pasaron a metodología, sección Fuentes (ítem nuevo «Texto de los proyectos» y un párrafo final).
- Elegido por Claude, a confirmar: en la página del expediente queda una línea corta bajo el texto (enlace al SIL y a Metodología) y un pie «Fuentes y alcance de los datos: Metodología».
- `astro check` 0 errores, build 3751 páginas. Sin probar en navegador. Sin commit.

## 2026-11-13 15:33 — decisión: votaciones como círculos por fracción, con la vista anterior recuperable (#49)

- A pedido del usuario, cada votación se muestra con un círculo por diputación, coloreado por fracción, en una fila por sentido del voto (A favor, En contra, y Abstención/Ausente si hay), con el total al lado. El nombre sale al pasar el cursor. La tabla por fracción queda en un desplegable «Ver conteo por fracción»; la votación nominal sigue igual.
- Colores dados por el usuario: PUSC azul, Pueblo Soberano celeste, PLN verde, FA amarillo, Coalición Agenda Ciudadana rojo. Están en `site/src/lib/parties.ts`.
- Elegido por Claude, a confirmar: colores de las ocho fracciones de legislaturas anteriores que aparecen en votaciones viejas (PPSD morado, PNR verde azulado, PLP naranja, PAC magenta, PRN café, PIN gris azulado, PRSC gris oscuro, Independiente gris) y el orden de las fracciones (el de esa lista).
- Para volver a la vista anterior (tabla con barra apilada): `<VotesTable ... layout="table" />` en `site/src/pages/expediente/[number].astro`. El componente conserva las dos vistas.
- Se quitó el pie «Fuentes y alcance de los datos: Metodología» de la página del expediente (el enlace ya está en el pie del sitio).
- `astro check` 0 errores, build 3751 páginas. Sin probar en navegador. Sin commit.

## 2026-11-13 15:50 — decisión: la lista de fechas del trámite queda plegada bajo el gráfico de cobertura (#49)

- A pedido del usuario, en «Cobertura y trámite» la lista numerada de eventos (pasos y votaciones con su fecha) va dentro de un desplegable «Ver las fechas del trámite (N eventos)», cerrado por defecto. El gráfico semanal y la franja del trámite completo siguen siempre visibles.
- Los números de los marcadores del gráfico remiten a esa lista; con la lista cerrada el detalle sale al pasar el cursor sobre el marcador.
- Cambio solo en `site/src/components/Timeline.astro`. `astro check` 0 errores. Sin probar en navegador. Sin commit.

## 2026-11-13 16:00 — decisión: las noticias vinculadas van al final de la página del expediente (#49)

- A pedido del usuario, «Noticias vinculadas» pasó a después de Proponentes. Orden actual de la página: Texto del proyecto, Cobertura y trámite, Votaciones, Proponentes, Noticias vinculadas.
- `astro check` 0 errores. Sin probar en navegador. Sin commit.

## 2026-11-13 16:15 — decisión: gráfico de cobertura más limpio, noticias sobre el eje y trámite debajo (#49)

- A pedido del usuario se rediseñó el gráfico «Noticias por semana» de `Timeline.astro`: un eje con un círculo por mes; arriba, las noticias de cada semana como barras finas con su número; abajo, los eventos del trámite. Sin eje vertical ni rejilla.
- Elegido por Claude, a confirmar: los eventos que caen el mismo día comparten una marca con el rango («19–23»); antes se encimaban (en 24290 había 9 marcas sobre 3 puntos). Votación = marca naranja rellena, paso = marca con borde.
- Período de estudio más discreto: en la franja del trámite completo pasó de un recuadro azul a una línea fina gris con su etiqueta; en el título, las fechas van en letra pequeña.
- La versión anterior está en git (`git show HEAD:site/src/components/Timeline.astro`); la lista plegada de fechas no cambió.
- `astro check` 0 errores y build completo. No se pudo ver renderizado: Firefox sin ventana no generó la captura y no hay otro renderizador en esta máquina; se revisaron solo las coordenadas del SVG generado. Sin commit.

## 2026-11-13 18:07 — decisión: lista de fechas como línea de tiempo vertical sencilla y período de estudio como un solo palito (#49)

- A pedido del usuario, la lista plegada de fechas del trámite pasó a una línea de tiempo vertical corriente: riel fino que une los eventos, fecha en una línea pequeña, título debajo y detalle, con más aire entre eventos (`Timeline.astro`, solo estilos).
- En la franja del trámite completo, el período de estudio ya no es una línea horizontal, que se salía por la izquierda en expedientes presentados dentro del período. Ahora es un palito punteado con la etiqueta «inicio del período de estudio», sujeto al borde izquierdo cuando el expediente es más nuevo que el período; la etiqueta pasa a la izquierda del palito si queda cerca del borde derecho.
- `astro check` 0 errores y build completo. Sigue sin verse renderizado. Sin commit.

## 2026-11-13 18:08 — corrección: el palito del período de estudio no se dibuja en expedientes presentados después de su inicio (#49)

- Corrige la entrada anterior: sujetar el palito al borde izquierdo decía «inicio del período de estudio» en una fecha que no lo era (p. ej. 25894, presentado el 4 nov 2026). Ahora, si el expediente se presentó después del inicio del período, la franja no lleva palito ni etiqueta.
- `astro check` 0 errores y build completo. Sin commit.

## 2026-11-13 18:44 — página «Evaluación de la página» con el objetivo y el enlace al cuestionario (#49)

- A pedido del usuario: página nueva `site/src/pages/evaluacion.astro`, enlazada en el pie junto a Metodología y Datos y descargas. Tiene «Nuestro objetivo» y un botón al cuestionario (Google Forms, `EVALUATION_FORM_URL` en `site/src/lib/config.ts`).
- El texto del objetivo lo redactó Claude a partir del lema del sitio; el usuario debe revisarlo o dar el texto oficial. No se describe el cuestionario (duración, anonimato) porque Claude no lo vio.
- `astro check` 0 errores, build 3752 páginas. Sin probar en navegador. Sin commit.

## 2026-11-13 18:50 — README del sitio con el flujo para actualizar la página (#48)

- A pedido del usuario, `site/README.md` (antes la plantilla de Astro) explica el flujo: cambio de presentación o de datos (exportador), revisar con dev/check/build, revisar qué se sube, commit y push a main, comprobar la corrida en Actions. En español; elegido por Claude ponerlo en `site/` y no en el README raíz, que está vacío y corresponde a #47.
- La página de evaluación se vincula a #52 (protocolo y cuestionario de usabilidad).

## 2026-11-13 18:58 — decisión: página del expediente sin recuadros, secciones separadas por una línea gris (#49)

- A pedido del usuario se quitaron los recuadros (fondo, borde y relleno) del gráfico de cobertura, de la tabla de mociones y de cada votación. Cada sección de la página empieza con una línea fina (`var(--border)`) y las votaciones se separan entre sí con la misma línea.
- Elegido por Claude, a confirmar: siguen con recuadro las tarjetas de cifras de arriba, las fichas de proponentes y la caja con scroll del texto del proyecto. La clase global `.card` no cambió (la usa la página de noticia).
- Archivos: `Timeline.astro`, `VotesTable.astro`, `expediente/[number].astro` (solo estilos). `astro check` 0 errores, build completo. Sin ver en navegador. Sin commit.

## 2026-11-13 19:04 — commits de la ficha sin recuadros; los del texto, votaciones y evaluación ya están en origin/main (#49)

- El usuario subió 9842982, d3b81db y 544e96e (main al día con origin). La ficha sin recuadros va en un commit propio más el de logs.
