from dataclasses import dataclass, field
from datetime import date

# Records from the Asamblea Legislativa's SIL (#65). Ids are the SIL's own. No cédulas: people are linked
# across terms by person_id (the SIL's internal IdCEDULA, which is not the cédula).

@dataclass
class Deputy:
    deputy_id: int                # IdDIPUTADO: one deputy in one term
    surnames: str
    names: str
    term: str                     # "2018-2022"
    province: str | None          # factions (and their changes within the term) are in DeputyFaction
    date_from: date | None        # first day in office in this term (later than May 1 for replacements)
    date_to: date | None          # last day in office in this term (None while in office)
    status: str | None = None     # "VIGENTE" or "NO VIGENTE"
    person_id: int | None = None  # IdCEDULA from the Administraciones tab: the same person across terms
    seat: int | None = None       # Placa_Diputado (seat number)

@dataclass
class DeputyFaction:
    faction_id: int               # IdFRACCION: the faction itself (43 = Liberación Nacional in every term), not the stint
    person_id: int | None
    term: str
    faction: str                  # e.g. "LIBERACIÓN NACIONAL", "DIPUTADA INDEPENDIENTE ACUNA CABRERA"
    province: str | None
    date_from: date | None
    date_to: date | None

@dataclass
class DeputyTerm:
    person_id: int
    term: str                     # every term of the person, including those before Config.DEPUTIES_SINCE
    province: str | None

@dataclass
class DeputyReplacement:
    person_id: int | None
    detail: str | None            # Reemplazos: "Detalle de reemplazo"
    name: str | None
    date: date | None

@dataclass
class DeputyBill:
    deputy_id: int
    bill_number: int
    proponent_id: int             # IdPROPONENTE_DE_PROYECTO
    term: str | None

@dataclass
class OrganMembership:
    membership_id: int            # IdINTEGRANTE
    deputy_id: int
    organ_code: int               # Codigo_Organo, joins Organ.organ_code
    organ_name: str | None        # as the deputy's Puestos tab shows it
    position: str | None          # e.g. "PRESIDENTE", "INTEGRANTE", "RETIRADO"
    legislature: str | None       # one-year legislature, e.g. "2019-2020"
    date_joined: date | None
    date_left: date | None

@dataclass
class Organ:
    organ_code: int               # Codigo_Organo (special commissions use the number of the bill that created them)
    organ_id: int                 # IdORGANO
    organ_type: str | None        # e.g. "PERMANENTE ORDINARIA", "ESPECIAL", "PLENARIO"
    name: str
    date_constituted: date | None
    date_dissolved: date | None
    status: str | None            # "ACTIVO" or "INACTIVO"

@dataclass
class OrganBill:
    organ_code: int
    bill_number: int
    date_start: date | None       # Fecha_Inicio of the bill's current step in the organ
    date_end: date | None         # Fecha_Termino (usually empty: the step is still open)
    last_step: str | None         # Descripcion_Tramite, e.g. "INGRESO EN EL ORDEN DEL DÍA Y DEBATE (COMISIÓN)"

@dataclass
class AsambleaData:
    """Everything the SIL tables hold, built from the cached CSVs."""
    deputies: list[Deputy] = field(default_factory = list)
    deputy_factions: list[DeputyFaction] = field(default_factory = list)
    deputy_terms: list[DeputyTerm] = field(default_factory = list)
    deputy_replacements: list[DeputyReplacement] = field(default_factory = list)
    deputy_bills: list[DeputyBill] = field(default_factory = list)
    organ_memberships: list[OrganMembership] = field(default_factory = list)
    organs: list[Organ] = field(default_factory = list)
    organ_bills: list[OrganBill] = field(default_factory = list)
