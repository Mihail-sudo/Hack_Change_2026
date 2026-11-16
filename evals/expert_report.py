"""Сформировать машинный и Markdown отчёт для повторной экспертной приёмки."""

import argparse
import hashlib
import json
import statistics
import subprocess
from pathlib import Path
from zipfile import ZipFile


def p95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[round(0.95 * (len(ordered) - 1))] if ordered else 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--batch-results", type=Path, required=True)
    parser.add_argument("--batch-validation", type=Path, required=True)
    parser.add_argument("--interactive-results", type=Path, required=True)
    parser.add_argument("--interactive-validation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    batch_results = json.loads(args.batch_results.read_text(encoding="utf-8"))
    interactive_results = json.loads(args.interactive_results.read_text(encoding="utf-8"))
    batch_validation = json.loads(args.batch_validation.read_text(encoding="utf-8"))
    interactive_validation = json.loads(args.interactive_validation.read_text(encoding="utf-8"))
    batch_times = [item["seconds"] for item in batch_results]
    interactive_times = [item["seconds"] for item in interactive_results]
    performance = {
        "batch_mean_seconds": statistics.mean(batch_times),
        "batch_p95_seconds": p95(batch_times),
        "batch_total_seconds": sum(batch_times),
        "interactive_mean_seconds": statistics.mean(interactive_times),
        "interactive_p95_seconds": p95(interactive_times),
        "interactive_max_seconds": max(interactive_times),
    }
    failed = batch_validation["summary"]["failed"] + interactive_validation["summary"]["failed"]
    errors = batch_validation["summary"]["errors"] + interactive_validation["summary"]["errors"]
    gate_passed = failed == 0 and errors == 0 and performance["interactive_p95_seconds"] < 8 and performance["batch_total_seconds"] <= 1200
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    archive_hash = hashlib.sha256(args.zip.read_bytes()).hexdigest()
    with ZipFile(args.zip) as zf:
        files = zf.namelist()
    report = {
        "decision": "СОГЛАСОВАНО" if gate_passed else "ОТКЛОНЕНО",
        "commit": commit,
        "zip": str(args.zip),
        "sha256": archive_hash,
        "files": files,
        "batch": batch_validation["summary"],
        "interactive": interactive_validation["summary"],
        "performance": performance,
        "artifacts": {
            "batch_results": str(args.batch_results),
            "batch_validation": str(args.batch_validation),
            "interactive_results": str(args.interactive_results),
            "interactive_validation": str(args.interactive_validation),
            "golden": "evals/golden_cases.json",
            "red_list": "evals/red_list.json",
            "coverage": "evals/rule_coverage.json",
        },
        "known_limitations": [
            "Независимый доменный эксперт отчёт ещё не проверял.",
            "Платформенная проверка кандидата ещё не выполнялась.",
            "Локальные LLM-генерации не гарантируют идентичные ответы на другой инфраструктуре.",
        ],
    }
    args.output.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Пакет повторной экспертной приёмки",
        "",
        f"**Решение: {report['decision']}**",
        "",
        f"- Commit: `{commit}`",
        f"- ZIP: `{args.zip}`",
        f"- SHA-256: `{archive_hash}`",
        f"- Batch: {batch_validation['summary']}",
        f"- Interactive: {interactive_validation['summary']}",
        f"- Batch p95: {performance['batch_p95_seconds']:.2f} с; общее время: {performance['batch_total_seconds']:.2f} с",
        f"- Interactive p95: {performance['interactive_p95_seconds']:.2f} с; максимум: {performance['interactive_max_seconds']:.2f} с",
        "",
        "## Состав архива",
        "",
        "```text",
        *files,
        "```",
        "",
        "## Известные ограничения",
        "",
        *[f"- {item}" for item in report["known_limitations"]],
        "",
        "Машинный отчёт не заменяет независимую экспертную приёмку по разделу 12 ТЗ.",
    ]
    args.output.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"decision": report["decision"], "batch": report["batch"], "interactive": report["interactive"], "performance": performance}, ensure_ascii=False))


if __name__ == "__main__":
    main()
