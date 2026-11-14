"""One local server for every page under private_visuals/.

Serves the folder as static files (never cached, so an edit shows up on a plain reload) and mounts the two pages
that need a backend under their own folder:

    /db_explorer/api/...      the corpus explorer API (db_explorer/server.py: api())
    /db_explorer/photos/...   deputy photos (db_explorer/server.py: photo())
    /jev_eval/api/...         the blind evaluation of Jev (jev_eval/server.py: EvalApp.get() and .post())

Everything else (graphs, Jev viewer, ranker replay, embeddings, the shared theme) is plain files. The database and
the evaluation's corpus load on the first request that needs them, so a missing database only breaks the explorer.
Listens on 127.0.0.1 only.

    python private_visuals/server.py [--port 8766] [--db path/to/db] [--eval-set pilot|all] [--eval-limit N]
                                     [--answers path]

and open http://localhost:8766/
"""
import argparse
import importlib.util
import json
import mimetypes
import threading
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
# The Windows registry may give other types to these, and browsers then refuse modules and fonts.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")

EXPLORER = "/db_explorer/"
EVAL = "/jev_eval/"
HOME = "/db_explorer/"   # where http://localhost:8766/ goes


def load(name, path):
  """Imports one of the page servers by file (both are called server.py)."""
  spec = importlib.util.spec_from_file_location(name, path)
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


explorer = load("db_explorer_server", HERE / "db_explorer" / "server.py")


class Evaluation:
  """The blind evaluation's EvalApp, built on first use (it reads the draw, the corpus and the database)."""

  def __init__(self, set_name, limit, answers):
    self.args = (set_name, answers, limit)
    self.app = None
    self.lock = threading.Lock()

  def get(self):
    with self.lock:
      if self.app is None:
        module = load("jev_eval_server", HERE / "jev_eval" / "server.py")
        set_name, answers, limit = self.args
        self.app = module.EvalApp(set_name, (answers or module.DEFAULT_ANSWERS).resolve(), limit)
        print(f"Evaluación: {len(self.app.items)} noticias ({set_name}), respuestas -> {self.app.store.path}",
              flush=True)
      return self.app


class Handler(SimpleHTTPRequestHandler):
  evaluation: Evaluation

  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(HERE), **kwargs)

  def log_request(self, code="-", size="-"):
    if not str(code).startswith(("2", "3")):   # only failures reach the terminal
      super().log_request(code, size)

  def end_headers(self):
    # Photos change rarely; everything else is never cached.
    if self.path.startswith(EXPLORER + "photos/"):
      self.send_header("Cache-Control", "max-age=86400")
    else:
      self.send_header("Cache-Control", "no-store")
    super().end_headers()

  def send_json(self, data, status=200):
    # The explorer's big indexes come already encoded (bytes, cached once).
    body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def blocked(self, path):
    # Server code and caches are not pages.
    return path.endswith((".py", ".pyc")) or "/__pycache__/" in path

  def do_GET(self):
    url = urlparse(self.path)
    path = url.path
    if path == "/":
      self.send_response(302)
      self.send_header("Location", HOME)
      self.end_headers()
      return
    if path.startswith(EXPLORER + "api/"):
      if not explorer.DB_PATH.exists():
        return self.send_json({"error": f"no existe la base: {explorer.DB_PATH}"}, 503)
      status, data = explorer.api(path.removeprefix(EXPLORER[:-1]), url.query)
      return self.send_json(data, status)
    if path.startswith(EXPLORER + "photos/"):
      found = explorer.photo(path.removeprefix(EXPLORER + "photos/"))
      if not found:
        return self.send_error(404)
      body, ctype = found
      self.send_response(200)
      self.send_header("Content-Type", ctype)
      self.send_header("Content-Length", str(len(body)))
      self.end_headers()
      self.wfile.write(body)
      return
    if path.startswith(EVAL + "api/"):
      status, data = self.evaluation_call(lambda app: app.get(path.removeprefix(EVAL[:-1])))
      return self.send_json(data, status)
    if self.blocked(path):
      return self.send_error(404)
    return super().do_GET()

  def do_POST(self):
    path = urlparse(self.path).path
    if not path.startswith(EVAL + "api/"):
      return self.send_json({"error": "not found"}, 404)
    length = int(self.headers.get("Content-Length") or 0)
    # Too large: not read; EvalApp.post answers 400 for the empty body.
    body = self.rfile.read(length) if 0 < length <= 2_000_000 else b""
    status, data = self.evaluation_call(lambda app: app.post(path.removeprefix(EVAL[:-1]), body))
    return self.send_json(data, status)

  def evaluation_call(self, call):
    try:
      app = self.evaluation.get()
    except Exception as error:   # e.g. the draw or the corpus is missing; the other pages keep working
      return 503, {"error": f"la evaluación no pudo cargar: {type(error).__name__}: {error}"}
    return call(app)


def main():
  ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
  ap.add_argument("--port", type=int, default=8766)
  ap.add_argument("--db", type=Path, default=explorer.DEFAULT_DB, help="database of the explorer")
  ap.add_argument("--eval-set", choices=["pilot", "all"], default="all", help="news of the blind evaluation")
  ap.add_argument("--eval-limit", type=int, default=30,
                  help="only the first N news of the set (the draw is balanced at 30); 0 for all")
  ap.add_argument("--answers", type=Path, default=None,
                  help="where the evaluation's answers are saved (default results/jev/human_eval/answers.json)")
  args = ap.parse_args()
  explorer.DB_PATH = args.db.resolve()
  Handler.evaluation = Evaluation(args.eval_set, args.eval_limit or None, args.answers)
  try:
    server = explorer.Server(("127.0.0.1", args.port), Handler)   # exclusive bind: fails if the port is taken
  except OSError:
    raise SystemExit(f"El puerto {args.port} ya está en uso. Cerrá el otro servidor o usá --port <otro>.")
  print(f"Páginas locales en http://localhost:{args.port}/  (base del explorador: {explorer.DB_PATH})", flush=True)
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    pass


if __name__ == "__main__":
  main()
