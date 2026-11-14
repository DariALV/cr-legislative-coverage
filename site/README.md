# Sitio de cobertura legislativa

Sitio estático (Astro) que muestra qué proyectos de ley de la Asamblea Legislativa llegan a los medios.
Se publica solo en GitHub Pages cada vez que hay un push a `main` con cambios dentro de `site/`.

No hay base de datos en línea: los datos van dentro de las páginas. La base privada, el texto de las
noticias y las carpetas `databasesV1/`, `rawV1/` y `resultsV1/` se quedan en la máquina y están en el
`.gitignore`.

## Requisitos

- Node 22 o más reciente. La primera vez: `cd site && npm install`.
- Python 3, solo para regenerar los datos.

## Flujo para actualizar la página

### 1. Hacer el cambio

Hay dos tipos de cambio. Solo el segundo necesita el exportador.

**Cambio de presentación** (textos, orden de las secciones, gráficos, colores, páginas nuevas): se edita
el código en `site/src/`. No hay que regenerar datos.

| Qué | Dónde |
| --- | --- |
| Página de cada expediente | `src/pages/expediente/[number].astro` |
| Gráfico de cobertura y fechas del trámite | `src/components/Timeline.astro` |
| Votaciones | `src/components/VotesTable.astro` |
| Colores de las fracciones | `src/lib/parties.ts` |
| Texto del proyecto | `src/components/BillText.astro` |
| Metodología, datos, evaluación | `src/pages/metodologia.astro`, `datos.astro`, `evaluacion.astro` |
| Pie de página y encabezado | `src/layouts/Base.astro` |
| Enlaces externos (cuestionario, formulario de reporte, licencia) | `src/lib/config.ts` |

**Cambio de datos** (base nueva, resultados nuevos del cruce o cambios en `export_public.py`): se corre
el exportador desde la raíz del repositorio.

```sh
python export_public.py --database databasesV1/private_corpus.db --jev-dir resultsV1/jev/corpus --texts-dir rawV1/text/asamblea/bills
```

El exportador reescribe `site/src/data/` y `site/public/textos/`. Nunca exporta el texto de las noticias.
Al terminar imprime cuántos vínculos, noticias, expedientes y textos publicó: conviene comparar esas
cifras con las anteriores antes de seguir.

### 2. Revisar en la máquina

```sh
cd site
npm run dev      # abre el sitio en http://localhost:4321/cr-legislative-coverage/
npm run check    # debe terminar con 0 errores
npm run build    # debe terminar sin errores
```

### 3. Revisar qué se va a subir

```sh
git status
```

El repositorio es público. No deben entrar: texto de noticias, la base de datos, `.env`, claves ni
carpetas `V1`. Si aparece un archivo que no se reconoce, se deja fuera.

### 4. Commit y push

```sh
git add <archivos>
git commit -m "feature: <descripción breve> #<issue>"
git push origin main
```

También se puede trabajar en una rama y mezclarla en `main` con un pull request. El sitio solo se
publica cuando los cambios llegan a `main`.

### 5. Comprobar la publicación

En GitHub, pestaña **Actions**: la corrida «Deploy to GitHub Pages» tarda unos minutos. Cuando termina en verde, el sitio
ya está actualizado. Si falla, el sitio publicado se queda como estaba; el error se lee en la corrida.

## Para volver a una vista anterior

- Votaciones como tabla con barra apilada: `<VotesTable ... layout="table" />` en la página del expediente.
- Cualquier otro archivo: `git log -- <archivo>` y `git checkout <commit> -- <archivo>`.
