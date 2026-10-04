import hashlib
import pathlib
import json

class FileManager:

  def save_html(self, folder_path: str, name: str, html: str, encripted: bool = True):
    path = self.get_path(folder_path, name, ".html", encripted)
    path.parent.mkdir(parents = True, exist_ok = True)
    path.write_text(html, encoding = "utf-8")

  def load_html(self, folder_path: str, name: str, encripted: bool = True) -> str:
    path = self.get_path(folder_path, name, ".html", encripted)
    html = path.read_text(encoding = "utf-8")
    return html
  
  def delete_html(self, folder_path: str, name: str, encripted: bool = True):
    path = self.get_path(folder_path, name, ".html", encripted)
    path.unlink(missing_ok=True)
  
  def html_exists(self, folder_path: str, name: str, encripted: bool = True) -> bool:
    path = self.get_path(folder_path, name, ".html", encripted)
    return path.exists()
  
  def save_dict_as_json(self, folder_path: str, name: str, dictionary: dict, encripted: bool = False):
    path = self.get_path(folder_path, name, ".json", encripted)
    path.parent.mkdir(parents = True, exist_ok = True)
    path.write_text(json.dumps(dictionary, ensure_ascii=False, indent=2), encoding="utf-8")

  def load_json_as_dict(self, folder_path: str, name: str, encripted: bool = False) -> dict:
    path = self.get_path(folder_path, name, ".json", encripted)
    dictionary = json.loads(path.read_text(encoding="utf-8"))
    return dictionary
  
  def json_exists(self, folder_path: str, name: str, encripted: bool = False) -> bool:
    path = self.get_path(folder_path, name, ".json", encripted)
    return path.exists()
  
  def get_path(self, folder_path: str, name: str, extension: str, encripted: bool = False) -> pathlib.Path:
    final_name = name
    if encripted:
      final_name = encrypt(name)
    final_name += extension

    path = pathlib.Path(folder_path) / final_name
    return path

def encrypt(text: str) -> str:
  return hashlib.sha256(text.encode("utf-8")).hexdigest()