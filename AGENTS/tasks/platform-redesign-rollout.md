# Platform Redesign Rollout

## Goal

Привести всю платформу к новому dashboard-oriented стилю, заданному главной страницей в духе Refero/Seline: светлая/тёмная тема, спокойные поверхности, компактные pill controls, аккуратные таблицы/карточки и минимум маркетинговой декоративности.

## Current State

- Главная уже переведена на новый landing/dashboard style и поддерживает light/dark theme.
- Сценарии разметки на главной должны вести в создание комнаты с предвыбранным типом датасета/workflow.
- Экран создания комнаты уже переведён на progressive wizard: сценарий, основное, данные, команда, контроль качества и прямое создание после финальной валидации. Backend payload и validation constraints остались прежними.
- Room detail получил первый command-center слой: компактный topbar со сводкой комнаты, KPI strip, role-aware CTA, свернутую личную/owner-сводку и управление комнатой, которое больше не завязано на роль annotator.
- Rooms list получил первый room navigator слой: compact dashboard topbar, KPI, поиск, фильтры по статусу/типу датасета, отдельные pinned rooms и плотные карточки с progress/quick actions.
- Остальные рабочие поверхности пока живут в прежней visual system: edit forms, profile, invite, room-work editor, video screens.

## Rollout Order

1. Shared shell:
   - унифицировать header/nav/buttons/theme toggle;
   - вынести общие цветовые токены нового стиля без ломки editor-specific CSS.
2. Rooms list and profile:
   - rooms list уже переведён в navigator с фильтрами и compact cards;
   - дальше проверить реальные большие списки комнат и привести profile stats к той же плотной dashboard-сетке.
3. Create/edit room:
   - форма создания комнаты уже сценарная; дальше нужно привести edit room к той же визуальной системе;
   - сохранить все текущие validation constraints.
4. Room detail:
   - первый слой command-center уже добавлен;
   - дальше дожать визуальную систему dataset/team/export/review блоков и проверить реальные room payload-ы на owner/reviewer/annotator ролях.
5. Work editors:
   - менять осторожно: `room-work`, image/video annotation и review являются production surfaces;
   - не нарушать fullscreen/no-page-scroll invariant и pointer UX.

## Non-Negotiables

- Не ломать `room-work` fullscreen shell.
- Не менять бизнес-логику assignment, review, cross-validation и video annotation ради визуального рефакторинга.
- После каждого слоя гонять `npm.cmd run check:types`, `npm.cmd run build:ui`, `python manage.py check`; для затронутых backend paths добавлять/гонять Django tests.
