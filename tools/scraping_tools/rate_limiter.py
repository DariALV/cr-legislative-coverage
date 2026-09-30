import time

class RateLimiter:

  def __init__(self, rate_limit: float):
    self.rate_limit = rate_limit
    self.last_time_taken = float(0)
  
  def wait(self):
    remaining_time = self.rate_limit - (time.monotonic() - self.last_time_taken)
    if remaining_time > 0:
      time.sleep(remaining_time)
    self.last_time_taken = time.monotonic()