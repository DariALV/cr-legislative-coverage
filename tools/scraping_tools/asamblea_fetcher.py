import base64
import csv
import io
import json
import logging
import os
import pathlib
import re
import ssl
from datetime import date, datetime

import certifi
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import Config
from tools.file_tools.file_manager import hash
from tools.scraping_tools.rate_limiter import RateLimiter

logger = logging.getLogger("cr")

# Queries of the SIL screens (#65) and the columns asked for. The export only accepts columns the query returns.
# Cédulas are never asked for in a cached query: they are only read in memory to select a deputy (see deputy_contexts).
DEPUTIES_LIST = ("C_ll_CNSDIPUTADOS_Diputados",
                 ["IdDIPUTADO", "Administracion", "AdministracionFormato", "Apellidos", "Nombre", "Nombre_Fraccion",
                  "Nombre_Provincia", "Desde", "Hasta", "Activo"], "Apellidos asc")
# "Información general" is a form, not a table: it can't be exported, so it is read from the data embedded in the
# tab's window (SIL_CNSDIPUTADOS_GENERAL) and cached as a CSV with the same columns.
DEPUTY_GENERAL = ("SIL_CNSDIPUTADOS_GENERAL", "C_ff_CNSDIPUTADOS_General",
                  ["IdDIPUTADO", "Placa_Diputado", "Desde", "Hasta", "Administracion", "Nombre_Fraccion", "Nombre",
                   "Nombre_Provincia", "Activo"])
DEPUTY_TABS: dict[str, tuple[str, list[str], str]] = {
  "bills": ("C_ll_CNSDIPUTADOS_Proyectos",
            ["IdPROPONENTE_DE_PROYECTO", "Numero_Proyecto", "Administracion"], "Numero_Proyecto asc"),
  "positions": ("C_ll_CNSDIPUTADOS_PuestosLegislativos",
                ["IdINTEGRANTE", "Codigo_Organo", "Nombre_Organo", "Nombre_Puesto", "Fecha_Ingreso_Organo",
                 "Fecha_Retiro_Organo", "Legislatura"], "IdINTEGRANTE asc"),
  "factions": ("C_ll_CNSDIPUTADOS_Fracciones",
               ["IdFRACCION", "Administracion", "Nombre_Fraccion", "Desde", "Hasta", "Nombre_Provincia"], "IdFRACCION asc"),
  "terms": ("C_ll_CNSDIPUTADOS_Administraciones",
            ["IdCEDULA", "Administracion", "Nombre_Provincia"], "IdCEDULA asc"),
  "replacements": ("C_ll_CNSDIPUTADOS_Reemplazos",
                   ["IdCEDULA", "Reemplazos", "Nombre", "Fecha_Reemplazo"], "Fecha_Reemplazo asc"),
}
ORGANS_LIST = ("C_ll_CNSORGANOS_ListaOrganos",
               ["IdORGANO", "Codigo_Organo", "Descripcion_Tipo", "Nombre_Organo", "Fecha_Constitucion",
                "Fecha_Disolucion", "Estado"], "Codigo_Organo asc")
ORGAN_BILLS = ("C_ll_CNSORGANOS_Expedientes",
               ["IdPROYECTO_DE_LEY", "Numero_Proyecto", "Fecha_Inicio", "Fecha_Termino", "Descripcion_Tramite"],
               "Numero_Proyecto asc")

SIL_INTERMEDIATE_CERT = pathlib.Path(__file__).parent / "certs" / "globalsign_gcc_r3_dv_tls_ca_2020.pem"

# A frame built by a window's html: new <Frame>({"ventana": ..., "datos": {query: {"0": [rows]}}, ...});
WINDOW_FRAME_REGEX = re.compile(r'new \w+\((\{"ventana".*?\})\);\r?\n')

