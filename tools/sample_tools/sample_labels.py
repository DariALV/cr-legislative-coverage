import csv
import pathlib
import re
from dataclasses import dataclass, field

# Column headers of the "Etiquetas" tab of the labeling sheet (#27, #28), as exported to CSV from Google Sheets.
COLUMNS = {"draw": "#", "outlet": "Medio", "date": "Fecha", "primary": "Expediente", "file_type": "Tipo de expediente",
           "others": "Otros expedientes mencionados", "alternatives": "Alternativos si hay ambigüedad",
           "mention": "Tipo de mención", "centrality": "Centralidad", "review": "Revisión", "news_id": "news_id",
           "in_sample": "En la muestra"}
POSITIVE_MENTIONS = {"Número", "Nombre oficial", "Apodo", "Proponente o trámite", "Descripción"}
BILL_NUMBER = re.compile(r"\b(2\d{4})\b")

@dataclass
class SampleLabel:
  news_id: str
  draw: int
  outlet: str
  date: str
  in_sample: bool
  review: str                       # Correcto, Corregir, Dudoso or Pendiente
  mention: str                      # mention type of the primary bill, or the reason of a negative
  centrality: str                   # Central, Secundario or De paso ('' for negatives)
  primary: int | None
  others: list[int] = field(default_factory = list)
  alternatives: list[int] = field(default_factory = list)

  @property
  def positive(self) -> bool:
    return self.primary is not None

  @property
  def mentioned(self) -> set[int]:
    """Every bill the news covers according to the label: the primary one and the other mentioned ones."""
    return ({self.primary} if self.primary else set()) | set(self.others)

def read_labels(path: str | pathlib.Path) -> list[SampleLabel]:
  """Labels from the CSV export of the sheet's "Etiquetas" tab. Only the label columns are read; the title,
  evidence and notes columns of the export are ignored (they quote the news)."""
  with open(path, encoding = "utf-8-sig") as handle:
    reader = csv.DictReader(handle)
    absent = [header for header in COLUMNS.values() if header not in (reader.fieldnames or [])]
    if absent:
      raise ValueError(f"{path} lacks the columns {absent}: export the Etiquetas tab of the labeling sheet")
    labels = []
    for row in reader:
      value = {key: (row[header] or "").strip() for key, header in COLUMNS.items()}
      if not value["news_id"]:
        continue
      primary = BILL_NUMBER.findall(value["primary"])
      labels.append(SampleLabel(
        news_id = value["news_id"], draw = int(value["draw"] or 0), outlet = value["outlet"], date = value["date"],
        in_sample = value["in_sample"].lower().startswith("s"), review = value["review"], mention = value["mention"],
        centrality = value["centrality"], primary = int(primary[0]) if primary else None,
        others = [int(n) for n in BILL_NUMBER.findall(value["others"])],
        alternatives = [int(n) for n in BILL_NUMBER.findall(value["alternatives"])]))
  return labels
