# Current State

## Baseline

- DataSetAI остаётся Django-монолитом с React UI-shell, REST API и PostgreSQL.
- Канонический frontend entrypoint по-прежнему один: Django рендерит `apps/ui/templates/ui/base.html`, а React выбирает экран через bootstrap-contract в `apps/ui/static/ui/app.tsx`.
- Проект уже вышел за рамки только текстовой разметки: image/video и workflow `text_detect_text` считаются first-class сценариями.
- Cross-validation больше не только “равномерная раздача по людям”: в кодовой базе уже живёт deterministic grouped distribution с fallback на legacy strategy.
- Владелец комнаты теперь не обязан быть annotator: это управляется `Room.owner_is_annotator` и затрагивает доступ, eligible pools и room payload-ы.
- `room-work` развивается как отдельная fullscreen рабочая поверхность, а не как секция длинной страницы комнаты. Этот shell больше не annotator-only: внутри него теперь должны жить и очередь задач, и редактирование своих submit-ов, и reviewer-native проверка.

## Current Priorities

1. Не вносить регрессии в room lifecycle: create/edit room, invite links, join requests, pinning, recency sorting, member roles, access.
2. Сохранять корректность labeling pipeline: task assignment, submit, consensus, review/reject, repeat rounds, export.
3. Дожимать `room-work` до состояния настоящего редактора: стабильный fullscreen workspace, быстрый pointer UX, единый stage для annotate/edit/review и масштабируемость под новые сценарии разметки.
4. Удерживать grouped cross-validation и `owner_is_annotator` согласованными между backend, selectors, tests и UI payload-ами.
5. Не ломать Django/React bootstrap split при любых UI-экспериментах.

## Stable Invariants

- Write-side бизнес-логика живёт в `services.py`; read-side shaping payload-ов живёт в `selectors.py`.
- Изменения в assignment/submit/reopen flow обязаны уважать `transaction.atomic()` и схему `select_for_update()`.
- `get_next_task_for_annotator` нельзя случайно лишить `select_for_update(skip_locked=True)` там, где это поддерживается СУБД.
- Пользовательские квоты внутри комнаты живут в `RoomAssignmentQuota`: квоту расходуют только assignments текущего раунда в статусах `in_progress`/`submitted`; skipped assignments и старые отклонённые раунды квоту не занимают.
- Пропуск media-задачи представлен как `TaskAssignment.Status.SKIPPED`: пропустивший annotator не должен получить ту же задачу снова в том же раунде, а skipped assignments не считаются как нужные cross-validation submissions.
- Review различает `final` и `incomplete` задачи. `final` включает как accepted consensus, так и уже rejected старые раунды; `incomplete` - только текущий раунд, где есть submissions, но их меньше нужного числа. Неполные cross-validation задачи показывают только per-annotator submissions без consensus и позволяют вернуть на исправление только одну выбранную разметку.
- Image dataset room не считается immutable после создания: владелец может дозагружать изображения/ZIP и удалять primary task rows через room dataset API; новые task rows должны продолжать `input_payload.item_number`, а удаление primary task удаляет связанные child tasks/разметки каскадом.
- Прямой вход в комнату по ID+паролю убран из UI/API. Публичный путь доступа для новых участников - invite link / join request; список комнат показывает только уже доступные пользователю комнаты.
- Для grouped cross-validation одна и та же задача должна детерминированно попадать в одну reviewer-group, если room можно разбить на полные группы нужного размера; иначе обязателен fallback на legacy strategy.
- Ручной reject на review должен возвращать задачу тем же annotator-ам, которые сдавали отклонённый раунд; не удаляй rejected-round assignments до успешного принятия нового раунда.
- В `text_detect_text` финальным считается transcription stage, а не все task rows подряд.
- `room-work` должен оставаться fullscreen shell без desktop page scroll; auxiliary chrome должен уходить во внутренний scroll, а не перекрывать media.
- `room-work` теперь считается общей рабочей поверхностью для трёх режимов: `queue`, `submitted`, `review`. Новые review/edit сценарии нужно встраивать сюда, а не возвращать обратно на room detail page.
- Workspace editor-а задаётся layout-ом, а не размером текущего изображения/видео.
- Границы media должны быть привязаны к реальному media/overlay и клиппиться вместе с ним.

## Active Tasks

- [tasks/fullscreen-room-work-editor.md](tasks/fullscreen-room-work-editor.md)
  Главная UI-тема: превратить `room-work` в быстрый редактор под bbox today и расширяемый scenario shell tomorrow, включая review и post-submit edit flow.
- [tasks/grouped-cross-validation-stabilization.md](tasks/grouped-cross-validation-stabilization.md)
  Backend-тема: удерживать новую grouped distribution согласованной с owner-role semantics, review flow и тестами.

## Recently Completed Major Changes

- В проект добавлен deterministic grouped cross-validation поверх старой balanced assignment-модели.
- В room domain добавлен `Room.owner_is_annotator`, который меняет policy и room payload semantics.
- Список комнат уже живёт с pin ordering через `RoomPin.sort_order` и recency через `RoomVisit.last_accessed_at`.
- `room-work` уже вынесен в отдельный fullscreen shell вместо прежнего page-section подхода.

## Where To Look First

### Если задача про комнаты и доступ

- `apps/rooms/services.py`
- `apps/rooms/selectors.py`
- `apps/rooms/models.py`
- `apps/rooms/policies.py`
- `tests/test_rooms_api.py`

### Если задача про assignment, submit, consensus, review

- `apps/labeling/services.py`
- `apps/labeling/distribution.py`
- `apps/labeling/consensus.py`
- `apps/labeling/workflows.py`
- `tests/test_labeling_api.py`

### Если задача про UI bootstrap и page routing

- `apps/ui/views.py`
- `apps/ui/templates/ui/base.html`
- `apps/ui/static/ui/app.tsx`

### Если задача про fullscreen editor

- [context/room-work-editor.md](context/room-work-editor.md)
- [tasks/fullscreen-room-work-editor.md](tasks/fullscreen-room-work-editor.md)
- `apps/ui/static/ui/app.tsx`
- `apps/ui/static/ui/app.css`

### Если задача про roadmap или новые типы разметки

- [ideas/index.md](ideas/index.md)
- [../data-labeling-scenarios.md](../data-labeling-scenarios.md)
- [context/product-and-priorities.md](context/product-and-priorities.md)
