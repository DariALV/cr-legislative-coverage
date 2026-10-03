from tools.scraping_tools.html_fetcher import HTMLFetcher
from tools.scraping_tools.crhoy_parser import CRHoyParser


fetcher: HTMLFetcher = HTMLFetcher("uni-project", 0.5, 5)
urls = ["https://crhoy.com/nacionales/vigilancia-policial-a-faroleadas-no-se-limito-a-cartago-alcanzo-a-otros-cantones/",
        "https://crhoy.com/nacionales/crisis-financiera-genera-cierre-de-dos-comites-de-cruz-roja/",
        "https://crhoy.com/nacionales/conare-respalda-excluir-gasto-en-educacion-publica-de-la-regla-fiscal/",
        "https://crhoy.com/nacionales/apse-orden-de-vigilar-a-opositores-en-cartago-es-propia-de-un-regimen-dictatorial/",
        "https://crhoy.com/nacionales/convocan-a-marcha-por-los-derechos-de-los-animales-este-domingo/",
        "https://crhoy.com/nacionales/embajada-desmiente-que-ee-uu-haya-revocado-visas-a-funcionarios-de-gobierno/",
        "https://crhoy.com/nacionales/estas-son-las-13-marcas-de-guaro-con-alerta-por-presencia-de-metanol/",
        ]
html_responses = fetcher.fetch_multiple(urls)

parser: CRHoyParser = CRHoyParser()


for html_response in html_responses:
  parser.parse(html_response)