from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class Expediente:
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