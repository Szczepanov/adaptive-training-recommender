import atexit
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    if not target.exists():
        return
    text = target.read_text(encoding="utf-8")
    if old not in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f"{path}: post-transform replacement target is ambiguous")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def fix_generated_outputs() -> None:
    replace_once(
        "app/src/engine/reviewHardening.test.ts",
        "            id: 'hamstring-review',\n",
        "",
    )
    replace_once(
        "app/src/engine/simulation/analyze.ts",
        """        durationMin: number;
        durationMax: number;
        stimulusProfile: WorkoutStimulusProfile | null;
""",
        """        durationMin?: number;
        durationMax?: number;
        stimulusProfile?: WorkoutStimulusProfile | null;
""",
    )


atexit.register(fix_generated_outputs)