DEPUTIES_MODULE = "CNSDIPUTADOS"
DEPUTIES_FRAME = "ll_CNSDIPUTADOS_Diputados"
ORGANS_MODULE = "CNSORGANOS"
ORGANS_FRAME = "ll_CNSORGANOS_ListaOrganos"
LEGISLATURE_FRAME = "ff_CNSORGANOS_FiltroLegislatura"

class AsambleaError(Exception):
  """The SIL answered with an error page or an expired session instead of the data."""

class AsambleaFetcher:
  """
  Downloads data from the Asamblea Legislativa's SIL (https://produccion.asamblea.go.cr/SILConsulta), see #19 and #65.

  The SIL is a stateful ASP.NET app: a session cookie, a "window" opened per screen and a "context" (the selected
  deputy, organ or legislature) stored on the server. Every screen's table can be exported as a whole CSV with
  Utilidades/DescargarArchivoPlano, which is what this class uses: no HTML parsing and no paging.

  Each export is cached as one CSV file under raw/csv/asamblea/<group>/ (written atomically: temp file + rename),
  so an interrupted run (Ctrl+C, network failure) loses nothing and the next run skips what is cached.
  Not thread-safe: one session, one rate limiter.
  """

  def __init__(self, user_agent: str = Config.USER_AGENT, rate_limit: float = Config.RATE_LIMIT,
               retries: int = Config.RETRIES, timeout: int = Config.ASAMBLEA_TIMEOUT, base_url: str = Config.ASAMBLEA_URL,
               cache_dir: str = f"{Config.RAW_CSV_DIR}/asamblea", refresh_before: datetime | None = None):
    """refresh_before: cached files written before that moment are downloaded again (e.g. after a new legislature)."""
    self.user_agent = user_agent
    self.rate_limiter = RateLimiter(rate_limit)
    self.retries = retries
    self.timeout = timeout
    self.base_url = base_url
    self.cache_dir = pathlib.Path(cache_dir)
    self.refresh_before = refresh_before
    self.session: requests.Session | None = None
    self.open_windows: set[str] = set()
    self.contexts: dict[str, list[dict]] = {}   # last context set per module, to restore it on a new session

  # ---- Deputies ----

  def fetch_deputies_list(self) -> str:
    """CSV of every deputy × term × faction stint (one row per stint: a deputy who changed faction has several)."""
    return self.cached_export("deputies", "list", DEPUTIES_MODULE, None, *DEPUTIES_LIST)

  def deputy_contexts(self) -> dict[int, list[dict]]:
    """
    {IdDIPUTADO: context} to select each deputy term. The context needs the cédula, so this export is kept in memory
    only and never cached or returned to the database. Uses the first stint of each term (earliest Desde).
    """
    query, _, order = DEPUTIES_LIST
    text = self.export(DEPUTIES_MODULE, query, ["IdDIPUTADO", "Cedula_Diputado", "Administracion", "Desde"], order)
    contexts: dict[int, list[dict]] = {}
    first_desde: dict[int, date] = {}
    for row in read_csv_rows(text):
      deputy_id = int(row["IdDIPUTADO"])
      desde = datetime.strptime(row["Desde"], "%d/%m/%Y %H:%M:%S").date()
      if deputy_id in first_desde and first_desde[deputy_id] <= desde:
        continue
      first_desde[deputy_id] = desde
      contexts[deputy_id] = [
        {"nombre": "Cedula_Diputado", "valor": int(row["Cedula_Diputado"]), "marco": DEPUTIES_FRAME},
        {"nombre": "Administracion", "valor": int(row["Administracion"]), "marco": DEPUTIES_FRAME},
        {"nombre": "Desde", "valor": row["Desde"], "marco": DEPUTIES_FRAME},
      ]
    return contexts

  def deputy_is_cached(self, deputy_id: int) -> bool:
    return all(self.is_cached("deputies", f"{deputy_id}/{tab}") for tab in ["general", *DEPUTY_TABS])

  def fetch_deputy(self, deputy_id: int, context: list[dict]) -> dict[str, str]:
    """
    Every tab of one deputy term: general (seat), bills (Expedientes presentados), positions (Puestos in organs),
    factions, terms (Administraciones) and replacements. Returns {tab: CSV}. The context is set only if a tab is missing.
    Bills and positions are per term; factions, terms and replacements cover the whole person (all their terms).
    """
    tabs: dict[str, str] = {"general": self.cached_window("deputies", f"{deputy_id}/general", DEPUTIES_MODULE, context, *DEPUTY_GENERAL)}
    for tab, (query, columns, order) in DEPUTY_TABS.items():
      tabs[tab] = self.cached_export("deputies", f"{deputy_id}/{tab}", DEPUTIES_MODULE, context, query, columns, order)
    return tabs

  def load_deputy(self, deputy_id: int) -> dict[str, str]:
    """The cached tabs of a deputy term (missing ones left out). Never downloads."""
    return {tab: text for tab in ["general", *DEPUTY_TABS] if (text := self.load("deputies", f"{deputy_id}/{tab}")) is not None}

  # ---- Organs ----

  def fetch_organs_list(self) -> str:
    """CSV of every legislative organ ever (Plenario, Directorio, permanent and special commissions...)."""
    return self.cached_export("organs", "list", ORGANS_MODULE, legislature_context(), *ORGANS_LIST)

  def organ_is_cached(self, organ_code: int) -> bool:
    return self.is_cached("organs", f"{organ_code}/bills")

  def fetch_organ(self, organ_code: int) -> dict[str, str]:
    """
    The organ's tabs that are stored: bills (Expedientes que atiende), i.e. the bills it holds today with the date they
    came in and their last step. Members come from each deputy's positions instead (#65); support staff is not stored.
    """
    context = legislature_context() + [{"nombre": "Codigo_Organo", "valor": organ_code, "marco": ORGANS_FRAME}]
    return {"bills": self.cached_export("organs", f"{organ_code}/bills", ORGANS_MODULE, context, *ORGAN_BILLS)}

  def load_organ(self, organ_code: int) -> dict[str, str]:
    text = self.load("organs", f"{organ_code}/bills")
    return {"bills": text} if text is not None else {}

  # ---- Cache ----

  def cached_export(self, group: str, key: str, module: str, context: list[dict] | None,
                    query: str, columns: list[str], order: str) -> str:
    """The cached CSV, or exports it (setting the context first) and caches it."""
    if self.is_cached(group, key):
      return self.load(group, key) or ""
    if context is not None:
      self.set_context(module, context)
    text = self.export(module, query, columns, order)
    self.save(group, key, text)
    return text

  def cached_window(self, group: str, key: str, module: str, context: list[dict], window: str,
                    query: str, columns: list[str]) -> str:
    """Like cached_export, for a form tab: its rows are read from the window's embedded data and cached as CSV."""
    if self.is_cached(group, key):
      return self.load(group, key) or ""
    self.set_context(module, context)
    text = rows_to_csv(self.window_rows(module, window, query), columns)
    self.save(group, key, text)
    return text

  def path(self, group: str, key: str) -> pathlib.Path:
    return self.cache_dir / group / f"{hash(key)}.csv"

  def is_cached(self, group: str, key: str) -> bool:
    path = self.path(group, key)
    if not path.exists():
      return False
    return self.refresh_before is None or datetime.fromtimestamp(path.stat().st_mtime) >= self.refresh_before

  def load(self, group: str, key: str) -> str | None:
    path = self.path(group, key)
    return path.read_text(encoding = "utf-8", newline = "") if path.exists() else None

  def save(self, group: str, key: str, text: str):
    """Atomic: a Ctrl+C while writing leaves the old file (or none), never half a CSV that looks valid."""
    path = self.path(group, key)
    path.parent.mkdir(parents = True, exist_ok = True)
    temp = path.with_suffix(".tmp")
    temp.write_text(text, encoding = "utf-8", newline = "")   # kept byte for byte: no \r\n translation on Windows
    os.replace(temp, path)

  # ---- SIL session ----

  def export(self, module: str, query: str, columns: list[str], order: str) -> str:
    """
    Whole result of a screen's query as CSV text (UTF-8), for the context currently set in the session.
    An expired session or error page is retried once on a fresh session (with the same window and context).
    """
    for attempt in range(2):
      self.open_window(module)
      parameters = [{
        "@Tipo": "SP", "@NumeroPagina": 0, "@TamanoPagina": 30, "@OrdenadoPor": order, "@Condiciones": None,
        "@Total": True, "@Parametros": None, "@LlaveNombre": None, "@LlaveContexto": None, "@LlaveValor": None,
        "@Columnas": [{"nombre": c, "codigo": c} for c in columns], "@BaseDatos": "SIL", "@Filtro": None,
      }]
      response = self.post("Utilidades/DescargarArchivoPlano",
                           data = {"consultas": json.dumps([{"consulta": query}]), "parametros": json.dumps(parameters)})
      text = decode(response.content)
      if response.status_code == 200 and text.startswith("sep="):
        return text
      if attempt == 0:
        logger.info(f"[asamblea] {query} answered {response.status_code} at {response.url}, opening a new session")
        self.reset_session(module)
    raise AsambleaError(f"{query} answered {response.status_code} at {response.url}")

  def window_rows(self, module: str, window: str, query: str) -> list[dict]:
    """
    Rows of query embedded in a tab window's answer (JSON whose html builds each frame with its data), for the
    context set in the session. An expired session is retried once on a fresh session.
    """
    for attempt in range(2):
      self.open_window(module)
      response = self.post(window, files = {"parametros": (None, "null")})
      try:
        answer = response.json()
      except ValueError:
        answer = {}
      for result in answer.get("resultadosServiciosIU") or []:
        for match in WINDOW_FRAME_REGEX.finditer(result.get("html") or ""):
          data = (json.loads(match.group(1)).get("datos") or {}).get(query)
          if isinstance(data, dict):
            return data.get("0") or data.get("Resultados") or []
      if attempt == 0:
        logger.info(f"[asamblea] {window} answered {response.status_code} without {query}, opening a new session")
        self.reset_session(module)
    raise AsambleaError(f"{window} answered {response.status_code} without {query}: {response.text[:200]}")

  def set_context(self, module: str, context: list[dict]):
    """
    Selects a deputy, organ or legislature in the server session (what the screens filter by). Skipped when the
    session already has that context, so the tabs of one deputy or organ share a single request.
    """
    if self.session is not None and self.contexts.get(module) == context:
      return
    self.open_window(module)
    response = self.post(f"SIL_{module}_PRINCIPAL/Contexto", files = {"sis_contexto": (None, base64_field(json.dumps(context)))})
    if '"ResultadoEjecucion":"1"' not in response.text:
      raise AsambleaError(f"Could not set the context of {module}: {response.text[:200]}")
    self.contexts[module] = context

  def open_window(self, module: str):
    """Opens the screen of the module once per session (exports fail on a session that never opened it)."""
    if module in self.open_windows:
      return
    window = {"sistema": "SIL", "basedatos": "SIL", "ventanaPrincipal": True}
    self.post(f"SIL_{module}_PRINCIPAL", files = {"parametros": (None, base64_field(json.dumps(window)))})
    self.open_windows.add(module)

  def reset_session(self, module: str):
    """New cookie, windows closed; the module's last context is set again."""
    self.session = None
    self.open_windows = set()
    context = self.contexts.pop(module, None)
    self.contexts = {}   # a new session has no context set
    if context is not None:
      self.set_context(module, context)

  def post(self, path: str, data: dict | None = None, files: dict | None = None) -> requests.Response:
    session = self.get_session()
    headers = {"X-Requested-With": "XMLHttpRequest", "sistema": "SIL", "basedatos": "SIL", "diseno": "DT"}
    response = session.post(self.base_url + path, data = data, files = files, headers = headers, timeout = self.timeout)
    self.rate_limiter.wait()
    return response

  def get_session(self) -> requests.Session:
    """A session with the SIL's cookie (the first GET of Monitor/Principal sets it)."""
    if self.session is None:
      self.session = make_retry_session(self.user_agent, self.retries)
      self.session.get(self.base_url + "Monitor/Principal", timeout = self.timeout)
      self.rate_limiter.wait()
    return self.session

