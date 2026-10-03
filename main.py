from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.file_tools.file_manager import FileManager
from tools.scraping_tools.crhoy_parser import CRHoyParser
from tools.scraping_tools.delfino_parser import DelfinoParser

fetcher: HTMLFetcher = HTMLFetcher("uni-project", 0.5, 5)
file_manager: FileManager = FileManager()
# crhoy_urls = [
#         "https://crhoy.com/nacionales/vigilancia-policial-a-faroleadas-no-se-limito-a-cartago-alcanzo-a-otros-cantones/",
#         "https://crhoy.com/nacionales/crisis-financiera-genera-cierre-de-dos-comites-de-cruz-roja/",
#         "https://crhoy.com/nacionales/conare-respalda-excluir-gasto-en-educacion-publica-de-la-regla-fiscal/",
#         "https://crhoy.com/nacionales/apse-orden-de-vigilar-a-opositores-en-cartago-es-propia-de-un-regimen-dictatorial/",
#         "https://crhoy.com/nacionales/convocan-a-marcha-por-los-derechos-de-los-animales-este-domingo/",
#         "https://crhoy.com/nacionales/embajada-desmiente-que-ee-uu-haya-revocado-visas-a-funcionarios-de-gobierno/",
#         "https://crhoy.com/nacionales/estas-son-las-13-marcas-de-guaro-con-alerta-por-presencia-de-metanol/",
#         ]
# crhoy_html_responses = fetcher.fetch_multiple(crhoy_urls)

# delfino_urls = [
#         "https://delfino.cr/asamblea/proyecto/25820",
#         # "https://delfino.cr/asamblea/proyecto/23500",
#         # "https://delfino.cr/asamblea/proyecto/21538",
#         # "https://delfino.cr/asamblea/proyecto/25000",
#         # "https://delfino.cr/asamblea/proyecto/24000",
#         # "https://delfino.cr/asamblea/proyecto/23000",
#         # "https://delfino.cr/asamblea/proyecto/22000",
#         ]
# delfino_html_responses = fetcher.fetch_multiple(delfino_urls)

delfino_parser = DelfinoParser()

# for html_response in delfino_html_responses:
#   file_manager.save_html("raw/html/delfino/asamblea/expedientes", html_response.url, html_response.html, True)

html = file_manager.load_html("raw/html/delfino/asamblea/expedientes", "https://delfino.cr/asamblea/proyecto/25820")

delfino_parser.parse(html)

test = file_manager.html_exists("raw/html/delfino/asamblea/expedientes", "https://delfino.cr/asamblea/proyecto/2580")
print(test)
# parser: CRHoyParser = CRHoyParser()


# for html_response in crhoy_html_responses:
#   parser.parse(html_response)