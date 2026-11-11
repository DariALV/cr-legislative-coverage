# Modelo de costo de Jev (2026-11-10)

Scripts: `results/jev/scripts/jev_cost_fit.py` (ajuste por etapa) y `results/jev/scripts/jev_cost_stats.py` (por medio y mes).
Fuentes: `results/jev/corpus_filter/` (29.698 noticias, filtro) y `results/jev/test100/` (101 puertas, 46 detalles).

## Fórmula (n = noticias que entran al filtro)

C(n, p, m) = P · n · [ (T_all + q_f) + r_f · (T_pass + q_g + K·c_g) + r_f · r_m · (T_pass + D + q_N + b·(c_d + p·m)) ]

| Constante | Valor | De dónde |
|---|---|---|
| P | $0,042 por millón de tokens de input (output gratis) | config, docs.typesafe.ai |
| T_all | 1.130 tokens (media de la noticia, todo el corpus) | filtro − pregunta |
| T_pass | 1.385 tokens (media de las que pasan el filtro) | filtro |
| q_f | 105 (pregunta assembly, 420 caracteres) | código, ~4 car./token |
| r_f | 0,250 (7.431 / 29.698 con umbral 0,2) | filtro |
| q_g | 97 (genre) | código |
| K | 50 candidatos | config |
| c_g | 597 por candidato = tarjeta ≈ 286 + explicit/implicit ≈ 311 | ajuste test100 − same_topic (≈ 58) |
| r_m | 0,455 (46 / 101 con match) | test100 |
| b | 1,80 expedientes por noticia con match (83 / 46) | test100 |
| D | 1.930 (diputados + base del detalle) | ajuste test100 |
| q_N | 480 (4 preguntas por noticia, 1.919 caracteres) | código |
| c_d | 613 (tarjeta del expediente en el detalle) | ajuste test100 |
| p, m | hoy 32 preguntas por expediente, m ≈ 75 tokens (9.635 caracteres) | código |

Numéricamente: C ≈ n · (9.632 + 0,205·p·m) · 0,042e-6 USD ≈ n · (4,05e-4 + 8,6e-9·p·m).
Lo que falta del corpus (n_p = noticias que pasaron el filtro): C ≈ n_p · (33.561 + 0,819·p·m) · 0,042e-6.
Con p·m = 2.400: corpus completo ≈ $12,6 (filtro $1,54 ya pagado + puerta $9,78 + detalle $1,31).

Ajuste: puerta = noticia + 50·655 (con same_topic), sd del residuo 1.285 tokens; detalle = 2.314 + 0,97·noticia + 3.508·expedientes, sd 160.

## Por medio

| Medio | Noticias | Tokens media | Mediana | p90 | M tokens | Pasan | % | Media de las que pasan | Cortadas | Costo proyectado | $ / 1000 noticias |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Nación | 9.424 | 1.211 | 1.104 | 1.883 | 11,41 | 2.061 | 21,9 | 1.505 | 51 | $3,61 | 0,383 |
| CRHoy | 9.268 | 831 | 707 | 1.377 | 7,70 | 1.602 | 17,3 | 1.016 | 4 | $2,72 | 0,293 |
| Delfino | 5.397 | 1.372 | 1.198 | 2.108 | 7,40 | 1.327 | 24,6 | 1.821 | 73 | $2,35 | 0,436 |
| El Mundo | 3.388 | 1.147 | 992 | 1.730 | 3,89 | 1.481 | 43,7 | 1.138 | 39 | $2,37 | 0,698 |
| Semanario | 2.221 | 1.416 | 1.264 | 2.134 | 3,15 | 960 | 43,2 | 1.521 | 24 | $1,58 | 0,713 |
| Total | 29.698 | 1.130 | 1.003 | 1.808 | 33,55 | 7.431 | 25,0 | 1.385 | 191 | $12,63 | 0,425 |

Costo proyectado por medio usa r_m y b globales (test100 no alcanza para medirlos por medio).

## Por mes (todo el corpus)

| Mes | Noticias | Tokens media | Pasan | M tokens del filtro |
|---|---|---|---|---|
| 2026-05 | 5.396 | 1.101 | 1.320 | 6,51 |
| 2026-06 | 4.757 | 1.112 | 1.004 | 5,79 |
| 2026-07 | 4.762 | 1.102 | 1.064 | 5,75 |
| 2026-08 | 4.787 | 1.150 | 1.300 | 6,01 |
| 2026-09 | 4.904 | 1.143 | 1.291 | 6,12 |
| 2026-10 | 5.092 | 1.170 | 1.452 | 6,49 |

Media de tokens por medio y mes (noticias / tokens media / pasan):
- Nación: may 1.858/1.142/389 · jun 1.708/1.180/299 · jul 1.637/1.177/307 · ago 1.348/1.295/386 · sep 1.416/1.256/328 · oct 1.457/1.251/352
- CRHoy: may 1.526/818/272 · jun 1.363/815/176 · jul 1.475/812/216 · ago 1.692/841/280 · sep 1.620/836/331 · oct 1.592/857/327
- Delfino: may 1.084/1.321/237 · jun 857/1.296/184 · jul 762/1.313/162 · ago 846/1.410/243 · sep 851/1.399/198 · oct 997/1.484/303
- El Mundo: may 582/1.133/265 · jun 465/1.155/186 · jul 488/1.113/207 · ago 544/1.176/246 · sep 629/1.163/268 · oct 680/1.141/309
- Semanario: may 346/1.388/157 · jun 364/1.424/159 · jul 400/1.450/172 · ago 357/1.409/145 · sep 388/1.421/166 · oct 366/1.400/161