def legislature_context(today: date | None = None) -> list[dict]:
  """The current legislature (May 1 to April 30), which the organs screen filters by."""
  today = today or date.today()
  start = today.year if today.month >= 5 else today.year - 1
  return [{"nombre": "AnioAnterior", "valor": start, "marco": LEGISLATURE_FRAME},
          {"nombre": "AnioPosterior", "valor": start + 1, "marco": LEGISLATURE_FRAME},
          {"nombre": "Legislatura", "valor": f"{start}{start + 1}", "marco": LEGISLATURE_FRAME}]

def base64_field(text: str) -> str:
  """The SIL's encoding of form fields: "base64|" + base64 of the UTF-8 text."""
  return "base64|" + base64.b64encode(text.encode("utf-8")).decode("ascii")

def decode(content: bytes) -> str:
  """The exports come in Windows-1252 (Latin-1 for the bytes it doesn't define)."""
  try:
    return content.decode("cp1252")
  except UnicodeDecodeError:
    return content.decode("latin-1")

def rows_to_csv(rows: list[dict], columns: list[str]) -> str:
  """Rows as an export-like CSV ("sep=," line, header, \r\n endings), so cached files all read the same way."""
  stream = io.StringIO(newline = "")
  stream.write("sep=,\r\n")
  writer = csv.DictWriter(stream, fieldnames = columns, extrasaction = "ignore", lineterminator = "\r\n")
  writer.writeheader()
  for row in rows:
    writer.writerow({c: "" if row.get(c) is None else row.get(c) for c in columns})
  return stream.getvalue()

