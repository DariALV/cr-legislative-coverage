import re

from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.file_tools.file_manager import FileManager
from tools.scraping_tools.crhoy_parser import CRHoyParser
from tools.scraping_tools.delfino_parser import DelfinoParser
from tools.scraping_tools.url_collector import UrlCollector

url_collector: UrlCollector = UrlCollector()
file_manager: FileManager = FileManager()
fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
# crhoy_urls = [
#         "https://crhoy.com/nacionales/vigilancia-policial-a-faroleadas-no-se-limito-a-cartago-alcanzo-a-otros-cantones/",
#         "https://crhoy.com/nacionales/crisis-financiera-genera-cierre-de-dos-comites-de-cruz-roja/",
#         "https://crhoy.com/nacionales/conare-respalda-excluir-gasto-en-educacion-publica-de-la-regla-fiscal/",
#         "https://crhoy.com/nacionales/apse-orden-de-vigilar-a-opositores-en-cartago-es-propia-de-un-regimen-dictatorial/",
#         "https://crhoy.com/nacionales/convocan-a-marcha-por-los-derechos-de-los-animales-este-domingo/",
#         "https://crhoy.com/nacionales/embajada-desmiente-que-ee-uu-haya-revocado-visas-a-funcionarios-de-gobierno/",
#         "https://crhoy.com/nacionales/estas-son-las-13-marcas-de-guaro-con-alerta-por-presencia-de-metanol/",
#         ]

# crhoy_urls = url_collector.get_crhoy_links()

# file_manager.save_dict_as_json("raw/links/crhoy", "crhoy_links", {"links": crhoy_urls})

crhoy_urls = file_manager.load_json_as_dict("raw/links/crhoy", "crhoy_links")["links"]

# fetcher.fetch_multiple("raw/html/crhoy/news", crhoy_urls)

# delfino_urls = [
#         "https://delfino.cr/asamblea/proyecto/25820",
#         "https://delfino.cr/asamblea/proyecto/23500",
#         "https://delfino.cr/asamblea/proyecto/21538",
#         "https://delfino.cr/asamblea/proyecto/25000",
#         "https://delfino.cr/asamblea/proyecto/24000",
#         "https://delfino.cr/asamblea/proyecto/23000",
#         "https://delfino.cr/asamblea/proyecto/22000",
#         ]

# delfino_urls = url_collector.get_delfino_links(25820)

# fetcher.fetch_multiple("raw/html/delfino/asamblea/expedientes", delfino_urls)

crhoy_parser = CRHoyParser()
delfino_parser = DelfinoParser()

# for html_response in delfino_html_responses:
#   file_manager.save_html("raw/html/delfino/asamblea/expedientes", html_response.url, html_response.html, True)

for url in crhoy_urls:
  if not "/caricaturas/" in url and not "/opinion/" in url and not "/gusto/" in url and file_manager.html_exists("raw/html/crhoy/news", url):
    html = file_manager.load_html("raw/html/crhoy/news", url)
    if re.fullmatch(r"Error (\d{3})", html):
      print(f"Url {url} found {html.lower()}")
    else:
      print("////////////////////////////////////////////////////////////")
      print(f"Url {url} fully functional")
      crhoy_parser.parse(html, url)
      print("////////////////////////////////////////////////////////////")

# parser: CRHoyParser = CRHoyParser()


# for html_response in crhoy_html_responses:
#   parser.parse(html_response)