from urllib.parse import urlparse

# Broad filter: sections with no bearing on legislative coverage (sports, world news,
# entertainment, lifestyle, sponsored content). The section is the first segment of the url path.
# Opinion sections are kept on purpose: columns also discuss bills.
EXCLUDED_URL_SECTIONS: dict[str, set[str]] = {
  "crhoy": {"deportes", "mundo", "entretenimiento", "caricaturas", "gusto"},
  "nacion": {"puro-deporte", "el-mundo", "viva", "teleguia", "tiempo-libre", "sabores", "mascotas",
             "revista-perfil", "brandvoice", "no-coma-cuento", "mi-bienestar", "empleo-costa-rica", "videos"},
  "elmundo": {"deportes", "mundo", "tendencias"},
  "semanario": {"mundo", "internacionales", "deportes", "cultura", "loslibros", "publicidad", "suplementos"},
}

# Delfino urls carry no section (/<year>/<month>/<slug>), so it is filtered after download
# by the "articleSection" of the page.
EXCLUDED_DELFINO_SECTIONS: set[str] = {
  "Cultura Colectiva", "Reporte Internacional", "Banca con Propósito", "JUPEMA", "Más conectados",
}

# WordPress outlets: categories that exclude a post wherever its url points. Semanario files some
# sponsored posts under /impreso/ (print edition) with the "publicidad" category.
EXCLUDED_CATEGORY_SLUGS: dict[str, set[str]] = {
  "elmundo": set(),
  "semanario": {"publicidad"},
}

def url_section(url: str) -> str | None:
  segments = [segment for segment in urlparse(url).path.split("/") if segment]
  return segments[0] if len(segments) > 1 else None

def is_relevant_url(outlet: str, url: str) -> bool:
  return url_section(url) not in EXCLUDED_URL_SECTIONS[outlet]

def is_relevant_categories(outlet: str, category_slugs: list[str]) -> bool:
  return not EXCLUDED_CATEGORY_SLUGS.get(outlet, set()).intersection(category_slugs)

def is_relevant_delfino_section(section: str | None) -> bool:
  return section not in EXCLUDED_DELFINO_SECTIONS
