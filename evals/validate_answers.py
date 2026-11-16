"""Детерминированная проверка ответов по golden_cases.json и red_list.json."""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.domain import merged_domain_slots, normalize_grid_assets, normalize_segment
from agent.guardrails import validate_result, validate_text

CLARIFICATION_TERMS = {
    "power_kw": ("мощност", "квт"),
    "region": ("регион", "област", "край", "город"),
    "organization_type": ("организац", "компани", "сегмент"),
    "has_grid_assets": ("на балансе", "сетевые организации", "сетевых организаций"),
    "solar_goal": ("цель", "резерв", "отключени", "экономия"),
    "site_details": ("кровл", "крыш", "площад"),
    "metering_setup": ("прибор", "счётчик", "показан"),
    "price_category": ("ценовая категория", "категори"),
    "consent_evidence": ("соглас",),
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower().replace("ё", "е").replace("–", "-").replace("—", "-")).strip()


def semantic_text(text: str) -> str:
    normalized = normalize_text(text)
    normalized = re.sub(r"от\s*(\d+(?:[.,]\d+)?)\s*до\s*(\d+(?:[.,]\d+)?)", r"\1–\2", normalized)
    normalized = re.sub(r"(\d+(?:[.,]\d+)?)\s*процент\w*", r"\1%", normalized)
    tokens = re.findall(r"[a-zа-я0-9%]+", normalized)
    return " ".join(token if len(token) <= 5 else token[:5] for token in tokens)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_candidates(path: Path) -> dict[str, dict]:
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as file:
            rows = [{"id": row["id"], "answer": row["answer"]} for row in csv.DictReader(file)]
    else:
        payload = load_json(path)
        rows = payload.get("items", payload.get("cases", [])) if isinstance(payload, dict) else payload
    candidates = {}
    for row in rows:
        case_id = str(row.get("id", row.get("case_id", "")))
        nested = row.get("result", row)
        state = nested.get("state") or row.get("state") or {}
        action = nested.get("action") or row.get("action") or {}
        if isinstance(action, str):
            action = {"type": action}
        recommended = nested.get("recommended", row.get("recommended"))
        if recommended is None:
            configurations = row.get("configurations") or {}
            recommended = [
                {"product_id": product, "configuration": configurations.get(product), "reason": ""}
                for product in row.get("products", [])
            ]
        actions = nested.get("actions", row.get("actions", []))
        lead = nested.get("lead") or row.get("lead")
        if lead is None:
            lead = next((item.get("lead") for item in actions if item.get("type") == "handoff"), None)
        candidates[case_id] = {
            "reply": nested.get("reply", nested.get("answer", row.get("answer", ""))),
            "recommended": recommended,
            "action": action,
            "slots": nested.get("slots") or state.get("slots") or row.get("slots") or {},
            "history": state.get("history") or nested.get("history") or row.get("history") or [],
            "lead": lead,
            "sources": nested.get("sources", row.get("sources", [])),
            "error": nested.get("error") or row.get("error"),
            "seconds": nested.get("seconds", row.get("seconds")),
            "raw": row,
        }
    return candidates


def violation(case: dict, rule_id: str, severity: str, quote: str, message: str) -> dict:
    return {
        "case_id": case["id"],
        "case_set": case.get("case_set", "dev"),
        "rule_id": rule_id,
        "severity": severity,
        "quote": quote,
        "message": message,
        "sources": case.get("sources", []),
    }


def check_alternatives(case: dict, reply: str) -> list[dict]:
    violations = []
    normalized = semantic_text(reply)
    for alternatives in case.get("must_include", []):
        variants = alternatives if isinstance(alternatives, list) else [alternatives]
        if not any(semantic_text(variant) in normalized for variant in variants):
            violations.append(violation(
                case, "REQUIRED_FACT_MISSING", case.get("severity", "P1"),
                " | ".join(variants), "Пропущен обязательный факт",
            ))
    for alternatives in case.get("must_not_include", []):
        variants = alternatives if isinstance(alternatives, list) else [alternatives]
        for variant in variants:
            if normalize_text(variant) in normalized:
                violations.append(violation(
                    case, "FORBIDDEN_STATEMENT", "P0", variant,
                    "Обнаружено запрещённое утверждение",
                ))
    return violations


