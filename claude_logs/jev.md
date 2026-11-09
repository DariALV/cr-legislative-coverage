# jev — evaluador TypeSafe (Jev)

Diario del tema. Las pruebas del 2026-11-08 se escribieron en `general.md` antes de que existiera este tema; no se copian, se indexan aquí.

## 2026-11-09 10:00 — tema jev creado: índice de las pruebas del 2026-11-08 y dónde están los datos crudos (#34 #39 #43)
- Entradas en `general.md` (buscar por título con `grep -A 15`): «diseño de las preguntas a Jev» (19:22), «Costo de Jev para 29.698 noticias × K» (19:40), «Filtro previo de noticias antes de Jev» (19:54), «Prueba v2 de Jev» (20:05), «pruebas del filtro de Jev por noticia» (20:23, 20:52), «el filtro de Jev se queda con las preguntas en inglés» (21:06), «Prueba de Jev contra las etiquetas de la muestra» (21:21).
- Probabilidades por noticia o par: `results/jev/*.csv`.
- Respuestas crudas de la API (una línea por request): `results/jev/answers/answers_*.jsonl`; barrido de K: `results/jev/answers/k_sweep.json`.
- Scripts que generaron todo (antes desechables, en el scratchpad): `results/jev/scripts/`. Leen `TYPESAFE_API_KEY` de `.env`. No se guardaron los payloads con el texto de las noticias (`payloads_v1.json`, 1 MB); se regeneran con `jev_probe.py`.

## 2026-11-09 15:40 — decisión: no se amplía la muestra; la prioridad pasa a ser Jev (#34 #39 #27)

- El usuario: es un trabajo universitario y queda poco tiempo. El ranker anda bien (~0,95 en la muestra) y Jev también; según el usuario, sus errores en la prueba contra la muestra (general 2026-11-08 21:21) se explican por etiquetas mal puestas y ambigüedades que le costarían hasta a un humano. No se agregan noticias a la muestra; las siguientes pruebas son de Jev.
- Hueco principal: nunca se probó de punta a punta. Las pruebas v1/v2 usaron candidatos de relleno por TF-IDF, no el top-50 del ranker, y en 21 noticias.

## 2026-11-09 15:46 — decisión: diseño de la prueba de punta a punta (ranker top-50 → Jev) en la muestra (#34 #39)

- Prueba: las 300 noticias de la muestra, top-50 del ranker evolutivo y un request a Jev por noticia. Se compara contra las etiquetas: recall y precisión por expediente, más el acierto de «ninguno» en las negativas.
- (1) La pregunta de match se corrige: cualquier expediente del SIL cuenta (nombramientos, comisiones, Reglamento), no solo proyectos de ley.
- (2) «Mismo tema» no abre la puerta del match, pero se guarda como señal aparte. El usuario lo quiere para el análisis: el problema que trata un expediente puede tener cobertura aunque el expediente no la tenga.
- (3) Umbral fijo de 0,5 decidido de antemano; se reportan las curvas.
- (4) Se agrega la segunda ráfaga de preguntas para los pares que pasan la puerta: tono (cobertura positiva o negativa) y profundidad (bien cubierta o por encimita). El usuario quiere usarla en el reporte. Falta definir su redacción.

## 2026-11-09 15:57 — pendiente: preguntas extra de la segunda ráfaga, solo para los pares que pasan el match (#34 #39)

