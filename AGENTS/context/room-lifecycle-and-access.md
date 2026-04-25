# Room Lifecycle And Access

## Why This Area Matters

Для DataSetAI комната - это не просто контейнер с задачами. Это основной operational boundary:

- кто вообще видит работу;
- кто может размечать, ревьюить и экспортировать;
- как участники входят в систему через invite links или join requests;
- как пользователь ориентируется в списке комнат.

Из-за этого изменения в room domain редко бывают “просто UI” или “просто selector tweak”.

## Core Goals

- Делать доступ предсказуемым для владельца и участников.
- Не ломать жизненный цикл комнаты при добавлении новых workflow или UI-экранов.
- Сохранять список комнат информативным: pinning, recency и role-sensitive payload должны помогать, а не мешать.

## Decisions Already Embedded In The Project

- `RoomPin.sort_order` - это не косметика, а явный механизм порядка закреплённых комнат.
- `RoomVisit.last_accessed_at` участвует в recency sorting и отражает недавнюю активность пользователя.
- `Room.owner_is_annotator` означает, что владелец комнаты не должен неявно считаться annotator-ом всегда; это сознательно вынесено в отдельную семантику.
- Join/access flow должен оставаться согласованным между policies, services, selectors и UI payload-ами.
- Image dataset management теперь часть room lifecycle: владелец может после создания комнаты добавить изображения или ZIP-архив и удалить отдельные primary task rows. Этот write-side flow должен оставаться в `apps/rooms/services.py`, а UI/API не должны обходить каскадное удаление задач и связанных результатов.
- Direct access по ID комнаты и паролю больше не является продуктовым входом. Новые участники приходят через invite link / join request; `/rooms/` показывает создание комнаты и список уже доступных комнат.

## What Refactors Must Preserve

- Доступ нельзя менять частично только в UI или только в selector: room access живёт через services + policies + shaped payloads.
- Любое изменение роли владельца должно проверяться не только в create/update flow, но и в assignment eligibility, participant stats и review/dashboard payload-ах.
- Post-create изменение датасета должно сохранять корректные `item_number`, source files и child-task semantics; нельзя просто удалять файл из storage без удаления task row и зависимых annotation/assignment rows.
- Не возвращай форму или API endpoint прямого входа по ID+паролю без явного продуктового решения: это меняет privacy/access semantics комнаты.
- Порядок комнат не должен “плыть” от случайных query изменений: pinned rooms и non-pinned rooms имеют разные сигналы сортировки, и это уже часть UX.

## First Files To Read

- `apps/rooms/models.py`
- `apps/rooms/services.py`
- `apps/rooms/selectors.py`
- `apps/rooms/policies.py`
- `tests/test_rooms_api.py`
