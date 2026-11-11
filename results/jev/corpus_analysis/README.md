# Análisis de la corrida de Jev sobre el corpus (2026-11-10)

Script: `analysis.py`. Las tablas están en `mention/` y `substantive/`, una carpeta por nivel. La primera pasada, que contaba todos los matches, quedó en `first_pass/`. Fuente: `results/jev/corpus/`, con 29.698 noticias de mayo a octubre de 2026; 7.431 pasaron el filtro de Jev.

**Dos niveles de cobertura** (decididos con la revisión de 190 pares; ver el anexo):
- **Mención:** match explícito ≥ 0,5, o implícito ≥ 0,75. Son 4.671 pares en 2.788 noticias, con precisión estimada del 78–85 %.
- **Cobertura sustantiva:** mención, y además centralidad ≥ 0,25 (no es una mención de paso). Son 3.462 pares en 2.620 noticias, con precisión estimada del 88–91 %.

Las cifras de volumen usan los dos niveles. Lo demás usa la cobertura sustantiva, salvo que se diga otra cosa.

**Alcance:** el plan del entregable 1 deja fuera valorar, comparar o rankear medios, diputados o partidos. Las secciones 1 a 4 son descriptivas: qué se cubre y cuánto, y qué tan bien acierta el cruce. La sección 5, sobre cómo cubre cada medio, es exploratoria. No es para el sitio, y si se usa en el informe tiene que ir con sus caveats.

## 1. Qué tan bien acierta el cruce

- **Precisión por nivel:** 78–85 % en mención y 88–91 % en cobertura sustantiva, a partir de 190 pares revisados contra el texto (anexo y `match_review.csv`).
- **Validación externa:** comparamos la posición que la prensa le atribuye a cada partido con su voto en primer y segundo debate. En los 141 casos en que la prensa le atribuye una posición clara, **coincide con el voto en 130 (92,2 %)** (`substantive/positions_vs_votes.csv`; votos de mayo a octubre). Con todas las menciones da 131 de 143 (91,6 %): las preguntas de posición de Jev son confiables.
- **Contraste con Delfino:** el 95 % de los matches explícitos en noticias de Delfino están entre los enlaces que el propio medio pone a los expedientes.

## 2. Cuánto se cubre la Asamblea (`*/outlets_volume.csv`)

| Medio | Noticias | Mencionan un expediente | % | Con cobertura sustantiva | % |
|---|---|---|---|---|---|
| Semanario Universidad | 2.221 | 451 | 20,3 % | 427 | 19,2 % |
| Delfino | 5.397 | 702 | 13,0 % | 645 | 12,0 % |
| El Mundo | 3.388 | 381 | 11,2 % | 361 | 10,7 % |
| La Nación | 9.424 | 685 | 7,3 % | 640 | 6,8 % |
| CRHoy | 9.268 | 569 | 6,1 % | 547 | 5,9 % |
| **Total** | 29.698 | **2.788** | **9,4 %** | **2.620** | **8,8 %** |

Más o menos **una de cada once noticias** trata algún expediente de forma sustantiva. Esta tabla describe cuánto publica cada medio sobre la Asamblea; no es un ranking de calidad.

## 3. Qué expedientes se cubren (`*/top_bills.csv`)

- **Cuántos:** 820 expedientes distintos se mencionan y 570 tienen cobertura sustantiva. De estos, 62 aparecen en los cinco medios y 233 en una sola noticia.
- **Concentración:** el top 10 se lleva el 31 % de la cobertura sustantiva, y el top 50, el 58 %.
- **Los más cubiertos** (noticias con cobertura sustantiva / noticias donde es el tema principal):

| Expediente | Noticias | Tema principal |
|---|---|---|
| 23414, armonización eléctrica | 278 | 200 |
| 25754, presupuesto 2027 | 182 | 138 |
| 25258, elección de magistrados suplentes de la Sala IV | 172 | 117 |
| 24290, jornadas excepcionales (4x3) | 77 | 55 |
| 24717, minería metálica (Crucitas) | 71 | 37 |
| 25803, segundo presupuesto extraordinario 2026 | 69 | 32 |
| 25589, primer presupuesto extraordinario 2026 | 60 | 43 |
| 25363, eurobonos | 51 | 40 |
| 24259 | 50 | 31 |
| 25747, libre competencia en servicios profesionales | 49 | 46 |

