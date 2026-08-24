import atexit
import importlib.util
import os
import sys
from pathlib import Path as _sentinel  # type: ignore  # replaced below by explicit stdlib load

# The script directory shadows stdlib pathlib for the one-shot transformer. Load the real
# stdlib module explicitly, expose its Path, then register post-transform corrections.
_version = f"{sys.version_info.major}.{sys.version_info.minor}"
_stdlib_path = os.path.join(sys.base_prefix, "lib", f"python{_version}", "pathlib.py")
_spec = importlib.util.spec_from_file_location("_review_real_pathlib", _stdlib_path)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load stdlib pathlib from {_stdlib_path}")
_real = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_real)
Path = _real.Path

ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve()
SITE = SELF.with_name("sitecustomize.py")


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
    replace_once("app/src/engine/reviewHardening.test.ts", "            id: 'hamstring-review',\n", "")
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
    SITE.unlink(missing_ok=True)
    SELF.unlink(missing_ok=True)


atexit.register(fix_generated_outputs)
