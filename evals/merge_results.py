"""Заменить результаты повторно запущенных кейсов в полном отчёте."""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--patch", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    base = json.loads(args.base.read_text(encoding="utf-8"))
    patch = json.loads(args.patch.read_text(encoding="utf-8"))
    by_id = {item["id"]: item for item in base}
    for item in patch:
        by_id[item["id"]] = item
    if len(by_id) != len(base):
        raise ValueError("Потеряны или добавлены кейсы при объединении")
    merged = [by_id[item["id"]] for item in base]
    args.output.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Обновлено {len(patch)} кейсов из {len(base)}: {args.output}")


if __name__ == "__main__":
    main()
