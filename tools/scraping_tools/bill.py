from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class BillProponent:
    slug: str                 # Delfino's profile slug (/asamblea/congresistas/<slug>), stable across bills
    name: str
    role: str                 # "main" (Firma Principal) or "co" (Co-proponentes)
    kind: str = "deputy"      # "deputy" or "special" (/asamblea/perfiles-especiales/<slug>, e.g. the executive)
    party: str | None = None
    position: str | None = None   # e.g. "Jefe de fracción"
    province: str | None = None
    seat: int | None = None       # seat number Delfino shows next to the photo

@dataclass
class DeputyVote:
    slug: str                 # same slug as BillProponent (/asamblea/congresistas/<slug>)
    name: str
    vote: str                 # "for" (A favor), "against" (En contra), "absent" (Ausente); other labels kept as Delfino shows them
    party: str | None = None
    seat: int | None = None

@dataclass
class BillEvent:
    event_type: str           # "text" (Histórico de Textos) or "vote" (Histórico de Votaciones)
    date: datetime | None
    name: str                 # e.g. "Texto base", "Criterio Servicios Técnicos", "Primer debate", "Moción de fondo"
    description: str | None = None   # votes only: what was voted
    result: str | None = None        # votes only: e.g. "Aprobado", "Rechazado"
    url: str | None = None           # text PDF or Delfino vote page
    vote_id: str | None = None       # votes only: last part of the vote page url, e.g. "20260514007"
    deputy_votes: list[DeputyVote] = field(default_factory = list)   # votes only: filled from the vote page

@dataclass
class Bill:
    number: int
    name: str
    description: str
    date_extracted: datetime
    file_type: str | None = None
    status: str | None = None
    commission: str | None = None
    date_proposed: datetime | None = None
    law_number: int | None = None
    categories: list[str] = field(default_factory = list)
    flag: str | None = None   # "honorific", "administrative" or None (see bill_flags.py, #21)
    proponents: list[BillProponent] = field(default_factory = list)
    events: list[BillEvent] = field(default_factory = list)
