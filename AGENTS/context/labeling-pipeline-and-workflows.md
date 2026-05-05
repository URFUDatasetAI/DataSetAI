# Labeling Pipeline And Workflows

## Why This Area Is Sensitive

Главная ценность продукта - не просто показать данные в UI, а корректно провести задачу через assignment, annotation, consensus, review и export. Ошибки здесь бьют по данным, а не только по интерфейсу.

## Core Goals

- Не допускать двойных assignment-ов и гонок между annotator-ами.
- Корректно закрывать или переоткрывать задачи по результатам review/cross-validation.
- Считать прогресс и экспорт по правильной стадии workflow, особенно в `text_detect_text`.
- Держать новую grouped cross-validation модель детерминированной и объяснимой.

## Why Services And Distribution Matter

- `apps/labeling/services.py` владеет write-side жизненным циклом задач и аннотаций.
- `apps/labeling/distribution.py` теперь является отдельной смысловой точкой: здесь живёт логика reviewer pool, grouped assignment и fallback на legacy distribution.
- `apps/labeling/consensus.py` нельзя рассматривать как изолированный helper: его поведение влияет на reopen semantics и итоговый export.

## Decisions Already Embedded In The Project

- `select_for_update(skip_locked=True)` в assignment flow - часть модели конкурентной безопасности, а не случайная оптимизация.
- Grouped cross-validation сознательно выбрана как deterministic room-level strategy: одинаковый набор annotator-ов должен давать предсказуемые reviewer groups.
- Если пул annotator-ов нельзя разбить на полные группы нужного размера, система должна fallback-нуться на старую balanced strategy, а не вести себя “почти правильно”.
- В `text_detect_text` final-stage semantics важнее сырой структуры task rows: detection может порождать transcription children, но именно transcription stage определяет прогресс готовности комнаты.
- Ручное отклонение на review не должно сразу выбрасывать задачу в общий пул: следующий раунд сначала должен вернуться тем же annotator-ам, которые сдавали отклонённый раунд.
- Assignment quota - это эффективный лимит на активную работу пользователя в текущем раунде комнаты: персональный `RoomAssignmentQuota` override, иначе `Room.default_assignment_quota`. Отклонённые раунды возвращают квоту, потому что перестают быть current round; skipped work не считается выполненной работой.
- Для media skip есть дополнительная exposure-семантика: annotator не должен видеть больше новых изображений, чем его квота, поэтому skipped-задачи временно занимают слот просмотра. Если новых задач в пределах exposure-лимита нет, нужно переоткрывать его собственные skipped assignments. Если skipped-задачу уже submitted-нул другой annotator, она освобождает exposure-слот и не переоткрывается исходному пропустившему.
- Assignment flow делает строгий pass по назначенным annotator-ам, а потом rescue-pass для задач без `revision_target_annotator`, если у пользователя ещё есть квота и строгих задач больше нет. Rescue-pass нужен, чтобы зависшие rejected-задачи могли быть перехвачены, но он всё равно обязан уважать `required_reviews_per_item` и не создавать лишние разметки в одном раунде.
- Неполный cross-validation review - это не проваленный consensus. Пока нужного числа submissions нет в текущем раунде, reviewer смотрит только разметки конкретных annotator-ов и может вернуть на исправление только одну выбранную submission.
- Review-фильтр `final` включает два outcome-а: accepted consensus и rejected старые раунды после ручного/consensus отклонения. Для rejected-задач consensus недоступен, но прошлые submitted annotations остаются видимыми как rejected evidence.
- Optional validation voting pool - это gate после accepted consensus на final-stage task, а не замена assignment consensus. При `Room.review_voting_enabled=True` такая задача становится `in_review`; export-ready статус появляется только после approve quorum. Reject quorum открывает следующий раунд и сохраняет обычную round semantics.
- Reviewer-ы голосуют через `ValidationVote` в текущем раунде. Пользователь, который сам submitted-нул annotation в этом раунде, не должен голосовать за итог этой же задачи.

## What Refactors Must Preserve

- Любая “упрощающая” правка в assignment flow должна перепроверяться на concurrency, round semantics и review consequences.
- Review/reject logic нельзя оценивать отдельно от export и room progress.
- Новые сценарии разметки должны либо вписываться в существующую pipeline semantics, либо явно расширять её, а не обходить.

## First Files To Read

- `apps/labeling/services.py`
- `apps/labeling/distribution.py`
- `apps/labeling/consensus.py`
- `apps/labeling/workflows.py`
- `tests/test_labeling_api.py`
- `apps/labeling/tests.py`
