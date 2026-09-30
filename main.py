from tools.scraping_tools.html_fetcher import HTMLFetcher

fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
urls = ["https://crhoy.com/nacionales/vigilancia-policial-a-faroleadas-no-se-limito-a-cartago-alcanzo-a-otros-cantones/",
        "https://crhoy.com/nacionales/crisis-financiera-genera-cierre-de-dos-comites-de-cruz-roja/",
        "https://crhoy.com/nacionales/conare-respalda-excluir-gasto-en-educacion-publica-de-la-regla-fiscal/",
        "https://crhoy.com/nacionales/apse-orden-de-vigilar-a-opositores-en-cartago-es-propia-de-un-regimen-dictatorial/",
        "https://crhoy.com/nacionales/convocan-a-marcha-por-los-derechos-de-los-animales-este-domingo/",
        ]
html_responses = fetcher.fetch_multiple(urls)

for html_response in html_responses:
  print("-----------------------------------------------------------")
  print(f"Link: {html_response.url}")
  print(f"Status code: {html_response.status_code}")
  print(f"Body: {html_response.html[:300]}")
  print("-----------------------------------------------------------")