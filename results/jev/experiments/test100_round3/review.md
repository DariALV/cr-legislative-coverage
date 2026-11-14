# Revisión de las preguntas de la tercera ronda (test100, 2026-11-10)

Dos subagentes leyeron las 46 noticias con match: 83 pares noticia–expediente, 23 noticias cada uno. Cada uno dio su propia respuesta a cada pregunta y la comparó con la de Jev. Para sí/no, Jev cuenta como sí con 0,5 o más; para source_count se toma su opción más probable.

| Pregunta | Coinciden | Errores | ¿Funciona? |
|---|---|---|---|
| voice_affected (vieja) | 59 / 83 | 24 falsos sí: diputados, el TSE, la CGR, Conare, gremios y expertos | No |
| voice_affected (nueva) | 82 / 83 | 1 falso sí: un manifestante detenido, afectado por la protesta y no por la ley | Sí, pero en la muestra no hay ningún afectado de verdad, así que no se sabe si los detectaría |
| next_step | 81 / 83 | 1 falso sí («negociaciones el próximo lunes») y 1 dudoso | Sí |
| own_evidence | 64 / 83 | 16 falsos no (0,23–0,48) y 1 falso sí (cifras dichas por un magistrado) | A medias: no reconoce como documento consultado una descripción breve de artículos, penas o montos, ni el texto citado en una columna |
| source_count | 27 / 46 | 19 cuenta de más; nunca cuenta de menos. Dice «tres o más» en 38 de 46 | No |

Por qué source_count cuenta de más:
- cuenta actores que solo se mencionan (partidos que votaron, firmantes, la proponente);
- cuenta a la gente que aparece dentro del relato de otra fuente;
- no junta en una sola fuente a los miembros del mismo partido o institución;
- cuenta por separado el proyecto, su exposición de motivos y las leyes que cita.

Redacciones propuestas (unión de las dos revisiones):

- **source_count:**
  > How many distinct sources does `news` itself attribute statements to, by quoting or paraphrasing them ('said', 'according to', 'stated')? Count a person, institution, party or organization only if the news reports something it said or wrote. Do not count actors merely mentioned, parties or deputies listed in a vote, a bill's proponent, people mentioned within another source's account, or documents and bills. Several people from the same institution or party count as one.

- **own_evidence:**
  > Besides people's statements, does `news` draw on documents or data about {bill} itself, such as quoting the bill's text or exposition of motives, describing its specific provisions (articles, penalties, amounts, percentages, deadlines), vote counts, budgets, official reports or statistics? Answer true even if it is brief or appears in an opinion piece. Answer false if everything said about {bill} comes from what people or institutions said about it.

- **voice_affected** (mejora opcional): agregar «affected by the consequences of {bill} itself, not by events around its debate such as protests or arrests».

- **next_step** (mejora opcional): agregar «Political negotiations or meetings between parties do not count unless tied to a scheduled legislative step».

Nota del matcher: 562eae9d hizo match con 25648 y con 21769, que tienen el mismo título. La noticia es sobre 25648; 21769 no aparece. Es la misma limitación de los expedientes hermanos (25400/25800).
