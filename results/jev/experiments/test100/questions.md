# Preguntas de la prueba de 100 noticias (Jev)

La 🆕 marca las preguntas nuevas, que nunca se le habían hecho a Jev. Las respuestas sí/no son probabilidades de 0 a 1. Los textos exactos que recibe Jev, en inglés, están en `tools/llm_tools/jev_questions.py`.


## Puerta: una vez por noticia

| # | Pregunta | Nivel | Tipo | Opciones | Qué mide |
|---|---|---|---|---|---|
| 1 | `genre` | noticia | choice | news_report, opinion, interview, analysis | Género de la pieza |

## Puerta: por cada uno de los 50 candidatos

| # | Pregunta | Nivel | Tipo | Opciones | Qué mide |
|---|---|---|---|---|---|
| 1 | `explicit` | expediente | noul | sí / no (probabilidad) | ¿Nombra el expediente (número, título o apodo)? |
| 2 | `implicit` | expediente | noul | sí / no (probabilidad) | ¿Habla del expediente sin nombrarlo? |
| 3 | `same_topic` | expediente | noul | sí / no (probabilidad) | ¿Trata el mismo problema público que el expediente? |

## Detalle: una vez por noticia con match

| # | Pregunta | Nivel | Tipo | Opciones | Qué mide |
|---|---|---|---|---|---|
| 1 | `press_release` 🆕 | noticia | noul | sí / no (probabilidad) | ¿Parece un comunicado reproducido casi tal cual, sin reporteo propio? |
| 2 | `main_frame` 🆕 | noticia | choice | conflict, economic, human_interest, responsibility, morality, policy | Encuadre dominante de la nota |
| 3 | `assembly_image` 🆕 | noticia | score | 0–4 | Cómo retrata a la Asamblea como institución (0 muy negativo – 4 muy positivo) |
| 4 | `headline_misleading` 🆕 | noticia | noul | sí / no (probabilidad) | ¿El título exagera o contradice el cuerpo? |

## Detalle: por cada expediente con match

