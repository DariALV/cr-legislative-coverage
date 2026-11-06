from datetime import date, datetime

from tools.scraping_tools.asamblea import (AsambleaData, Deputy, DeputyBill, DeputyFaction, DeputyReplacement, DeputyTerm,
                                           Organ, OrganBill, OrganMembership)
from tools.scraping_tools.asamblea_fetcher import read_csv_rows

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

def clean(value: str | None) -> str | None:
  """Strips the value (the SIL pads many texts with spaces); empty becomes None."""
  if value is None:
    return None
  value = " ".join(value.split())
  return value or None

def parse_int(value: str | None) -> int | None:
  value = clean(value)
  return int(value) if value is not None else None

def parse_date(value: str | None) -> date | None:
  value = clean(value)
  if value is None:
    return None
  return datetime.strptime(value.split(" ")[0], "%d/%m/%Y").date()
