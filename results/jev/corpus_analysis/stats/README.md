# Estadística descriptiva de la corrida de Jev (2026-11-11)

Script: `stats.py`. Usa la misma fuente y los mismos dos niveles de `../README.md` (mayo–octubre de 2026). Salvo que se diga otra cosa, las cifras son de **cobertura sustantiva**. En las preguntas con escala (centralidad, posición, imagen de la Asamblea), cada respuesta va al nivel más cercano a su valor esperado. Las preguntas de sí o no cuentan como «sí» cuando la probabilidad es al menos 0,5.

## 1. Cuántas noticias tiene cada expediente (`news_per_bill.csv`, `news_per_bill_exact.csv`)

«Vivos» son los expedientes que hoy siguen en trámite, más los que tuvieron algún paso en el SIL entre mayo y octubre (2.156).

| Expedientes | Total | 0 | 1 | 2 | 3 | 4 | 5 | 6–9 | 10–19 | 20–49 | 50–99 | 100+ | Con cobertura |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Todos (20000–25897) | 5.898 | 5.328 | 233 | 99 | 61 | 32 | 28 | 48 | 33 | 27 | 6 | 3 | 9,7 % |
| Vivos en el período | 2.156 | 1.698 | 163 | 79 | 54 | 27 | 26 | 41 | 32 | 27 | 6 | 3 | 21,2 % |
| Con paso en el SIL (mayo–oct) | 924 | 550 | 108 | 68 | 50 | 24 | 25 | 37 | 29 | 25 | 5 | 3 | 40,5 % |
| Presentados en mayo–oct | 306 | 75 | 52 | 47 | 43 | 16 | 15 | 22 | 18 | 15 | 2 | 1 | 75,5 % |
| Con votación en el Plenario | 110 | 29 | 20 | 6 | 4 | 4 | 5 | 12 | 14 | 10 | 4 | 2 | 73,6 % |

Si se cuentan también las menciones de paso, los porcentajes con cobertura suben a 13,9 %, 30,5 %, 57,6 %, 80,1 % y 85,5 %.

- **Cuatro de cada cinco expedientes vivos no salen en ninguna noticia.** De los que sí salen, el 36 % aparece en una sola.
- **Concentración:** la mediana es 2 noticias por expediente cubierto, el percentil 90 es 16 y el máximo, 278 (armonización eléctrica). El Gini entre los cubiertos es 0,68, y entre los vivos (contando los ceros) es 0,93. **35 expedientes se llevan la mitad de la cobertura**; el top 10 se lleva el 31 % y el top 100, el 72 %.
- 250 expedientes se mencionan, pero nunca con cobertura sustantiva. 339 son el tema principal de al menos una noticia, y 69 lo son de 5 o más.

## 2. Otras cifras de volumen (`report.json`)

- **Expedientes por noticia:** de las 2.620 noticias con cobertura, 2.189 (84 %) tratan un solo expediente, 252 tratan dos y 179 tratan tres o más (hasta 11).
- **Medios por expediente:** 285 de los 570 expedientes cubiertos (50 %) aparecen en un solo medio, y 62 en los cinco. De los que salen en un solo medio, 140 son de Delfino.
- **Duración:** en los 337 expedientes con dos o más noticias, la mediana entre la primera y la última es de 31 días (percentil 75: 76 días). 256 de los 570 se cubren en un solo día.
- **Actividad y cobertura:** entre los vivos, la correlación de Spearman entre los pasos en el SIL del período y las noticias es 0,50; con las votaciones del Plenario es 0,32. Entre los que tienen cobertura baja a 0,37 y 0,26: la actividad explica si un expediente sale, más que cuánto sale.

## 3. Por tipo, año de presentación y estado (`coverage_by_*.csv`)

- **Tipo** (% de los vivos con cobertura): proyectos ordinarios 22,5 %, reformas constitucionales y magistrados 46,9 %, comisiones investigadoras 19,4 %, nombramientos 16,0 %, comisión de honores 6,9 %, permisos de atraque 0 de 64. Los 4 presupuestos cubiertos suman 313 noticias (mediana 64,5).
- **Año de presentación:** los de 2026 tienen cobertura en un 50,7 %; los de 2024–2025, en 14–16 %; los de 2022–2023, en ~9 %. Los anteriores casi no salen.
- **Estado actual:** en trámite 21,2 %; leyes 7,0 % del total, pero 43,2 % de las que tuvieron pasos en el período; archivados 3,1 %.

## 4. Preguntas de Jev por par y por expediente (`questions_by_bill.csv`)

Columnas: `pairs` son los pares noticia–expediente en cada opción. `bills_with_any` son los expedientes con al menos una noticia en esa opción. `bills_majority` son los expedientes cuya opción más frecuente es esa (los empates van aparte). `bills_by_mean`, solo en las escalas, ubica cada expediente por el promedio de sus noticias.

**Posición de la noticia sobre el expediente** (3.462 pares; 570 expedientes):

