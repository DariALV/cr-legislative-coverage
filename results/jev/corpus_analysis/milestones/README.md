# Cobertura alrededor de los pasos del trámite (2026-11-11)

Script: `milestones.py`. Tablas en `substantive/` y `mention/`, con los mismos dos niveles de `../README.md`. Las cifras de abajo son de cobertura sustantiva (3.462 pares, mayo–octubre de 2026).

**Pregunta:** ¿la prensa cubre un expediente cuando da un paso en el trámite (presentación, dictamen, debates), o lo cubre de forma pareja?

**Hitos:** la fecha de presentación, los pasos del SIL (agenda de comisión, dictamen, mociones 137, consulta de constitucionalidad, primer y segundo debate, remisión a Casa Presidencial o publicación de la ley, archivo) y las votaciones del Plenario de Delfino (mociones de fondo y de reiteración, primer y segundo debate, plazo cuatrienal y otras). Una noticia está **cerca** de un hito si sale entre 2 días antes y 3 días después. La **base** reparte las mismas noticias de cada expediente al azar en el período.

## Resultados

- **El 47 % de las noticias cae cerca de un hito de su expediente**, contra un 8 % en la base (con menciones: 45 % contra 8 %). Los hitos que más noticias juntan son la presentación (665), el primer debate (249) y el dictamen (171).
- **Qué pasos reciben alguna noticia** (`milestones.csv`; hito con al menos una noticia en la ventana):

| Paso | Hitos | Con ≥ 1 noticia |
|---|---|---|
| Segundo debate | 42 | 86 % |
| Otras votaciones del Plenario | 60 | 72 % |
| Presentación | 289 | 69 % |
| Mociones de fondo | 35 | 69 % |
| Primer debate | 101 | 42 % |
| Ley firmada o publicada | 106 | 34 % |
| Dictamen de comisión | 93 | 26 % |
| Mociones 137 | 54 | 24 % |
| Ingreso a la agenda de comisión | 254 | 8 % |
| Archivo | 404 | 3,5 % |

- **Ráfagas** (`episodes.csv`; se corta con más de 7 días sin noticias): el 62 % de los 570 expedientes cubiertos tiene una sola. El 70 % de las ráfagas de 3 o más noticias arranca junto a un hito, y ahí está el 83 % de sus noticias. De los 211 expedientes con ráfaga al presentarse, 126 no vuelven a salir; esa ráfaga se lleva 1.048 de sus 1.511 noticias.
- **Presentación y después debate:** solo 4 expedientes se presentan y llegan al Plenario dentro del período, y 3 muestran las dos ráfagas. Seis meses no alcanzan para medir qué tan común es ese patrón.
- **Fuera de los hitos** (`bills_share_near.csv`): sobre todo negociación política sin paso en el SIL. Por ejemplo, la elección de magistrados (25258), la minería (24717), los eurobonos (25363, sin pasos desde enero aunque se negocian en Hacendarios) y el reglamento contra el hostigamiento (21372, citado por denuncias contra diputados). En total, 197 expedientes con cobertura no tienen ningún hito en la ventana (538 noticias).

## Cuidados

- La presentación solo se ve en los expedientes presentados entre abril y octubre. Los anteriores ya traían cobertura que el corpus no tiene.
- Las fechas del SIL marcan cuándo se registró el paso, que a veces no coincide con el día del evento. Por eso el pico de «ley publicada» va antes del hito: la noticia sale con la firma o el segundo debate.
- La ventana (−2/+3) y el corte de las ráfagas (7 días) son elecciones del análisis. Con otros valores los porcentajes cambian un poco, pero la conclusión no.
- La base al azar no tiene en cuenta que la prensa publica menos los fines de semana.
