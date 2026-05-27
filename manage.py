#!/usr/bin/env python3
import os
import subprocess
import sys
from pathlib import Path


def _reexec_into_project_venv() -> None:
    if os.environ.get("DATASETAI_SKIP_VENV_REEXEC") or os.environ.get("DATASETAI_VENV_REEXECED"):
        return

    root = Path(__file__).resolve().parent
    venv_python = root / ".venv" / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
    if not venv_python.exists():
        return

    current_python = Path(sys.executable).resolve()
    target_python = venv_python.resolve()
    if current_python == target_python:
        return

    env = os.environ.copy()
    env["VIRTUAL_ENV"] = str(root / ".venv")
    env["DATASETAI_VENV_REEXECED"] = "1"
    env["PATH"] = f"{target_python.parent}{os.pathsep}{env.get('PATH', '')}"
    raise SystemExit(subprocess.call([str(target_python), str(Path(__file__).resolve()), *sys.argv[1:]], env=env))


def main() -> None:
    _reexec_into_project_venv()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Install dependencies from requirements/local.txt first."
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
