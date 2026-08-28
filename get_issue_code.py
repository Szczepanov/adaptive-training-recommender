import sys

issue_code = """
def run_push_pending_workouts_all_cmd(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Push workouts for linked users.")
    parser.parse_args(args)
    return _run_for_all_users(
        "push workouts", lambda service: service.push_pending_workouts()
    )
"""

print(issue_code)
