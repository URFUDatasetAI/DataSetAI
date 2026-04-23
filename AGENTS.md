# AGENTS Bootstrap

Некоторые агентные рантаймы автоматически читают только корневой `AGENTS.md`. Для этого репозитория этот файл служит bootstrap-слоем и маршрутизатором.

Главный handoff-layer живёт в [AGENTS/AGENTS.md](AGENTS/AGENTS.md).

## Read First

1. [AGENTS/AGENTS.md](AGENTS/AGENTS.md) - главный entrypoint и порядок чтения.
2. [AGENTS/current-state.md](AGENTS/current-state.md) - текущее состояние проекта, активные темы и быстрые маршруты по коду.
3. Релевантные файлы из [AGENTS/context/](AGENTS/context/README.md) - зачем проект устроен именно так и какие цели нельзя потерять.
4. Релевантные файлы из [AGENTS/tasks/](AGENTS/tasks/README.md) - незавершённая работа и handoff по крупным темам.
5. Канонические факты из [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и [DEPLOY.md](DEPLOY.md).

## Project Snapshot

- DataSetAI - Django-монолит для командной разметки датасетов с React UI, REST API и PostgreSQL.
- Основные продуктовые поверхности: room lifecycle, labeling pipeline, review/export, fullscreen `room-work` editor.
- Поддерживаемые dataset/source сценарии уже включают text, image, video и workflow `text_detect_text`.
- Важные свежие слои системы: deterministic grouped cross-validation, `Room.owner_is_annotator`, recency-aware room sorting и fullscreen editor shell.

## Non-Negotiables

- Канонические факты остаются в `README.md` и `docs/*`; `AGENTS/*` хранит живой operational/context слой поверх них.
- Если меняется долговременный приоритет, архитектурный компромисс, активная незавершённая тема или backlog-решение, обнови соответствующий файл в `AGENTS/`.
- Незавершённую многосоставную работу нельзя оставлять только в diff или в голове: для неё нужен task-file в `AGENTS/tasks/`.
- Идеи, которые ещё не стали задачами, должны жить в `AGENTS/ideas/`, а не растворяться в чатах.

Если времени мало, сначала прочитай [AGENTS/current-state.md](AGENTS/current-state.md), затем выбери один релевантный файл из [AGENTS/context/](AGENTS/context/README.md), и только потом иди в код.
