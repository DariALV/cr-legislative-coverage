import logging
import re
import unicodedata
from datetime import date, datetime

from tools.scraping_tools.asamblea import (AsambleaData, Deputy, DeputyBill, DeputyFaction, DeputyReplacement, DeputyTerm,
                                           Organ, OrganBill, OrganMembership)
from tools.scraping_tools.asamblea_fetcher import read_csv_rows
from tools.scraping_tools.bill import Bill, BillProponent, BillStep, BillSubject, Law

logger = logging.getLogger("cr")

# Markers of the exposición de motivos in a bill's base text, matched on a line without spaces and in upper case.
EXPOSITION_START_REGEX = re.compile(r"^ASAMBLEALEGISLATIVA:?$")
EXPOSITION_END_REGEX = re.compile(r"^(LAASAMBLEALEGISLATIVADELAREP[UÚ]BLICADECOSTARICA)?(DECRETA|ACUERDA):?$")
EXPOSITION_END_HEADER_REGEX = re.compile(r"^LAASAMBLEALEGISLATIVADELAREP[UÚ]BLICADECOSTARICA:?$")
CONTROL_CHARS_REGEX = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")   # e.g. \x1a in some SIL texts

class AsambleaParser:
  """
  Turns the SIL's CSV exports (see AsambleaFetcher) into records (asamblea.py). Texts are stripped and empty
  values become None. Dates come as "dd/mm/yyyy hh:mm:ss" and are kept as dates (the time is always 00:00:00).
  """

  def parse_deputies_list(self, text: str) -> list[Deputy]:
    """
    One Deputy per IdDIPUTADO (deputy × term). The list has one row per faction stint, so a deputy who changed
    faction has several rows: they are merged, keeping the first day of the first stint and the last of the last.
    """
    deputies: dict[int, Deputy] = {}
    for row in read_csv_rows(text):
      deputy_id = int(row["IdDIPUTADO"])
      date_from, date_to = parse_date(row["Desde"]), parse_date(row["Hasta"])
      if deputy_id not in deputies:
        deputies[deputy_id] = Deputy(deputy_id, clean(row["Apellidos"]) or "", clean(row["Nombre"]) or "",
                                     clean(row["AdministracionFormato"]) or "", clean(row["Nombre_Provincia"]),
                                     date_from, date_to, clean(row["Activo"]))
        continue
      deputy = deputies[deputy_id]
      if date_from and (deputy.date_from is None or date_from < deputy.date_from):
        deputy.date_from = date_from
      if deputy.date_to is not None and (date_to is None or date_to > deputy.date_to):
        deputy.date_to = date_to   # None (still in office) wins over any date
    return list(deputies.values())

  def select_deputies(self, deputies: list[Deputy], since: datetime) -> list[Deputy]:
    """Deputies still in office on or after since (no end date, or one on or after it)."""
    return [d for d in deputies if d.date_to is None or d.date_to >= since.date()]

  def parse_deputy(self, deputy: Deputy, tabs: dict[str, str], data: AsambleaData):
    """
    Adds the deputy's tabs to data and fills deputy.person_id and deputy.seat. A missing tab (not downloaded yet)
    is skipped. Person-wide tabs (factions, terms, replacements) repeat for each term of the same person: they are
    deduplicated by AsambleaData users through their keys (see Database.replace_asamblea_tables).
    """
    terms = read_csv_rows(tabs["terms"]) if "terms" in tabs else []
    person_ids = {int(r["IdCEDULA"]) for r in terms if clean(r["IdCEDULA"])}
    if len(person_ids) > 1:
      raise ValueError(f"Deputy {deputy.deputy_id} has several person ids: {sorted(person_ids)}")
    deputy.person_id = next(iter(person_ids), None)
    for r in terms:
      data.deputy_terms.append(DeputyTerm(int(r["IdCEDULA"]), clean(r["Administracion"]) or "", clean(r["Nombre_Provincia"])))

    for r in read_csv_rows(tabs.get("general", "")):
      if int(r["IdDIPUTADO"]) == deputy.deputy_id:
        deputy.seat = parse_int(r["Placa_Diputado"])

    for r in read_csv_rows(tabs.get("factions", "")):
      data.deputy_factions.append(DeputyFaction(int(r["IdFRACCION"]), deputy.person_id, clean(r["Administracion"]) or "",
                                                clean(r["Nombre_Fraccion"]) or "", clean(r["Nombre_Provincia"]),
                                                parse_date(r["Desde"]), parse_date(r["Hasta"])))

    for r in read_csv_rows(tabs.get("replacements", "")):
      data.deputy_replacements.append(DeputyReplacement(parse_int(r["IdCEDULA"]) or deputy.person_id, clean(r["Reemplazos"]),
                                                        clean(r["Nombre"]), parse_date(r["Fecha_Reemplazo"])))

    for r in read_csv_rows(tabs.get("bills", "")):
      number = parse_int(r["Numero_Proyecto"])
      if number is not None:
        data.deputy_bills.append(DeputyBill(deputy.deputy_id, number, int(r["IdPROPONENTE_DE_PROYECTO"]), clean(r["Administracion"])))

    for r in read_csv_rows(tabs.get("positions", "")):
      data.organ_memberships.append(OrganMembership(int(r["IdINTEGRANTE"]), deputy.deputy_id, int(r["Codigo_Organo"]),
                                                    clean(r["Nombre_Organo"]), clean(r["Nombre_Puesto"]), clean(r["Legislatura"]),
                                                    parse_date(r["Fecha_Ingreso_Organo"]), parse_date(r["Fecha_Retiro_Organo"])))

  def parse_organs_list(self, text: str) -> list[Organ]:
    return [Organ(int(r["Codigo_Organo"]), int(r["IdORGANO"]), clean(r["Descripcion_Tipo"]), clean(r["Nombre_Organo"]) or "",
                  parse_date(r["Fecha_Constitucion"]), parse_date(r["Fecha_Disolucion"]), clean(r["Estado"]))
            for r in read_csv_rows(text)]

  def parse_organ(self, organ: Organ, tabs: dict[str, str], data: AsambleaData):
    for r in read_csv_rows(tabs.get("bills", "")):
      number = parse_int(r["Numero_Proyecto"])
      if number is not None:
        data.organ_bills.append(OrganBill(organ.organ_code, number, parse_date(r["Fecha_Inicio"]),
                                          parse_date(r["Fecha_Termino"]), clean(r["Descripcion_Tramite"])))

  # ---- Bills and laws (#66) ----

  def parse_bills_list(self, text: str, first_bill: int) -> dict[int, str]:
    """{number: official title} for every bill from first_bill on (the SIL list goes back to 1960)."""
    bills: dict[int, str] = {}
    for r in read_csv_rows(text):
      number = parse_int(r["Numero_Proyecto"])
      if number is not None and number >= first_bill:
        bills[number] = clean(r["Asunto_Proyecto"]) or ""
    return bills

  def parse_laws_list(self, text: str) -> list[Law]:
    """Every law with its bill. Rows without a law number (one blank row in the list) are skipped."""
    laws: list[Law] = []
    for r in read_csv_rows(text):
      law_number = parse_int(r["Numero_Ley"])
      if law_number:
        laws.append(Law(law_number, parse_int(r["Numero_Proyecto"]), clean(r["Titulo_Ley"]), int(r["IdLEY"])))
    return laws

  def parse_bill(self, number: int, title: str, tabs: dict[str, str], law_numbers: list[int],
                 deputy_index: dict[tuple[str, str], int], date_extracted: datetime) -> Bill:
    """
    One bill from its cached tabs (a missing tab leaves its fields empty). law_numbers come from the laws list.
    Proponents are matched to deputies by name and term (deputy_index, see make_deputy_index): the SIL writes the
    same name in both screens, so no cédula is needed. Signers that aren't deputies (the executive) stay unmatched.
    """
    bill = Bill(number, title, date_extracted)
    for r in read_csv_rows(tabs.get("general", "")):
      bill.file_type = clean(r["Descripcion_Tipo"])
      bill.date_proposed = parse_date(r["Fecha_Iniciacion"])
      bill.archive_number = parse_archive_number(number, r["Numero_Archivado"])
      bill.date_expiry = parse_date(r["Fecha_Vencimiento"])
      bill.date_expiry_four_year = parse_date(r["Fecha_Cuatrienal"])
    bill.law_number = min(law_numbers) if law_numbers else None
    if bill.law_number:
      bill.status = "law"
    elif "general" in tabs:   # without the General tab the archive number is unknown, so the status is too
      bill.status = "archived" if bill.archive_number else "in progress"

    for r in read_csv_rows(tabs.get("steps", "")):
      bill.steps.append(BillStep(int(r["IdTRAMITACION_DE_PROYECTO"]), clean(r["Nombre_Corto"]),
                                 clean(r["Descripcion_Tramite"]) or "", parse_date(r["Fecha_Inicio"]), parse_date(r["Fecha_Termino"])))
    for r in read_csv_rows(tabs.get("proponents", "")):
      name, term = clean(r["Nombre"]) or "", clean(r["Administracion"])
      bill.proponents.append(BillProponent(int(r["IdPROPONENTE_DE_PROYECTO"]), name, term, parse_int(r["Secuencia_Firma"]),
                                           deputy_index.get((normalize_name(name), term or ""))))
    for r in read_csv_rows(tabs.get("subjects", "")):
      code = parse_int(r["Codigo_Materia"])
      subject = clean(r["Descripcion_Materia"])
      if code is not None and subject:
        bill.subjects.append(BillSubject(code, subject))
    return bill

  def parse_bill_text(self, bill: Bill, text: str | None):
    """
    Fills the bill's text fields from its cached base text (one line per paragraph, see docx_text). None (not
    downloaded) leaves them empty. The exposición de motivos goes from the line "ASAMBLEA LEGISLATIVA:" to the first
    "DECRETA" or "ACUERDA" after it (proyectos de acuerdo, e.g. Reglamento reforms, end with ACUERDA).
    """
    if text is None:
      return
    text = CONTROL_CHARS_REGEX.sub(" ", text)
    lines = [line for line in text.split("\n") if line.strip()]
    bill.total_words = sum(len(line.split()) for line in lines)
    if not lines:
      bill.text_status = "no_text"
      return
    keys = [re.sub(r"\s+", "", line).upper() for line in lines]
    start = next((i for i, key in enumerate(keys) if EXPOSITION_START_REGEX.match(key)), None)
    end = next((i for i, key in enumerate(keys) if start is not None and i > start and EXPOSITION_END_REGEX.match(key)), None)
    if start is not None and end is not None:
      while end > start + 1 and EXPOSITION_END_HEADER_REGEX.match(keys[end - 1]):
        end -= 1   # the line before DECRETA often is "LA ASAMBLEA LEGISLATIVA DE LA REPÚBLICA DE COSTA RICA"
    exposition = "\n".join(lines[start + 1:end]).strip() if start is not None and end is not None else ""
    if not exposition:
      bill.text_status = "no_exposition"
      return
    bill.text_status = "ok"
    bill.exposition = exposition
    bill.exposition_words = len(exposition.split())

