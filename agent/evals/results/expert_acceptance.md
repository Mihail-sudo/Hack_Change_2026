# Пакет повторной экспертной приёмки

**Решение: СОГЛАСОВАНО**

- Commit: `82333867cd15ec5df231b9213570938e05994c12`
- ZIP: `evals/results/guardrails_candidate.zip`
- SHA-256: `72abae5bbd7482ab29f04ddb2c1507c8942c98e917e6f5a9857b341d7f6c19ae`
- Batch: {'total': 114, 'passed': 114, 'failed': 0, 'errors': 0, 'p0': 0, 'p1': 0}
- Interactive: {'total': 114, 'passed': 114, 'failed': 0, 'errors': 0, 'p0': 0, 'p1': 0}
- Batch p95: 9.75 с; общее время: 631.99 с
- Interactive p95: 7.78 с; максимум: 8.61 с

## Состав архива

```text
agent.py
catalog.py
dialogue.py
domain.py
guardrails.py
leads.py
llm.py
prompts.py
recommendations.py
requirements.txt
solution.py
state.py
```

## Известные ограничения

- Независимый доменный эксперт отчёт ещё не проверял.
- Платформенная проверка кандидата ещё не выполнялась.
- Локальные LLM-генерации не гарантируют идентичные ответы на другой инфраструктуре.

Машинный отчёт не заменяет независимую экспертную приёмку по разделу 12 ТЗ.

## Финальный независимый holdout

- Batch: 42/42, ошибок P0/P1 нет.
- Interactive: 42/42, ошибок P0/P1 нет.
- Interactive p95 = 7,784 с (< 8 с).
