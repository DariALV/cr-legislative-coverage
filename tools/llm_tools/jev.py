from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

class Jev:
  def __init__(self):
    pass

def test():
  client = TypeSafeClient()

  ticket = "I am deeply dissapointed. I paid my subscription but I lost access to the premium content. I might just quit using it if y'all don't fix this right away."

  response = client.system_one(
      state=ticket,
      questions={
          "department": Choice(
              instructions="Which team should handle this",
              criteria={
                  "billing": "Payment or subscription issues",
                  "technical": "Bugs or integration problems",
                  "sales": "Pricing or account questions",
              },
          ),
          "frustration": Score(
              instructions="How frustrated the customer appears",
              criteria=[
                  "Calm, just stating facts",
                  "Frustrated but civil",
                  "Very angry, strong language",
              ],
          ),
          "is_urgent": Noul(
              instructions="The message conveys urgency or time-sensitivity",
          ),
      },
  )

  print("/" * 80)
  print(f"User message: {ticket}")
  print("-" * 80)
  print(f"Which team should handle this: {response.answers["department"].choice}")  # "technical"
  print(f"\nTeams:\n\tbilling - Payment or subscription issues\n\ttechnical - Bugs or integration problems\n\tsales - Pricing or account questions")
  print("-" * 80)
  print(f"How frustrated the customer appears: {response.answers["frustration"].score} out of 2.0")  # 1.0
  print(f"\nFrustration:\n\t0 - Calm, just stating facts\n\t1 - Frustrated but civil\n\t2 - Very angry, strong language")
  print("-" * 80)
  print(f"The message conveys urgency or time-sensitivity: {response.answers["is_urgent"].noul}")     # 1.0
  print("/" * 80)