# Revisión de fact_check y press_release (test100, 2026-11-10)

Dos subagentes leyeron el texto completo de cada caso y dieron su propio veredicto con la definición que busca la investigación. Además de los casos en que Jev dijo que sí, leyeron noticias en que dijo que no, para comparar. Las citas clave se verificaron contra el texto. Lista de casos: `review_dubious.md`.

## fact_check

**Resultado:** de los 16 pares en que Jev dijo que sí (≥ 0,5), 5 son aciertos, 3 son dudosos y 8 son falsos positivos. Las 5 noticias en que dijo que no (< 0,2) están bien. La probabilidad no separa los grupos: el par más alto (0,88, Semanario) es un falso positivo.

**Aciertos:**
- Nación: «Laura Fernández acusa a la oposición de obstruir: esto muestran 35 proyectos votados». La Nación revisó las votaciones. Acierto en 23414, 24717 y 24009.
- Nación: «Bloque opositor celebra cambio de criterio…». El medio corrige: «lo cual no es real, pues el proyecto…». Acierto en 22623.
- El Mundo: impuesto a rentas del exterior. «Contrasta con una declaración pública» de Fernández. Acierto en 25796.

**Patrones de error (11 pares):**

| Patrón | Pares |
|---|---|
| Una fuente disputa, acusa o rebate a otra («¡No mienta…!», «negó», «refutó») | 4 |
| Contagio entre expedientes: la verificación es sobre otro expediente y este solo aparece como dato | 3 |
| Una institución advierte o corrige (Contraloría) y el medio solo lo transmite | 1 |
| La oposición critica una moción | 1 |
| Un actor justifica su propio voto | 1 |
| Columna de opinión que argumenta | 1 |

**Señales:**
- Los falsos positivos tienen `conflict_frame` alto (0,81–0,94 en 6 de 8) y léxico de disputa.
- Los aciertos tienen un marcador en la voz del medio («revisó», «contrasta con», «lo cual no es real») y evidencia propia (votos, cifras, declaraciones anteriores).

En resumen, Jev responde «¿alguien en el texto disputa una afirmación?» y no «¿el medio verifica?».

**Posibles falsos negativos:** el resumen semanal de Delfino verifica la exposición de motivos de 25796 y 25798, pero esos pares no se le preguntaron a Jev.

## press_release

**Resultado:** de las 17 noticias en que Jev dijo que sí, 9 son claramente sí, 2 son casi sí, 3 son dudosas y 3 son no. Las 6 noticias en que dijo que no están bien.

**Aciertos:**
- Comunicados de gremios, ministerios o fracciones, y declaraciones de una sola persona sin réplica (Garnier, Kattia Calvo, Barzuna).
- 6 de los 9 son de El Mundo, con la entradilla «San José, dd mmm (elmundo.cr) –». Tres van firmados por «Edmundo».
- Estructura: «X anunció/manifestó», citas y paráfrasis, y cierre con «concluyó».

**Errores:**

| Patrón | Noticias |
|---|---|
| Resumen o explicación de un proyecto (plantilla de Delfino «presentó a la corriente legislativa…», explicación del articulado en Nación) | 3 |
| Nota de un hecho con contexto propio, o una fuente oficial con una segunda voz (la nota de CRHoy de la comisión, la de la Contraloría) | 2 |
| Columna de opinión (Delfino, «Una policía civilista»; Jev le puso genre = opinion 1,0) | 1 |

**Filtro por género** (preguntar `press_release` solo si genre = news_report): saca solo la columna y no pierde ningún acierto. Hay que usar el género más probable; si se exige confianza ≥ 0,7, se pierden dos aciertos.

## Propuestas de redacción (para validar)

### fact_check

```
Does `news` itself, in the outlet's or journalist's own voice, check a specific claim about {bill} against evidence and say whether it holds?
true: the article's own narration (not a quoted person or body) says a claim about this file is false, inaccurate, misleading or contradicted (or confirms it), pointing to evidence: the file's text, vote records, earlier statements or data the outlet gathered. The claim can come from anyone, including the file's own exposition of motives.
false: one actor calls another a liar or rebuts them and the article only reports both sides; an institution, court or association objects or corrects and the article relays it; a person defends their own vote; an opinion column argues; the article explains the file without contrasting it with a prior claim; the checked claim is about another file and this one only appears as an example.
```

### press_release

```
Is `news` a news report that mainly passes on one source's statement, announcement or communiqué (an institution, party, deputy, union, organization or government office) in that source's own words and framing, with little or no reporting of its own?
true: built around one source's announcement or statement; quotes and paraphrases it, takes its side, no other voices or reactions, at most a sentence or two of background.
false: an opinion column, interview or analysis; reporting that adds other sources, reactions, data or background; or the reporter explains a document (a bill's articles, a vote, a technical report) in their own words.
```

Regla combinada: el género más probable es news_report y `press_release` ≥ 0,6.

## Validación de las redacciones nuevas (results/jev/test100_rewrite/)

Hubo una request por noticia con match (46 noticias), con la vieja y la nueva redacción en la misma request y el mismo estado del detalle. Se pagó con la llave tests: 219.125 tokens, ≈ $0,009. La vieja reproduce la corrida original con ±0,03.

| | Vieja: sí | Vieja: aciertos / falsos | Nueva: sí | Nueva: aciertos / falsos / se pierden |
|---|---|---|---|---|
| press_release (23 noticias revisadas) | 17 | 11 / 6 | 9 | 9 / 0 / 2 (las dos «casi sí») |
| fact_check (21 pares revisados) | 16 | 5 / 8 (+3 dudosos) | 4 | 3 / 0 / 2 (+1 dudoso) |

- **press_release:** desaparecen los 6 errores (los resúmenes de proyectos, la nota de la comisión, la de la Contraloría y la columna). Siguen todos los sí claros. Se pierden las dos «casi sí»: Delfino con el proyecto más una cita de la diputada (0,23) y el informe del OES-UNA (0,44). Con la redacción nueva, el filtro por género ya no cambia nada.
- **fact_check:** desaparecen los 8 falsos positivos; todos quedan en 0,20 o menos. Se pierden 2 aciertos claros:
  - la corrección a Ariel Mora en Nación (22623), que baja de 0,85 a 0,25;
  - las 651 frente a 551 mociones de Crucitas (24717), que baja de 0,57 a 0,17.
- **fact_check fuera de los pares revisados:** la nueva dice que sí en 4 pares.
  - 2 son probables aciertos: el resumen semanal de Delfino verifica la exposición de motivos de 25796 y 25798 (0,70 y 0,67). El subagente los había señalado como falsos negativos de la vieja.
  - 2 son columnas de opinión (Nación, José Luis Arce, 21346; Semanario, 24196). Jev les puso genre = opinion, así que se descartan si no se cuenta fact_check cuando el género es opinion.
- **Contagio entre expedientes:** sigue en el límite: en cacb84cb, 24625 da 0,51 y 25291 da 0,49.
