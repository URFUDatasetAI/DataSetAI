# UI Bootstrap And React Shell

## Why The UI Is Structured This Way

Проект сознательно не разносит Django и frontend на два независимых приложения. Django остаётся владельцем:

- routing;
- auth/access checks;
- server-rendered bootstrap;
- form workflows и service endpoints.

React отвечает за клиентскую интерактивность поверх этого контракта.

## Core Goals

- Избежать дублирования шаблонов и page logic между Django templates и frontend.
- Сохранять server-owned routing и access checks.
- Развивать UI как одно React-приложение без превращения проекта в отдельный frontend deployment pipeline.

## Decisions Already Embedded In The Project

- `apps/ui/templates/ui/base.html` - единый HTML-shell для React root.
- `apps/ui/views.py` и `UiContextMixin` централизуют bootstrap-contract.
- `apps/ui/static/ui/app.tsx` выбирает экран по `page_key`, а не по отдельному frontend-router, владеющему всем URL-space.

## What Refactors Must Preserve

- Нельзя размывать bootstrap-contract в ad hoc `<script>` fragments по разным template-файлам.
- Access logic не должна мигрировать в чисто клиентские условия: Django всё ещё источник истины для страницы и разрешений.
- UI может становиться сложнее, но boundary между Django bootstrap и React rendering должен оставаться ясным.

## First Files To Read

- `apps/ui/views.py`
- `apps/ui/templates/ui/base.html`
- `apps/ui/static/ui/app.tsx`
- `docs/ARCHITECTURE.md`
