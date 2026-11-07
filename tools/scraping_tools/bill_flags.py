import re
import unicodedata

from tools.scraping_tools.bill import Bill

# Bills that inflate the "no coverage" count (#21): they are flagged, not dropped, so the analysis can
# report coverage with and without them. A bill with no flag is a regular bill.
HONORIFIC = "honorific"
ADMINISTRATIVE = "administrative"

# The SIL's procedure types (bills.file_type) that are honorific or administrative by themselves (#66). Most such
# bills still go through the ordinary procedure, so titles are checked too. The SIL's subjects (Materias) are too
# broad to decide (e.g. "BENEMERIT,-O/-A" also tags a donation by the Benemérito Cuerpo de Bomberos), so they aren't used.
HONORIFIC_TYPES: set[str] = {"PROCEDIMIENTO PROYECTOS DE COMISION DE HONORES"}
ADMINISTRATIVE_TYPES: set[str] = {"PROCEDIMIENTO SOLICITUDES DE ATRAQUE Y DESEMBARQUE"}

# Institutions whose name carries an honorific word but that appear in policy or property bills; removed from the
# title before the honorific patterns run.
INSTITUTION_NAMES_REGEX = re.compile(r"benemerit[oa] (cuerpo de bomberos|cruz roja)")

# Titles are matched without accents and in lowercase.
# Honorific: benemeritazgos, distinguished citizens, naming a place or building, commemorative days (the verb before
# or after the day), symbols, folk cities, and declarations of interest (public, cultural, touristic...) of a place,
# event or program.
HONORIFIC_TITLE_REGEX = re.compile(
  r"benemerit|ciudadan[oa]s? (distinguid|honorari)|hij[oa]s? predilect"
  r"|(asignacion|otorgamiento|cambio) del? (nombre|denominacion)|denominese|denominar (a|al|el|la)\b"
  r"|\b(dia|semana|mes|ano) (nacional|de la|del|de los|de las)\b.*\b(celebra|conmemora|declara|instaura|efemeride)"
  r"|\b(declar|celebra|conmemora|instaura)\w*\b.*\b(dia|semana|mes|ano) (nacional|de la|del|de los|de las)\b"
  r"|efemeride|simbolo (nacional|de la patria)|ciudad (folcl|folkl)"
  r"|declara\w* (de|como) (interes|ciudad|capital|cuna)"
)

# Administrative: authorizations over specific properties (segregate, donate, release from public use,
# transfer, swap, change of purpose) and permits for foreign ships to dock, sail through or land crews.
# Debt condonations are policy, so they need a property verb.
ADMINISTRATIVE_TITLE_REGEX = re.compile(
  r"\b(segreg\w*|desafect\w*|traspas\w*|permut\w*|mutacion demanial|cambi\w* (de |el )?(uso|destino|finalidad)"
  r"|don(e|en|ar|arlo|arla|arlos|arlas|acion|aciones)|done)\b"
  r"|permiso (para (el )?(atraque|ingreso|desembarque)|de navegacion)"
)

def normalize(text: str) -> str:
  return " ".join("".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn").split())

def flag_bill(bill: Bill) -> str | None:
  """'honorific', 'administrative' or None. Honorific wins if both apply (e.g. naming a donated building)."""
  title: str = normalize(bill.name or "")
  if bill.file_type in HONORIFIC_TYPES or HONORIFIC_TITLE_REGEX.search(INSTITUTION_NAMES_REGEX.sub("", title)):
    return HONORIFIC
  if bill.file_type in ADMINISTRATIVE_TYPES or ADMINISTRATIVE_TITLE_REGEX.search(title):
    return ADMINISTRATIVE
  return None
