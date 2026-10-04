from dataclasses import dataclass
from datetime import datetime

@dataclass
class NewsArticle:
    organization: str
    url: str
    title: str
    description: str
    date_published: datetime
    author: str | None
    content: str | None
    date_extracted: datetime
    extraction_status: str