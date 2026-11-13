"""Собрать плоский ZIP-сабмит в evals/results/submission.zip."""

import argparse
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AGENT_MODULES = ["agent.py", "catalog.py", "dialogue.py", "leads.py", "llm.py", "recommendations.py", "state.py"]
PROMPT_REPLACEMENT = '''def _prompt_template(path: Path) -> str:
    if path.name == "system.md":
        return SYSTEM_PROMPT
    if path.name == "dialogue.md":
        return DIALOGUE_PROMPT
    raise RuntimeError(f"Неизвестный промпт: {path}")
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "evals" / "results" / "submission.zip")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="submission-build-") as directory:
        build = Path(directory)
        (build / "requirements.txt").write_bytes((ROOT / "requirements.txt").read_bytes())
        (build / "solution.py").write_text(
            (ROOT / "solution.py").read_text(encoding="utf-8")
            .replace("from agent import catalog as _catalog", "import catalog as _catalog")
            .replace("from agent import llm as _llm", "import llm as _llm")
            .replace("from agent.", "from "),
            encoding="utf-8",
        )
        for name in AGENT_MODULES:
            source = (ROOT / "agent" / name).read_text(encoding="utf-8")
            source = source.replace("from agent.", "from ")
            if name == "agent.py":
                old = '''def _prompt_template(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError(f"Пустой промпт: {path}")
    return text
'''
                if old not in source:
                    raise RuntimeError("Не удалось заменить загрузчик промптов")
                source = source.replace(old, PROMPT_REPLACEMENT, 1)
                source = source.replace(
                    "from pathlib import Path\n",
                    "from pathlib import Path\n\nfrom prompts import DIALOGUE_PROMPT, SYSTEM_PROMPT\n",
                    1,
                )
            (build / name).write_text(source, encoding="utf-8")

        prompts = (
            f"SYSTEM_PROMPT = {(ROOT / 'prompts' / 'system.md').read_text(encoding='utf-8')!r}\n\n"
            f"DIALOGUE_PROMPT = {(ROOT / 'prompts' / 'dialogue.md').read_text(encoding='utf-8')!r}\n\n"
            f"SOLUTION_PROMPT = {(ROOT / 'prompts' / 'solution.md').read_text(encoding='utf-8')!r}\n"
        )
        (build / "prompts.py").write_text(prompts, encoding="utf-8")

        with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(build.iterdir()):
                zf.write(path, arcname=path.name)

    with zipfile.ZipFile(args.output) as zf:
        print("Содержимое:", ", ".join(zf.namelist()))
    print(f"Создан {args.output} ({args.output.stat().st_size} байт)")


if __name__ == "__main__":
    main()
