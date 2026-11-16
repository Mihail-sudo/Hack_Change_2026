"""Классифицировать нарушения валидатора по причинам из экспертного ТЗ."""

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def contains_fact(context: str, alternatives) -> bool:
    normalized = context.lower().replace("ё", "е")
    variants = alternatives if isinstance(alternatives, list) else [alternatives]
    return any(variant.lower().replace("ё", "е") in normalized for variant in variants)


def classify(case: dict, result: dict, violation: dict) -> str:
    rule_id = violation["rule_id"]
    if rule_id in {"CANDIDATE_MISSING", "CANDIDATE_ERROR"}:
        return "unknown"
    if rule_id in {"SLOT_MISMATCH", "CONSENT_NOT_PROVEN", "LEAD_CONSENT_NOT_PROVEN"}:
        return "state"
    if rule_id in {"PRODUCT_MISMATCH", "CONFIGURATION_MISMATCH", "ACTION_MISMATCH", "PREMATURE_HANDOVER", "RESULT_CONSISTENCY"}:
        return "orchestration"
    if violation.get("runtime") and rule_id in {
        "OREM_BELOW_750", "OREM_POWER_UNKNOWN", "OREM_ISOLATED_REGION", "OREM_SEGMENT",
        "LOSSES_SEGMENT", "LOSSES_GRID_ASSETS_REQUIRED", "SOLAR_SEGMENT", "SOLAR_BELOW_15",
        "SOLAR_INDIVIDUAL_REQUIRED", "SOLAR_GRID_NO_AUTONOMY", "PHOTO_B2B_REQUIRED",
        "PHOTO_RESOURCE_CUSTOM", "ASKUE_WATER_NOT_READY",
    }:
        return "state"
    if rule_id in {"REQUIRED_FACT_MISSING", "CLARIFICATION_MISSING"}:
        candidate = result.get("candidate") or {}
        context = candidate.get("retrieval_context", "")
        expected_sources = set(case.get("sources", []))
        actual_sources = set(candidate.get("retrieval_sources", []))
        if expected_sources and not expected_sources.issubset(actual_sources):
            return "retrieval"
        for alternatives in case.get("must_include", []):
            if not contains_fact(context, alternatives):
                return "retrieval"
        return "generation"
    if rule_id in {"FORBIDDEN_STATEMENT", "ESCALATION_MISSING"}:
        return "generation"
    if violation.get("runtime"):
        return "generation"
    return "unknown"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--golden", type=Path, default=Path("evals/golden_cases.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    validation = json.loads(args.validation.read_text(encoding="utf-8"))
    golden = {case["id"]: case for case in json.loads(args.golden.read_text(encoding="utf-8"))}
    records = []
    for result in validation["results"]:
        case = golden[result["id"]]
        for violation in result["violations"]:
            records.append({
                "case_id": result["id"],
                "case_set": case.get("case_set"),
                "mode": validation["metadata"]["mode"],
                "rule_id": violation["rule_id"],
                "severity": violation["severity"],
                "category": classify(case, result, violation),
                "quote": violation["quote"],
                "message": violation["message"],
                "sources": violation.get("sources", case.get("sources", [])),
                "actual_sources": (result.get("candidate") or {}).get("retrieval_sources", []),
            })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    summary = dict(Counter(record["category"] for record in records))
    args.output.with_suffix(".json").write_text(json.dumps({"summary": summary, "items": records}, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = ["case_id", "case_set", "mode", "rule_id", "severity", "category", "quote", "message", "sources", "actual_sources"]
    with args.output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({**record, "sources": " | ".join(record["sources"]), "actual_sources": " | ".join(record["actual_sources"])})
    print(json.dumps(summary, ensure_ascii=False))
    print(f"Отчёты: {args.output.with_suffix('.json')} и {args.output.with_suffix('.csv')}")


if __name__ == "__main__":
    main()
