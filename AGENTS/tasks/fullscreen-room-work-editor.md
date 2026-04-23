# Fullscreen Room Work Editor

## Status

- active

## Why It Exists

- Текущий product direction требует, чтобы `room-work` стал полноценным editor shell, а не секцией на длинной странице.
- Для image-heavy сценариев скорость и предсказуемость работы исполнителя важнее визуального сходства с остальным сайтом.
- Этот слой должен стать основой для будущего роста от bbox к нескольким сценариям разметки.
- Review и post-submit edit flow тоже должны жить здесь: room detail page остаётся обзорной точкой входа, а не местом, где разворачивается детальная проверка payload-ов.

## Scope

- Fullscreen layout редактора.
- Стабильная media stage geometry.
- Быстрый bbox UX с keyboard/pointer ergonomics.
- Неперекрывающий auxiliary chrome: label rail, zoom, inspector.
- Multi-mode workspace: `queue`, `submitted`, `review`.
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
- Один и тот же stage/controller должен переиспользоваться для annotate, edit своей submitted-разметки и reviewer review; не нужно плодить отдельные mini-viewer-ы.

## Open Edges / Risks

- Нужна дальнейшая нормализация shell-а под большее число сценариев, чтобы bbox-логика не стала архитектурной ловушкой.
- Любая визуальная полировка должна перепроверяться на предмет перекрытия media-контента.
- Zoom и media boundary logic легко ломаются при seemingly harmless CSS/layout изменениях.
- При добавлении новых scenario tools важно не превратить shell обратно в “кучку фреймов” вместо единого редактора.
- Edit-after-submit и reviewer-driven `return-for-revision` меняют не только UI, но и pipeline expectations; editor-правки в этой зоне нужно сверять с `apps/labeling/services.py` и тестами, а не только глазами.

## Next Likely Steps

1. Продолжить выводить общие editor controls в scenario-agnostic shell и отделять их от bbox-specific поведения.
2. Проверять overlay geometry и internal scroll rails после каждой заметной правки layout-а.
3. Поддерживать единый stage contract для queue/submitted/review, чтобы новые annotation scenarios смогли подключаться без переписывания всего `room-work`.

## Handoff Notes

- Если правка касается зума, rail-ов или границ media, сначала перечитай [../context/room-work-editor.md](../context/room-work-editor.md).
- Перед большими UI-правками держи в уме, что цель editor-а - скорость работы исполнителя, а не карточная “dashboard” композиция.
