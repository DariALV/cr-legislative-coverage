"""
Downloads the original "Texto base" documents (.docx) of the bills published on the site, from the SIL.

  python download_bill_documents.py [--bills site/src/data/bills.json] [--out raw/docx/asamblea/bills]
                                    [--limit N]

The site shows the base text as plain text and links to the SIL's home, because the SIL has no fixed address
per document: the .docx comes out of a request made inside a session. This script keeps the original files,
so they can be offered as a download later. They are not in git (raw/ is ignored): about 200 KB each, some
1-3 MB.

Needs the SIL cache of the bills (raw/csv/asamblea/bills/<number>/general), which holds the internal id of each
bill, so it runs on the machine that ran the pipeline. Files already downloaded are skipped; a bill that fails
is reported and retried on the next run. Same politeness as the pipeline: Config.RATE_LIMIT between requests.
"""
import argparse
import json
import os
from pathlib import Path

import requests

from tools.scraping_tools.asamblea_fetcher import AsambleaError, AsambleaFetcher, read_csv_rows


def download(fetcher: AsambleaFetcher, number: int, path: Path) -> str:
  """Saves the bill's .docx to `path`. Returns "saved", "no text" (the SIL has none) or "no id" (not in the cache)."""
  general = fetcher.load("bills", f"{number}/general")
  rows = read_csv_rows(general) if general else []
  if not rows or not rows[0].get("IdPROYECTO_DE_LEY"):
    return "no id"
  file_id = fetcher.bill_text_file_id(number, rows[0]["IdPROYECTO_DE_LEY"])
  if file_id is None:
    return "no text"
  response = fetcher.get_session().get(fetcher.base_url + "Utilidades/DescargarArchivo", params = {"id": file_id},
                                       timeout = fetcher.timeout)
  fetcher.rate_limiter.wait()
  if response.status_code != 200 or not response.content.startswith(b"PK"):
    raise AsambleaError(f"The text of bill {number} answered {response.status_code}, not a .docx")
  temp = path.with_suffix(".tmp")
  temp.write_bytes(response.content)
  os.replace(temp, path)   # atomic: an interrupted run leaves no half-written file
  return "saved"


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description = "Download the original base text (.docx) of the published bills.")
  parser.add_argument("--bills", type = Path, default = Path("site/src/data/bills.json"),
                      help = "bills.json written by export_public.py: the bills to download")
  parser.add_argument("--out", type = Path, default = Path("raw/docx/asamblea/bills"),
                      help = "output folder, <number>.docx")
  parser.add_argument("--limit", type = int, default = None, help = "download at most this many (to try it out)")
  arguments = parser.parse_args()

  numbers = [bill["number"] for bill in json.loads(arguments.bills.read_text(encoding = "utf-8"))]
  arguments.out.mkdir(parents = True, exist_ok = True)
  missing = [number for number in numbers if not (arguments.out / f"{number}.docx").exists()]
  print(f"{len(numbers)} bills, {len(numbers) - len(missing)} already downloaded")
  fetcher = AsambleaFetcher()
  results = {"saved": 0, "no text": 0, "no id": 0, "failed": 0}
  for number in missing[:arguments.limit]:
    try:
      results[download(fetcher, number, arguments.out / f"{number}.docx")] += 1
    except (AsambleaError, requests.RequestException, OSError) as error:
      results["failed"] += 1
      print(f"bill {number}: {error}")
  print(", ".join(f"{count} {result}" for result, count in results.items()))
