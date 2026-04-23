# Grouped Cross-Validation Stabilization

## Status

- active

## Why It Exists

- В проект уже добавлена deterministic grouped cross-validation model, но это изменение затрагивает assignment, review, progress semantics и tests.
- Любая неполная синхронизация между distribution logic, owner-role semantics и UI payload-ами легко даёт скрытые регрессии.

## Scope

- Поддерживать согласованность grouped distribution с `required_reviews_per_item`.
- Сохранять корректный fallback на legacy balanced strategy.
- Не ломать `Room.owner_is_annotator` в assignment pool logic.
- Держать тесты и selectors в соответствии с реальной бизнес-логикой.

## Non-Goals

- Радикальный редизайн всей модели assignment-а без явной продуктовой причины.
- Удаление legacy strategy, пока grouped flow не покрывает все кейсы надёжно.

## Relevant Files

- `apps/labeling/distribution.py`
- `apps/labeling/services.py`
- `apps/labeling/consensus.py`
- `apps/labeling/workflows.py`
- `apps/rooms/selectors.py`
- `apps/rooms/services.py`
- `apps/labeling/tests.py`
- `tests/test_labeling_api.py`

## Decisions Already Made

- Reviewer groups должны быть deterministic на уровне room/task ordering.
- Неполный annotator pool не должен ронять систему и не должен притворяться полными группами; для таких случаев нужен fallback.
- `owner_is_annotator` входит в assignment pool только если это явно разрешено room settings.

## Open Edges / Risks

- Изменения в selectors или participant stats могут тихо рассинхронизироваться с assignment pool semantics.
- Рефакторинг review/progress/export логики легко ломает final-stage semantics для `text_detect_text`.
- Любая “упрощающая” правка в assignment flow должна проверяться не только на happy path, но и на concurrency/fallback cases.

## Next Likely Steps

1. При каждом заметном изменении room/access semantics перепроверять влияние на assignment pools.
2. При развитии review/export держать grouped flow и final-stage semantics в одном ментальном контуре.
3. Расширять тесты раньше, чем сильно реорганизовывать distribution code.

## Handoff Notes

- Начинай чтение с [../context/labeling-pipeline-and-workflows.md](../context/labeling-pipeline-and-workflows.md).
- Если меняешь что-то вокруг owner-role или membership selection, проверь не только rooms-тесты, но и labeling assignment semantics.
