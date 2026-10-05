from dotenv import load_dotenv

load_dotenv()

from pipeline import Pipeline
from tools.llm_tools.jev import test

test()