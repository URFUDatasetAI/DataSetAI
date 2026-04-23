# AGENTS

Это главный entrypoint для нового агента без истории чата.

Здесь не дублируются все факты о проекте. Канонические факты остаются в [README.md](../README.md), [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) и [DEPLOY.md](../DEPLOY.md). Папка `AGENTS/` хранит живой handoff-слой поверх этих документов:

- что сейчас действительно важно;
- какие компромиссы уже приняты;
- какую незавершённую работу нельзя потерять;
- какие идеи уже одобрены, отложены или отклонены;
- как следующему агенту поддерживать этот слой в актуальном состоянии.

## Read Order

Читай в таком порядке:

1. [current-state.md](current-state.md)
2. один или несколько файлов из [context/](context/README.md), релевантных задаче
3. релевантные файлы из [tasks/](tasks/README.md), если задача пересекается с незавершённой темой
4. канонические документы:
   - [../README.md](../README.md)
   - [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
   - [../DEPLOY.md](../DEPLOY.md)
5. при продуктовых расширениях или roadmap-вопросах:
   - [ideas/index.md](ideas/index.md)

## What Lives Where

### `current-state.md`

Открывай всегда. Это короткий снимок проекта:

- базовое текущее состояние;
- активные приоритеты;
- инварианты, которые чаще всего ломают случайно;
- активные task-файлы;
- недавние крупные изменения;
- быстрые маршруты по коду.

### `context/*`

Открывай, когда важно понять не только что есть в коде, но и зачем так устроено. Это слой про цели решений и компромиссы.

Примеры:

- почему `services.py` и `selectors.py` жёстко разведены;
- почему `room-work` развивается как отдельный fullscreen shell;
- почему grouped cross-validation важнее “симпатичного” рефакторинга;
- почему owner role и room access нельзя трогать как локальный UI detail.

### `tasks/*`

Это handoff по незавершённой работе. Task-file нужен, когда тема:

- длится больше одной правки;
- затрагивает несколько слоёв системы;
- уже содержит решения и открытые края;
- вероятно будет подхвачена другим агентом позже.

Если задача полностью завершена и не требует handoff, не держи её в `tasks/`; кратко отрази результат в `current-state.md`, если изменение действительно важное и долгоживущее.

### `ideas/*`

Это backlog-слой. Сюда попадают идеи, которые ещё не стали активной задачей.

- `candidate/` - идея понятна и выглядит продуктово совместимой с направлением проекта.
- `needs-discovery/` - идея интересная, но пока не хватает исследования, UX-модели или технической схемы.
- `rejected/` - идея или направление сознательно отвергнуты, чтобы будущие агенты не поднимали их снова без новой причины.

Важная локальная договорённость: `ideas/*` нельзя заполнять по одной только агентной интерпретации roadmap-сигналов, scenario-документов или “логичных будущих шагов”. Этот слой заполняется только после явного обсуждения идеи с пользователем или командой.

## Quick Routing By Task Type

- Room lifecycle, invite links, join requests, pinning, owner-role semantics:
  сначала [current-state.md](current-state.md), потом [context/room-lifecycle-and-access.md](context/room-lifecycle-and-access.md), затем `apps/rooms/services.py`, `apps/rooms/selectors.py`, `apps/rooms/models.py`.
- Labeling pipeline, consensus, review, grouped cross-validation:
  сначала [context/labeling-pipeline-and-workflows.md](context/labeling-pipeline-and-workflows.md), затем [tasks/grouped-cross-validation-stabilization.md](tasks/grouped-cross-validation-stabilization.md), потом `apps/labeling/services.py`, `apps/labeling/distribution.py`, `apps/labeling/consensus.py`.
- UI bootstrap, page routing, Django/React boundary:
  сначала [context/ui-bootstrap-and-react-shell.md](context/ui-bootstrap-and-react-shell.md), потом `apps/ui/views.py`, `apps/ui/templates/ui/base.html`, `apps/ui/static/ui/app.tsx`.
- Fullscreen editor и media UX:
  сначала [context/room-work-editor.md](context/room-work-editor.md), затем [tasks/fullscreen-room-work-editor.md](tasks/fullscreen-room-work-editor.md), потом `apps/ui/static/ui/app.tsx` и `apps/ui/static/ui/app.css`.
- Product direction, feature expansion, scenario growth:
  сначала [context/product-and-priorities.md](context/product-and-priorities.md), затем [ideas/index.md](ideas/index.md) и [../data-labeling-scenarios.md](../data-labeling-scenarios.md).

## Mandatory Update Rules

Обновляй `AGENTS/` в том же изменении, если произошло хотя бы одно из следующего:

- изменился долгоживущий продуктовый или инженерный приоритет;
- появился новый важный компромисс или инвариант;
- начата многосоставная незавершённая работа;
- идея получила явный статус `candidate`, `needs-discovery` или `rejected`;
- изменилась рекомендуемая карта чтения для следующего агента.

Минимум дисциплины:

- значимое незавершённое состояние фиксируй в `tasks/*`;
- устойчивое “зачем” фиксируй в `context/*`;
- текущее положение дел и свежие крупные сдвиги поддерживай в `current-state.md`.

Если сомневаешься, обнови `AGENTS/` в сторону большей конкретики. Для handoff это почти всегда дешевле, чем заставлять следующего агента реконструировать контекст по diff и чатам.
