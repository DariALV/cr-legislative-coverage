"""Builds the alternative styles of the local pages into variants.css and checks them.

The official style lives by hand in theme.css. Every other style is described here by a few key colors; the rest is
derived in OKLCH. Then every pair that carries text or data is checked against WCAG and nudged in lightness (same hue
and chroma) until it passes: text 4.5:1, tile numbers 7:1, lines and data marks 3:1. Styles marked `faithful` (the
original look) are not nudged; their failures are only reported.

Color vision deficiency: the data palettes (categorical, outlets, parties, status, the stance ends) are simulated for
protanopia, deuteranopia and tritanopia (Machado et al. 2009, severity 1) and the closest pair is reported as a
distance in OKLab (x100). Under ~10 two colors start to look alike.

Usage: python private_visuals/theme/build_styles.py            (writes variants.css and the style list in theme.js)
       python private_visuals/theme/build_styles.py --check    (only reports)
"""

import argparse
import itertools
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------- color math

def hex_to_rgb(h: str) -> list[float]:
  return [int(h[k:k + 2], 16) / 255 for k in (1, 3, 5)]

def rgb_to_hex(c: list[float]) -> str:
  return "#" + "".join(f"{round(max(0, min(1, x)) * 255):02X}" for x in c)

def to_linear(x: float) -> float:
  return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

def to_srgb(x: float) -> float:
  x = max(0.0, min(1.0, x))
  return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055

def linear_to_oklab(c: list[float]) -> list[float]:
  l = 0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]
  m = 0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]
  s = 0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]
  l, m, s = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]

def oklab(h: str) -> list[float]:
  return linear_to_oklab([to_linear(x) for x in hex_to_rgb(h)])

def oklch(h: str) -> tuple[float, float, float]:
  L, a, b = oklab(h)
  return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360

def from_oklch(L: float, C: float, h: float) -> str:
  a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
  l_, m_, s_ = L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b
  l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
  rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
         -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
         -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
  return rgb_to_hex([to_srgb(x) for x in rgb])

def luminance(h: str) -> float:
  r, g, b = (to_linear(x) for x in hex_to_rgb(h))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a: str, b: str) -> float:
  x, y = sorted([luminance(a), luminance(b)], reverse = True)
  return (x + 0.05) / (y + 0.05)

def mix(a: str, b: str, t: float) -> str:
  """color-mix(in srgb, a (1-t), b t)."""
  x, y = hex_to_rgb(a), hex_to_rgb(b)
  return rgb_to_hex([u + (v - u) * t for u, v in zip(x, y)])

def nudge(color: str, against: list[str], target: float) -> str:
  """Moves the OKLCH lightness of `color` away from the backgrounds until it reaches `target` against all of them."""
  L, C, h = oklch(color)
  darker = sum(luminance(b) for b in against) / len(against) > 0.18
  for _ in range(120):
    if min(contrast(color, b) for b in against) >= target:
      return color
    L += -0.006 if darker else 0.006
    if not 0 <= L <= 1:
      break
    color = from_oklch(L, C * (0.995 if darker else 1), h)
  return color

# Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB.
CVD = {
  "protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  "tritan": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}

def simulate(h: str, kind: str) -> list[float]:
  c = [to_linear(x) for x in hex_to_rgb(h)]
  m = CVD[kind]
  return linear_to_oklab([max(0.0, min(1.0, sum(m[i][j] * c[j] for j in range(3)))) for i in range(3)])

def closest_pair(colors: dict[str, str], kind: str | None) -> tuple[float, str]:
  pts = {k: (simulate(v, kind) if kind else oklab(v)) for k, v in colors.items()}
  best = (1e9, "")
  for (ka, a), (kb, b) in itertools.combinations(pts.items(), 2):
    d = 100 * math.dist(a, b)
    if d < best[0]:
      best = (d, f"{ka}/{kb}")
  return best

def cvd_distance(a: str, b: str) -> float:
  """Smallest OKLab distance (x100) between two colors under normal vision and the three simulations."""
  d = 100 * math.dist(oklab(a), oklab(b))
  return min([d] + [100 * math.dist(simulate(a, k), simulate(b, k)) for k in CVD])

def cvd_palette(n: int, backgrounds: list[str], dark: bool, seeds: list[str]) -> list[str]:
  """Greedy farthest-point choice of n colors that reach 3:1 on every background, maximizing the smallest distance
  between any two under normal vision, protanopia, deuteranopia and tritanopia. Seeds go first, nudged to 3:1."""
  pool = []
  for L in ([0.62, 0.70, 0.78, 0.86, 0.92] if dark else [0.32, 0.40, 0.48, 0.56, 0.62]):
    for C in (0.06, 0.10, 0.14, 0.18):
      for h in range(0, 360, 10):
        c = from_oklch(L, C, h)
        if min(contrast(c, b) for b in backgrounds) >= 3 and abs(oklch(c)[1] - C) < 0.03:
          pool.append(c)
  chosen = [nudge(c, backgrounds, 3) for c in seeds]
  while len(chosen) < n:
    chosen.append(max(pool, key = lambda c: min(cvd_distance(c, x) for x in chosen)))
  return chosen

def best_subset(candidates: list[str], k: int, fixed: list[str] = ()) -> list[str]:
  """The k candidates (plus the fixed ones) whose closest pair under any vision is the farthest apart."""
  best, best_d = None, -1.0
  for combo in itertools.combinations(candidates, k):
    group = list(fixed) + list(combo)
    d = min(cvd_distance(a, b) for a, b in itertools.combinations(group, 2))
    if d > best_d:
      best, best_d = list(combo), d
  return best

# ---------------------------------------------------------------- style descriptions

SANS = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif'
POPPINS = '"Poppins", "Segoe UI", system-ui, sans-serif'
SERIF = 'Georgia, "Times New Roman", serif'
SITE_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
SITE_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
INTER = '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif'

TILES = ["sky", "mint", "lavender", "peach", "rose"]
STATUS = ["law", "progress", "archived", "warn", "bad"]
OUTLETS = ["crhoy", "nacion", "delfino", "elmundo", "semanario"]
PARTIES = ["ppso", "pln", "fa", "pusc", "cac", "pac", "prn", "pnr", "plp", "ppsd", "pin", "prsc", "other", "executive"]

# Real party colors (identity), before the per-theme lightness adjustment.
PARTY_HUES = {"ppso": "#4DB8E8", "pln": "#2FA84F", "fa": "#F2C53D", "pusc": "#E04E4E", "cac": "#F08A3C", "pac": "#C9601A",
              "prn": "#3F6FD9", "pnr": "#9A6FE0", "plp": "#E87BA4", "ppsd": "#2BB5A6", "pin": "#B08968", "prsc": "#C77D7D",
              "other": "#8F8E85", "executive": "#8F8E85"}

# Okabe & Ito (2008): told apart under the three common color vision deficiencies.
OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#666666"]

STYLES = {
  "sobrio": {
    "name": "Sobrio", "description": "Grises neutros, acento azul petróleo, esquinas cortas y Segoe UI.",
    "font": SANS, "display": SANS, "weight": 400, "radius": "10px", "radius_sm": "7px",
    "light": {"bg": "#F3F4F6", "surface": "#FFFFFF", "ink": "#1F2328", "accent": "#1F6F8B", "neutral_hue": 250, "neutral_chroma": 0.006},
    "dark": {"bg": "#111315", "surface": "#1A1D21", "ink": "#E6E8EB", "accent": "#6CB8D4", "neutral_hue": 250, "neutral_chroma": 0.008},
    "tiles": {"hues": [235, 200, 260, 70, 15], "chroma": 0.025},
  },
  "editorial": {
    "name": "Editorial", "description": "Blanco y negro con acento rojo prensa, títulos en Georgia y tarjetas planas con filete.",
    "font": SANS, "display": SERIF, "weight": 400, "radius": "3px", "radius_sm": "2px",
    "light": {"bg": "#F5F3EE", "surface": "#FFFFFF", "ink": "#141414", "accent": "#B3261E", "neutral_hue": 80, "neutral_chroma": 0.006},
    "dark": {"bg": "#101010", "surface": "#1A1A1A", "ink": "#EEEBE5", "accent": "#FF7A6E", "neutral_hue": 80, "neutral_chroma": 0.005},
    "tiles": {"hues": [250, 150, 300, 70, 25], "chroma": 0.02, "flat": True},
    "extra": """
:root[data-style="editorial"] .stat { background: var(--surface); border: 1px solid var(--line); border-top: 4px solid var(--t-ink); }
:root[data-style="editorial"] .card, :root[data-style="editorial"] .toolbar-inner,
:root[data-style="editorial"] .pane-detail, :root[data-style="editorial"] .row { box-shadow: none; }
:root[data-style="editorial"] .page-head h1 { font-weight: 700; letter-spacing: 0; }
""",
  },
  "calido": {
    "name": "Cálido", "description": "Fondo crema, acento terracota y mosaicos oliva, arena y salvia; esquinas redondas.",
    "font": POPPINS, "display": POPPINS, "weight": 500, "radius": "22px", "radius_sm": "14px",
    "light": {"bg": "#F6EFE3", "surface": "#FFFCF6", "ink": "#2E2219", "accent": "#B4532A", "neutral_hue": 70, "neutral_chroma": 0.02},
    "dark": {"bg": "#1C1713", "surface": "#27201A", "ink": "#F2E8DC", "accent": "#F0956A", "neutral_hue": 70, "neutral_chroma": 0.015},
    "tiles": {"hues": [115, 150, 75, 45, 350], "chroma": 0.06},
  },
  "proyector": {
    "name": "Proyector", "description": "Alto contraste para presentar: bordes marcados, mosaicos sólidos con texto blanco, letra más grande.",
    "font": POPPINS, "display": POPPINS, "weight": 500, "radius": "14px", "radius_sm": "10px", "strong": True,
    "light": {"bg": "#E6E9F0", "surface": "#FFFFFF", "ink": "#000814", "accent": "#3138B0", "neutral_hue": 265, "neutral_chroma": 0.02},
    "dark": {"bg": "#000000", "surface": "#10141F", "ink": "#FFFFFF", "accent": "#A9AEFF", "neutral_hue": 265, "neutral_chroma": 0.02},
    "tiles": {"hues": [255, 155, 295, 55, 20], "chroma": 0.13, "solid": True},
    "extra": """
:root[data-style="proyector"] body { font-size: 16px; }
:root[data-style="proyector"] .stat dd { font-size: 28px; }
:root[data-style="proyector"] .card, :root[data-style="proyector"] .toolbar-inner, :root[data-style="proyector"] .row,
:root[data-style="proyector"] .pane-detail, :root[data-style="proyector"] .side { border-width: 2px; }
""",
  },
  "accesible": {
    "name": "Accesible", "description": "Colores de datos escogidos para distinguirse con daltonismo rojo-verde y azul-amarillo; los estados no dependen del verde y el rojo.",
    "font": POPPINS, "display": POPPINS, "weight": 500, "radius": "18px", "radius_sm": "12px", "cvd": True,
    "light": {"bg": "#F4F6FB", "surface": "#FFFFFF", "ink": "#1B2140", "accent": "#0067A3", "neutral_hue": 260, "neutral_chroma": 0.02},
    "dark": {"bg": "#0E1224", "surface": "#161B31", "ink": "#E9EBF7", "accent": "#7CC3F2", "neutral_hue": 260, "neutral_chroma": 0.02},
    "tiles": {"from": [OKABE_ITO[0], OKABE_ITO[2], OKABE_ITO[3], OKABE_ITO[1], OKABE_ITO[5]], "chroma": 0.06},
    # seeds: blue (good, in favor) and vermillion (bad, against), from Okabe & Ito; the rest is optimized
    "seeds": [OKABE_ITO[0], OKABE_ITO[5]],
    "stance": (OKABE_ITO[5], OKABE_ITO[0]),
  },
  "sitio": {
    "name": "Sitio web", "description": "El del sitio público (Astro): grises cálidos, acento azul, títulos en Palatino, letra del sistema, cifras sin recuadro y bordes finos.",
    "font": SITE_SANS, "display": SITE_SERIF, "weight": 400, "radius": "8px", "radius_sm": "5px",
    "light": {"bg": "#FCFCFB", "surface": "#FFFFFF", "ink": "#1B1B19", "accent": "#1C5CAB", "neutral_hue": 90, "neutral_chroma": 0.004},
    "dark": {"bg": "#121211", "surface": "#1A1A19", "ink": "#F0EFEC", "accent": "#86B6EF", "neutral_hue": 90, "neutral_chroma": 0.004},
    "tiles": {"hues": [255, 155, 295, 60, 25], "chroma": 0.01},
    # the site's own tokens, kept as they are when they pass the checks
    "overrides": {
      "light": {"soft": "#F3F2EF", "line": "#E2E0DA", "ink-2": "#52514E", "ink-3": "#706E68", "accent-soft": "#E6EFFB"},
      "dark": {"soft": "#232321", "line": "#353430", "ink-2": "#C3C2B7", "ink-3": "#9A988F", "accent-soft": "#1D2A3B"},
    },
    # status as on the site: law in the accent blue, in progress neutral, archived muted; against in its orange
    "status": {"law": "#1C5CAB", "progress": "#52514E", "archived": "#706E68", "warn": "#5A3E00", "bad": "#C2501F"},
    # the site's validated reference palette (favor blue, against orange, then the rest of the series)
    "data": ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300", "#8A7FB5", "#5E5D58"],
    "stance": ("#EB6834", "#2A78D6"),
    "extra": """
:root[data-style="sitio"] body { font-size: 16px; }
:root[data-style="sitio"] h1, :root[data-style="sitio"] .page-head h1 { font-weight: 600; letter-spacing: -.01em; }
:root[data-style="sitio"] .stat { background: none; padding: 2px 0; border-radius: 0; }
:root[data-style="sitio"] .stat dt { color: var(--ink-2); font-weight: 400; font-size: 13.5px; }
:root[data-style="sitio"] .stat dd { color: var(--ink); font-weight: 600; font-size: 26px; }
:root[data-style="sitio"] .nav-item { font-weight: 400; }
:root[data-style="sitio"] .nav-item[aria-current="page"] { background: var(--accent-soft); color: var(--accent-deep); font-weight: 600; }
:root[data-style="sitio"] .side-card.real { background: var(--soft); color: var(--ink-2); }
:root[data-style="sitio"] .side-card.real strong { color: var(--ink); }
:root[data-style="sitio"] .chip, :root[data-style="sitio"] .pill, :root[data-style="sitio"] .tag { font-weight: 400; border: 1px solid var(--line); }
:root[data-style="sitio"] .chip[aria-pressed="true"] { font-weight: 600; border-color: transparent; }
:root[data-style="sitio"] .card, :root[data-style="sitio"] .toolbar-inner, :root[data-style="sitio"] .pane-detail,
:root[data-style="sitio"] .row, :root[data-style="sitio"] .settings { box-shadow: none; }
:root[data-style="sitio"] .row, :root[data-style="sitio"] .person, :root[data-style="sitio"] .news-item { border-width: 1px; }
:root[data-style="sitio"] .row-name, :root[data-style="sitio"] .news-title { font-weight: 600; }
:root[data-style="sitio"] .d-title, :root[data-style="sitio"] h2 { font-weight: 600; }
""",
  },
  "original": {
    "name": "Original", "description": "Los colores y la letra de las páginas antes del rediseño, sobre la estructura nueva.",
    "faithful": True, "font": INTER, "display": INTER, "weight": 400, "radius": "14px", "radius_sm": "10px",
  },
}

# The original look, copied from the pages before the redesign (explorer and embeddings in light, graphs in dark).
ORIGINAL = {
  "light": {
    "bg": "#FFFFFF", "surface": "#FFFFFF", "soft": "#F7F8FA", "line": "#ECEEF2", "line-strong": "#DFE2E8",
    "ink": "#15171C", "ink-2": "#4A505C", "ink-3": "#8A909C", "accent": "#4F46E5", "accent-deep": "#4F46E5",
    "accent-soft": "#EEF0FF", "on-accent": "#FFFFFF", "mark-bg": "#FFF1B8",
    "law": "#0F9F6E", "law-soft": "#E6F6F0", "progress": "#3B6FE0", "progress-soft": "#EAF0FD", "archived": "#8A909C",
    "archived-soft": "#F1F2F5", "warn": "#A15C07", "warn-soft": "#FFF6E6", "bad": "#C2410C", "bad-soft": "#FFF1EB",
    "crhoy": "#E2453C", "nacion": "#2563EB", "delfino": "#F08A24", "elmundo": "#16A34A", "semanario": "#8B5CF6",
  },
  "dark": {
    "bg": "#1A1A19", "surface": "#242423", "soft": "#2E2E2C", "line": "#3A3A37", "line-strong": "#55554F",
    "ink": "#F0EFEC", "ink-2": "#C3C2B7", "ink-3": "#8F8E85", "accent": "#4C7DF0", "accent-deep": "#7FA3F5",
    "accent-soft": "#2B3550", "on-accent": "#FFFFFF", "mark-bg": "#5A4812",
    "law": "#23A878", "law-soft": "#1E3A2E", "progress": "#4C7DF0", "progress-soft": "#24304D", "archived": "#8F8E85",
    "archived-soft": "#2E2E2C", "warn": "#E6A640", "warn-soft": "#3A2E17", "bad": "#E07A52", "bad-soft": "#3D251C",
    "crhoy": "#E2453C", "nacion": "#4C7DF0", "delfino": "#F08A24", "elmundo": "#23A878", "semanario": "#9085E9",
  },
  # graph page colors before the redesign
  "data": ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181", "#008300", "#9085E9", "#E66767"],
  "stance": ("#D9435E", "#CFCCC2", "#23A878"),
  "none": "#63635D", "old": "#2F2F2C",
}

# ---------------------------------------------------------------- derivation

def neutral(L: float, spec: dict) -> str:
  return from_oklch(L, spec["neutral_chroma"], spec["neutral_hue"])

def derive(style: dict, mode: str) -> dict[str, str]:
  spec = style[mode]
  dark = mode == "dark"
  bg, surface, ink, accent = spec["bg"], spec["surface"], spec["ink"], spec["accent"]
  t: dict[str, str] = {"bg": bg, "surface": surface, "ink": ink}
  Lb = oklch(bg)[0]
  t["soft"] = neutral(Lb + (0.045 if dark else -0.02), spec)
  t["line"] = neutral(Lb + (0.11 if dark else -0.075), spec)
  t["line-strong"] = nudge(neutral(0.55 if dark else 0.6, spec), [surface, bg], 3.4 if style.get("strong") else 3)
  if style.get("strong"):
    t["line"] = t["line-strong"]
  t["ink-2"] = nudge(mix(ink, surface, 0.3), [surface, bg, t["soft"]], 7 if style.get("strong") else 5.5)
  t["ink-3"] = nudge(mix(ink, surface, 0.42), [surface, bg, t["soft"]], 7 if style.get("strong") else 4.6)
  La, Ca, ha = oklch(accent)
  t["accent-soft"] = from_oklch(0.30 if dark else 0.93, 0.06 if dark else 0.035, ha)
  t["accent"] = nudge(accent, [surface, bg], 3)
  t["accent-deep"] = nudge(from_oklch(La + (0.08 if dark else -0.06), Ca, ha), [surface, bg, t["accent-soft"]], 4.6)
  white_ok = contrast("#FFFFFF", t["accent"]) >= 4.5
  t["on-accent"] = "#FFFFFF" if white_ok else bg if not dark else "#0B0D12"
  if contrast(t["on-accent"], t["accent"]) < 4.5:
    t["on-accent"] = "#000000" if luminance(t["accent"]) > 0.18 else "#FFFFFF"
  t["mark-bg"] = from_oklch(0.42 if dark else 0.92, 0.09, 90)

  tiles = style["tiles"]
  hues = [oklch(c)[2] for c in tiles["from"]] if "from" in tiles else tiles["hues"]
  for name, h in zip(TILES, hues):
    if tiles.get("solid"):
      t[name] = nudge(from_oklch(0.46 if not dark else 0.40, tiles["chroma"], h), ["#FFFFFF"], 7)
      t[f"{name}-ink"] = "#FFFFFF"
      t[f"{name}-label"] = nudge(from_oklch(0.95, 0.03, h), [t[name]], 4.6)
    else:
      t[name] = from_oklch(0.30 if dark else (0.95 if tiles.get("flat") else 0.90), tiles["chroma"], h)
      t[f"{name}-ink"] = nudge(from_oklch(0.95 if dark else 0.30, 0.03 if dark else 0.09, h), [t[name], surface], 7)
      t[f"{name}-label"] = nudge(from_oklch(0.86 if dark else 0.40, 0.07 if dark else 0.11, h), [t[name], surface], 4.6)

  safe = cvd_palette(8, [surface, bg], dark, style["seeds"]) if style.get("cvd") else None
  if safe:
    # Status colors are text (4.5:1), so they are compared after the nudge. law = blue seed, bad = vermillion seed,
    # in progress = the candidate (any hue, as text) farthest from both under every vision.
    as_text = lambda c: nudge(from_oklch(0.80 if dark else 0.45, oklch(c)[1], oklch(c)[2]), [surface, bg, from_oklch(0.30 if dark else 0.94, 0.05, oklch(c)[2])], 4.6)
    law, bad = as_text(safe[0]), as_text(safe[1])
    pool = [as_text(from_oklch(0.6, C, h)) for h in range(0, 360, 10) for C in (0.08, 0.12, 0.16)]
    progress = max(pool, key = lambda c: min(cvd_distance(c, law), cvd_distance(c, bad)))
    status = {"law": law, "progress": progress, "archived": neutral(0.5, spec), "warn": "#8A5300" if not dark else "#F0B35E", "bad": bad}
  elif style.get("status"):
    status = dict(style["status"])
    if dark:  # same hues, lightened by the nudge below
      status = {k: from_oklch(0.8, oklch(v)[1], oklch(v)[2]) for k, v in status.items()}
  else:
    status = {"law": "#17683A", "progress": "#2F5FB8", "archived": neutral(0.5, spec), "warn": "#8A5300", "bad": "#A32F2F"}
  for name in STATUS:
    h, C = oklch(status[name])[2], oklch(status[name])[1]
    soft = from_oklch(0.30 if dark else 0.94, min(C, 0.05), h)
    t[f"{name}-soft"] = soft
    base = from_oklch(0.80 if dark else 0.45, C, h)
    t[name] = nudge(base, [soft, surface, bg], 4.6)

  data = safe or style.get("data") or ["#2F6FD6", "#C2570F", "#1E8A5A", "#A87700", "#C2437A", "#00838F", "#7A5CD6", "#C93C3C"]
  for i, c in enumerate(data[:8]):
    t[f"cat-{i + 1}"] = nudge(c, [surface, bg], 3)
  as_outlet = lambda c: nudge(c, [surface, mix(c, surface, 0.88), bg], 4.6)
  if safe:
    # outlet names are text: pick the 5 that stay farthest apart after the nudge to 4.5:1
    outlets = best_subset([as_outlet(c) for c in safe], 5)
  else:
    outlets = [as_outlet(c) for c in ["#C2362E", "#2357C9", "#985200", "#1F7A3F", "#7445D6"]]
  for name, c in zip(OUTLETS, outlets):
    t[name] = c
  neg, pos = style.get("stance") or ("#C8354F", "#12855C")
  t["div-neg"], t["div-pos"] = nudge(neg, [surface, bg], 3), nudge(pos, [surface, bg], 3)
  t["div-mid"] = neutral(0.38 if dark else 0.83, spec)  # neutral stance: lighter than "no coverage" in light, dimmer in dark
  t["div-neg-soft"] = mix(t["div-neg"], t["div-mid"], 0.5)
  t["div-pos-soft"] = mix(t["div-pos"], t["div-mid"], 0.5)
  hs = oklch(t["accent"])[2]
  t["seq-low"], t["seq-high"] = from_oklch(0.30 if dark else 0.92, 0.05, hs), from_oklch(0.88 if dark else 0.35, 0.12, hs)
  t["data-none"] = nudge(neutral(0.58 if dark else 0.62, spec), [surface, bg], 3)
  t["data-old"] = neutral(Lb + (0.12 if dark else -0.12), spec)
  t["data-neutral"] = nudge(neutral(0.76 if dark else 0.45, spec), [surface, bg], 3.5)
  t["data-shape"] = neutral(0.5 if dark else 0.64, spec)
  party_source = {p: data[i % len(data)] for i, p in enumerate(PARTIES[:-2])} if style.get("cvd") else PARTY_HUES
  for p in PARTIES:
    c = party_source.get(p, PARTY_HUES[p]) if p not in ("other", "executive") else neutral(0.5, spec)
    if p == "executive":  # the executive stands apart from the gray categories: near ink
      c = neutral(0.93 if dark else 0.28, spec)
    t[f"party-{p}"] = nudge(c, [surface, bg], 3)
  for k, v in style.get("overrides", {}).get(mode, {}).items():
    t[k] = v
  t["shadow"] = ("0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .3)" if dark
                 else "0 1px 2px rgba(20, 24, 35, .05), 0 8px 24px rgba(20, 24, 35, .07)")
  return t

def derive_original(mode: str) -> dict[str, str]:
  t = dict(ORIGINAL[mode])
  dark = mode == "dark"
  for name in TILES:  # plain soft tiles, as before
    t[name], t[f"{name}-ink"], t[f"{name}-label"] = t["soft"], t["ink"], t["ink-3"]
  for i, c in enumerate(ORIGINAL["data"]):
    t[f"cat-{i + 1}"] = c
  neg, mid, pos = ORIGINAL["stance"]
  t.update({"div-neg": neg, "div-mid": mid, "div-pos": pos, "div-neg-soft": mix(neg, mid, 0.5), "div-pos-soft": mix(pos, mid, 0.5)})
  t.update({"seq-low": "#EAF0FD" if not dark else "#24304D", "seq-high": "#3B6FE0" if not dark else "#9DB8F5",
            "data-none": ORIGINAL["none"], "data-old": ORIGINAL["old"] if dark else "#D6D9DF",
            "data-neutral": "#7D7C75", "data-shape": "#A3A197"})
  for p in PARTIES:
    t[f"party-{p}"] = PARTY_HUES[p] if p != "executive" else ("#E8E6DF" if dark else "#8F8E85")
  t["shadow"] = "0 1px 2px rgba(20, 24, 35, .04), 0 4px 16px rgba(20, 24, 35, .04)"
  return t

# ---------------------------------------------------------------- checks

def checks(t: dict[str, str], strong: bool) -> list[tuple[str, str, float, float]]:
  """(foreground, background, ratio, required) for every pair that matters."""
  out = []
  def need(fg, bg, req):
    out.append((fg, bg, contrast(t[fg], t[bg]), req))
  for fg in ["ink", "ink-2", "ink-3"]:
    for bg in ["surface", "bg", "soft"]:
      need(fg, bg, 4.5)
  need("accent-deep", "accent-soft", 4.5); need("accent-deep", "surface", 4.5); need("on-accent", "accent", 4.5)
  need("line-strong", "surface", 3); need("line-strong", "bg", 3)
  for name in TILES:
    need(f"{name}-ink", name, 7); need(f"{name}-label", name, 4.5)
  for name in STATUS:
    need(name, f"{name}-soft", 4.5); need(name, "surface", 4.5)
  for name in OUTLETS:
    need(name, "surface", 4.5)
  for k in [f"cat-{i}" for i in range(1, 9)] + ["div-neg", "div-pos", "data-none", "data-neutral"] + [f"party-{p}" for p in PARTIES]:
    need(k, "surface", 3)
  return out

def cvd_report(t: dict[str, str]) -> dict[str, tuple[float, str]]:
  groups = {
    "categorical": {f"cat-{i}": t[f"cat-{i}"] for i in range(1, 9)},
    "outlets": {k: t[k] for k in OUTLETS},
    "status": {k: t[k] for k in ("law", "progress", "bad")},
    "stance": {"neg": t["div-neg"], "mid": t["div-mid"], "pos": t["div-pos"]},
    "parties (main 5)": {p: t[f"party-{p}"] for p in ("ppso", "pln", "fa", "pusc", "cac")},
  }
  rep = {}
  for g, colors in groups.items():
    worst = min((closest_pair(colors, k) + (k,) for k in CVD), key = lambda r: r[0])
    rep[g] = worst
  return rep

# ---------------------------------------------------------------- output

def block(selector: str, t: dict[str, str], style: dict, dark: bool) -> str:
  lines = [f"{selector} {{", f"  color-scheme: {'dark' if dark else 'light'};"]
  for k, v in t.items():
    lines.append(f"  --{k}: {v};")
  lines += [f"  --font: {style['font']};", f"  --font-display: {style['display']};", f"  --fw: {style['weight']};",
            f"  --radius: {style['radius']};", f"  --radius-sm: {style['radius_sm']};", "}"]
  return "\n".join(lines)

def main():
  ap = argparse.ArgumentParser(description = __doc__.splitlines()[0])
  ap.add_argument("--check", action = "store_true", help = "only report, write nothing")
  args = ap.parse_args()

  css = ["/* Generated by build_styles.py: do not edit by hand. Alternative styles of the local pages; the official",
         "   one is in theme.css. Selected with html[data-style] (theme.js), each with light and dark. */", ""]
  failures = 0
  official = official_tokens()
  print_report("oficial", official)
  for key, style in STYLES.items():
    for mode in ("light", "dark"):
      t = derive_original(mode) if style.get("faithful") else derive(style, mode)
      bad = [c for c in checks(t, style.get("strong", False)) if c[2] < c[3]]
      if not style.get("faithful"):
        failures += len(bad)
      print(f"\n== {key} / {mode}: {len(bad)} contrast failures{' (faithful copy, not fixed)' if style.get('faithful') and bad else ''}")
      for fg, bg, r, req in bad[:12]:
        print(f"   {fg} on {bg}: {r:.2f} (needs {req})")
      for g, (d, pair, kind) in cvd_report(t).items():
        flag = "  <-- close" if d < 10 else ""
        print(f"   cvd {g:17s} closest {d:5.1f} ({pair}, {kind}){flag}")
      sel = f':root[data-style="{key}"]' + ('[data-theme="dark"]' if mode == "dark" else ':not([data-theme="dark"])')
      css.append(block(sel, t, style, mode == "dark"))
      css.append("")
    if style.get("extra"):
      css.append(style["extra"].strip())
      css.append("")
  print(f"\nTotal contrast failures in the new styles: {failures}")
  if args.check:
    return
  (HERE / "variants.css").write_text("\n".join(css), encoding = "utf-8")
  write_style_list()
  print(f"Wrote {HERE / 'variants.css'} and the style list in theme.js")

def official_tokens() -> dict[str, dict[str, str]]:
  css = (HERE / "theme.css").read_text(encoding = "utf-8")
  def read(sel):
    i = css.index(sel); j = css.index("\n}", i)
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", css[i:j]))
  light = read(":root {")
  return {"light": light, "dark": {**light, **read(':root[data-theme="dark"]')}}

def print_report(key: str, modes: dict[str, dict[str, str]]):
  for mode, t in modes.items():
    print(f"== {key} / {mode} (hand-made, in theme.css)")
    for g, (d, pair, kind) in cvd_report(t).items():
      flag = "  <-- close" if d < 10 else ""
      print(f"   cvd {g:17s} closest {d:5.1f} ({pair}, {kind}){flag}")

def write_style_list():
  """Writes the list shown in Settings (name, description, preview colors) between markers in theme.js."""
  official = official_tokens()
  items = [{"id": "oficial", "name": "Oficial", "description": "Poppins, fondo azulado, acento índigo y mosaicos pastel.",
            "light": [official["light"][k] for k in ("bg", "surface", "accent", "sky", "mint", "peach")],
            "dark": [official["dark"][k] for k in ("bg", "surface", "accent", "sky", "mint", "peach")]}]
  for key, style in STYLES.items():
    tl = derive_original("light") if style.get("faithful") else derive(style, "light")
    td = derive_original("dark") if style.get("faithful") else derive(style, "dark")
    items.append({"id": key, "name": style["name"], "description": style["description"],
                  "light": [tl[k] for k in ("bg", "surface", "accent", "sky", "mint", "peach")],
                  "dark": [td[k] for k in ("bg", "surface", "accent", "sky", "mint", "peach")]})
  import json
  body = "  window.LC.STYLES = " + json.dumps(items, ensure_ascii = False, indent = 2).replace("\n", "\n  ") + ";"
  path = HERE / "theme.js"
  js = path.read_text(encoding = "utf-8")
  start, end = "  // BEGIN STYLES (generated by build_styles.py)", "  // END STYLES"
  i, j = js.index(start) + len(start), js.index(end)
  path.write_text(js[:i] + "\n" + body + "\n" + js[j:], encoding = "utf-8")

if __name__ == "__main__":
  main()