- El usuario aprueba el diseño de la prueba de punta a punta: clase real en tools/llm_tools/jev.py (#10), top-50 en CSV desde la máquina con los embeddings, etiquetas de hoy con re-corrida al cerrar la revisión. Pide más preguntas para los pares con match: posición de cada partido (5 escalas) y todo lo que informe sobre el expediente.
- Partidos 2026-2030 según deputy_factions: Pueblo Soberano 31, Liberación Nacional 17, Frente Amplio 7, Unidad Social Cristiana 1, Coalición Agenda Ciudadana 1.
- Propuesta de Claude (sin respuesta): Choice de 6 opciones por partido y por el Ejecutivo; Nouls de voces citadas; Choice de etapa del trámite; Nouls de contenido (explica, impacto, cifras, conflicto); género por noticia. Validación con la base: posición del partido contra sus votos en vote_deputies, etapa contra bill_steps. En el estado va la lista de diputados con su partido.

## 2026-11-09 16:01 — decisión: se aprueban todas las preguntas extra; pendiente: diseño de la clase Jev (#10 #34)

- El usuario aprueba toda la lista: postura de los 5 partidos y del Ejecutivo (Choice de 6 opciones), 6 voces citadas, etapa del trámite, 4 preguntas de contenido y género por noticia, más centralidad, postura, author_judges y new_development.
- Claude empezó a escribir código antes de acordar la clase; el usuario lo frenó. No se escribió nada. Propuesta de diseño en el chat (sin respuesta): SDK typesafe_sdk en lugar de HTTP a mano; clases separadas para la API (Jev), el contexto de la base (fichas y lista de diputados) y la corrida (reanudable, con tope de costo); 2 requests por noticia; salida en JSONL crudo más CSV en formato largo; modelo fijado a una versión.

## 2026-11-09 16:12 — Implementada la clase Jev y la prueba de punta a punta; probada con 3 noticias (#10 #34 #39)

- Código: `tools/llm_tools/jev.py` (Jev, solo API, con el SDK typesafe_sdk; reemplaza el stub de prueba), `jev_questions.py` (redacción de todas las preguntas), `jev_context.py` (fichas de expediente con los 3 primeros proponentes y su partido, y la lista de los 57 diputados 2026-2030), `jev_runner.py` (2 requests por noticia, reanudable con answers.jsonl, tope de costo, 3 hilos; escribe gate.csv, news.csv, details.csv en formato largo y run.json). `tools/retrieval_tools/candidate_ranker.py` (top-K para cualquier noticia con la receta evolucionada, solo numpy, estandariza con la media y el desvío del oro) y `tools/sample_tools/sample_labels.py` (lee el CSV exportado de la pestaña Etiquetas). Scripts: `run_candidates.py`, `run_jev.py`, `run_jev_eval.py`. Config: RANKER_RECIPE, CANDIDATES_K y JEV_*.
- Receta: semilla 7, elegida por el CV en el oro (@50 0,960 contra 0,948 de la semilla 100), no por la muestra.
- Versión: la API solo ofrece los alias jev-latest y jev-preview; se usa jev-latest y cada respuesta guarda el modelo que informa la API (hoy jev-1.14.0).
- Prueba real (3 noticias de la muestra, 12–15 candidatos de relleno al azar, 5 requests, 41.112 tokens, $0,0017): la puerta acierta en 22817; en 22388 y 23667; y da ninguno en la negativa. Se verificó que retoma sin repetir requests y que run_jev_eval corre con un CSV de etiquetas de prueba. Se borró la carpeta de prueba.
- Sin probar: `candidate_ranker.py` y `run_candidates.py`, porque en esta máquina no hay numpy ni embeddings. Tienen que correr en la otra máquina antes de la prueba de las 300.
- Evaluación: la verdad es el expediente principal más los otros mencionados; un match en un "alternativo" no cuenta como falso positivo. Salen métricas para todas y para las «Correcto», curvas de 0,05 a 0,95, resultados por medio, centralidad y una lista de errores (eval_errors.csv) para la adjudicación.

## 2026-11-09 16:25 — Ajuste de dos preguntas del detalle tras revisar la noticia del veto a mano (#34)

- Revisión manual de la nota del veto (22817, CRHoy) contra las respuestas: centralidad, postura, juicio del autor, hecho reciente, Ejecutivo, voces y contenido cuadran con el texto. Dos fallas de redacción, ajustadas con permiso del usuario:
  - «Oficialismo»: Jev atribuía a Pueblo Soberano (en contra, 0,81) el voto de la fracción oficialista de la Asamblea 2022-2026. Ahora la ficha del partido dice que la equivalencia vale solo desde mayo de 2026. Resultado: no_mentioned 0,59 (en contra 0,28).
  - `gives_figures` contaba los números de expediente como cifras: la columna de opinión daba 0,87. Ahora excluye números de expediente y de ley, fechas y votaciones. Resultado: columna 0,02–0,03; la nota del veto 0,74 (55 años, 10 años de servicio).
- Re-corrida de 2 noticias, $0,0014; se borró la carpeta de prueba.
