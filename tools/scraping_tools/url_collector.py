import requests
from bs4 import BeautifulSoup

class UrlCollector:
  def get_delfino_links(self, max_expediente) -> list[str]:
    urls: list[str] = []
    for i in range(20000, max_expediente + 1):
      urls.append(f"https://delfino.cr/asamblea/proyecto/{i}")
    return urls

  def get_crhoy_links(self) -> list[str]:
    links: list[str] = []
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-latest.xml")
    print(f"Sitemap Latest: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-1.xml")
    print(f"Sitemap 1: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-2.xml")
    print(f"Sitemap 2: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-3.xml")
    print(f"Sitemap 3: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-4.xml")
    print(f"Sitemap 4: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-5.xml")
    print(f"Sitemap 5: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-6.xml")
    print(f"Sitemap 6: {len(links)}")
    links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-7.xml")
    print(f"Sitemap 7: {len(links)}")
    # links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-8.xml")
    # links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-9.xml")
    # links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-10.xml")
    # links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-11.xml")
    # links += self.get_crhoy_sitemap_links("https://crhoy.com/sitemaps/sitemap-12.xml")
    filtered_links: list[str] = []
    for link in links:
      if "/entretenimiento/" in link or "/deportes/" in link or "/mundo/" in link:
        continue
      filtered_links.append(link)
    return filtered_links
    
  
  def get_crhoy_sitemap_links(self, sitemap_url: str) -> list[str]:
    response = requests.get(sitemap_url, headers = {"User-Agent": f"uni-project/1.0"}, timeout = 10)
    soup = BeautifulSoup(response.content, "xml")
    link_locs = soup.find_all("loc")
    links: list[str] = []
    for loc in link_locs:
      if loc.text != 'https://crhoy.com/':
        links.append(loc.text)
    return links


