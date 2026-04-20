# AGENTS.md

Этот файл хранит агентный контекст для работы с репозиторием. Публичные документы проекта должны оставаться человеко-ориентированными; всё, что относится к навигации, памяти и специальным рабочим правилам для агентов, фиксируется здесь.

## Project Snapshot

- DataSetAI - монолитное Django-приложение для командной разметки датасетов с React UI, REST API и PostgreSQL.
- Backend: Django 5, DRF, `psycopg`, `.env`-конфигурация через `python-dotenv`.
- Frontend: React + TypeScript + CSS, сборка через `esbuild` в `apps/ui/static/ui/app.js`.
- Поддерживаемые типы датасетов: `demo`, `json`, `image`, `video`.
- Поддерживаемые source types задач: `text`, `image`, `video`.
- Поддерживаемые workflow: `standard` и `text_detect_text` (`TEXT_DETECTION` -> `TEXT_TRANSCRIPTION`).
- Экспорт: `native_json` всегда; `coco_json` и `yolo_zip` только для image/video-комнат вне detect+text workflow.
- Закреплённые комнаты опираются на явный `RoomPin.sort_order`, а сортировка списков комнат использует `RoomVisit.last_accessed_at` как сигнал недавней активности.
- CI на Pull Request запускает сборку UI, `python manage.py check` и `python manage.py test`. Merge в `main` запускает production deploy.

## Current Focus

- Удерживать в рабочем состоянии MVP командной разметки без регрессий в room lifecycle: создание, редактирование, invite links, join requests, pinning, роли и вход в комнату.
- Не ломать новый UX списка комнат: pinning, reorder закреплённых комнат, удаление участника и recency-сортировка по посещениям должны оставаться согласованными между backend и UI.
- Сохранять надёжность пайплайна разметки: выдача задач, submit, cross-validation, review/reject и экспорт готовых данных.
- Поддерживать image/video и detect+text сценарии как основные, а не второстепенные кейсы.
- Развивать `room-work` как отдельный fullscreen editor shell, где сцена, инструменты и отправка результата доступны без прокрутки всей страницы.
- Удерживать editor workspace независимым от размера текущего media-файла: маленькие изображения не должны визуально схлопывать сцену, а границы media должны читаться как часть самого media, а не как отдельная декоративная рамка.
- Не ломать текущую Django + React bootstrap-архитектуру при развитии UI.

## Durable Priorities

- Надёжность и корректность пайплайна разметки важнее быстрого добавления новых фич.
- Конкурентная безопасность назначения и отправки задач обязательна: изменения не должны создавать двойные назначения, гонки раундов или потерю аннотаций.
- Room/access workflow должен оставаться предсказуемым: invite links, join requests, password access, роли и visibility не должны деградировать.
- Списки комнат должны оставаться детерминированными: закреплённые комнаты ограничены по количеству, порядок pinned-комнат задаётся `sort_order`, а внутри каждого pin-state приоритет задаётся недавним посещением комнаты.
- Media и OCR-сценарии считаются first-class: import, review, progress и export для image/video и detect+text нельзя рассматривать как edge cases.
- Производительность editor UX важна сама по себе: pointer-driven взаимодействия в `room-work` должны оставаться максимально прямыми, без ощутимого отставания курсора и лишних React re-render на hot path.
- Workspace редактора должен задаваться layout-ом, а не размером изображения/видео: media может быть меньше или больше viewport-а, но stage и tool chrome должны оставаться стабильными.
- Вторичный tool chrome в `room-work` не должен перекрывать сцену: overflow для label-rail и похожих элементов должен уходить во внутренний scroll внутри собственного frame, а не в наложение поверх media.
- Zoom в `room-work` должен сохранять визуальную геометрию сцены: переход от `100%` к увеличению не должен срывать media в левый верх, а zoom > `100%` обязан позволять media выходить за viewport редактора с корректным pan/scroll.
- BBox-редактор должен сохранять power-user ergonomics: модификаторы вроде `Shift` для квадратного выделения и `Ctrl` для reposition текущего draft-box, а также `Esc` для отмены незавершённой операции, считаются частью ожидаемого UX, а не необязательным украшением.
- Архитектурный split Django/React нужно сохранять: Django отвечает за routing, auth, bootstrap и API, React - за экран и клиентскую интерактивность.

## Hotspots

- `apps/rooms/services.py`
  - Создание комнат, импорт датасетов, invite/join flow, pinning/reorder pinned rooms, room visit tracking, room updates, export.
