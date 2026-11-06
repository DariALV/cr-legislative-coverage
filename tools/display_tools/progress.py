import logging
import threading

from rich.console import Console
from rich.progress import BarColumn, Progress, ProgressColumn, Task, TaskID, TextColumn
from rich.table import Column
from rich.text import Text

logger = logging.getLogger("cr")

# Colors given to the rows' first column, in order, when the caller doesn't pick one.
DEFAULT_COLORS = ["cyan", "magenta", "blue", "yellow", "bright_green", "bright_magenta", "bright_cyan", "bright_blue"]
PLAIN_STEP = 10   # without an interactive terminal, one line per task every PLAIN_STEP percent

class ProgressBoard:
  """
  Several live progress bars at once, one row per (group, phase), e.g. ("crhoy", "news"). Thread safe.
  With an interactive terminal the rows are redrawn in place; otherwise (redirected output, run by an agent)
  it prints one plain line per task every PLAIN_STEP percent. enabled = False gives a silent board (tests, notebooks).

    with ProgressBoard("full run") as board:
      task = board.task("crhoy", "news", total = 9712)
      task.advance()
      task.warn("timeout")   # counted in the row and logged as a warning (shown above the bars)
      task.finish()
  """

  def __init__(self, title: str = "", enabled: bool = True, console: Console | None = None):
    self.title = title
    self.enabled = enabled
    self.console: Console = console or Console()
    self.live: bool = enabled and self.console.is_terminal
    self.lock = threading.Lock()
    self.colors: dict[str, str] = {}
    self.progress = Progress(
      TextColumn("{task.fields[group]}", table_column = Column(width = 10, no_wrap = True)),
      TextColumn("{task.fields[phase]}", style = "bold", table_column = Column(width = 9, no_wrap = True)),
      CounterlessBarColumn(bar_width = 34, style = "grey23", complete_style = "white", finished_style = "green"),
      CountColumn(), PercentColumn(), StatusColumn(), WarningColumn(),
      console = self.console, refresh_per_second = 4, disable = not self.live,
    )

  def __enter__(self) -> "ProgressBoard":
    if self.live:
      if self.title:
        self.console.rule(f"[bold]{self.title}", align = "left")
      self.progress.start()
    return self

  def __exit__(self, *exc_info):
    if self.live:
      self.progress.stop()

  def task(self, group: str, phase: str, total: int | None = None, estimated: bool = False,
           color: str | None = None) -> "ProgressTask":
    """
    A new row, waiting (grey) until its first advance. total = None is a counter without a bar (e.g. votes
    found while walking the bills); estimated shows the total as "~N" (it may grow, see set_total).
    """
    with self.lock:
      if color:
        self.colors[group] = color
      color = self.colors.setdefault(group, DEFAULT_COLORS[len(self.colors) % len(DEFAULT_COLORS)])
      task_id: TaskID = self.progress.add_task("", total = total, start = False, group = Text(group, style = f"bold {color}"),
                                               phase = phase, estimated = estimated, warnings = 0, done = False)
    return ProgressTask(self, task_id, group, phase)

def silent_task() -> "ProgressTask":
  """A task that shows nothing, for code that takes an optional task."""
  return ProgressBoard(enabled = False).task("", "")

