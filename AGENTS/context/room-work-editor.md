# Room Work Editor

## Why The Editor Is Being Treated As Its Own Surface

`room-work` больше не считается просто ещё одним блоком на странице комнаты. Продуктовый вектор уже зафиксирован: исполнитель должен входить в отдельную рабочую поверхность, где всё нужное доступно без page-level scroll.

Это решение принято не ради визуального эффекта, а ради скорости и предсказуемости работы.

## Core Goals

- Fullscreen workspace без desktop page scroll.
- Быстрый pointer-driven UX без заметного отставания курсора.
- Layout, который не схлопывается от маленького media и не ломается от большого.
- Возможность расти от bbox today к нескольким сценариям разметки tomorrow.

## Decisions Already Embedded In The Project

- Горячий путь bbox editor-а уже оправданно содержит императивные куски: это сделано ради pointer performance, а не из-за недосмотра.
- Workspace должен определяться layout-ом editor-а, а не размером изображения или видео.
- Auxiliary chrome вроде label rail, zoom и inspector не должен перекрывать media-контент; overflow должен уходить во внутренний scroll собственных rail/frame-ов.
- Zoom считается корректным только если сохраняет ожидаемую геометрию: переход от `100%` к увеличению не должен “приклеивать” media к левому верхнему углу и должен позволять media выходить за viewport редактора.
- Power-user ergonomics уже часть ожидаемого UX: `Shift` для квадратного bbox, `Ctrl` для reposition draft/resize flow, `Esc` для отмены незавершённой операции.

## What Future Refactors Must Preserve

- Не возвращать editor в длинный scrolling room page.
- Не подменять реальную границу media декоративной рамкой, живущей вне геометрии изображения/видео.
- Не делать React re-render узким местом для pointer loop.
- Не проектировать новые annotation scenarios как hardcoded исключения только под bbox.

## First Files To Read

- `apps/ui/static/ui/app.tsx`
- `apps/ui/static/ui/app.css`
- [../tasks/fullscreen-room-work-editor.md](../tasks/fullscreen-room-work-editor.md)
