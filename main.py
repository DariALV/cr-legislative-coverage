from tools.scraping_tools.html_fetcher import HTMLFetcher

fetcher: HTMLFetcher = HTMLFetcher("uni-project", 1, 5)
html = fetcher.fetch("https://crhoy.com/nacionales/vigilancia-policial-a-faroleadas-no-se-limito-a-cartago-alcanzo-a-otros-cantones/")