- **No todo son proyectos de ley:** de los 570 cubiertos, 468 son proyectos ordinarios. Además hay 33 reformas constitucionales y elecciones de magistrados, 20 comisiones investigadoras, nombramientos y reformas al Reglamento.

## 4. Cobertura frente a la actividad legislativa (`*/activity_vs_coverage.csv`)

| Expedientes | Cantidad | Con mención | Con cobertura sustantiva | Mediana de noticias (sustantiva) |
|---|---|---|---|---|
| Con actividad en el SIL (mayo–octubre) | 924 | 58 % | **40 %** | 0 |
| Presentados entre mayo y octubre | 306 | 80 % | 75 % | 2 |
| Votados en el Plenario (mayo–octubre) | 110 | 85 % | 74 % | 2,5 |
| Aprobados en primer debate | 35 | 100 % | 89 % | 6 |
| Aprobados en segundo debate | 39 | 100 % | 92 % | 5 |
| Con 4 o más mociones votadas | 13 | 100 % | 100 % | 15 |

- **Todo lo aprobado se nombra en la prensa,** pero no todo se cubre. Tres leyes aprobadas en segundo debate solo aparecen de paso, en listas: dos acuerdos de transporte aéreo (25080 y 25302) y un protocolo de aviación civil (25207).
- **El trabajo en comisión casi no se ve:** el 60 % de los expedientes con actividad en el SIL no tiene ninguna cobertura sustantiva.
- **El conflicto atrae más cobertura que la aprobación:** los 13 expedientes con 4 o más mociones tienen una mediana de 15 noticias; los aprobados en segundo debate, 5.
- **Proponentes** (expedientes presentados entre mayo y octubre, según el primer firmante; `substantive/proponents_coverage.csv`): los del Ejecutivo tienen 718 noticias para 42 expedientes, unas 17 por expediente. Los de diputados tienen 2–3 por expediente. Pesan los presupuestos, los préstamos y los eurobonos, que son trámites del Ejecutivo.
- **Posiciones que la prensa reporta** (`substantive/party_positions.csv`): el Ejecutivo y Pueblo Soberano tienen posición atribuida en el 38–40 % de los pares; el PLN en el 28 %, el FA en el 23 %, el PUSC en el 10 % y Agenda Ciudadana en el 8 %. Esto es consistente con un período en que el Ejecutivo propone y el oficialismo tiene mayoría.

## 5. Exploratorio: cómo cubre cada medio (`substantive/outlet_style.csv`)

**No es para el sitio.** Si va al informe, tiene que presentarse como descripción y no como ranking. Las preguntas detrás tienen distinta validación:
- `press_release` se validó en 23 noticias.
- `voice_affected` casi no tuvo positivos en la prueba.
- Las demás se revisaron en 46 noticias (test100).

| Cobertura sustantiva | CRHoy | Delfino | El Mundo | Nación | Semanario | Todos |
|---|---|---|---|---|---|---|
| Explica qué hace el proyecto | 85 % | 87 % | 71 % | 84 % | 83 % | 83 % |
| Da cifras | 53 % | 41 % | 27 % | 45 % | 44 % | 43 % |
| Lo presenta como pelea política | 48 % | 25 % | 39 % | 43 % | 56 % | 40 % |
| Cita a un diputado | 40 % | 33 % | 44 % | 34 % | 48 % | 38 % |
| Informa la votación | 21 % | 24 % | 11 % | 20 % | 26 % | 21 % |
| Dice qué sigue en el trámite | 36 % | 31 % | 13 % | 16 % | 29 % | 26 % |
| Sin voces externas | 51 % | 55 % | 57 % | 47 % | 43 % | 51 % |
| Parece un comunicado (noticias con press_release ≥ 0,6) | 8 % | 4 % | 55 % | 3 % | 6 % | 12 % |
| No dice en qué etapa está | 26 % | 23 % | 39 % | 36 % | 26 % | 29 % |

