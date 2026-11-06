import re
import unicodedata

from tools.scraping_tools.bill import Bill

# Bills that inflate the "no coverage" count (#21): they are flagged, not dropped, so the analysis can
# report coverage with and without them. A bill with no flag is a regular bill.
HONORIFIC = "honorific"
ADMINISTRATIVE = "administrative"

# Delfino's categories (bill_categories). Many bills have "-" as their only category, so titles are checked too.
HONORIFIC_CATEGORIES: set[str] = {"Declaratorias y Benemeritazgos"}
ADMINISTRATIVE_CATEGORIES: set[str] = {"Autorizaciones, donaciones y segregaciones"}

# Titles are matched without accents and in lowercase, and only when the bill has no substantive category
# (just "-"): a title alone misleads, e.g. "Benemérito Cuerpo de Bomberos" or "Benemérita Cruz Roja" are
# institution names inside policy bills.
# Honorific: benemeritazgos, distinguished citizens, naming a place or building, commemorative days,
# symbols, and declarations of interest (public, cultural, touristic...) of a place, event or program.
HONORIFIC_TITLE_REGEX = re.compile(
  r"benemerit|ciudadan[oa]s? (distinguid|honorari)|hij[oa]s? predilect"
  r"|(asignacion|otorgamiento|cambio) del? (nombre|denominacion)|denominese|denominar (a|al|el|la)\b"
  r"|\b(dia|semana|mes|ano) (nacional|de la|del|de los|de las)\b.*\b(celebra|conmemora|declara|instaura|efemeride)"
  r"|efemeride|simbolo (nacional|de la patria)"
  r"|declara\w* (de|como) (interes|ciudad|capital|cuna)"
)

# Administrative: authorizations over specific properties (segregate, donate, release from public use,
# transfer, swap, change of purpose) and permits for foreign ships to dock, sail through or land crews.
# Debt condonations share Delfino's "Autorizaciones" category but are policy, so they need a property verb.
ADMINISTRATIVE_TITLE_REGEX = re.compile(
  r"\b(segreg\w*|desafect\w*|traspas\w*|permut\w*|mutacion demanial|cambi\w* (de |el )?(uso|destino|finalidad)"
  r"|don(e|en|ar|arlo|arla|arlos|arlas|acion|aciones)|done)\b"
  r"|permiso (para (el )?(atraque|ingreso|desembarque)|de navegacion)"
)

def normalize(text: str) -> str:
  return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")

def flag_bill(bill: Bill) -> str | None:
  """'honorific', 'administrative' or None. Honorific wins if both apply (e.g. naming a donated building)."""
  title: str = normalize(bill.name or "")
  categories: set[str] = set(bill.categories)
  uncategorized: bool = categories <= {"-"}
  if categories & HONORIFIC_CATEGORIES or (uncategorized and HONORIFIC_TITLE_REGEX.search(title)):
    return HONORIFIC
  if ADMINISTRATIVE_TITLE_REGEX.search(title) and (categories & ADMINISTRATIVE_CATEGORIES or uncategorized
                                                    or bill.file_type == "Acuerdo Legislativo"):
    return ADMINISTRATIVE
  return None