class ProgressTask:
  """One row of a ProgressBoard. Every method is safe to call from any thread, and does nothing on a silent board."""

  def __init__(self, board: ProgressBoard, task_id: TaskID, group: str, phase: str):
    self.board = board
    self.task_id = task_id
    self.name = f"[{group}] {phase}"
    self.started = False
    self.next_plain_step = PLAIN_STEP

  def advance(self, amount: int = 1):
    if not self.board.enabled:
      return
    with self.board.lock:
      self.start_locked()
      self.board.progress.update(self.task_id, advance = amount)
      # An estimated total that falls short grows with the count, so the bar never overflows.
      task: Task = self.rich_task()
      if task.total is not None and task.completed > task.total:
        self.board.progress.update(self.task_id, total = task.completed)
      self.print_plain_step_locked()

  def set_total(self, total: int | None, estimated: bool = False):
    if not self.board.enabled:
      return
    with self.board.lock:
      self.board.progress.update(self.task_id, total = total, estimated = estimated)

  def warn(self, message: str):
    """Counts a warning in the row and logs it (above the bars on a live board, and in the log file)."""
    if self.board.enabled:
      with self.board.lock:
        task: Task = self.rich_task()
        self.board.progress.update(self.task_id, warnings = task.fields["warnings"] + 1)
    logger.warning(f"{self.name}: {message}")

  def finish(self):
    """Marks the row as done (green, with its elapsed time). A counter or estimated total becomes the final count."""
    if not self.board.enabled:
      return
    with self.board.lock:
      self.start_locked()
      task: Task = self.rich_task()
      self.board.progress.update(self.task_id, total = task.completed, estimated = False, done = True)
      self.board.progress.stop_task(self.task_id)
      if not self.board.live:
        warnings: int = task.fields["warnings"]
        self.board.console.print(f"{self.name}: done, {task.completed:,} in {format_duration(task.elapsed)}"
                                 + (f", {warnings} warnings" if warnings else ""), markup = False, highlight = False)

  def rich_task(self) -> Task:
    return self.board.progress._tasks[self.task_id]   # rich has no public lookup by id

  def start_locked(self):
    if not self.started:
      self.started = True
      self.board.progress.start_task(self.task_id)

  def print_plain_step_locked(self):
    """Plain mode: one line when the task crosses the next PLAIN_STEP percent (counters print only at finish)."""
    if self.board.live:
      return
    task: Task = self.rich_task()
    if not task.total:
      return
    percent: float = 100.0 * task.completed / task.total
    if percent >= self.next_plain_step and percent < 100:
      self.next_plain_step = (int(percent) // PLAIN_STEP + 1) * PLAIN_STEP
      self.board.console.print(f"{self.name}: {percent:.0f}% ({task.completed:,}/{'~' if task.fields['estimated'] else ''}"
                               f"{int(task.total):,})", markup = False, highlight = False)

class CounterlessBarColumn(BarColumn):
  """The bar, except for counters (no total), which only show their count."""
  def render(self, task: Task):
    if task.started and task.total is None:
      return Text(" " * (self.bar_width or 0))
    return super().render(task)

class CountColumn(ProgressColumn):
  def render(self, task: Task) -> Text:
    if not task.started:
      return Text("waiting", style = "grey50")
    if task.total is None:
      return Text(f"{task.completed:,} found", style = "cyan")
    estimated: str = "~" if task.fields["estimated"] else ""
    return Text(f"{task.completed:,}/{estimated}{int(task.total):,}", style = "cyan")

class PercentColumn(ProgressColumn):
  def render(self, task: Task) -> Text:
    if not task.started or task.total is None:
      return Text("")
    return Text(f"{task.percentage:>3.0f}%", style = "green" if task.fields["done"] else "white")

class StatusColumn(ProgressColumn):
  def render(self, task: Task) -> Text:
    if task.fields["done"]:
      return Text(f"✓ {format_duration(task.elapsed)}", style = "bold green")
    if not task.started:
      return Text("")
    rate: str = f"{task.speed:.1f}/s" if task.speed else ""
    eta: str = f"ETA {format_duration(task.time_remaining)}" if task.total is not None and task.time_remaining else ""
    return Text(f"{rate}  {eta}".strip(), style = "grey62")

class WarningColumn(ProgressColumn):
  def render(self, task: Task) -> Text:
    warnings: int = task.fields["warnings"]
    return Text(f"⚠ {warnings}", style = "yellow") if warnings else Text("")

def format_duration(seconds: float | None) -> str:
  """1h52m, 6m, 40s."""
  if seconds is None:
    return "-"
  seconds = int(seconds)
  hours, rest = divmod(seconds, 3600)
  minutes, secs = divmod(rest, 60)
  if hours:
    return f"{hours}h{minutes:02d}m"
  if minutes:
    return f"{minutes}m"
  return f"{secs}s"

if __name__ == "__main__":
  # Demo: python -m tools.display_tools.progress (from the repo root). Fake work in parallel threads.
  import random, time
  from concurrent.futures import ThreadPoolExecutor

  logging.basicConfig(level = logging.WARNING, format = "%(message)s")

  def fake_work(task: ProgressTask, count: int, delay: float, warn_every: int = 0):
    for i in range(count):
      time.sleep(delay * random.uniform(0.5, 1.5))
      task.advance()
      if warn_every and i % warn_every == warn_every - 1:
        task.warn(f"simulated timeout on item {i + 1}")
    task.finish()

  with ProgressBoard("demo run") as board:
    crhoy = board.task("crhoy", "news", total = 120)
    nacion = board.task("nacion", "news", total = 80)
    bills = board.task("delfino", "bills", total = 60, estimated = True)
    votes = board.task("delfino", "votes")
    def delfino():
      for _ in range(75):   # more bills than estimated: the total grows
        time.sleep(0.04)
        bills.advance()
        if random.random() < 0.3:
          votes.advance()
      bills.finish()
      votes.finish()
    with ThreadPoolExecutor(3) as executor:
      executor.submit(fake_work, crhoy, 120, 0.03)
      executor.submit(fake_work, nacion, 80, 0.05, warn_every = 30)
      executor.submit(delfino)
