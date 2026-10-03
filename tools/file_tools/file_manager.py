import hashlib
import pathlib

class FileManager:

  def save_html(self, folder_path: str, name: str, html: str, encripted: bool):
    final_name = name
    if encripted:
      final_name = hashlib.sha256(name.encode("utf-8")).hexdigest()
    final_name += ".html"

    path = pathlib.Path(folder_path) / final_name
    path.parent.mkdir(parents = True, exist_ok = True)
    path.write_text(html, encoding="utf-8")

  def load_html(folder_path: str, name: str, encripted: bool) -> str:
    pass