def read_csv_rows(text: str) -> list[dict[str, str]]:
  """Rows of an export as {column: value}, skipping its first line ("sep=,", a hint for Excel)."""
  stream = io.StringIO(text, newline = "")
  if text.startswith("sep="):
    stream.readline()
  return list(csv.DictReader(stream))

def make_retry_session(user_agent: str, retries: int) -> requests.Session:
  """
  Retries connection errors and 429/5xx with exponential backoff. POST too: every SIL request here only reads.
  HTTPS is verified against certifi plus the GlobalSign intermediate the SIL server leaves out of its chain (see
  certs/README.md): without it every request fails with "unable to get local issuer certificate".
  """
  retry = Retry(
    total = retries,
    backoff_factor = 1,
    status_forcelist = [429, 500, 502, 503, 504],
    respect_retry_after_header = True,
    allowed_methods = ["GET", "POST"],
  )
  session = requests.Session()
  session.mount("https://", SslContextAdapter(sil_ssl_context(), max_retries = retry))
  session.headers.update({"User-Agent": user_agent})
  return session

def sil_ssl_context() -> ssl.SSLContext:
  context = ssl.create_default_context(cafile = certifi.where())
  context.load_verify_locations(cafile = str(SIL_INTERMEDIATE_CERT))
  return context

class SslContextAdapter(HTTPAdapter):
  """HTTPAdapter that verifies with a given SSL context."""

  def __init__(self, ssl_context: ssl.SSLContext, **kwargs):
    self.ssl_context = ssl_context
    super().__init__(**kwargs)

  def init_poolmanager(self, *args, **kwargs):
    kwargs["ssl_context"] = self.ssl_context
    return super().init_poolmanager(*args, **kwargs)

  def proxy_manager_for(self, *args, **kwargs):
    kwargs["ssl_context"] = self.ssl_context
    return super().proxy_manager_for(*args, **kwargs)