class DeputyMatcher:
  """
  Matches a name written as Delfino does ("Ivonne Acuña Cabrera": names first, mixed case, sometimes without a
  second name) to the SIL deputy in office on a given date. Tries, among the deputies in office that day:
  1. the same name ("NAMES SURNAMES", without accents);
  2. the same words in any order;
  3. a single deputy whose name holds every word of the given one.
  Anything else (no candidate or several) is left unmatched.
  """

  def __init__(self, deputies: list[tuple[int, str, str, str | None, str | None]]):
    """deputies: (deputy_id, surnames, names, date_from, date_to) as Database.get_deputies_for_matching returns them."""
    self.deputies = [(deputy_id, normalize_name(f"{names} {surnames}"),
                      date.fromisoformat(date_from) if date_from else None, date.fromisoformat(date_to) if date_to else None)
                     for deputy_id, surnames, names, date_from, date_to in deputies]

  def match(self, name: str, when: date | None) -> int | None:
    if when is None:
      return None
    candidates = [(deputy_id, full) for deputy_id, full, start, end in self.deputies
                  if (start is None or start <= when) and (end is None or when <= end)]
    target = normalize_name(name)
    words = set(target.split())
    for rule in (lambda full: full == target, lambda full: set(full.split()) == words, lambda full: words <= set(full.split())):
      found = [deputy_id for deputy_id, full in candidates if rule(full)]
      if len(found) == 1:
        return found[0]
      if len(found) > 1:
        return None
    return None

