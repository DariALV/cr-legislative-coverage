from dataclasses import dataclass, field
from datetime import date, datetime

# Bills (expedientes) come from the Asamblea's SIL (#66); votes and how each deputy voted come from Delfino,
# the only part of Delfino's bill data the SIL doesn't have (#22).

@dataclass
class BillProponent:
    proponent_id: int             # IdPROPONENTE_DE_PROYECTO
    name: str                     # as the SIL writes it: surnames then names, e.g. "VÁSQUEZ CASTRO LUIS ALBERTO"
    term: str | None              # the signer's term, e.g. "2014-2018"
    signing_order: int | None     # Secuencia_Firma: 1 is the main signer
    deputy_id: int | None = None  # deputies.deputy_id, matched by name and term; None for non-deputies (the executive)

@dataclass
class BillStep:
    step_id: int                  # IdTRAMITACION_DE_PROYECTO
    organ: str | None             # short name of the organ, e.g. "PLENARIO", "ECONOMICOS (ÁREA V)", "ARCHIVO"
    description: str              # e.g. "VOTACIÓN PRIMER DEBATE (PLENARIO)"
    date_start: date | None
    date_end: date | None

@dataclass
class BillSubject:
    subject_code: int             # Codigo_Materia
    subject: str                  # e.g. "BECA", "DECLARATORIA" (official descriptors, replace Delfino's categories)

@dataclass
class Bill:
    number: int
    name: str                     # official title
    date_extracted: datetime
    file_type: str | None = None  # e.g. "PROCEDIMIENTO PROYECTO DE LEY ORDINARIO"
    date_proposed: date | None = None
    law_number: int | None = None          # from the laws list; the lowest one if the bill produced several
    archive_number: int | None = None      # Numero_Archivado: set once the bill is archived
    date_expiry: date | None = None        # Fecha_Vencimiento (ordinary deadline)
    date_expiry_four_year: date | None = None   # Fecha_Cuatrienal (art. 119: four years unless extended)
    status: str | None = None     # "law", "archived" or "in progress" (derived, the SIL has no status field)
    flag: str | None = None       # "honorific", "administrative" or None (see bill_flags.py, #21)
    proponents: list[BillProponent] = field(default_factory = list)
    steps: list[BillStep] = field(default_factory = list)
    subjects: list[BillSubject] = field(default_factory = list)
    # "Texto base" (#32): the exposición de motivos is the text matched against news. text_status is "ok",
    # "no_exposition" (text without the markers) or "no_text" (the SIL has none); None while not downloaded.
    text_status: str | None = None
    exposition: str | None = None
    total_words: int | None = None
    exposition_words: int | None = None

@dataclass
class Law:
    law_number: int
    bill_number: int | None       # None for the few laws the SIL doesn't tie to a bill
    title: str | None
    law_id: int                   # IdLEY

@dataclass
class DeputyVote:
    slug: str                     # Delfino's profile slug (/asamblea/congresistas/<slug>)
    name: str
    vote: str                     # "for" (A favor), "against" (En contra), "absent" (Ausente); other labels kept as Delfino shows them
    party: str | None = None
    seat: int | None = None
    deputy_id: int | None = None  # deputies.deputy_id, matched by name and the vote date

@dataclass
class Vote:
    vote_id: str                  # last part of the Delfino vote url, e.g. "20260514007"
    number: int                   # bill number
    date: date | None
    name: str                     # e.g. "Primer debate", "Moción de fondo", "Dispensa de trámites (art. 177)"
    description: str | None = None   # what was voted
    result: str | None = None        # e.g. "Aprobado", "Rechazado"
    url: str | None = None
    kind: str = "plenary"            # "plenary" (Plenario), "full_committee" (comisión plena) or "election"
    deputy_votes: list[DeputyVote] = field(default_factory = list)
