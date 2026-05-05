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
- Удерживать optional validation voting pool как post-consensus gate: он не должен менять deterministic grouped assignment, но влияет на финализацию, progress и export.

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
- Fallback должен включаться для всего пула, если `len(assignment_pool) % required_reviews_per_item != 0`; нельзя формировать partial grouped split и молча оставлять “лишних” annotator-ов без задач.
- `owner_is_annotator` входит в assignment pool только если это явно разрешено room settings.
- Квота annotator-а берётся из персонального override-а или из `Room.default_assignment_quota`; UI и selectors должны показывать прогресс относительно этой квоты, даже если она больше или меньше размера датасета.
- Skipped media assignments не расходуют completed quota, но ограничивают выдачу новых unseen изображений до размера квоты. Они могут быть переоткрыты тому же annotator-у; если skipped-задачу submitted-нул другой annotator, она освобождает exposure-слот и не должна переоткрываться исходному пропустившему.
- Rejected-задачи сначала возвращаются исходным annotator-ам, но assignment flow имеет rescue-pass для зависших задач, когда у другого annotator-а есть свободная квота и строгих задач больше нет. Rescue-pass не должен превышать `required_reviews_per_item` в текущем раунде.

## Open Edges / Risks

- Изменения в selectors или participant stats могут тихо рассинхронизироваться с assignment pool semantics.
- Рефакторинг review/progress/export логики легко ломает final-stage semantics для `text_detect_text`.
- Validation voting добавляет промежуточный `in_review` статус: любые progress/export изменения должны считать export-ready только финальные `submitted` задачи, а не consensus, который ещё ждёт голосования.
- Любая “упрощающая” правка в assignment flow должна проверяться не только на happy path, но и на concurrency/fallback cases.
- Rescue-pass особенно чувствителен к гонкам: нельзя ослаблять `select_for_update(skip_locked=True)` и проверки текущего числа annotator-ов раунда.

## Next Likely Steps

1. При каждом заметном изменении room/access semantics перепроверять влияние на assignment pools.
2. При развитии review/export держать grouped flow и final-stage semantics в одном ментальном контуре.
3. Расширять тесты раньше, чем сильно реорганизовывать distribution code.

## Handoff Notes

- Начинай чтение с [../context/labeling-pipeline-and-workflows.md](../context/labeling-pipeline-and-workflows.md).
- Если меняешь что-то вокруг owner-role или membership selection, проверь не только rooms-тесты, но и labeling assignment semantics.
