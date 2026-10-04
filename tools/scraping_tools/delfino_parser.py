from bs4 import BeautifulSoup
import json
from datetime import datetime

from tools.scraping_tools.expediente import Expediente

class DelfinoParser:
  
  def parse(self, html: str, url: str) -> Expediente:
    soup = BeautifulSoup(html, "lxml")
    # print(self.get_title(soup))
    metadata_list: list[Metadata] = self.get_metadata(soup)
    number = int(url.replace("https://delfino.cr/asamblea/proyecto/", ""))
    title = self.get_title(soup)
    description = self.get_description(soup)
    file_type = self.get_metadata_file_type(metadata_list)
    status = self.get_metadata_status(metadata_list)
    law_number = self.get_metadata_law_number(metadata_list, number)
    date_proposed = self.get_metadata_date_proposed(metadata_list)
    commission = self.get_metadata_commission(metadata_list)
    categories = self.get_metadata_categories(metadata_list)
    expediente: Expediente = Expediente(number, title, description, datetime.now(), file_type, status, commission, date_proposed, law_number, categories)
    return expediente


  def get_title(self, soup: BeautifulSoup) -> str:
    title_tag = soup.find("meta", property="og:title")
    title = title_tag.get("content")
    title = title.split(" - ")[1]
    return title
  
  def get_description(self, soup: BeautifulSoup) -> str:
    base = soup.find(string=lambda s: s.strip() == "Propósito del Proyecto")
    description_root = base.parent.parent.parent
    return description_root.find_all(True, recursive = False)[1].text
  
  def get_metadata(self, soup: BeautifulSoup) -> list[Metadata]:

    metadata_list: list[Metadata] = []

    base = soup.find(string=lambda s: s.strip() == "Tipo")
    metadata_list_parent = base.parent.parent.parent
    metadata_list_div = metadata_list_parent.find_all(True, recursive = False)
    for metadata in metadata_list_div:
      metadata_parts = metadata.find_all(True, recursive = False)
      metadata_name = metadata_parts[0].text
      metadata_value = metadata_parts[1].text
      metadata_list.append(Metadata(metadata_name, metadata_value))
    
    return metadata_list
  
  def get_metadata_file_type(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Tipo":
        return metadata.value
    return None
  
  def get_metadata_status(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Estado":
        return metadata.value
    return None
      
  def get_metadata_law_number(self, metadata_list: list[Metadata], exp_num: int):
    for metadata in metadata_list:
      if metadata.name == "Número de Ley":
        if "6933-22-23" in metadata.value:
          return None
        
        number = int(metadata.value.replace(".", "").replace(" (VETADO)", ""))
        return number
    return None
      
  def get_metadata_date_proposed(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Presentado":
        date_parts = metadata.value.strip().lower().split(" de ")
        return datetime(int(date_parts[2]), MONTHS[date_parts[1]], int(date_parts[0]))
    return None
      
  def get_metadata_commission(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Comisión":
        return metadata.value
    return None
  
  def get_metadata_categories(self, metadata_list: list[Metadata]):
    for metadata in metadata_list:
      if metadata.name == "Categorías":
        return metadata.value.split("|")
    return []
      

class Metadata:
  def __init__(self, name: str, value: str):
    self.name = name
    self.value = value

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
}