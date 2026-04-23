# Fullscreen Room Work Editor

## Status

- active

## Why It Exists

- Текущий product direction требует, чтобы `room-work` стал полноценным editor shell, а не секцией на длинной странице.
- Для image-heavy сценариев скорость и предсказуемость работы исполнителя важнее визуального сходства с остальным сайтом.
- Этот слой должен стать основой для будущего роста от bbox к нескольким сценариям разметки.

## Scope

- Fullscreen layout редактора.
- Стабильная media stage geometry.
- Быстрый bbox UX с keyboard/pointer ergonomics.
- Неперекрывающий auxiliary chrome: label rail, zoom, inspector.
- Подготовка shell-а к будущему scenario scaling.

## Non-Goals

- Полная реализация всех будущих сценариев разметки уже сейчас.
- Жёсткая стилистическая привязка editor-а к landing/marketing части сайта.
- Переписывание hot path editor-а в “чистый React”, если это ухудшает отзывчивость.

## Relevant Files

- `apps/ui/static/ui/app.tsx`
- `apps/ui/static/ui/app.css`
- `apps/ui/templates/ui/base.html`
- `apps/ui/views.py`

## Decisions Already Made

- Editor живёт как отдельный fullscreen shell.
- Pointer-intensive bbox flow допускает императивные участки ради производительности.
- Workspace size не должен зависеть от размеров текущего media.
- Label rail и похожие элементы должны жить внутри собственных rail/frame-ов с internal scroll.
- `Shift`, `Ctrl`, `Esc` уже считаются частью нормального editor UX.

## Open Edges / Risks

- Нужна дальнейшая нормализация shell-а под большее число сценариев, чтобы bbox-логика не стала архитектурной ловушкой.
- Любая визуальная полировка должна перепроверяться на предмет перекрытия media-контента.
- Zoom и media boundary logic легко ломаются при seemingly harmless CSS/layout изменениях.
- При добавлении новых scenario tools важно не превратить shell обратно в “кучку фреймов” вместо единого редактора.

## Next Likely Steps

1. Продолжить выводить общие editor controls в scenario-agnostic shell и отделять их от bbox-specific поведения.
2. Проверять overlay geometry и internal scroll rails после каждой заметной правки layout-а.
3. Подготавливать модель, в которой новые annotation scenarios смогут подключаться без переписывания всего `room-work`.

## Handoff Notes

- Если правка касается зума, rail-ов или границ media, сначала перечитай [../context/room-work-editor.md](../context/room-work-editor.md).
- Перед большими UI-правками держи в уме, что цель editor-а - скорость работы исполнителя, а не карточная “dashboard” композиция.