def check_slots(case: dict, candidate: dict) -> list[dict]:
    violations = []
    slots = merged_domain_slots(candidate.get("slots") or {}, case.get("question", ""))
    for name, expected in case.get("expected_slots", {}).items():
        actual = slots.get(name)
        if name == "segment":
            matches = normalize_segment(actual) == expected
        elif name == "has_grid_assets":
            matches = normalize_grid_assets(actual) == expected
        elif name == "power_kw":
            matches = actual is None if expected is None else actual is not None and float(actual) == float(expected)
        elif name == "company":
            expected_text = re.sub(r"[^a-zа-я0-9]+", "", expected.lower()) if expected else ""
            actual_text = re.sub(r"[^a-zа-я0-9]+", "", (actual or "").lower())
            matches = bool(expected_text and actual_text and (expected_text in actual_text or actual_text in expected_text))
        else:
            matches = actual == expected
        if not matches:
            violations.append(violation(
                case, "SLOT_MISMATCH", case.get("severity", "P1"),
                f"{name}={actual!r}", f"Ожидалось {name}={expected!r}",
            ))
    return violations


def check_products(case: dict, candidate: dict) -> list[dict]:
    expected = case.get("expected_products", [])
    actual = candidate.get("recommended") or []
    violations = []
    expected_map = {item["product_id"]: item.get("configuration") for item in expected}
    actual_map = {item.get("product_id"): item.get("configuration") for item in actual if isinstance(item, dict)}
    forbidden = set(case.get("forbidden_products", []))
    for product in sorted(forbidden & set(actual_map)):
        violations.append(violation(
            case, "PRODUCT_FORBIDDEN", "P0", product, "Рекомендован запрещённый продукт",
        ))
    if expected_map and set(expected_map) != set(actual_map):
        violations.append(violation(
            case, "PRODUCT_MISMATCH", case.get("severity", "P0"),
            ", ".join(sorted(actual_map)) or "∅",
            "Набор рекомендованных продуктов не совпадает с ожидаемым: " + ", ".join(sorted(expected_map)),
        ))
    for product, configuration in expected_map.items():
        if product in actual_map and actual_map[product] != configuration:
            violations.append(violation(
                case, "CONFIGURATION_MISMATCH", "P0",
                f"{product}={actual_map[product]}", f"Ожидалась конфигурация {configuration}",
            ))
    return violations


def check_action(case: dict, candidate: dict) -> list[dict]:
    expected = case.get("expected_action")
    if not expected:
        return []
    allowed = set(expected.split("|"))
    actual = candidate.get("action", {}).get("type")
    if actual not in allowed:
        return [violation(
            case, "ACTION_MISMATCH", case.get("severity", "P1"), actual or "∅",
            f"Ожидалось действие {expected}",
        )]
    return []


def check_clarification(case: dict, candidate: dict) -> list[dict]:
    slot = case.get("required_clarification_slot")
    if not slot:
        return []
    reply = normalize_text(candidate.get("reply", ""))
    terms = CLARIFICATION_TERMS.get(slot, (slot.lower(),))
    if not any(normalize_text(term) in reply for term in terms):
        return [violation(
            case, "CLARIFICATION_MISSING", case.get("severity", "P1"), slot,
            "Не задан обязательный уточняющий вопрос",
        )]
    if candidate.get("action", {}).get("type") == "handover":
        return [violation(case, "PREMATURE_HANDOVER", "P0", slot, "Уточнение заменено передачей заявки")]
    return []