- `apps/rooms/models.py`
  - `Room`, `RoomPin`, `RoomVisit`, membership и join-request сущности, на которых держатся room lifecycle и сортировка комнат.
- `apps/labeling/services.py`
  - Выдача задач, submit, cross-validation, повторные раунды, review reject.
- `apps/labeling/consensus.py`
  - Расчёт сходства и выбор consensus payload для text/media сценариев.
- `apps/rooms/selectors.py`
  - Dashboard, invite preview, progress, actor-specific room payloads и порядок списков комнат по pin/visit activity.
- `apps/labeling/workflows.py`
  - Разделение primary/final tasks, особенно для `text_detect_text`.
- `apps/ui/views.py`, `apps/ui/templates/ui/base.html`, `apps/ui/static/ui/app.tsx`
  - Django bootstrap + React page router + клиентские экраны.
- `apps/ui/static/ui/app.css`
  - Layout и interaction shell fullscreen editor-а, включая fixed-height workspace, media stage и internal scrolling панелей.
- `apps/rooms/api/v1/*` и `apps/labeling/api/v1/*`
  - Валидация запросов и thin-controller слой над services/selectors.
- `tests/test_rooms_api.py` и `tests/test_labeling_api.py`
  - Основная спецификация поведения room/access flows, detect+text, review и export.

## Non-Negotiable Invariants

- Write-side бизнес-логика живёт в `services.py`. Read-side выборки и shaping payload-ов живут в `selectors.py`. Не размазывать сложную логику по views/serializers.
- Любые изменения в назначении, отправке, повторном открытии или закрытии задач должны уважать `transaction.atomic()` и существующую схему `select_for_update()`.
- В `get_next_task_for_annotator` важно сохранять семантику `select_for_update(skip_locked=True)` там, где СУБД её поддерживает: это часть модели конкурентной выдачи задач.
- Для cross-validation задача закрывается только после достаточного числа submit-ов текущего раунда; при расхождении consensus задача возвращается в `PENDING` и переходит в следующий раунд.
- В workflow `text_detect_text` detection stage может создавать дочернюю transcription task; прогресс, review и export для комнаты считаются по финальной `TEXT_TRANSCRIPTION` стадии, а не по всем task rows.
- Video import зависит от наличия `ffmpeg`. Если `ffmpeg` недоступен, импорт видео должен падать явно, а не деградировать в частично созданное состояние.
- Image/video функциональность зависит от корректного `MEDIA_ROOT` и nginx media serving в production. Локально media обслуживается Django только при `DEBUG=true`.
- UI не является отдельным SPA-сервером: Django задаёт `page_key` и bootstrap, React выбирает нужный экран по этому bootstrap-контракту.
- `room-work` должен оставаться отдельной рабочей поверхностью: fullscreen layout, без page-level scroll на desktop, с internal scroll только у вспомогательных панелей и с приоритетом на быстрый pointer/keyboard feedback.
- Явные границы media в `room-work` должны быть привязаны к самому media/overlay и клиппиться вместе с ним; нельзя подменять их отдельной внешней рамкой, живущей вне реальных границ изображения или видео.
- Pinning-комнаты нельзя рассматривать как просто boolean-флаг: `RoomPin.sort_order`, лимит количества pinned rooms и `RoomVisit.last_accessed_at` участвуют в порядке выдачи списков и должны обновляться согласованно.
- Header auth через `X-User-Id` всё ещё часть текущего MVP и уже встроен в API/UI сценарии; не ломать его случайными изменениями auth-слоя.

## Maintenance Protocol

- Если пользователь формулирует долговременный продуктовый или инженерный приоритет, обнови этот файл в том же изменении, где этот приоритет начал влиять на код.
- Если меняются архитектурные hotspots, entry points в коде, ключевые workflow или правила валидации/export, обнови соответствующие разделы этого файла.
- Если в публичные docs, комментарии или docstrings случайно попадает агентно-ориентированный текст, перенеси агентную часть сюда, а human-facing документы перепиши нейтрально.
- Не превращай `AGENTS.md` в changelog. Здесь должны жить устойчивые правила, инварианты, приоритеты и точки навигации, которые помогают быстро включиться в проект.
- При сомнении обновляй этот файл в сторону большей конкретики: агенту полезнее увидеть актуальный проектный контекст сразу, чем реконструировать его по коду и старым обсуждениям.