**Lo que vale para todos los medios:**
- en la mitad de las notas sustantivas sobre un expediente no habla nadie fuera de la política (ni expertos, instituciones, sociedad civil ni afectados);
- 3 de cada 10 no dicen en qué etapa está el expediente;
- 1 de cada 5 informa cómo se votó.

## Caveats

- **Leyes vigentes:** 21372, el Reglamento contra el hostigamiento sexual de la Asamblea, sigue con 44 noticias, de las cuales solo 1 lo tiene como tema principal. Son notas sobre las denuncias contra Fabricio Alvarado y Obaldía que lo aplican como norma vigente. Es el falso positivo de «ley vigente» ya conocido. La centralidad ≥ 0,25 no lo filtra, porque la nota sí trata del procedimiento que el reglamento regula.
- **Cuánto se pierde:** el nivel de cobertura sustantiva pierde ~27 % de los pares correctos (sobre todo implícitos con probabilidad entre 0,5 y 0,75), así que las cifras de volumen son un piso.
- **Votaciones:** la base tiene las votaciones de Delfino desde 2018; el análisis usa solo las de mayo a octubre de 2026 (110 expedientes votados en el Plenario).
- **Recall del pipeline:** el filtro pierde ~1 % del oro y el ranker ~5 %.
- **Expedientes hermanos:** los que tienen el mismo título (25400/25800, 25648/21769) pueden repartirse mal las noticias.
- **Columnas y resúmenes:** Delfino tiene más pares por noticia por sus resúmenes semanales y sus columnas de opinión.

## Anexo: revisión de 190 matches para elegir el criterio de cobertura (2026-11-10)

Revisión a mano, hecha por subagentes que leyeron cada noticia, de 190 pares noticia–expediente:
- **Ronda 1:** 50 pares solo implícitos. Los revisores veían la probabilidad de Jev.
- **Ronda 2:** 140 pares sin la probabilidad de Jev, para no sesgar a los revisores: 25 implícitos por franja de probabilidad y 40 explícitos.

Detalle en `match_review.csv`.

En la ronda 2, a los revisores se les mandaron solo los primeros 8.000 caracteres de cada noticia. En 6 pares explícitos el número del expediente aparece más adelante, en listas, así que se corrigieron a «sí».

| Franja | Revisados | Precisión estricta | Precisión con dudosos |
|---|---|---|---|
| implícito < 0,65 | 41 | 24 % | 51 % |
| implícito 0,65–0,75 | 33 | 39 % | 67 % |
| implícito 0,75–0,85 | 38 | 66 % | 76 % |
| implícito ≥ 0,85 | 38 | 82 % | 92 % |
| explícito | 40 | 75 % | 82 % |

- **La centralidad separa las menciones de paso:** con centralidad < 0,25, solo el 28 % es sí.
- **Errores que quedan:** otro expediente del mismo tema, leyes vigentes citadas como antecedente y notas generales sobre el tema o la institución.

Estimación en el corpus, ponderando cada franja y nivel de centralidad por su tamaño:

| Criterio | Pares | Noticias | Expedientes | Precisión estimada | Pares correctos que conserva |
|---|---|---|---|---|---|
| A. Todo lo que dio match | 6.329 | 3.662 | 1.039 | 66 % / 78 % | 100 % |
| B. Mención: explícito ≥ 0,5 o implícito ≥ 0,75 | 4.671 | 2.788 | 820 | 78 % / 85 % | ~88 % |
| C. Cobertura sustantiva: B y centralidad ≥ 0,25 | 3.462 | 2.620 | 570 | 88 % / 91 % | ~73 % |
| D. B y centralidad ≥ 0,5 | 2.288 | 2.132 | 407 | 88 % / 91 % | ~48 % |
