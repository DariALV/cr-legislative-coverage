from datetime import datetime

class Expediente:

  def __init__(self, number: int, file_type: str, name: str, description: str, date_proposed: datetime, categories: list[str], status: str, date_extracted: datetime):
    self.number = number
    self.file_type = file_type
    self.name = name
    self.description = description
    self.date_proposed = date_proposed
    self.categories = categories
    self.status = status
    self.date_extracted = date_extracted