| Nivel | Pares | % | Expedientes con alguna | Por promedio |
|---|---|---|---|---|
| Muy crítica | 479 | 13,8 % | 97 | 16 |
| Algo crítica | 555 | 16,0 % | 154 | 80 |
| Neutral o equilibrada | 1.442 | 41,7 % | 392 | 266 |
| Algo favorable | 668 | 19,3 % | 273 | 162 |
| Muy favorable | 318 | 9,2 % | 162 | 46 |

- **Centralidad:** el 52 % de los pares tiene el expediente como tema principal y el 48 % como una parte de la noticia. Las menciones de paso quedan fuera por definición del nivel.
- **Etapa según la noticia:** presentación 23 %, comisión 17 %, primer debate 11 %, segundo debate 6,5 %, veto o firma 5 %, Sala IV 3 %, archivo o rechazo 6 %, no la dice 29 %.

**Posición atribuida a cada actor** (% de pares; entre paréntesis, expedientes con al menos una noticia):

| Actor | No se menciona | En contra | Neutral o dividido | A favor | Expedientes con noticias a favor y en contra |
|---|---|---|---|---|---|
| Ejecutivo | 61,9 % | 3,1 % (42) | 0,6 % (10) | 34,3 % (152) | 14 |
| Pueblo Soberano | 60,1 % | 8,7 % (63) | 2,0 % (39) | 29,2 % (202) | 24 |
| Liberación Nacional | 71,7 % | 12,1 % (60) | 2,3 % (35) | 14,0 % (182) | 27 |
| Frente Amplio | 76,6 % | 10,0 % (55) | 0,4 % (10) | 13,0 % (152) | 15 |
| Unidad Social Cristiana | 90,5 % | 2,2 % (31) | 0,2 % (5) | 7,0 % (83) | 8 |
| Agenda Ciudadana | 92,3 % | 3,7 % (23) | 0,2 % (6) | 3,8 % (54) | 8 |

«En contra» junta «en contra» y «muy en contra», y «a favor» junta «a favor» y «muy a favor»; cada expediente cuenta una vez. El CSV trae cada nivel por separado. Que un mismo expediente tenga noticias a favor y en contra para un mismo actor puede ser un cambio de posición en el tiempo, o un error de Jev.

**Qué trae la noticia** (% de pares con «sí»; entre paréntesis, expedientes con al menos una):

| Pregunta | % de pares | Expedientes |
|---|---|---|
| Dice qué consecuencias tendría | 91,3 % | 533 |
| Explica qué haría | 83,3 % | 525 |
| Da antecedentes | 81,8 % | 509 |
| Lo nombra en el título | 65,3 % | 418 |
| Dice quién lo propuso | 58,7 % | 415 |
| Informa algo que acaba de pasar en el trámite | 56,5 % | 364 |
| Da cifras | 43,1 % | 279 |
| Lo presenta como pelea política | 40,4 % | 194 |
| Cita a un diputado | 38,4 % | 333 |
| Dice qué sigue en el trámite | 26,1 % | 258 |
| Informa cómo se votó | 21,1 % | 138 |
| Lo ilustra con un caso personal | 20,2 % | 178 |
| Explica el procedimiento legislativo | 16,7 % | 133 |
| Duda de su constitucionalidad | 15,8 % | 131 |
| Dice si tiene los votos | 15,7 % | 118 |
| Compara con otros países | 10,8 % | 142 |
| El autor lo juzga | 10,2 % | 143 |

**Voces citadas:** instituciones públicas 40,1 % de los pares (313 expedientes), sociedad civil 10,9 %, expertos 8,8 %, empresas 5,7 %, sindicatos 3,3 %, personas afectadas 2,2 %.

## 5. Preguntas por noticia (`questions_by_news.csv`; 2.620 noticias)

- **Género:** nota informativa 81,9 %, opinión 12,9 %, análisis 4,6 %, entrevista 0,5 %.
- **Encuadre principal:** política pública 50,6 %, conflicto 33,0 %, economía 8,2 %, responsabilidad 5,2 %, interés humano 1,6 %, moral 1,4 %.
- **Comunicado reproducido:** 14,0 %. **Título engañoso:** 3,1 %.
- **Imagen de la Asamblea:** neutral 72,1 %, algo negativa 20,2 %, muy negativa 2,0 %, algo positiva 5,5 %, muy positiva 0,3 %.

## Cuidados

- La base «vivos» es aproximada: el SIL no da la fecha de cierre, así que un expediente archivado o hecho ley antes de mayo sin pasos en el período queda fuera, aunque se mencione (112 expedientes cubiertos no están en esa base, casi todos leyes vigentes o archivados).
- Las preguntas por par se contestaron solo sobre los pares que pasaron la puerta. Sus precisiones son las de la muestra, no las de este corpus. «Caso personal» (20 %) frente a «personas afectadas» (2 %) sugiere que Jev cuenta como caso personal cosas que no lo son: conviene revisarlo antes de reportarlo.
- La posición de los partidos se validó con los votos (92 %, `../substantive/positions_vs_votes.csv`). Las demás preguntas no tienen validación externa.
- Por medio hay pocos casos. Esta carpeta describe el corpus; no compara ni ordena medios, partidos ni diputados.
