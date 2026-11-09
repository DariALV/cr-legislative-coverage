# jev — evaluador TypeSafe (Jev)

Diario del tema. Las pruebas del 2026-11-08 se escribieron en `general.md` antes de que existiera este tema; no se copian, se indexan aquí.

## 2026-11-09 10:00 — tema jev creado: índice de las pruebas del 2026-11-08 y dónde están los datos crudos (#34 #39 #43)
- Entradas en `general.md` (buscar por título con `grep -A 15`): «diseño de las preguntas a Jev» (19:22), «Costo de Jev para 29.698 noticias × K» (19:40), «Filtro previo de noticias antes de Jev» (19:54), «Prueba v2 de Jev» (20:05), «pruebas del filtro de Jev por noticia» (20:23, 20:52), «el filtro de Jev se queda con las preguntas en inglés» (21:06), «Prueba de Jev contra las etiquetas de la muestra» (21:21).
- Probabilidades por noticia o par: `results/jev/*.csv`.
- Respuestas crudas de la API (una línea por request): `results/jev/answers/answers_*.jsonl`; barrido de K: `results/jev/answers/k_sweep.json`.
- Scripts que generaron todo (antes desechables, en el scratchpad): `results/jev/scripts/`. Leen `TYPESAFE_API_KEY` de `.env`. No se guardaron los payloads con el texto de las noticias (`payloads_v1.json`, 1 MB); se regeneran con `jev_probe.py`.