def make_deputy_index(deputies: list[Deputy]) -> dict[tuple[str, str], int]:
  """{(normalized "SURNAMES NAMES", term): deputy_id}, to match bill proponents and Delfino voters to deputies."""
  return {(normalize_name(f"{d.surnames} {d.names}"), d.term): d.deputy_id for d in deputies}

def normalize_name(name: str) -> str:
  """Upper case, no accents, single spaces: "Vásquez  Castro" and "VASQUEZ CASTRO" are the same name."""
  text = unicodedata.normalize("NFD", name.upper())
  return " ".join("".join(c for c in text if unicodedata.category(c) != "Mn").split())

def clean(value: str | None) -> str | None:
  """Strips the value (the SIL pads many texts with spaces); empty becomes None."""
  if value is None:
    return None
  value = " ".join(value.split())
  return value or None

def parse_int(value: str | None) -> int | None:
  value = clean(value)
  return int(value) if value is not None else None

def parse_archive_number(bill_number: int, value: str | None) -> int | None:
  """
  The archive number, keeping only its integer part when the SIL writes it oddly (seen: "16605.1", "16335."),
  with a warning in the run log.
  """
  value = clean(value)
  if value is None or value.isdigit():
    return int(value) if value else None
  digits = value.split(".")[0]
  if not digits.isdigit():
    raise ValueError(f"bill {bill_number}: unexpected archive number {value!r}")
  logger.warning("bill %s: archive number %r kept as %s", bill_number, value, digits)
  return int(digits)

def parse_date(value: str | None) -> date | None:
  value = clean(value)
  if value is None:
    return None
  return datetime.strptime(value.split(" ")[0], "%d/%m/%Y").date()
