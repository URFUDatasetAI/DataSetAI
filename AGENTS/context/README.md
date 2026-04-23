# Context Layer

`AGENTS/context/*` объясняет, почему проект устроен именно так, а не просто перечисляет факты.

Канонические факты о модулях, технологиях и запуске остаются в [README.md](../../README.md) и [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Этот слой нужен для более мобильной работы агента:

- понимать цель решения, а не только его текущую форму;
- свободнее рефакторить код, не теряя ключевые свойства системы;
- не возвращать уже отвергнутые направления под видом “чистого улучшения”.

## Read By Topic

- Общие продуктовые приоритеты и то, что проект считает успехом:
  [product-and-priorities.md](product-and-priorities.md)
- Room lifecycle, access, pinning, owner role semantics:
  [room-lifecycle-and-access.md](room-lifecycle-and-access.md)
- Assignment, cross-validation, consensus, final-stage semantics:
  [labeling-pipeline-and-workflows.md](labeling-pipeline-and-workflows.md)
- Django/React boundary, bootstrap contract и почему UI не выделен в отдельный SPA-server:
  [ui-bootstrap-and-react-shell.md](ui-bootstrap-and-react-shell.md)
- Fullscreen editor, media geometry, pointer UX и сценарная масштабируемость:
  [room-work-editor.md](room-work-editor.md)

## Maintenance Rule

Если устойчивое “зачем” меняется, обновляй context-файл сразу. Если меняется только локальная реализация без нового смысла, context-файл трогать не нужно.
