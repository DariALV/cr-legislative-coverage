# Posición atribuida a cada partido según quién propuso el expediente (2026-11-11)

Script: `party_vs_proponent.py`. Fuente: la corrida de Jev con cobertura sustantiva (`../README.md`), mayo–octubre de 2026.

**Pregunta:** según la prensa, ¿qué tan a favor está cada partido de los expedientes que proponen otros?

**Cómo se mide:**
- **Proponente:** el partido del primer firmante en la legislatura en que firmó, o el Poder Ejecutivo. El Ejecutivo se parte en el cambio de gobierno (2026-05-08): el de Fernández, y el anterior. Las elecciones de magistrados y los nombramientos no tienen proponente y van aparte.
- **Oficialismo** = PPSO más el Ejecutivo desde 2026-05-08. **Oposición** = PLN, FA, PUSC y CAC.
- **Posición de un partido sobre un expediente:** se suman sus noticias, con +1 si la noticia lo pone a favor, −1 si lo pone en contra y 0 si lo pone neutral o dividido. Según el signo, el expediente cuenta como a favor, en contra o mixto. Solo entran los expedientes donde la prensa le atribuye alguna posición a ese partido.
- **Contraste con los votos:** cómo votó la mayoría de cada fracción en primer y segundo debate, mayo–octubre.

## Resultados (`press_by_proponent.csv`)

% de expedientes a favor según la prensa (entre paréntesis, cuántos expedientes):

| Partido \ Propone | Propios | Oficialismo | Oposición | PLN | FA | PUSC | Ejecutivo anterior | Todos los de otros |
|---|---|---|---|---|---|---|---|---|
| PPSO | 100 % (93) | — | **40 %** (68) | 32 % (28) | 23 % (22) | 81 % (16) | 100 % (25) | **59 %** (116); 47 % (91) sin los 25 del Ejecutivo anterior |
| PLN | 99 % (74) | **48 %** (33) | — | — | 79 % (28) | 50 % (12) | 45 % (29) | **62 %** (123) |
| FA | 100 % (68) | **32 %** (31) | — | 80 % (20) | — | 50 % (12) | 63 % (27) | **58 %** (106) |
| PUSC | 100 % (29) | **32 %** (19) | — | 100 % (9) | 71 % (14) | — | 50 % (14) | **62 %** (71) |
| CAC | 100 % (6) | **35 %** (17) | — | 100 % (5) | 92 % (12) | 40 % (5) | 64 % (14) | **64 %** (61) |
| Ejecutivo | 100 % (32) | — | **54 %** (48) | 39 % (23) | 46 % (13) | 92 % (12) | 93 % (53) | **75 %** (119) |

En «Propios», la fila del PPSO cuenta los expedientes del PPSO y la del Ejecutivo cuenta los del Ejecutivo de 2026. En las columnas de oficialismo y oposición, la raya marca la celda que es el propio bloque. «Todos los de otros» excluye los propios, los del propio bloque en el caso del PPSO y del Ejecutivo, y los que no tienen proponente.

- **Sobre los propios, la prensa los pone siempre a favor** (98–100 %). Es lo esperable.
- **Sobre los de otros, cada partido sale a favor en ~60 % de los casos.** La división es entre oficialismo y oposición: el PPSO apoya el 40 % de los expedientes de la oposición, y la oposición, el 32–48 % de los del oficialismo.
- **Entre la oposición el apoyo es alto con los de PLN y FA** (71–100 %), pero no con los del PUSC: PLN, FA y CAC apoyan sus expedientes en un 40–50 %.
- **Los expedientes del PUSC están más cerca del oficialismo:** el PPSO apoya el 81 %, y el Ejecutivo el 92 %.
- **El PPSO apoya el 100 % de los 25 expedientes del Ejecutivo anterior** (Chaves), su antecesor político. La oposición los apoya en un 45–64 %.
- **Lo que más divide** (expedientes con más noticias):
  - La oposición, contra los presupuestos 2027 y el segundo extraordinario, libre competencia en servicios profesionales, «mano firme», la reelección presidencial y beneficios fiscales.
  - El PPSO, contra expedientes de la oposición como las pensiones de expresidentes, seguridad energética (PLN) y protección al trabajador.
  - Detalle en `bill_positions.csv`.

## Contraste con los votos (`votes_by_proponent.csv`)

En primer y segundo debate (50 expedientes votados en el período), **todas las fracciones votan a favor en un 90–98 % de los casos, sea quien sea el proponente**. Solo 2 expedientes del PPSO llegaron a votarse. Donde hay votos y la prensa atribuye una posición clara, coinciden en 130 de 140 casos (16 de 16 en los propios, 114 de 124 en los de otros).

**Lectura:** el desacuerdo que muestra la prensa no aparece en las votaciones finales. Los expedientes en disputa todavía no llegan a votarse, o se cubren justamente porque hay pelea. Lo que llega a debate es casi siempre de consenso.

## Cuidados

- **Alcance:** el plan del entregable 1 deja fuera comparar o rankear partidos. Esto describe qué posición les atribuye la prensa, no cómo se comportan. Si va al informe, tiene que ir como sección exploratoria, con estos cuidados.
- **Es la posición según la prensa, solo donde la prensa dice algo.** De los expedientes de otros, a cada partido se le atribuye posición en 61 a 123, de unos 500 con cobertura. El silencio no cuenta como apoyo ni como rechazo.
- **Cuenta expedientes, no noticias:** un presupuesto con 182 noticias pesa lo mismo que un expediente con una sola.
- **El proponente es el primer firmante.** Muchos expedientes tienen firmas de varios partidos, y eso no se refleja aquí.
- **Celdas chicas:** muchas tienen menos de 20 expedientes; un par de expedientes mueve el porcentaje 10 puntos o más.
- La pregunta de posición de Jev se validó con los votos (92 %). La pregunta de quién propuso no depende de Jev, sale del SIL.