| # | Pregunta | Nivel | Tipo | Opciones | Qué mide |
|---|---|---|---|---|---|
| 1 | `centrality` | expediente | score | 0–2 | Cuánto de la nota trata del expediente (0 de paso – 2 tema principal) |
| 2 | `stance` | expediente | score | 0–4 | Opinión que transmite la nota sobre el expediente (0 muy crítica – 4 muy favorable) |
| 3 | `author_judges` | expediente | noul | sí / no (probabilidad) | ¿El autor (no un citado) dice que es bueno o malo? |
| 4 | `new_development` | expediente | noul | sí / no (probabilidad) | ¿Informa algo que acaba de pasar en el trámite? |
| 5 | `pueblo_soberano` | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida a Pueblo Soberano |
| 6 | `liberacion_nacional` | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida a Liberación Nacional |
| 7 | `frente_amplio` | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida al Frente Amplio |
| 8 | `unidad_social_cristiana` | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida a la Unidad Social Cristiana |
| 9 | `agenda_ciudadana` | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida a Agenda Ciudadana |
| 10 | `independents` 🆕 | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida a independientes u otros partidos |
| 11 | `executive` | expediente | choice | not_mentioned, strongly_against, against, neutral_or_divided, in_favor, strongly_in_favor | Posición atribuida al Ejecutivo (presidente, ministros, vocería) |
| 12 | `voice_business` | expediente | noul | sí / no (probabilidad) | ¿Cita a empresarios o cámaras? |
| 13 | `voice_labor` | expediente | noul | sí / no (probabilidad) | ¿Cita a sindicatos o trabajadores? |
| 14 | `voice_experts` | expediente | noul | sí / no (probabilidad) | ¿Cita a académicos o expertos independientes? |
| 15 | `voice_civil_society` | expediente | noul | sí / no (probabilidad) | ¿Cita a ONG, activistas o grupos comunales? |
| 16 | `voice_institutions` | expediente | noul | sí / no (probabilidad) | ¿Cita a otras instituciones públicas (CCSS, Contraloría, Defensoría, Sala IV, municipalidades)? |
| 17 | `voice_affected` | expediente | noul | sí / no (probabilidad) | ¿Cita a personas afectadas, hablando por sí mismas? |
| 18 | `stage` | expediente | choice | filing, committee, first_debate, second_debate, veto_or_signing, constitutional_court, archived_or_rejected, not_stated | En qué etapa del trámite está, según la nota |
| 19 | `explains_content` | expediente | noul | sí / no (probabilidad) | ¿Explica qué haría o cambiaría? |
| 20 | `explains_impact` | expediente | noul | sí / no (probabilidad) | ¿Dice a quién afecta o qué consecuencias tendría? |
| 21 | `gives_figures` | expediente | noul | sí / no (probabilidad) | ¿Da cifras de lo que haría o causaría (no cuentan números de expediente, fechas ni votos)? |
| 22 | `conflict_frame` | expediente | noul | sí / no (probabilidad) | ¿Lo presenta sobre todo como pelea política, más que explicarlo? |
| 23 | `in_headline` 🆕 | expediente | noul | sí / no (probabilidad) | ¿El título se refiere al expediente? |
| 24 | `names_proponent` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Dice quién lo propuso? |
| 25 | `deputy_quoted` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Cita o parafrasea a un diputado sobre el expediente? |
| 26 | `background` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Da antecedentes (cuándo se presentó, qué pasó antes)? |
| 27 | `explains_procedure` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Explica el trámite (qué es un debate, dictamen, vía rápida, dispensa, cuántos votos necesita)? |
| 28 | `vote_reported` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Informa cómo se votó (conteo, quién votó qué)? |
| 29 | `votes_outlook` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Dice si tiene o no los votos para aprobarse? |
| 30 | `fast_track` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Dice que va por vía rápida, dispensa de trámite u otra forma de acelerarlo? |
| 31 | `executive_agenda` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Dice que el Ejecutivo lo convocó o lo sacó de las sesiones extraordinarias? |
| 32 | `deadline` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Menciona un plazo (cuatrienal, fecha para votarlo)? |
| 33 | `constitutionality` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Plantea dudas de constitucionalidad o menciona consulta/resolución de la Sala IV? |
| 34 | `funding` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Dice cuánto le costaría al Estado o de dónde sale la plata? |
| 35 | `international` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Lo compara con otros países o cita organismos internacionales? |
| 36 | `public_opinion` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Cita encuestas u opinión pública? |
| 37 | `human_story` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Lo ilustra con el caso de una persona o familia concreta? |
| 38 | `pressure_groups` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Dice que grupos de interés presionan a favor o en contra? |
| 39 | `fact_check` 🆕 | expediente | noul | sí / no (probabilidad) | ¿Verifica o corrige afirmaciones sobre el expediente? |

### Opciones de `main_frame`

- `conflict`: A disagreement between political actors: who attacks whom, who wins or loses.
- `economic`: The economic consequences of the issue: costs, gains, jobs, prices or taxes.
- `human_interest`: The personal or emotional side of the issue, told through people affected by it.
- `responsibility`: Who caused a problem or who should solve it.
- `morality`: Moral or religious principles, what is right or wrong.
- `policy`: What a public policy or a bill does and how it would work.

### Opciones de las posiciones (partidos, independientes, Ejecutivo)

- `not_mentioned`: The news does not say what this actor thinks of the file.
- `strongly_against`: The actor firmly opposes the file.
- `against`: The actor has objections to the file or leans against it.
- `neutral_or_divided`: The actor's position is neutral, undecided, or its members are split.
- `in_favor`: The actor supports the file, maybe with reservations.
- `strongly_in_favor`: The actor firmly supports or champions the file.

### Opciones de `stage`

- `filing`: The file was just presented or is waiting to start in committee.
- `committee`: The file is being discussed or reported in a committee.
- `first_debate`: The file is in the plenary for, or just went through, the first debate.
- `second_debate`: The file is in the plenary for, or just went through, the second and final debate.
- `veto_or_signing`: The file was approved and is being signed, vetoed or published as law.
- `constitutional_court`: The file is under review by the Constitutional Court (Sala IV).
- `archived_or_rejected`: The file was archived, rejected or withdrawn.
- `not_stated`: The news does not say where the file stands.