def check_escalation(case: dict, candidate: dict) -> list[dict]:
    escalation = case.get("escalation") or {}
    if not escalation.get("required"):
        return []
    action = candidate.get("action", {}).get("type")
    reply = normalize_text(candidate.get("reply", ""))
    if action not in {"show_form", "handover"} and "специалист" not in reply and "менеджер" not in reply and "оператор" not in reply:
        return [violation(
            case, "ESCALATION_MISSING", "P0", action or "∅",
            escalation.get("reason") or "Не выполнена обязательная эскалация",
        )]
    return []


def evaluate_case(case: dict, candidate: dict | None, mode: str) -> dict:
    if candidate is None:
        return {
            "id": case["id"], "passed": False,
            "violations": [violation(case, "CANDIDATE_MISSING", "P0", "", "Ответ кандидата отсутствует")],
        }
    if candidate.get("error"):
        return {
            "id": case["id"], "passed": False, "candidate": candidate,
            "violations": [violation(case, "CANDIDATE_ERROR", "P0", str(candidate["error"]), "Ошибка выполнения")],
        }
    violations = check_alternatives(case, candidate.get("reply", ""))
    if mode == "interactive":
        violations.extend(check_slots(case, candidate))
        violations.extend(check_products(case, candidate))
        violations.extend(check_action(case, candidate))
    violations.extend(check_clarification(case, candidate))
    violations.extend(check_escalation(case, candidate))
    if mode == "interactive":
        runtime = validate_result(
            candidate.get("reply", ""), candidate.get("slots"), candidate.get("recommended"),
            candidate.get("action"), candidate.get("history"), candidate.get("lead"),
        )
    else:
        runtime = validate_text(candidate.get("reply", ""))
    for item in runtime:
        violations.append({
            **violation(case, item["rule_id"], item["severity"], item["quote"], item["message"]),
            "runtime": True,
        })
    return {"id": case["id"], "passed": not violations, "candidate": candidate, "violations": violations}


def write_results(output: Path, results: list[dict], metadata: dict) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    violations = [item for result in results for item in result["violations"]]
    summary = {
        "total": len(results),
        "passed": sum(result["passed"] for result in results),
        "failed": sum(not result["passed"] for result in results),
        "errors": sum(item["rule_id"] in {"CANDIDATE_MISSING", "CANDIDATE_ERROR"} for item in violations),
        "p0": sum(item["severity"] == "P0" for item in violations),
        "p1": sum(item["severity"] == "P1" for item in violations),
    }
    payload = {"metadata": metadata, "summary": summary, "results": results}
    output.with_suffix(".json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = ["case_id", "case_set", "rule_id", "severity", "quote", "message", "sources", "runtime"]
    with output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for item in violations:
            writer.writerow({**item, "sources": " | ".join(item.get("sources", [])), "runtime": item.get("runtime", False)})
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--golden", type=Path, default=ROOT / "evals/golden_cases.json")
    parser.add_argument("--red-list", type=Path, default=ROOT / "evals/red_list.json")
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--mode", choices=["batch", "interactive"], default="batch")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ids", nargs="*", help="Проверить только выбранные ID")
    args = parser.parse_args()

    golden = load_json(args.golden)
    if args.ids:
        selected = set(args.ids)
        golden = [case for case in golden if case["id"] in selected]
    red_list = load_json(args.red_list)
    rule_ids = [rule["rule_id"] for rule in red_list]
    if len(rule_ids) != len(set(rule_ids)):
        raise ValueError("rule_id в red_list должны быть уникальными")
    candidates = load_candidates(args.candidate)
    results = [evaluate_case(case, candidates.get(case["id"]), args.mode) for case in golden]
    metadata = {
        "golden": str(args.golden), "red_list": str(args.red_list),
        "candidate": str(args.candidate), "mode": args.mode,
        "red_list_rules": len(red_list),
    }
    summary = write_results(args.output, results, metadata)
    print(json.dumps(summary, ensure_ascii=False))
    print(f"Отчёты: {args.output.with_suffix('.json')} и {args.output.with_suffix('.csv')}")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
