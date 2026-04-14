type ActivitySeriesItem = {
  date: string;
  count: number;
};

type FlashOptions = {
  persistent?: boolean;
  duration?: number | string | null;
};

type ClearFlashOptions = {
  includePersistent?: boolean;
};

type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  formData?: FormData;
};

type ToastEntry = {
  id: number;
  element: HTMLElement;
  persistent: boolean;
  timeoutId: number | null;
  isClosing: boolean;
};

interface ActivityContainer extends HTMLElement {
  _activitySeries?: ActivitySeriesItem[];
  _activityResizeBound?: boolean;
  _activityResizeFrame?: number | null;
  _activityResizeObserver?: ResizeObserver;
  _activityResizeHandler?: () => void;
}

function byId<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T | null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || "Неизвестная ошибка.");
}

function readJsonScript<T = any>(id: string): T | null {
  const element = document.getElementById(id);
  if (!element?.textContent) {
    return null;
  }

  try {
    return JSON.parse(element.textContent) as T;
  } catch (error) {
    return null;
  }
}

const authUser = readJsonScript("auth-user-data");

const body = document.body;
const currentPage = body.dataset.page;
const currentRoomId = body.dataset.roomId ? Number(body.dataset.roomId) : null;
const currentProfileUserId = body.dataset.profileUserId ? Number(body.dataset.profileUserId) : null;
const appDebugMode = body.dataset.appDebugMode === "true";

const roleLabels = {
  owner: "Владелец",
  customer: "Заказчик",
  annotator: "Исполнитель",
  admin: "Админ",
  tester: "Инспектор",
  unknown: "Неизвестная роль",
};

const membershipLabels = {
  owner: "Владелец",
  invited: "Приглашен",
  joined: "В комнате",
};

const taskStatusLabels = {
  pending: "Ожидает разметки",
  in_progress: "В работе",
  submitted: "Отправлена",
};

const datasetModeLabels = {
  demo: "Demo JSON",
  json: "JSON",
  image: "Фото",
  video: "Видео",
};

const sourceTypeLabels = {
  text: "JSON / текст",
  image: "Фото",
  video: "Видео",
};

const labelColorPool = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFD166",
  "#118AB2",
  "#EF476F",
  "#06D6A0",
  "#F78C6B",
  "#9B5DE5",
];

const state = {
  user: authUser,
  currentTask: null,
  roomDashboard: null,
  reviewTasks: [],
  selectedReviewTaskId: null,
  selectedAnnotatorUserId: null,
  appDebugMode,
  theme: document.documentElement.dataset.theme || "light",
  pageRefresh: () => {},
};

const FLASH_DEFAULT_DURATION = 5000;
const FLASH_MIN_DURATION = 1600;
const FLASH_EXIT_DURATION = 180;

const toastState: { nextId: number; items: Map<number, ToastEntry> } = {
  nextId: 0,
  items: new Map(),
};

const globalElements = {
  toastRegion: byId<HTMLDivElement>("toast-region"),
  themeToggle: byId<HTMLInputElement>("theme-toggle"),
};

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("datasetai-theme", theme);
  } catch (error) {
    // no-op for restricted environments
  }

  if (globalElements.themeToggle) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    globalElements.themeToggle.checked = theme === "dark";
    globalElements.themeToggle.setAttribute("aria-label", `Переключить на ${nextTheme === "dark" ? "тёмную" : "светлую"} тему`);
    globalElements.themeToggle.setAttribute("title", `Переключить на ${nextTheme === "dark" ? "тёмную" : "светлую"} тему`);
  }
}

function initThemeToggle() {
  applyTheme(state.theme);
  globalElements.themeToggle?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLInputElement | null;
    applyTheme(target?.checked ? "dark" : "light");
  });
}

function translateRole(role) {
  return roleLabels[role] || role;
}

function translateMembership(status) {
  return membershipLabels[status] || status;
}

function translateTaskStatus(status) {
  return taskStatusLabels[status] || status;
}

function translateDatasetMode(mode) {
  return datasetModeLabels[mode] || mode;
}

function translateSourceType(sourceType) {
  return sourceTypeLabels[sourceType] || sourceType;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pickRandomLabelColor() {
  const color = labelColorPool[Math.floor(Math.random() * labelColorPool.length)];
  return color;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) {
    return "Не задан";
  }
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeFlashType(type) {
  switch (type) {
    case "error":
    case "danger":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "success":
    default:
      return "success";
  }
}

function createToastElement({ id, message, type, persistent, duration }) {
  const toast = document.createElement("section");
  toast.className = `toast-notification toast-notification--${type}${persistent ? " is-persistent" : ""}`;
  toast.dataset.toastId = String(id);
  toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
  if (!persistent) {
    toast.style.setProperty("--toast-duration", `${duration}ms`);
  }

  const body = document.createElement("div");
  body.className = "toast-notification__body";

  const accent = document.createElement("span");
  accent.className = "toast-notification__accent";
  accent.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "toast-notification__content";

  const paragraph = document.createElement("p");
  paragraph.className = "toast-notification__message";
  paragraph.textContent = message;
  content.appendChild(paragraph);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "toast-notification__close";
  closeButton.setAttribute("aria-label", "Закрыть уведомление");
  closeButton.setAttribute("title", "Закрыть уведомление");
  closeButton.textContent = "×";

  body.appendChild(accent);
  body.appendChild(content);
  body.appendChild(closeButton);

  const progress = document.createElement("div");
  progress.className = "toast-notification__progress";
  progress.setAttribute("aria-hidden", "true");

  const progressBar = document.createElement("span");
  progressBar.className = "toast-notification__progress-bar";
  progress.appendChild(progressBar);

  toast.appendChild(body);
  toast.appendChild(progress);

  return { toast, closeButton };
}

function dismissFlash(id) {
  const toastEntry = toastState.items.get(id);
  if (!toastEntry || toastEntry.isClosing) {
    return;
  }

  toastEntry.isClosing = true;
  if (toastEntry.timeoutId) {
    window.clearTimeout(toastEntry.timeoutId);
    toastEntry.timeoutId = null;
  }

  toastEntry.element.classList.remove("is-visible");
  toastEntry.element.classList.add("is-leaving");
  window.setTimeout(() => {
    toastEntry.element.remove();
    toastState.items.delete(id);
  }, FLASH_EXIT_DURATION);
}

function showFlash(message, type = "success", options: FlashOptions = {}) {
  const text = String(message || "").trim();
  if (!text || !globalElements.toastRegion) {
    return null;
  }

  const persistent = Boolean(options.persistent);
  const normalizedType = normalizeFlashType(type);
  const requestedDuration = Number(options.duration);
  const duration =
    persistent
      ? null
      : Math.max(Number.isFinite(requestedDuration) ? requestedDuration : FLASH_DEFAULT_DURATION, FLASH_MIN_DURATION);
  const id = ++toastState.nextId;
  const { toast, closeButton } = createToastElement({
    id,
    message: text,
    type: normalizedType,
    persistent,
    duration,
  });

  const toastEntry = {
    id,
    element: toast,
    persistent,
    timeoutId: null,
    isClosing: false,
  };
  toastState.items.set(id, toastEntry);

  closeButton.addEventListener("click", () => {
    dismissFlash(id);
  });

  globalElements.toastRegion.appendChild(toast);
  window.requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  if (!persistent) {
    toastEntry.timeoutId = window.setTimeout(() => {
      dismissFlash(id);
    }, duration);
  }

  return id;
}

function showPersistentFlash(message, type = "info", options = {}) {
  return showFlash(message, type, { ...options, persistent: true });
}

function clearFlash(options: ClearFlashOptions = {}) {
  const includePersistent = Boolean(options.includePersistent);
  Array.from(toastState.items.values()).forEach((toastEntry) => {
    if (toastEntry.persistent && !includePersistent) {
      return;
    }
    dismissFlash(toastEntry.id);
  });
}

function initBootstrappedToasts() {
  document.querySelectorAll<HTMLElement>("[data-toast-message]").forEach((element) => {
    const message = element.dataset.toastMessage;
    if (message) {
      showFlash(message, element.dataset.toastType || "info", {
        persistent: element.dataset.toastPersistent === "true",
        duration: element.dataset.toastDuration,
      });
    }
    element.remove();
  });
}

function formatApiError(data, fallbackStatus) {
  if (!data) {
    return `HTTP ${fallbackStatus}`;
  }

  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }

  if (Array.isArray(data)) {
    return data.join(", ");
  }

  if (typeof data === "object") {
    const messages = [];
    Object.entries(data).forEach(([key, value]) => {
      const fieldName = key === "non_field_errors" ? "Ошибка" : key;
      if (Array.isArray(value)) {
        messages.push(`${fieldName}: ${value.join(", ")}`);
      } else if (typeof value === "string") {
        messages.push(`${fieldName}: ${value}`);
      }
    });
    if (messages.length) {
      return messages.join(" | ");
    }
  }

  return `HTTP ${fallbackStatus}`;
}

async function api(path, options: ApiRequestOptions = {}) {
  if (!state.user) {
    throw new Error("Сначала войди в аккаунт.");
  }

  const headers: Record<string, string> = {
    "X-User-Id": String(state.user.id),
    ...(options.headers || {}),
  };
  const requestOptions: RequestInit & { headers: Record<string, string> } = {
    method: options.method || "GET",
    headers,
  };

  if (options.formData) {
    requestOptions.body = options.formData;
  } else if (options.body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, requestOptions);
  const contentType = response.headers.get("content-type") || "";

  if (response.status === 204) {
    return null;
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      if (contentType.includes("application/json")) {
        data = JSON.parse(text);
      } else if (text.includes("<!DOCTYPE html") || text.includes("<html")) {
        data = {
          detail: "Сервер вернул HTML-ошибку вместо JSON. Обычно это значит, что backend упал или не применены миграции. Выполни: python manage.py migrate",
        };
      } else {
        data = { detail: text };
      }
    } catch (error) {
      data = { detail: "Не удалось прочитать ответ API." };
    }
  }

  if (!response.ok) {
    throw new Error(formatApiError(data, response.status));
  }

  return data;
}

function renderMetricCards(container, metrics) {
  container.innerHTML = metrics
    .map((metric) => `
      <article class="metric-card">
        <span>${metric.label}</span>
        <strong>${metric.value}</strong>
      </article>
    `)
    .join("");
}

function renderProfileCharts(container, overview) {
  const roomSeries = [
    { label: "Доступные", value: Number(overview.accessible_rooms_count || 0) },
    { label: "Созданные", value: Number(overview.created_rooms_count || 0) },
    { label: "Как исполнитель", value: Number(overview.joined_rooms_count || 0) },
    { label: "Приглашения", value: Number(overview.invitations_count || 0) },
  ];
  const workSeries = [
    { label: "Размечено", value: Number(overview.completed_tasks || 0) },
    { label: "В работе", value: Number(overview.in_progress_tasks || 0) },
  ];

  const renderChartRows = (series) => {
    const maxValue = Math.max(...series.map((item) => item.value), 0);
    return series
      .map((item) => {
        const ratio = maxValue > 0 ? item.value / maxValue : 0;
        return `
          <div class="profile-chart-card__row">
            <div class="profile-chart-card__meta">
              <span>${item.label}</span>
              <strong>${item.value}</strong>
            </div>
            <div class="profile-chart-card__track">
              <div class="profile-chart-card__fill" style="width: ${Math.max(ratio * 100, item.value > 0 ? 8 : 0)}%"></div>
            </div>
          </div>
        `;
      })
      .join("");
  };

  container.innerHTML = `
    <article class="profile-chart-card">
      <div class="profile-chart-card__head">
        <span>Комнаты</span>
        <strong>${roomSeries[0].value}</strong>
      </div>
      <div class="profile-chart-card__rows">
        ${renderChartRows(roomSeries)}
      </div>
    </article>
    <article class="profile-chart-card">
      <div class="profile-chart-card__head">
        <span>Работа</span>
        <strong>${workSeries[0].value + workSeries[1].value}</strong>
      </div>
      <div class="profile-chart-card__rows">
        ${renderChartRows(workSeries)}
      </div>
    </article>
  `;
}

function renderRoomProgressChart(container, overview) {
  const total = Number(overview.total_tasks || 0);
  const completed = Number(overview.completed_tasks || 0);
  const remaining = Math.max(Number(overview.remaining_tasks || 0), 0);
  const percent = Number(overview.progress_percent || 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const completedOffset = circumference * (1 - Math.min(Math.max(percent, 0), 100) / 100);

  container.innerHTML = `
    <article class="room-progress-chart">
      <div class="room-progress-chart__visual">
        <svg viewBox="0 0 140 140" class="room-progress-chart__svg" aria-hidden="true">
          <circle class="room-progress-chart__track" cx="70" cy="70" r="${radius}"></circle>
          <circle
            class="room-progress-chart__value"
            cx="70"
            cy="70"
            r="${radius}"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${completedOffset.toFixed(2)}"
          ></circle>
        </svg>
        <div class="room-progress-chart__center">
          <strong>${formatPercent(percent)}</strong>
          <span>готово</span>
        </div>
      </div>
      <div class="room-progress-chart__legend">
        <div class="room-progress-chart__legend-row">
          <span>Всего задач</span>
          <strong>${total}</strong>
        </div>
        <div class="room-progress-chart__legend-row">
          <span>Выполнено</span>
          <strong>${completed}</strong>
        </div>
        <div class="room-progress-chart__legend-row">
          <span>Осталось</span>
          <strong>${remaining}</strong>
        </div>
      </div>
    </article>
  `;
}

function renderSummaryRows(container, rows) {
  container.innerHTML = rows
    .map((row) => `
      <div class="summary-row">
        <span>${row.label}</span>
        <strong>${row.value}</strong>
      </div>
    `)
    .join("");
}

function parseDateString(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(dateString) {
  return new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" })
    .format(parseDateString(dateString))
    .replace(".", "");
}

function shiftDateString(dateString, days) {
  const date = parseDateString(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function formatWeeksLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "неделю";
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "недели";
  }

  return "недель";
}

const ACTIVITY_CELL_SIZE = 14;
const ACTIVITY_CELL_GAP = 4;
const ACTIVITY_CALENDAR_PADDING = 24;
const ACTIVITY_MIN_WEEKS = 8;
const ACTIVITY_MAX_WEEKS = 52;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildActivityMonthLabels(series: ActivitySeriesItem[]) {
  const labels = [];
  let previousMonthKey = null;

  series.forEach((item, index) => {
    const date = parseDateString(item.date);
    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (monthKey === previousMonthKey) {
      return;
    }

    const weekIndex = Math.floor(index / 7);
    if (labels.length && labels[labels.length - 1].weekIndex === weekIndex) {
      labels[labels.length - 1] = {
        label: formatMonthLabel(item.date),
        weekIndex,
      };
    } else {
      labels.push({
        label: formatMonthLabel(item.date),
        weekIndex,
      });
    }

    previousMonthKey = monthKey;
  });

  return labels;
}

function getVisibleActivityWeeks(container) {
  const availableWidth = Math.floor(container.clientWidth || container.getBoundingClientRect().width || 0);
  if (!availableWidth) {
    return ACTIVITY_MAX_WEEKS;
  }

  const weekStride = ACTIVITY_CELL_SIZE + ACTIVITY_CELL_GAP;
  const fittedWeeks = Math.floor((availableWidth - ACTIVITY_CALENDAR_PADDING + ACTIVITY_CELL_GAP) / weekStride);
  return clamp(fittedWeeks, ACTIVITY_MIN_WEEKS, ACTIVITY_MAX_WEEKS);
}

function buildCalendarSeries(series: ActivitySeriesItem[], targetWeekCount = 52): ActivitySeriesItem[] {
  const totalDays = targetWeekCount * 7;
  const seriesByDate = new Map(series.map((item) => [item.date, item.count]));
  const lastDate = series[series.length - 1]?.date;

  if (!lastDate) {
    return [];
  }

  const firstDate = shiftDateString(lastDate, -(totalDays - 1));

  return Array.from({ length: totalDays }, (_, index) => {
    const date = shiftDateString(firstDate, index);
    return {
      date,
      count: seriesByDate.get(date) || 0,
    };
  });
}

function renderActivity(container: ActivityContainer | null, series: ActivitySeriesItem[]) {
  if (!container) {
    return;
  }

  if (!series?.length) {
    container.innerHTML = '<div class="empty-card">Активность пока отсутствует.</div>';
    return;
  }

  container._activitySeries = series;
  const targetWeekCount = getVisibleActivityWeeks(container);
  const calendarSeries = buildCalendarSeries(series, targetWeekCount);
  const maxCount = Math.max(...calendarSeries.map((item) => item.count), 0);
  const calendarWidth =
    targetWeekCount * ACTIVITY_CELL_SIZE + (targetWeekCount - 1) * ACTIVITY_CELL_GAP + ACTIVITY_CALENDAR_PADDING;
  const monthLabels = buildActivityMonthLabels(calendarSeries);

  if (!container._activityResizeBound) {
    container._activityResizeBound = true;

    const rerenderIfNeeded = () => {
      const nextWeeks = getVisibleActivityWeeks(container);
      if (nextWeeks === Number(container.dataset.activityWeeks || 0)) {
        return;
      }

      if (container._activityResizeFrame) {
        cancelAnimationFrame(container._activityResizeFrame);
      }

      container._activityResizeFrame = requestAnimationFrame(() => {
        container._activityResizeFrame = null;
        renderActivity(container, container._activitySeries || []);
      });
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => rerenderIfNeeded());
      observer.observe(container);
      container._activityResizeObserver = observer;
    } else {
      window.addEventListener("resize", rerenderIfNeeded);
      container._activityResizeHandler = rerenderIfNeeded;
    }
  }

  container.dataset.activityWeeks = String(targetWeekCount);
  container.innerHTML = `
    <div class="activity-board__calendar" style="width: ${calendarWidth}px; max-width: 100%;">
      <div class="activity-board__months" style="grid-template-columns: repeat(${targetWeekCount}, ${ACTIVITY_CELL_SIZE}px);">
        ${monthLabels
          .map(
            (item) =>
              `<span class="activity-board__month" style="grid-column: ${item.weekIndex + 1};">${item.label}</span>`
          )
          .join("")}
      </div>
      <div class="activity-board__grid" style="grid-template-columns: repeat(${targetWeekCount}, ${ACTIVITY_CELL_SIZE}px);">
        ${calendarSeries
          .map((item) => {
            let level = 0;
            if (item.count > 0 && maxCount > 0) {
              const ratio = item.count / maxCount;
              level = ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : 3;
            }

            return `<div class="activity-board__cell" data-level="${level}" title="${item.date}: ${item.count}"></div>`;
          })
          .join("")}
      </div>
    </div>
    <div class="activity-board__legend">Интенсивность активности за последние ${targetWeekCount} ${formatWeeksLabel(targetWeekCount)}</div>
  `;
}

function initGlobalHeader() {
  initThemeToggle();
  initBootstrappedToasts();
  if (state.user) {
    state.pageRefresh();
  }
}

function initRoomsPage() {
  const grid = byId<HTMLDivElement>("rooms-grid");
  const empty = byId<HTMLElement>("rooms-grid-empty");
  const roomIdInput = byId<HTMLInputElement>("rooms-room-id");
  const passwordInput = byId<HTMLInputElement>("rooms-room-password");
  const enterBtn = byId<HTMLButtonElement>("rooms-enter-btn");

  function updateEnterButtonState() {
    const isReady = roomIdInput.value.trim().length > 0;
    enterBtn.disabled = !isReady;
    enterBtn.classList.toggle("btn--primary", isReady);
    enterBtn.classList.toggle("btn--muted", !isReady);
  }

  function sortRooms(rooms) {
    return [...rooms].sort((left, right) => {
      if (Boolean(left.is_pinned) !== Boolean(right.is_pinned)) {
        return Number(Boolean(right.is_pinned)) - Number(Boolean(left.is_pinned));
      }

      const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
      const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
      if (rightCreatedAt !== leftCreatedAt) {
        return rightCreatedAt - leftCreatedAt;
      }

      return Number(right.id) - Number(left.id);
    });
  }

  function renderRooms(rooms) {
    grid.innerHTML = rooms
      .map(
        (room) => `
          <article class="room-card ${room.is_pinned ? "is-pinned" : ""}" data-room-id="${room.id}">
            <div>
              <div class="room-card__head">
                <div class="room-card__id">Комната #${room.id}</div>
                <button
                  class="room-card__pin"
                  type="button"
                  data-room-pin-id="${room.id}"
                  data-is-pinned="${room.is_pinned ? "true" : "false"}"
                  aria-pressed="${room.is_pinned ? "true" : "false"}"
                  aria-label="${room.is_pinned ? "Убрать комнату из закрепленных" : "Закрепить комнату"}"
                  title="${room.is_pinned ? "Убрать из закрепленных" : "Закрепить комнату"}"
                >
                  ${room.is_pinned ? "★" : "☆"}
                </button>
              </div>
              <div class="room-card__title">${escapeHtml(room.title)}</div>
              <div class="room-card__meta">${escapeHtml(room.description || "Описание пока не добавлено.")}</div>
            </div>
            <div class="room-card__footer">
              <div>ID: ${room.id}</div>
              <div>Статус: ${translateMembership(room.membership_status || "owner")}</div>
              <div>Роль в комнате: ${translateRole(room.membership_role || "owner")}</div>
              <div>Прогресс: ${formatPercent(room.progress_percent)}</div>
              <div>Задачи: ${room.completed_tasks}/${room.total_tasks}</div>
              <div>Пароль: ${room.has_password ? "есть" : "не задан"}</div>
            </div>
          </article>
        `
      )
      .join("");

    grid.querySelectorAll<HTMLElement>("[data-room-id]").forEach((card) => {
      card.addEventListener("click", () => {
        roomIdInput.value = card.dataset.roomId;
        updateEnterButtonState();
        window.location.href = `/rooms/${card.dataset.roomId}/`;
      });
    });

    grid.querySelectorAll<HTMLButtonElement>("[data-room-pin-id]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        clearFlash();

        const roomId = Number(button.dataset.roomPinId);
        const nextPinnedState = button.dataset.isPinned !== "true";

        button.disabled = true;
        try {
          await api(`/api/v1/rooms/${roomId}/pin/`, {
            method: "POST",
            body: { is_pinned: nextPinnedState },
          });
          showFlash(
            nextPinnedState ? `Комната #${roomId} закреплена.` : `Комната #${roomId} откреплена.`,
            "success"
          );
          await loadRooms();
        } catch (error) {
          showFlash(getErrorMessage(error), "error");
          button.disabled = false;
        }
      });
    });
  }

  async function loadRooms() {
    if (!state.user) {
      return;
    }

    const [ownedRooms, memberRooms] = await Promise.all([api("/api/v1/rooms/"), api("/api/v1/me/rooms/")]);
    const roomMap = new Map();
    [...ownedRooms, ...memberRooms].forEach((room) => {
      if (!roomMap.has(room.id)) {
        roomMap.set(room.id, room);
      }
    });
    const rooms = sortRooms(Array.from(roomMap.values()));

    if (!rooms?.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    renderRooms(rooms);
  }

  roomIdInput?.addEventListener("input", updateEnterButtonState);
  passwordInput?.addEventListener("input", updateEnterButtonState);

  enterBtn?.addEventListener("click", async () => {
    clearFlash();
    try {
      const response = await api("/api/v1/rooms/access/", {
        method: "POST",
        body: {
          room_id: Number(roomIdInput.value),
          password: passwordInput.value,
        },
      });
      window.location.href = response.redirect_url;
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  state.pageRefresh = async () => {
    updateEnterButtonState();
    try {
      await loadRooms();
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  };
}

function initProfilePage() {
  const metrics = byId<HTMLElement>("profile-metrics");
  const summary = byId<HTMLElement>("profile-summary");
  const activity = byId<ActivityContainer>("profile-activity");
  const profileUserId = currentProfileUserId || state.user?.id || null;

  state.pageRefresh = async () => {
    if (!state.user || !profileUserId) {
      return;
    }

    try {
      const profile = await api(
        profileUserId === state.user.id ? "/api/v1/me/profile/" : `/api/v1/users/${profileUserId}/profile/`
      );
      renderProfileCharts(metrics, profile.overview);

      renderSummaryRows(summary, [
        { label: "Пользователь", value: `#${profile.id} ${profile.username}` },
        { label: "Создано комнат", value: profile.overview.created_rooms_count },
        { label: "Комнат как исполнителю", value: profile.overview.joined_rooms_count },
        { label: "Приглашения / доступы", value: profile.overview.invitations_count },
      ]);
      renderActivity(activity, profile.activity);
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  };
}

function readImageMetadata(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Не удалось прочитать изображение ${file.name}.`));
    };
    image.src = objectUrl;
  });
}

function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        name: file.name,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number(video.duration.toFixed(3)),
        frame_rate: 25,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Не удалось прочитать видео ${file.name}.`));
    };
    video.src = objectUrl;
  });
}

async function buildMediaManifest(files, datasetMode) {
  if (datasetMode === "image") {
    return Promise.all(files.map((file) => readImageMetadata(file)));
  }
  if (datasetMode === "video") {
    return Promise.all(files.map((file) => readVideoMetadata(file)));
  }
  return [];
}

function summarizeSelectedFiles(files) {
  if (!files.length) {
    return "Файлы пока не выбраны.";
  }
  if (files.length === 1) {
    return `Выбран файл: ${files[0].name}`;
  }
  const preview = files.slice(0, 3).map((file) => file.name).join(", ");
  const suffix = files.length > 3 ? ` и еще ${files.length - 3}` : "";
  return `Выбрано ${files.length} файлов: ${preview}${suffix}`;
}

function initRoomCreatePage() {
  const form = byId<HTMLFormElement>("room-create-form");
  const datasetModeSelect = byId<HTMLSelectElement>("dataset-mode-select");
  const datasetFilesInput = byId<HTMLInputElement>("dataset-files-input");
  const datasetUploadHint = byId<HTMLElement>("dataset-upload-hint");
  const datasetFilesSummary = byId<HTMLElement>("dataset-files-summary");
  const testTaskCountField = byId<HTMLElement>("test-task-count-field");
  const labelEditorSection = byId<HTMLElement>("label-editor-section");
  const labelEditorList = byId<HTMLElement>("label-editor-list");
  const addLabelBtn = byId<HTMLButtonElement>("add-label-btn");
  const crossValidationToggle = byId<HTMLInputElement>("cross-validation-enabled");
  const crossValidationCountInput = byId<HTMLInputElement>("cross-validation-count");
  const crossValidationThresholdInput = byId<HTMLInputElement>("cross-validation-threshold");

  const datasetModeConfig = {
    demo: {
      hint: "Для demo-режима будет создан встроенный набор текстовых задач без загрузки файлов.",
      accept: "",
      multiple: false,
      usesFiles: false,
      usesLabels: false,
    },
    json: {
      hint: "Загрузи один JSON-файл. Каждый элемент массива будет создан как отдельная задача.",
      accept: ".json,application/json",
      multiple: false,
      usesFiles: true,
      usesLabels: false,
    },
    image: {
      hint: "Загрузи набор фотографий. Для каждой фотографии будет создана отдельная задача с bbox-разметкой.",
      accept: "image/*",
      multiple: true,
      usesFiles: true,
      usesLabels: true,
    },
    video: {
      hint: "Загрузи набор видеороликов. Каждое видео будет автоматически разбито на кадры, и каждый кадр станет отдельной задачей как обычное фото.",
      accept: "video/*",
      multiple: true,
      usesFiles: true,
      usesLabels: true,
    },
  };

  function buildLabelRow(name = "", color = pickRandomLabelColor()) {
    const row = document.createElement("div");
    row.className = "label-editor-row";
    row.innerHTML = `
      <label class="field">
        <span>Лейбл</span>
        <input class="label-editor-row__name" type="text" placeholder="Например, car" value="${name}">
      </label>
      <label class="field field--color">
        <span>Цвет</span>
        <input class="label-editor-row__color" type="color" value="${color}">
      </label>
      <button class="btn btn--muted btn--compact" type="button">Убрать</button>
    `;

    row.querySelector("button")?.addEventListener("click", () => {
      row.remove();
    });

    return row;
  }

  function ensureInitialLabelRow() {
    if (!labelEditorList.children.length) {
      labelEditorList.appendChild(buildLabelRow());
    }
  }

  function collectLabels() {
    return Array.from(labelEditorList.querySelectorAll<HTMLElement>(".label-editor-row"))
      .map((row) => ({
        name: row.querySelector<HTMLInputElement>(".label-editor-row__name")?.value.trim() || "",
        color: row.querySelector<HTMLInputElement>(".label-editor-row__color")?.value || pickRandomLabelColor(),
      }))
      .filter((item) => item.name);
  }

  function syncDatasetMode() {
    const datasetMode = datasetModeSelect?.value || "demo";
    const config = datasetModeConfig[datasetMode];

    datasetUploadHint.textContent = config.hint;
    datasetFilesInput.disabled = !config.usesFiles;
    datasetFilesInput.accept = config.accept;
    datasetFilesInput.multiple = config.multiple;
    if (!config.usesFiles) {
      datasetFilesInput.value = "";
    }
    datasetFilesSummary.textContent = summarizeSelectedFiles(Array.from(datasetFilesInput.files || []));
    testTaskCountField.classList.toggle("hidden", datasetMode !== "demo");
    labelEditorSection.classList.toggle("hidden", !config.usesLabels);
    if (config.usesLabels) {
      ensureInitialLabelRow();
    }
  }

  function syncCrossValidationSettings() {
    const enabled = Boolean(crossValidationToggle?.checked);
    if (crossValidationCountInput) {
      crossValidationCountInput.disabled = !enabled;
    }
    if (crossValidationThresholdInput) {
      crossValidationThresholdInput.disabled = !enabled;
    }
  }

  datasetModeSelect?.addEventListener("change", syncDatasetMode);
  crossValidationToggle?.addEventListener("change", syncCrossValidationSettings);
  datasetFilesInput?.addEventListener("change", () => {
    datasetFilesSummary.textContent = summarizeSelectedFiles(Array.from(datasetFilesInput.files || []));
  });
  addLabelBtn?.addEventListener("click", () => {
    labelEditorList.appendChild(buildLabelRow());
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash();

    const rawFormData = new FormData(form);
    const datasetMode = (rawFormData.get("dataset_mode") || "demo").toString();
    const datasetFiles = Array.from(datasetFilesInput.files || []);
    const annotatorIds = (rawFormData.get("annotator_ids") || "")
      .toString()
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
    const deadlineValue = rawFormData.get("deadline");
    const labels = collectLabels();
    const crossValidationEnabled = Boolean(crossValidationToggle?.checked);
    const crossValidationCount = Number(rawFormData.get("cross_validation_annotators_count") || 1);

    if (datasetMode !== "demo" && !datasetFiles.length) {
      showFlash("Загрузи файл или набор файлов для выбранного типа датасета.", "error");
      return;
    }

    if ((datasetMode === "image" || datasetMode === "video") && !labels.length) {
      showFlash("Добавь хотя бы один лейбл для фото или видео.", "error");
      return;
    }

    if (crossValidationEnabled && crossValidationCount < 2) {
      showFlash("Для перекрестной разметки укажи минимум двух независимых исполнителей.", "error");
      return;
    }

    let mediaManifest = [];
    try {
      mediaManifest = await buildMediaManifest(datasetFiles, datasetMode);
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
      return;
    }

    const payload = new FormData();
    payload.append("title", rawFormData.get("title") || "");
    payload.append("description", rawFormData.get("description") || "");
    payload.append("password", rawFormData.get("password") || "");
    payload.append("dataset_mode", datasetMode);
    payload.append("dataset_label", rawFormData.get("dataset_label") || "Тестовый датасет");
    payload.append("test_task_count", String(Number(rawFormData.get("test_task_count") || 12)));
    payload.append("cross_validation_enabled", crossValidationEnabled ? "true" : "false");
    payload.append(
      "cross_validation_annotators_count",
      String(Number(rawFormData.get("cross_validation_annotators_count") || 1))
    );
    payload.append(
      "cross_validation_similarity_threshold",
      String(Number(rawFormData.get("cross_validation_similarity_threshold") || 80))
    );
    annotatorIds.forEach((annotatorId) => {
      payload.append("annotator_ids", String(annotatorId));
    });
    datasetFiles.forEach((file) => {
      payload.append("dataset_files", file);
    });

    if (deadlineValue) {
      payload.append("deadline", new Date(deadlineValue.toString()).toISOString());
    }
    if (labels.length) {
      payload.append("labels", JSON.stringify(labels));
    }
    if (mediaManifest.length) {
      payload.append("media_manifest", JSON.stringify(mediaManifest));
    }

    try {
      const room = await api("/api/v1/rooms/", {
        method: "POST",
        formData: payload,
      });
      showFlash(`Комната #${room.id} создана. Переходим к ней.`, "success");
      window.setTimeout(() => {
        window.location.href = `/rooms/${room.id}/`;
      }, 700);
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  syncDatasetMode();
  syncCrossValidationSettings();

  state.pageRefresh = async () => {
    syncDatasetMode();
    syncCrossValidationSettings();
  };
}

function renderCurrentTask(taskBox, task) {
  if (!taskBox) {
    return;
  }

  if (!state.appDebugMode) {
    taskBox.className = "empty-card hidden";
    return;
  }

  if (!task) {
    taskBox.className = "empty-card";
    taskBox.textContent = "Задача пока не выбрана.";
    return;
  }

  const meta = [
    `Статус: ${translateTaskStatus(task.status)}`,
    `Тип: ${translateSourceType(task.source_type)}`,
  ];
  if (task.source_name) {
    meta.push(`Файл: ${task.source_name}`);
  }
  if (task.input_payload?.width && task.input_payload?.height) {
    meta.push(`Размер: ${task.input_payload.width} × ${task.input_payload.height}`);
  }

  taskBox.className = "task-box";
  taskBox.innerHTML = `
    <strong>Задача #${task.id}</strong>
    ${meta.map((item) => `<div>${item}</div>`).join("")}
    <pre class="payload-preview">${JSON.stringify(task.input_payload, null, 2)}</pre>
  `;
}

function renderCustomerAnnotatorDetail(container, activityContainer, annotator, dashboard = null) {
  if (!annotator) {
    container.className = "empty-card";
    container.textContent = "Выбери исполнителя в списке слева.";
    activityContainer.innerHTML = "";
    return;
  }

  container.className = "summary-stack";
  renderSummaryRows(container, [
    { label: "Исполнитель", value: `#${annotator.user_id} ${annotator.username}` },
    { label: "Статус", value: translateMembership(annotator.status) },
    { label: "Роль", value: translateRole(annotator.role) },
    { label: "Выполнено", value: annotator.completed_tasks },
    { label: "В работе", value: annotator.in_progress_tasks },
    { label: "Осталось", value: annotator.remaining_tasks },
    { label: "Прогресс", value: formatPercent(annotator.progress_percent) },
  ]);

  const roleOptions = (dashboard?.membership_role_options || [])
    .map(
      (option) => `
        <option value="${escapeHtml(option.value)}" ${option.value === annotator.role ? "selected" : ""}>
          ${escapeHtml(option.label)}
        </option>
      `
    )
    .join("");

  container.insertAdjacentHTML(
    "beforeend",
    `
      <div class="role-assignment-box">
        ${
          dashboard?.actor?.can_assign_roles
            ? `
              <label class="field field--compact">
                <span>Роль участника</span>
                <select id="annotator-role-select" data-user-id="${annotator.user_id}">
                  ${roleOptions}
                </select>
              </label>
            `
            : ""
        }
        <div class="role-assignment-box__actions">
          <a class="btn btn--muted btn--compact" href="/users/${annotator.user_id}/profile/">Открыть профиль</a>
          ${
            dashboard?.actor?.can_assign_roles
              ? `
                <button id="annotator-role-submit" class="btn btn--secondary btn--compact" type="button" data-user-id="${annotator.user_id}">
                  Сохранить роль
                </button>
              `
              : ""
          }
        </div>
      </div>
    `
  );

  renderActivity(activityContainer, annotator.activity);
}

function getRoomLabelById(labelId) {
  return state.roomDashboard?.labels?.find((label) => label.id === labelId) || null;
}

function getReviewPayloadAnnotations(payload) {
  if (!payload || !Array.isArray(payload.annotations)) {
    return [];
  }
  return payload.annotations.filter(
    (annotation) =>
      annotation &&
      Array.isArray(annotation.points) &&
      annotation.points.length === 4 &&
      typeof annotation.label_id === "number"
  );
}

function getReviewPayloadTextAnnotations(payload) {
  return getReviewPayloadAnnotations(payload).filter((annotation) => typeof annotation.text === "string");
}

function buildReviewTextSummaryHtml(payload) {
  const textAnnotations = getReviewPayloadTextAnnotations(payload);
  if (!textAnnotations.length) {
    return "";
  }

  return `
    <div class="review-text-summary">
      <div class="review-text-summary__title">Текст</div>
      <div class="review-text-summary__list">
        ${textAnnotations
          .map((annotation, index) => {
            const label = getRoomLabelById(annotation.label_id);
            const title = label?.name || `Область ${index + 1}`;
            const textValue =
              typeof annotation.text === "string" && annotation.text.length
                ? annotation.text
                : "Пустой текст";

            return `
              <div class="review-text-summary__item">
                <span class="review-text-summary__label">${escapeHtml(title)}</span>
                <span class="review-text-summary__value">${escapeHtml(textValue)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderReviewGraphicPreview(container: HTMLElement | null, task, payload) {
  if (!container || !task?.source_file_url) {
    return;
  }

  const annotations = getReviewPayloadAnnotations(payload);
  if (!annotations.length) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="review-media-stage media-stage">
      <div class="review-media-canvas media-canvas">
        <img class="media-stage__asset" src="${escapeHtml(task.source_file_url)}" alt="${escapeHtml(task.source_name || `task-${task.id}`)}">
        <div class="review-media-overlay media-overlay"></div>
      </div>
    </div>
  `;

  const asset = container.querySelector<HTMLImageElement>(".media-stage__asset");
  const overlay = container.querySelector<HTMLElement>(".review-media-overlay");
  if (!asset || !overlay) {
    return;
  }

  const renderBoxes = () => {
    overlay.innerHTML = "";

    const naturalWidth = asset.naturalWidth || task.input_payload?.width || asset.clientWidth || 1;
    const naturalHeight = asset.naturalHeight || task.input_payload?.height || asset.clientHeight || 1;
    const bounds = overlay.getBoundingClientRect();
    const scaleX = bounds.width > 0 ? bounds.width / naturalWidth : 1;
    const scaleY = bounds.height > 0 ? bounds.height / naturalHeight : 1;

    annotations.forEach((annotation) => {
      const [xMin, yMin, xMax, yMax] = annotation.points;
      const label = getRoomLabelById(annotation.label_id);
      const box = document.createElement("div");
      box.className = "review-media-bbox";
      box.style.left = `${xMin * scaleX}px`;
      box.style.top = `${yMin * scaleY}px`;
      box.style.width = `${Math.max((xMax - xMin) * scaleX, 1)}px`;
      box.style.height = `${Math.max((yMax - yMin) * scaleY, 1)}px`;
      box.style.setProperty("--bbox-color", label?.color || "#B8B8B8");
      box.innerHTML = `<span class="review-media-bbox__label">${escapeHtml(label?.name || `Label #${annotation.label_id}`)}</span>`;
      overlay.appendChild(box);
    });
  };

  if (asset.complete) {
    window.requestAnimationFrame(renderBoxes);
  } else {
    asset.addEventListener("load", renderBoxes, { once: true });
  }
}

function renderReviewGraphicPreviews(container: HTMLElement, detail) {
  const consensusPreview = container.querySelector<HTMLElement>("[data-review-consensus-preview]");
  renderReviewGraphicPreview(consensusPreview, detail.task, detail.consensus_payload);

  container.querySelectorAll<HTMLElement>("[data-review-annotation-preview]").forEach((preview) => {
    const annotationId = Number(preview.dataset.annotationId);
    const annotation = (detail.annotations || []).find((item) => item.id === annotationId);
    renderReviewGraphicPreview(preview, detail.task, annotation?.result_payload);
  });
}

function renderReviewComparison(
  consensusContainer,
  annotationsContainer,
  comparisonSection,
  rejectBtn,
  detail
) {
  if (!comparisonSection || !consensusContainer || !annotationsContainer || !rejectBtn) {
    return;
  }

  if (!detail) {
    comparisonSection.classList.add("hidden");
    consensusContainer.className = "empty-card";
    consensusContainer.textContent = "Выбери размеченный объект в списке выше.";
    annotationsContainer.className = "empty-card";
    annotationsContainer.textContent = "Выбери размеченный объект в списке выше.";
    rejectBtn.classList.add("hidden");
    rejectBtn.removeAttribute("data-task-id");
    return;
  }

  comparisonSection.classList.remove("hidden");
  rejectBtn.classList.remove("hidden");
  rejectBtn.dataset.taskId = String(detail.task.id);

  const consensusHtml = detail.consensus_payload
    ? `
        <div class="review-media-preview hidden" data-review-consensus-preview></div>
        ${buildReviewTextSummaryHtml(detail.consensus_payload)}
        ${
          state.appDebugMode
            ? `<pre class="payload-preview">${escapeHtml(JSON.stringify(detail.consensus_payload, null, 2))}</pre>`
            : ""
        }
      `
    : '<div class="panel-note">Финальный payload для этой задачи пока отсутствует.</div>';

  const annotationsHtml = (detail.annotations || [])
    .map(
      (annotation) => `
        <section class="review-annotation-entry">
          <header class="review-annotation-entry__head">
            <strong>Аннотация пользователя</strong>
            <span>${escapeHtml(annotation.annotator_username || `#${annotation.annotator_id}`)}</span>
            <span>Раунд ${escapeHtml(annotation.round_number)} · ${escapeHtml(formatDate(annotation.submitted_at))}</span>
          </header>
          <div class="review-media-preview hidden" data-review-annotation-preview data-annotation-id="${escapeHtml(annotation.id)}"></div>
          ${buildReviewTextSummaryHtml(annotation.result_payload)}
          ${
            state.appDebugMode
              ? `<pre class="payload-preview">${escapeHtml(JSON.stringify(annotation.result_payload, null, 2))}</pre>`
              : ""
          }
        </section>
      `
    )
    .join("");

  consensusContainer.className = "review-comparison-stack";
  consensusContainer.innerHTML = consensusHtml;
  annotationsContainer.className = "review-comparison-stack";
  annotationsContainer.innerHTML =
    annotationsHtml || '<div class="panel-note">Аннотации для этой задачи пока отсутствуют.</div>';

  renderReviewGraphicPreviews(comparisonSection, detail);
}

function renderReviewTaskDetail(container, detail) {
  if (!detail) {
    container.className = "empty-card";
    container.textContent = "Выбери размеченный объект в списке слева.";
    return;
  }

  const task = detail.task;
  const sourcePreview = task.source_file_url
    ? (task.source_type === "image"
        ? `<img class="review-task-preview" src="${escapeHtml(task.source_file_url)}" alt="${escapeHtml(task.source_name || `task-${task.id}`)}">`
        : `<video class="review-task-preview" src="${escapeHtml(task.source_file_url)}" controls preload="metadata"></video>`)
    : "";

  container.className = "summary-stack review-task-detail";
  container.innerHTML = `
    <div class="summary-row"><span>Задача</span><strong>#${escapeHtml(task.id)}</strong></div>
    <div class="summary-row"><span>Статус</span><strong>${escapeHtml(translateTaskStatus(task.status))}</strong></div>
    <div class="summary-row"><span>Тип</span><strong>${escapeHtml(translateSourceType(task.source_type))}</strong></div>
    <div class="summary-row"><span>Раунд</span><strong>${escapeHtml(task.current_round)}</strong></div>
    <div class="summary-row"><span>Сходство</span><strong>${task.validation_score == null ? "Не рассчитано" : `${escapeHtml(task.validation_score)}%`}</strong></div>
    ${sourcePreview}
  `;
}

function renderRoomDashboardHeader(title, subtitle, roomHeaderMeta, roomMetrics, dashboard) {
  title.textContent = dashboard.room.title;
  subtitle.textContent = dashboard.room.description || "Описание для этой комнаты пока не заполнено.";
  roomHeaderMeta.innerHTML = `
    <div class="summary-stack room-header-meta__stack">
      <div class="summary-row"><span>ID комнаты</span><strong>#${dashboard.room.id}</strong></div>
      <div class="summary-row"><span>Датасет</span><strong>${dashboard.room.dataset_label || "Тестовый датасет"}</strong></div>
      <div class="summary-row"><span>Тип</span><strong>${translateDatasetMode(dashboard.room.dataset_type)}</strong></div>
      <div class="summary-row"><span>Дедлайн</span><strong>${formatDate(dashboard.room.deadline)}</strong></div>
      <div class="summary-row"><span>Доступ</span><strong>${dashboard.room.has_password ? "С паролем" : "Без пароля"}</strong></div>
      ${
        dashboard.actor.can_delete_room
          ? '<button id="detail-delete-room-btn" class="btn btn--danger room-header-meta__delete" type="button">Удалить комнату</button>'
          : ""
      }
    </div>
  `;

  renderRoomProgressChart(roomMetrics, dashboard.overview);
}

function renderAnnotatorOverview(summaryContainer, activityContainer, dashboard) {
  renderSummaryRows(summaryContainer, [
    { label: "Роль в комнате", value: translateRole(dashboard.actor.role) },
    { label: "Выполнено мной", value: dashboard.annotator_stats.completed_tasks },
    { label: "В работе", value: dashboard.annotator_stats.in_progress_tasks },
    { label: "Осталось", value: dashboard.annotator_stats.remaining_tasks },
    { label: "Мой прогресс", value: formatPercent(dashboard.annotator_stats.progress_percent) },
  ]);
  renderActivity(activityContainer, dashboard.annotator_stats.activity);
}

function renderEmptyTaskBox(taskBox, message) {
  if (!taskBox) {
    return;
  }

  if (!state.appDebugMode) {
    taskBox.className = "empty-card hidden";
    return;
  }

  taskBox.className = "empty-card";
  taskBox.textContent = message;
}

function renderStaticLabels(container, labels) {
  if (!container) {
    return;
  }

  if (!labels?.length) {
    container.innerHTML = '<div class="empty-card">Лейблы для этой комнаты пока не заданы.</div>';
    return;
  }

  container.innerHTML = labels
    .map(
      (label) => `
        <span class="label-chip label-chip--static" style="--label-color: ${label.color}">
          <i></i>
          <span>${label.name}</span>
        </span>
      `
    )
    .join("");
}

async function downloadRoomExport(roomId, exportFormat) {
  const response = await fetch(`/api/v1/rooms/${roomId}/export/?export_format=${encodeURIComponent(exportFormat)}`, {
    method: "GET",
    headers: {
      "X-User-Id": String(state.user.id),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { detail: text || `HTTP ${response.status}` };
    }
    throw new Error(data?.detail || `HTTP ${response.status}`);
  }

  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = filenameMatch?.[1] || `room-${roomId}-${exportFormat}`;
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

function initRoomDetailPage() {
  if (!currentRoomId) {
    showFlash("Не удалось определить ID комнаты из URL.", "error");
    state.pageRefresh = async () => {};
    return;
  }

  const title = byId<HTMLElement>("room-title");
  const subtitle = byId<HTMLElement>("room-subtitle");
  const roomHeaderMeta = byId<HTMLElement>("room-header-meta");
  const roomMetrics = byId<HTMLElement>("room-metrics");
  const annotatorWorkspace = byId<HTMLElement>("annotator-workspace");
  const annotatorManageSide = byId<HTMLElement>("annotator-manage-side");
  const customerWorkspace = byId<HTMLElement>("customer-workspace");
  const annotatorSummary = byId<HTMLElement>("annotator-summary");
  const annotatorActivity = byId<ActivityContainer>("annotator-activity");
  const workBtn = byId<HTMLButtonElement>("detail-work-btn");
  const workNote = byId<HTMLElement>("detail-work-note");
  const annotatorsList = byId<HTMLElement>("annotators-list");
  const annotatorDetailPanel = byId<HTMLElement>("annotator-detail-panel");
  const annotatorDetailActivity = byId<ActivityContainer>("annotator-detail-activity");
  const inviteForm = byId<HTMLFormElement>("detail-invite-form");
  const inviteUserIdInput = byId<HTMLInputElement>("detail-invite-user-id");
  const exportPanel = byId<HTMLElement>("detail-export-panel");
  const invitePanel = byId<HTMLElement>("detail-invite-panel");
  const customerLabels = byId<HTMLElement>("customer-labels");
  const exportFormatSelect = byId<HTMLSelectElement>("detail-export-format");
  const exportBtn = byId<HTMLButtonElement>("detail-export-btn");
  const reviewTasksList = byId<HTMLElement>("review-tasks-list");
  const reviewTaskDetail = byId<HTMLElement>("review-task-detail");
  const reviewComparisonSection = byId<HTMLElement>("review-comparison-section");
  const reviewConsensusDetail = byId<HTMLElement>("review-consensus-detail");
  const reviewAnnotationsDetail = byId<HTMLElement>("review-annotations-detail");
  const rejectReviewTaskBtn = byId<HTMLButtonElement>("reject-review-task-btn");
  const annotatorsSearchInput = byId<HTMLInputElement>("detail-annotators-search");
  const reviewSearchInput = byId<HTMLInputElement>("detail-review-search");

  function normalizeSearchValue(value) {
    return String(value || "").trim().toLowerCase();
  }

  function bindDeleteRoomButton() {
    const deleteRoomBtn = byId<HTMLButtonElement>("detail-delete-room-btn");
    deleteRoomBtn?.addEventListener("click", async () => {
      clearFlash();
      const shouldDelete = window.confirm(
        "Удалить комнату? Это действие удалит саму комнату, задачи, участников и результаты разметки без возможности восстановления."
      );
      if (!shouldDelete) {
        return;
      }

      try {
        await api(`/api/v1/rooms/${currentRoomId}/`, { method: "DELETE" });
        window.location.href = "/rooms/";
      } catch (error) {
        showFlash(getErrorMessage(error), "error");
      }
    });
  }

  function updateAnnotatorWorkAction(dashboard) {
    const isReadyForWork = dashboard.actor.can_annotate;

    workBtn.disabled = false;
    workBtn.dataset.action = isReadyForWork ? "work" : "join";
    workBtn.textContent = isReadyForWork ? "Приступить к работе" : "Вступить в комнату";
    workNote.textContent = isReadyForWork
      ? "Обзор комнаты открыт. Вход в комнату, получение задач и отправка результата доступны только в отдельной рабочей среде."
      : "Ты приглашен в комнату. Сначала подтверди вступление, после этого кнопка переключится на переход в рабочую среду.";
  }

  function bindAnnotatorRoleControls(dashboard, annotator) {
    const roleSelect = byId<HTMLSelectElement>("annotator-role-select");
    const roleSubmit = byId<HTMLButtonElement>("annotator-role-submit");

    if (!dashboard.actor.can_assign_roles || !annotator || !roleSelect || !roleSubmit) {
      return;
    }

    roleSubmit.addEventListener("click", async () => {
      clearFlash();
      roleSubmit.disabled = true;

      try {
        await api(`/api/v1/rooms/${currentRoomId}/memberships/${annotator.user_id}/role/`, {
          method: "POST",
          body: { role: roleSelect.value },
        });
        showFlash(`Роль пользователя #${annotator.user_id} обновлена.`, "success");
        await loadDashboard();
      } catch (error) {
        showFlash(getErrorMessage(error), "error");
      } finally {
        roleSubmit.disabled = false;
      }
    });
  }

  async function loadDashboard() {
    const dashboard = await api(`/api/v1/rooms/${currentRoomId}/dashboard/`);
    state.roomDashboard = dashboard;

    renderRoomDashboardHeader(title, subtitle, roomHeaderMeta, roomMetrics, dashboard);

    if (dashboard.actor.can_annotate) {
      annotatorWorkspace.classList.remove("hidden");
      annotatorWorkspace.classList.toggle("workspace-grid--owner-manage", dashboard.actor.can_manage);
      const managePanelsCount = Number(Boolean(dashboard.actor.can_export)) + Number(Boolean(dashboard.actor.can_invite));
      annotatorManageSide?.classList.toggle("hidden", managePanelsCount === 0);
      annotatorManageSide?.classList.toggle("workspace-grid__side--stack-single", managePanelsCount === 1);
      exportPanel?.classList.toggle("hidden", !dashboard.actor.can_export);
      invitePanel?.classList.toggle("hidden", !dashboard.actor.can_invite);

      renderAnnotatorOverview(annotatorSummary, annotatorActivity, dashboard);
      updateAnnotatorWorkAction(dashboard);
    } else {
      annotatorWorkspace.classList.add("hidden");
      annotatorWorkspace.classList.remove("workspace-grid--owner-manage");
      annotatorManageSide?.classList.add("hidden");
      exportPanel?.classList.add("hidden");
      invitePanel?.classList.add("hidden");
    }

    if (dashboard.actor.can_review) {
      customerWorkspace.classList.remove("hidden");
      renderCustomerView(dashboard);
      state.reviewTasks = [];
      await loadReviewTasks();
    } else {
      customerWorkspace.classList.add("hidden");
    }

    if (dashboard.actor.can_delete_room) {
      bindDeleteRoomButton();
    }
  }

  function renderCustomerView(dashboard) {
    renderStaticLabels(customerLabels, dashboard.labels);
    exportFormatSelect.innerHTML = (dashboard.export_formats || [])
      .map((item) => `<option value="${item.value}">${item.label}</option>`)
      .join("");
    exportBtn.disabled = !dashboard.export_formats?.length;

    const searchTerm = normalizeSearchValue(annotatorsSearchInput?.value);
    const filteredAnnotators = (dashboard.annotators || []).filter((annotator) => {
      if (!searchTerm) {
        return true;
      }

      return [
        annotator.username,
        annotator.user_id,
        translateMembership(annotator.status),
        translateRole(annotator.role),
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });

    if (!dashboard.annotators?.length) {
      annotatorsList.innerHTML = '<div class="empty-card">В этой комнате пока нет исполнителей.</div>';
      state.selectedAnnotatorUserId = null;
      renderCustomerAnnotatorDetail(annotatorDetailPanel, annotatorDetailActivity, null);
      return;
    }

    if (!filteredAnnotators.length) {
      annotatorsList.innerHTML = '<div class="empty-card">По этому запросу исполнители не найдены.</div>';
      if (!state.selectedAnnotatorUserId) {
        renderCustomerAnnotatorDetail(annotatorDetailPanel, annotatorDetailActivity, null);
      }
      return;
    }

    annotatorsList.innerHTML = filteredAnnotators
      .map(
        (annotator) => `
          <button class="annotator-row ${annotator.user_id === state.selectedAnnotatorUserId ? "is-active" : ""}" type="button" data-user-id="${annotator.user_id}">
            <div class="annotator-row__meta">
              <strong>${annotator.username}</strong>
              <span>${translateMembership(annotator.status)} · ${translateRole(annotator.role)}</span>
            </div>
            <div class="annotator-row__brief">
              <div>${formatPercent(annotator.progress_percent)}</div>
              <div>${annotator.completed_tasks} из ${dashboard.overview.total_tasks}</div>
            </div>
          </button>
        `
      )
      .join("");

    const activeAnnotator = filteredAnnotators.find((item) => item.user_id === state.selectedAnnotatorUserId) || null;

    if (activeAnnotator) {
      annotatorDetailPanel.dataset.userId = String(activeAnnotator.user_id);
      renderCustomerAnnotatorDetail(annotatorDetailPanel, annotatorDetailActivity, activeAnnotator, dashboard);
      bindAnnotatorRoleControls(dashboard, activeAnnotator);
    } else {
      delete annotatorDetailPanel.dataset.userId;
      renderCustomerAnnotatorDetail(annotatorDetailPanel, annotatorDetailActivity, null, dashboard);
    }

    annotatorsList.querySelectorAll<HTMLButtonElement>(".annotator-row").forEach((row) => {
      row.addEventListener("click", async () => {
        const annotator = filteredAnnotators.find((item) => item.user_id === Number(row.dataset.userId));
        if (!annotator) {
          return;
        }

        state.selectedAnnotatorUserId =
          state.selectedAnnotatorUserId === annotator.user_id ? null : annotator.user_id;
        renderCustomerView(dashboard);
        await loadReviewTasks();
      });
    });
  }

  async function loadReviewTaskDetail(taskId) {
    const detail = await api(`/api/v1/tasks/${taskId}/review/`);
    state.selectedReviewTaskId = taskId;
    renderReviewTaskDetail(reviewTaskDetail, detail);
    renderReviewComparison(
      reviewConsensusDetail,
      reviewAnnotationsDetail,
      reviewComparisonSection,
      rejectReviewTaskBtn,
      detail
    );
  }

  async function loadReviewTasks() {
    if (!reviewTasksList || !reviewTaskDetail) {
      return;
    }

    if (!state.reviewTasks.length) {
      const tasks = await api(`/api/v1/rooms/${currentRoomId}/review/tasks/`);
      state.reviewTasks = tasks || [];
    }

    const searchTerm = normalizeSearchValue(reviewSearchInput?.value);
    const filteredTasks = state.reviewTasks.filter((task) => {
      const matchesAnnotator =
        !state.selectedAnnotatorUserId ||
        (task.annotator_ids || []).includes(state.selectedAnnotatorUserId);

      if (!matchesAnnotator) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      return [
        `задача ${task.id}`,
        task.source_name,
        translateSourceType(task.source_type),
        task.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });

    if (!state.reviewTasks.length) {
      reviewTasksList.innerHTML = '<div class="empty-card">В итоговой выборке пока нет объектов для проверки.</div>';
      renderReviewTaskDetail(reviewTaskDetail, null);
      renderReviewComparison(
        reviewConsensusDetail,
        reviewAnnotationsDetail,
        reviewComparisonSection,
        rejectReviewTaskBtn,
        null
      );
      return;
    }

    if (!filteredTasks.length) {
      reviewTasksList.innerHTML = '<div class="empty-card">По этому запросу объекты не найдены.</div>';
      renderReviewTaskDetail(reviewTaskDetail, null);
      renderReviewComparison(
        reviewConsensusDetail,
        reviewAnnotationsDetail,
        reviewComparisonSection,
        rejectReviewTaskBtn,
        null
      );
      return;
    }

    reviewTasksList.innerHTML = filteredTasks
      .map(
        (task) => `
          <button class="annotator-row review-task-row ${task.id === state.selectedReviewTaskId ? "is-active" : ""}" type="button" data-task-id="${task.id}">
            <div class="annotator-row__meta">
              <strong>Задача #${task.id}</strong>
              <span>${escapeHtml(task.source_name || translateSourceType(task.source_type))}</span>
            </div>
            <div class="annotator-row__brief">
              <div>${task.validation_score == null ? "Без score" : `${task.validation_score}%`}</div>
              <div>${task.annotations_count} аннотац.</div>
            </div>
          </button>
        `
      )
      .join("");

    const selectedTaskId =
      filteredTasks.find((item) => item.id === state.selectedReviewTaskId)?.id ?? filteredTasks[0].id;

    reviewTasksList.querySelectorAll<HTMLButtonElement>(".review-task-row").forEach((row) => {
      row.classList.toggle("is-active", Number(row.dataset.taskId) === selectedTaskId);
      row.addEventListener("click", async () => {
        const taskId = Number(row.dataset.taskId);
        reviewTasksList.querySelectorAll<HTMLButtonElement>(".review-task-row").forEach((item) => {
          item.classList.toggle("is-active", Number(item.dataset.taskId) === taskId);
        });
        await loadReviewTaskDetail(taskId);
      });
    });

    await loadReviewTaskDetail(selectedTaskId);
  }

  inviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash();

    const invitedUserId = Number(inviteUserIdInput.value);
    if (!Number.isInteger(invitedUserId) || invitedUserId <= 0) {
      showFlash("Укажи корректный ID пользователя.", "error");
      return;
    }

    try {
      await api(`/api/v1/rooms/${currentRoomId}/invite/`, {
        method: "POST",
        body: { annotator_id: invitedUserId },
      });
      inviteUserIdInput.value = "";
      showFlash(`Пользователь #${invitedUserId} добавлен в комнату.`, "success");
      await loadDashboard();
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  workBtn?.addEventListener("click", async () => {
    clearFlash();
    if (workBtn.dataset.action === "join") {
      try {
        await api(`/api/v1/rooms/${currentRoomId}/join/`, { method: "POST", body: {} });
        showFlash("Ты вступил в комнату. Теперь можно переходить к задачам.", "success");
        await loadDashboard();
      } catch (error) {
        showFlash(getErrorMessage(error), "error");
      }
      return;
    }

    window.location.href = `/rooms/${currentRoomId}/work/`;
  });

  exportBtn?.addEventListener("click", async () => {
    clearFlash();
    try {
      await downloadRoomExport(currentRoomId, exportFormatSelect.value || "native_json");
      showFlash("Файл с размеченным датасетом подготовлен.", "success");
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  annotatorsSearchInput?.addEventListener("input", () => {
    if (state.roomDashboard?.actor.can_review) {
      renderCustomerView(state.roomDashboard);
    }
  });

  reviewSearchInput?.addEventListener("input", async () => {
    if (state.roomDashboard?.actor.can_review) {
      await loadReviewTasks();
    }
  });

  rejectReviewTaskBtn?.addEventListener("click", async () => {
    const taskId = Number(rejectReviewTaskBtn.dataset.taskId);
    if (!taskId) {
      return;
    }

    clearFlash();
    const shouldReject = window.confirm(
      "Отклонить эту разметку? Задача будет исключена из итоговой выборки и отправлена на повторную разметку."
    );
    if (!shouldReject) {
      return;
    }

    try {
      await api(`/api/v1/tasks/${taskId}/reject/`, {
        method: "POST",
        body: {},
      });
      state.selectedReviewTaskId = null;
      showFlash(`Разметка по задаче #${taskId} отклонена. Объект возвращен в пул.`, "success");
      await loadDashboard();
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  state.pageRefresh = async () => {
    if (!state.user) {
      return;
    }

    try {
      state.reviewTasks = [];
      await loadDashboard();
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  };
}

function createMediaAnnotationEditor({
  mediaTool,
  instructions,
  labelPalette,
  activeLabelNote,
  zoomToolbar,
  zoomRange,
  zoomOutBtn,
  zoomInBtn,
  zoomResetBtn,
  mediaStage,
  annotationList,
  clearBtn,
  resultJson,
  resultLabel,
  submitBtn,
}: {
  mediaTool: HTMLElement;
  instructions: HTMLElement;
  labelPalette: HTMLElement;
  activeLabelNote: HTMLElement;
  zoomToolbar: HTMLElement | null;
  zoomRange: HTMLInputElement | null;
  zoomOutBtn: HTMLButtonElement | null;
  zoomInBtn: HTMLButtonElement | null;
  zoomResetBtn: HTMLButtonElement | null;
  mediaStage: HTMLElement;
  annotationList: HTMLElement;
  clearBtn: HTMLButtonElement | null;
  resultJson: HTMLTextAreaElement;
  resultLabel: HTMLElement;
  submitBtn: HTMLButtonElement | null;
}) {
  const editor = {
    annotations: [],
    activeLabelId: null,
    mediaElement: null,
    wrapperElement: null,
    overlayElement: null,
    boxElements: new Map<string, HTMLButtonElement>(),
    draftElement: null,
    draftStart: null,
    dragState: null,
    resizeState: null,
    panState: null,
    panPointerId: null,
    suppressLabelClickUntil: 0,
    eventsAttached: false,
    keyboardAttached: false,
    isPanKeyActive: false,
    activePointerId: null,
    interactionMetrics: null,
    zoomLevel: 1,
    minZoom: 1,
    maxZoom: 4,
    zoomStep: 0.25,
    baseCanvasWidth: 0,
    baseCanvasHeight: 0,
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getLatestPointerSample(event: PointerEvent) {
    const coalescedEvents = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    return coalescedEvents.length ? coalescedEvents[coalescedEvents.length - 1] : event;
  }

  function isEditableTarget(target) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || Boolean(target.closest("input, textarea, select, button, [contenteditable='true']")))
    );
  }

  function getLabels() {
    return state.roomDashboard?.labels || [];
  }

  function getLabelById(labelId) {
    return getLabels().find((label) => label.id === labelId) || null;
  }

  function getFrameRate() {
    return Number(state.currentTask?.input_payload?.frame_rate) || 25;
  }

  function getCurrentFrame() {
    if (state.currentTask?.source_type !== "video" || !editor.mediaElement) {
      return 0;
    }
    return Math.max(0, Math.round(editor.mediaElement.currentTime * getFrameRate()));
  }

  function isVisibleOnCurrentFrame(annotation) {
    if (state.currentTask?.source_type !== "video") {
      return true;
    }
    return annotation.frame === getCurrentFrame();
  }

  function setActiveLabel(labelId) {
    editor.activeLabelId = labelId;
    const label = getLabelById(labelId);
    activeLabelNote.textContent = label
      ? `Активный label: ${label.name}. Новые выделения получат его сразу, зажатие перемещает область, нижний правый угол меняет размер, а одиночный клик меняет ее label на активный.`
      : "Активный label пока не выбран.";

    labelPalette.querySelectorAll<HTMLButtonElement>("[data-label-id]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.labelId) === labelId);
    });
  }

  function getNaturalSize() {
    if (!editor.mediaElement) {
      return { width: 0, height: 0 };
    }
    if (state.currentTask?.source_type === "video") {
      return {
        width: editor.mediaElement.videoWidth || mediaStage.clientWidth,
        height: editor.mediaElement.videoHeight || mediaStage.clientHeight,
      };
    }
    return {
      width: editor.mediaElement.naturalWidth || mediaStage.clientWidth,
      height: editor.mediaElement.naturalHeight || mediaStage.clientHeight,
    };
  }

  function getOverlayScale() {
    if (!editor.overlayElement) {
      return { scaleX: 1, scaleY: 1 };
    }

    const bounds = editor.overlayElement.getBoundingClientRect();
    const naturalSize = getNaturalSize();
    return {
      scaleX: naturalSize.width > 0 && bounds.width > 0 ? bounds.width / naturalSize.width : 1,
      scaleY: naturalSize.height > 0 && bounds.height > 0 ? bounds.height / naturalSize.height : 1,
    };
  }

  function measureInteractionMetrics() {
    if (!editor.overlayElement) {
      return null;
    }

    const bounds = editor.overlayElement.getBoundingClientRect();
    const naturalSize = getNaturalSize();
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      scaleToNaturalX: bounds.width > 0 ? naturalSize.width / bounds.width : 1,
      scaleToNaturalY: bounds.height > 0 ? naturalSize.height / bounds.height : 1,
    };
  }

  function beginPointerInteraction(pointerId) {
    editor.activePointerId = pointerId;
    editor.interactionMetrics = measureInteractionMetrics();
    if (editor.overlayElement) {
      editor.overlayElement.setPointerCapture(pointerId);
    }
    return editor.interactionMetrics;
  }

  function endPointerInteraction(pointerId = editor.activePointerId) {
    if (pointerId !== null && editor.overlayElement?.hasPointerCapture(pointerId)) {
      editor.overlayElement.releasePointerCapture(pointerId);
    }
    editor.activePointerId = null;
    editor.interactionMetrics = null;
  }

  function shouldStartPanning(event: PointerEvent) {
    if (!editor.mediaElement || editor.zoomLevel <= 1) {
      return false;
    }
    return event.button === 1 || (event.button === 0 && editor.isPanKeyActive);
  }

  function updateStageInteractionState() {
    const canPan = Boolean(editor.mediaElement && editor.zoomLevel > 1);
    mediaStage.classList.toggle("media-stage--zoomed", canPan);
    mediaStage.classList.toggle("media-stage--pan-ready", canPan && editor.isPanKeyActive && !editor.panState);
    mediaStage.classList.toggle("media-stage--panning", Boolean(editor.panState));
  }

  function startPanning(event: PointerEvent) {
    if (editor.panState || !shouldStartPanning(event) || editor.activePointerId !== null) {
      return false;
    }

    const sample = getLatestPointerSample(event);
    event.preventDefault();
    event.stopPropagation();
    editor.panPointerId = event.pointerId;
    editor.panState = {
      startClientX: sample.clientX,
      startClientY: sample.clientY,
      startScrollLeft: mediaStage.scrollLeft,
      startScrollTop: mediaStage.scrollTop,
      moved: false,
    };
    mediaStage.setPointerCapture(event.pointerId);
    updateStageInteractionState();
    return true;
  }

  function updatePan(event: PointerEvent) {
    if (!editor.panState || editor.panPointerId !== event.pointerId) {
      return;
    }

    const sample = getLatestPointerSample(event);
    const deltaX = sample.clientX - editor.panState.startClientX;
    const deltaY = sample.clientY - editor.panState.startClientY;
    editor.panState.moved =
      editor.panState.moved || Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
    mediaStage.scrollLeft = Math.max(editor.panState.startScrollLeft - deltaX, 0);
    mediaStage.scrollTop = Math.max(editor.panState.startScrollTop - deltaY, 0);
    event.preventDefault();
  }

  function finishPanning(event: PointerEvent | null = null) {
    if (event && editor.panPointerId !== event.pointerId) {
      return;
    }
    if (!editor.panState) {
      return;
    }

    if (editor.panState.moved) {
      editor.suppressLabelClickUntil = Date.now() + 150;
    }
    if (editor.panPointerId !== null && mediaStage.hasPointerCapture(editor.panPointerId)) {
      mediaStage.releasePointerCapture(editor.panPointerId);
    }
    editor.panState = null;
    editor.panPointerId = null;
    updateStageInteractionState();
  }

  function normalizePoints(points, naturalWidth, naturalHeight) {
    const xMin = clamp(Math.min(points[0], points[2]), 0, naturalWidth);
    const yMin = clamp(Math.min(points[1], points[3]), 0, naturalHeight);
    const xMax = clamp(Math.max(points[0], points[2]), 0, naturalWidth);
    const yMax = clamp(Math.max(points[1], points[3]), 0, naturalHeight);
    return [Math.round(xMin), Math.round(yMin), Math.round(xMax), Math.round(yMax)];
  }

  function commitAnnotationPoints(annotation, metrics = editor.interactionMetrics) {
    const naturalWidth = metrics?.naturalWidth || getNaturalSize().width || 0;
    const naturalHeight = metrics?.naturalHeight || getNaturalSize().height || 0;
    annotation.points = normalizePoints(annotation.points, naturalWidth, naturalHeight);
  }

  function updateZoomControls() {
    if (!zoomToolbar) {
      return;
    }

    const hasMedia = Boolean(editor.mediaElement && editor.wrapperElement);
    zoomToolbar.classList.toggle("hidden", !hasMedia);

    const zoomPercent = Math.round(editor.zoomLevel * 100);
    if (zoomRange) {
      zoomRange.value = String(zoomPercent);
      zoomRange.disabled = !hasMedia;
    }
    if (zoomResetBtn) {
      zoomResetBtn.textContent = `${zoomPercent}%`;
      zoomResetBtn.disabled = !hasMedia || editor.zoomLevel === 1;
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = !hasMedia || editor.zoomLevel <= editor.minZoom;
    }
    if (zoomInBtn) {
      zoomInBtn.disabled = !hasMedia || editor.zoomLevel >= editor.maxZoom;
    }
    updateStageInteractionState();
  }

  function captureBaseCanvasSize() {
    if (!editor.mediaElement) {
      return false;
    }

    if (editor.zoomLevel > 1 && editor.baseCanvasWidth > 0 && editor.baseCanvasHeight > 0) {
      return true;
    }

    const width = editor.mediaElement.clientWidth || editor.mediaElement.getBoundingClientRect().width;
    const height = editor.mediaElement.clientHeight || editor.mediaElement.getBoundingClientRect().height;
    if (!width || !height) {
      return false;
    }

    editor.baseCanvasWidth = width;
    editor.baseCanvasHeight = height;
    return true;
  }

  function applyZoom(nextZoom, options: { preserveViewport?: boolean; anchorClientX?: number; anchorClientY?: number; force?: boolean } = {}) {
    if (!editor.wrapperElement) {
      editor.zoomLevel = editor.minZoom;
      updateZoomControls();
      return;
    }

    const previousZoom = editor.zoomLevel;
    const clampedZoom = clamp(nextZoom, editor.minZoom, editor.maxZoom);
    const shouldPreserveViewport = options.preserveViewport !== false;
    const force = Boolean(options.force);

    if (!force && Math.abs(previousZoom - clampedZoom) < 0.001) {
      updateZoomControls();
      return;
    }

    const stageRect = mediaStage.getBoundingClientRect();
    const anchorX =
      typeof options.anchorClientX === "number" ? options.anchorClientX - stageRect.left : mediaStage.clientWidth / 2;
    const anchorY =
      typeof options.anchorClientY === "number" ? options.anchorClientY - stageRect.top : mediaStage.clientHeight / 2;
    const contentX = mediaStage.scrollLeft + anchorX;
    const contentY = mediaStage.scrollTop + anchorY;

    if (clampedZoom <= 1) {
      finishPanning();
      editor.zoomLevel = 1;
      editor.wrapperElement.classList.remove("media-canvas--zoom-ready");
      editor.wrapperElement.style.width = "";
      editor.wrapperElement.style.height = "";
      updateZoomControls();
      window.requestAnimationFrame(() => {
        renderBoxes();
        if (shouldPreserveViewport && previousZoom > 1) {
          const zoomRatio = 1 / previousZoom;
          mediaStage.scrollLeft = Math.max(contentX * zoomRatio - anchorX, 0);
          mediaStage.scrollTop = Math.max(contentY * zoomRatio - anchorY, 0);
        }
      });
      return;
    }

    if (!captureBaseCanvasSize()) {
      return;
    }

    editor.zoomLevel = clampedZoom;
    editor.wrapperElement.classList.add("media-canvas--zoom-ready");
    editor.wrapperElement.style.width = `${Math.round(editor.baseCanvasWidth * clampedZoom)}px`;
    editor.wrapperElement.style.height = `${Math.round(editor.baseCanvasHeight * clampedZoom)}px`;
    updateZoomControls();
    window.requestAnimationFrame(() => {
      renderBoxes();
      if (shouldPreserveViewport) {
        const zoomRatio = clampedZoom / previousZoom;
        mediaStage.scrollLeft = Math.max(contentX * zoomRatio - anchorX, 0);
        mediaStage.scrollTop = Math.max(contentY * zoomRatio - anchorY, 0);
      }
    });
  }

  function handleStageResize() {
    if (editor.zoomLevel <= 1) {
      captureBaseCanvasSize();
    }
    renderBoxes();
  }

  function handleStageWheel(event: WheelEvent) {
    if (!event.ctrlKey || !editor.mediaElement || !editor.wrapperElement) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY < 0 ? editor.zoomStep : -editor.zoomStep;
    applyZoom(editor.zoomLevel + direction, {
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
    });
  }

  function syncCanvasViewport() {
    if (!editor.mediaElement || !editor.wrapperElement) {
      return;
    }

    if (editor.zoomLevel > 1) {
      applyZoom(editor.zoomLevel, { preserveViewport: false, force: true });
      return;
    }

    captureBaseCanvasSize();
    updateZoomControls();
    renderBoxes();
  }

  function buildPayload() {
    return {
      annotations: editor.annotations
        .filter((annotation) => annotation.label_id)
        .map((annotation) => ({
          type: annotation.type,
          label_id: annotation.label_id,
          points: normalizePoints(annotation.points, getNaturalSize().width || 0, getNaturalSize().height || 0),
          frame: annotation.frame,
          attributes: annotation.attributes,
          occluded: annotation.occluded,
        })),
    };
  }

  function updateSubmitState() {
    if (!submitBtn) {
      return;
    }
    submitBtn.disabled = !state.currentTask || editor.annotations.some((annotation) => !annotation.label_id);
  }

  function updateResultPreview() {
    resultJson.value = JSON.stringify(buildPayload(), null, 2);
    updateSubmitState();
  }

  function removeAnnotation(localId) {
    editor.annotations = editor.annotations.filter((annotation) => annotation.local_id !== localId);
    render();
  }

  function updateClearButtonVisibility() {
    clearBtn?.classList.toggle("hidden", !editor.annotations.length);
  }

  function renderAnnotationList() {
    if (!editor.annotations.length) {
      annotationList.className = "annotation-list empty-card";
      annotationList.textContent = "Разметка пока отсутствует.";
      return;
    }

    annotationList.className = "annotation-list";
    annotationList.innerHTML = editor.annotations
      .map((annotation, index) => {
        const label = getLabelById(annotation.label_id);
        return `
          <div class="annotation-row ${isVisibleOnCurrentFrame(annotation) ? "is-current" : ""}">
            <div class="annotation-row__meta">
              <strong>#${index + 1}</strong>
              <span>${label ? label.name : "Без лейбла"}</span>
              <small>frame ${annotation.frame}</small>
            </div>
            <div class="annotation-row__points">[${annotation.points.join(", ")}]</div>
            <button class="btn btn--muted btn--compact" type="button" data-remove-id="${annotation.local_id}">Удалить</button>
          </div>
        `;
      })
      .join("");

    annotationList.querySelectorAll<HTMLButtonElement>("[data-remove-id]").forEach((button) => {
      button.addEventListener("click", () => {
        removeAnnotation(button.dataset.removeId);
      });
    });
  }

  function removeBoxElement(localId) {
    const element = editor.boxElements.get(localId);
    if (!element) {
      return;
    }
    element.remove();
    editor.boxElements.delete(localId);
  }

  function updateBoxElement(element: HTMLButtonElement, annotation, scaleX, scaleY) {
    const label = getLabelById(annotation.label_id);
    const [xMin, yMin, xMax, yMax] = annotation.points;
    element.style.left = `${xMin * scaleX}px`;
    element.style.top = `${yMin * scaleY}px`;
    element.style.width = `${Math.max((xMax - xMin) * scaleX, 1)}px`;
    element.style.height = `${Math.max((yMax - yMin) * scaleY, 1)}px`;
    element.style.setProperty("--bbox-color", label?.color || "#B8B8B8");
    const labelNode = element.firstElementChild instanceof HTMLSpanElement ? element.firstElementChild : null;
    if (labelNode) {
      labelNode.textContent = label ? label.name : "Без лейбла";
    }
  }

  function renderActiveBox(annotation, metrics = editor.interactionMetrics, overlayScale = null) {
    if (!editor.overlayElement) {
      return;
    }

    if (!isVisibleOnCurrentFrame(annotation)) {
      removeBoxElement(annotation.local_id);
      return;
    }

    const scale = overlayScale || getOverlayScale();
    const scaleX = metrics ? (metrics.naturalWidth > 0 ? metrics.width / metrics.naturalWidth : 1) : scale.scaleX;
    const scaleY = metrics ? (metrics.naturalHeight > 0 ? metrics.height / metrics.naturalHeight : 1) : scale.scaleY;
    const element = editor.boxElements.get(annotation.local_id) || createBoxElement(annotation);
    if (element.parentNode !== editor.overlayElement) {
      editor.overlayElement.appendChild(element);
    }
    updateBoxElement(element, annotation, scaleX, scaleY);
  }

  function createBoxElement(annotation) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "media-bbox";
    element.innerHTML = `
      <span class="media-bbox__label"></span>
      <i class="media-bbox__resize-handle" aria-hidden="true"></i>
    `;
    element.addEventListener("pointerdown", (event) => {
      startDragging(event, annotation);
    });
    element.querySelector<HTMLElement>(".media-bbox__resize-handle")?.addEventListener("pointerdown", (event) => {
      startResizing(event, annotation);
    });
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < editor.suppressLabelClickUntil) {
        return;
      }
      if (!editor.activeLabelId) {
        showFlash("Сначала выбери label.", "error");
        return;
      }
      annotation.label_id = editor.activeLabelId;
      render();
    });
    editor.boxElements.set(annotation.local_id, element);
    return element;
  }

  function renderPalette() {
    const labels = getLabels();
    if (!labels.length) {
      labelPalette.innerHTML = '<div class="empty-card">Лейблы для этой комнаты не заданы.</div>';
      setActiveLabel(null);
      return;
    }

    labelPalette.innerHTML = labels
      .map(
        (label) => `
          <button
            class="label-chip label-chip--button ${editor.activeLabelId === label.id ? "is-active" : ""}"
            type="button"
            data-label-id="${label.id}"
            style="--label-color: ${label.color}"
          >
            <i></i>
            <span>${label.name}</span>
          </button>
        `
      )
      .join("");

    labelPalette.querySelectorAll<HTMLButtonElement>("[data-label-id]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveLabel(Number(button.dataset.labelId));
      });
    });

    if (!editor.activeLabelId) {
      setActiveLabel(labels[0].id);
    }
  }

  function renderBoxes() {
    if (!editor.overlayElement) {
      return;
    }

    const overlayScale = getOverlayScale();
    const visibleIds = new Set();

    editor.annotations.forEach((annotation) => {
      if (!isVisibleOnCurrentFrame(annotation)) {
        removeBoxElement(annotation.local_id);
        return;
      }

      visibleIds.add(annotation.local_id);
      renderActiveBox(annotation, null, overlayScale);
    });

    Array.from(editor.boxElements.keys()).forEach((localId) => {
      if (!visibleIds.has(localId)) {
        removeBoxElement(localId);
      }
    });
  }

  function render() {
    updateClearButtonVisibility();
    renderPalette();
    renderBoxes();
    renderAnnotationList();
    updateResultPreview();
  }

  function clearDraft() {
    editor.draftElement?.remove();
    editor.draftElement = null;
    editor.draftStart = null;
  }

  function startDragging(event, annotation) {
    if (editor.panState || startPanning(event) || event.button !== 0 || !editor.overlayElement) {
      return;
    }

    if (state.currentTask?.source_type === "video" && editor.mediaElement && !editor.mediaElement.paused) {
      showFlash("Поставь видео на паузу перед перемещением области.", "error");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    beginPointerInteraction(event.pointerId);
    editor.dragState = {
      annotation,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originalPoints: [...annotation.points],
      moved: false,
    };
  }

  function startResizing(event, annotation) {
    if (editor.panState || startPanning(event) || event.button !== 0 || !editor.overlayElement) {
      return;
    }

    if (state.currentTask?.source_type === "video" && editor.mediaElement && !editor.mediaElement.paused) {
      showFlash("Поставь видео на паузу перед изменением размера области.", "error");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    beginPointerInteraction(event.pointerId);
    editor.resizeState = {
      annotation,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originalPoints: [...annotation.points],
      moved: false,
    };
  }

  function startDrawing(event) {
    if (editor.panState || startPanning(event) || event.button !== 0 || !editor.overlayElement) {
      return;
    }

    if (state.currentTask?.source_type === "video" && editor.mediaElement && !editor.mediaElement.paused) {
      showFlash("Поставь видео на паузу перед выделением области.", "error");
      return;
    }

    const sample = getLatestPointerSample(event);
    event.preventDefault();
    const metrics = beginPointerInteraction(event.pointerId);
    if (!metrics) {
      return;
    }
    editor.draftStart = {
      x: Math.min(Math.max(sample.clientX - metrics.left, 0), metrics.width),
      y: Math.min(Math.max(sample.clientY - metrics.top, 0), metrics.height),
    };
    editor.draftElement = document.createElement("div");
    editor.draftElement.className = "media-bbox media-bbox--draft";
    editor.overlayElement.appendChild(editor.draftElement);
  }

  function updateDraft(event) {
    if (editor.activePointerId !== null && event.pointerId !== editor.activePointerId) {
      return;
    }

    const metrics = editor.interactionMetrics;
    if (!metrics) {
      return;
    }
    const sample = getLatestPointerSample(event);
    const clientX = sample.clientX;
    const clientY = sample.clientY;

    if (editor.resizeState && editor.overlayElement) {
      const deltaX = (clientX - editor.resizeState.startClientX) * metrics.scaleToNaturalX;
      const deltaY = (clientY - editor.resizeState.startClientY) * metrics.scaleToNaturalY;
      const [startXMin, startYMin, startXMax, startYMax] = editor.resizeState.originalPoints;
      const minWidth = 8;
      const minHeight = 8;
      const maxWidth = Math.max((metrics.naturalWidth || 0) - startXMin, minWidth);
      const maxHeight = Math.max((metrics.naturalHeight || 0) - startYMin, minHeight);
      const nextWidth = clamp((startXMax - startXMin) + deltaX, minWidth, maxWidth);
      const nextHeight = clamp((startYMax - startYMin) + deltaY, minHeight, maxHeight);

      editor.resizeState.moved =
        editor.resizeState.moved ||
        Math.abs(clientX - editor.resizeState.startClientX) > 3 ||
        Math.abs(clientY - editor.resizeState.startClientY) > 3;
      editor.resizeState.annotation.points = [
        startXMin,
        startYMin,
        startXMin + nextWidth,
        startYMin + nextHeight,
      ];
      renderActiveBox(editor.resizeState.annotation, metrics);
      return;
    }

    if (editor.dragState && editor.overlayElement) {
      const deltaX = (clientX - editor.dragState.startClientX) * metrics.scaleToNaturalX;
      const deltaY = (clientY - editor.dragState.startClientY) * metrics.scaleToNaturalY;
      const [startXMin, startYMin, startXMax, startYMax] = editor.dragState.originalPoints;
      const boxWidth = startXMax - startXMin;
      const boxHeight = startYMax - startYMin;
      const maxX = Math.max((metrics.naturalWidth || 0) - boxWidth, 0);
      const maxY = Math.max((metrics.naturalHeight || 0) - boxHeight, 0);
      const nextXMin = clamp(startXMin + deltaX, 0, maxX);
      const nextYMin = clamp(startYMin + deltaY, 0, maxY);

      editor.dragState.moved =
        editor.dragState.moved ||
        Math.abs(clientX - editor.dragState.startClientX) > 3 ||
        Math.abs(clientY - editor.dragState.startClientY) > 3;
      editor.dragState.annotation.points = [
        nextXMin,
        nextYMin,
        nextXMin + boxWidth,
        nextYMin + boxHeight,
      ];
      renderActiveBox(editor.dragState.annotation, metrics);
      return;
    }

    if (!editor.draftStart || !editor.draftElement || !editor.overlayElement) {
      return;
    }

    const currentX = Math.min(Math.max(clientX - metrics.left, 0), metrics.width);
    const currentY = Math.min(Math.max(clientY - metrics.top, 0), metrics.height);
    const left = Math.min(editor.draftStart.x, currentX);
    const top = Math.min(editor.draftStart.y, currentY);
    const width = Math.abs(currentX - editor.draftStart.x);
    const height = Math.abs(currentY - editor.draftStart.y);

    editor.draftElement.style.left = `${left}px`;
    editor.draftElement.style.top = `${top}px`;
    editor.draftElement.style.width = `${width}px`;
    editor.draftElement.style.height = `${height}px`;
  }

  function finishDrawing(event) {
    if (editor.activePointerId !== null && event.pointerId !== editor.activePointerId) {
      return;
    }
    const sample = getLatestPointerSample(event);

    if (editor.resizeState) {
      if (editor.resizeState.moved) {
        editor.suppressLabelClickUntil = Date.now() + 150;
      }
      commitAnnotationPoints(editor.resizeState.annotation);
      editor.resizeState = null;
      endPointerInteraction(event.pointerId);
      renderAnnotationList();
      updateResultPreview();
      return;
    }

    if (editor.dragState) {
      if (editor.dragState.moved) {
        editor.suppressLabelClickUntil = Date.now() + 150;
      }
      commitAnnotationPoints(editor.dragState.annotation);
      editor.dragState = null;
      endPointerInteraction(event.pointerId);
      renderAnnotationList();
      updateResultPreview();
      return;
    }

    const metrics = editor.interactionMetrics;
    if (!editor.draftStart || !editor.overlayElement || !metrics) {
      endPointerInteraction(event.pointerId);
      return;
    }

    const currentX = Math.min(Math.max(sample.clientX - metrics.left, 0), metrics.width);
    const currentY = Math.min(Math.max(sample.clientY - metrics.top, 0), metrics.height);
    const left = Math.min(editor.draftStart.x, currentX);
    const top = Math.min(editor.draftStart.y, currentY);
    const width = Math.abs(currentX - editor.draftStart.x);
    const height = Math.abs(currentY - editor.draftStart.y);

    if (width >= 8 && height >= 8) {
      editor.annotations.push({
        local_id: `${Date.now()}-${Math.random()}`,
        type: "bbox",
        label_id: editor.activeLabelId,
        points: [
          Math.round(left * metrics.scaleToNaturalX),
          Math.round(top * metrics.scaleToNaturalY),
          Math.round((left + width) * metrics.scaleToNaturalX),
          Math.round((top + height) * metrics.scaleToNaturalY),
        ],
        frame: getCurrentFrame(),
        attributes: [],
        occluded: false,
      });
    }

    clearDraft();
    endPointerInteraction(event.pointerId);
    render();
  }

  function cancelPointerInteraction(event) {
    if (editor.activePointerId !== null && event.pointerId !== editor.activePointerId) {
      return;
    }

    editor.dragState = null;
    editor.resizeState = null;
    clearDraft();
    endPointerInteraction(event.pointerId);
    renderAnnotationList();
    updateResultPreview();
  }

  function attachOverlayEvents() {
    if (!editor.overlayElement) {
      return;
    }

    editor.overlayElement.addEventListener("pointerdown", (event) => {
      if (event.target !== editor.overlayElement) {
        return;
      }
      startDrawing(event);
    });
    editor.overlayElement.addEventListener("pointermove", updateDraft);
    editor.overlayElement.addEventListener("pointerrawupdate", updateDraft as EventListener);
    editor.overlayElement.addEventListener("pointerup", finishDrawing);
    editor.overlayElement.addEventListener("pointercancel", cancelPointerInteraction);

    if (editor.eventsAttached) {
      return;
    }

    window.addEventListener("resize", handleStageResize);
    editor.eventsAttached = true;
  }

  clearBtn?.addEventListener("click", () => {
    editor.annotations = [];
    render();
  });

  zoomOutBtn?.addEventListener("click", () => {
    applyZoom(editor.zoomLevel - editor.zoomStep);
  });

  zoomInBtn?.addEventListener("click", () => {
    applyZoom(editor.zoomLevel + editor.zoomStep);
  });

  zoomResetBtn?.addEventListener("click", () => {
    applyZoom(1);
  });

  zoomRange?.addEventListener("input", () => {
    applyZoom(Number(zoomRange.value) / 100);
  });

  function handleStagePointerDown(event) {
    startPanning(event);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.code !== "Space" || isEditableTarget(event.target)) {
      return;
    }
    if (!editor.mediaElement || editor.zoomLevel <= 1) {
      return;
    }
    event.preventDefault();
    if (!editor.isPanKeyActive) {
      editor.isPanKeyActive = true;
      updateStageInteractionState();
    }
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.code !== "Space") {
      return;
    }
    editor.isPanKeyActive = false;
    updateStageInteractionState();
  }

  function handleWindowBlur() {
    editor.isPanKeyActive = false;
    finishPanning();
    updateStageInteractionState();
  }

  mediaStage.addEventListener("pointerdown", handleStagePointerDown, true);
  mediaStage.addEventListener("pointermove", updatePan);
  mediaStage.addEventListener("pointerup", finishPanning);
  mediaStage.addEventListener("pointercancel", finishPanning);
  mediaStage.addEventListener("wheel", handleStageWheel, { passive: false });

  if (!editor.keyboardAttached) {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    editor.keyboardAttached = true;
  }

  function reset() {
    finishPanning();
    editor.boxElements.forEach((element) => element.remove());
    editor.boxElements.clear();
    editor.annotations = [];
    editor.activeLabelId = null;
    editor.mediaElement = null;
    editor.wrapperElement = null;
    editor.overlayElement = null;
    clearDraft();
    editor.dragState = null;
    editor.resizeState = null;
    editor.isPanKeyActive = false;
    editor.zoomLevel = 1;
    editor.baseCanvasWidth = 0;
    editor.baseCanvasHeight = 0;
    endPointerInteraction();
    mediaTool.classList.add("hidden");
    zoomToolbar?.classList.add("hidden");
    mediaStage.className = "media-stage empty-card";
    mediaStage.textContent = "Файл задачи загрузится после выбора задания.";
    resultLabel.textContent = "Результат разметки";
    resultJson.readOnly = false;
    updateZoomControls();
    render();
  }

  function loadTask(task) {
    if (!task || !["image", "video"].includes(task.source_type) || !task.source_file_url) {
      reset();
      return;
    }

    mediaTool.classList.remove("hidden");
    instructions.textContent =
      task.source_type === "video"
        ? "Поставь видео на паузу на нужном кадре, зажми левую кнопку мыши и выдели область. Новое выделение сразу получит активный label. Зажми существующую область, чтобы переместить ее, потяни за правый нижний угол, чтобы изменить размер, или выбери другой label и кликни по области один раз, чтобы поменять label."
        : "Зажми левую кнопку мыши и выдели область. Новое выделение сразу получит активный label. Зажми существующую область, чтобы переместить ее, потяни за правый нижний угол, чтобы изменить размер, или выбери другой label и кликни по области один раз, чтобы поменять label.";
    resultLabel.textContent = "Результат bbox-разметки";
    resultJson.readOnly = true;
    editor.annotations = [];
    editor.zoomLevel = 1;
    editor.baseCanvasWidth = 0;
    editor.baseCanvasHeight = 0;
    zoomToolbar?.classList.remove("hidden");
    updateZoomControls();

    const wrapper = document.createElement("div");
    wrapper.className = "media-canvas";
    const overlay = document.createElement("div");
    overlay.className = "media-overlay";
    const handleMediaReady = () => {
      syncCanvasViewport();
    };

    let mediaElement;
    if (task.source_type === "video") {
      mediaElement = document.createElement("video");
      mediaElement.controls = true;
      mediaElement.preload = "metadata";
      mediaElement.addEventListener("loadedmetadata", handleMediaReady);
      mediaElement.addEventListener("seeked", renderBoxes);
      mediaElement.addEventListener("pause", renderBoxes);
    } else {
      mediaElement = document.createElement("img");
      mediaElement.alt = task.source_name || `Task ${task.id}`;
      mediaElement.addEventListener("load", handleMediaReady);
    }
    mediaElement.className = "media-stage__asset";
    mediaElement.draggable = false;
    mediaElement.src = task.source_file_url;

    wrapper.appendChild(mediaElement);
    wrapper.appendChild(overlay);
    mediaStage.className = "media-stage media-stage--interactive";
    mediaStage.innerHTML = "";
    mediaStage.appendChild(wrapper);

    editor.mediaElement = mediaElement;
    editor.wrapperElement = wrapper;
    editor.overlayElement = overlay;
    updateZoomControls();
    attachOverlayEvents();
    if (task.source_type === "image" && mediaElement.complete) {
      window.requestAnimationFrame(handleMediaReady);
    }
    render();
  }

  return {
    reset,
    loadTask,
    hasUnlabeledAnnotations() {
      return editor.annotations.some((annotation) => !annotation.label_id);
    },
  };
}

function initRoomWorkPage() {
  if (!currentRoomId) {
    showFlash("Не удалось определить ID комнаты из URL.", "error");
    state.pageRefresh = async () => {};
    return;
  }

  const joinBtn = byId<HTMLButtonElement>("work-join-btn");
  const topSubmitBtn = byId<HTMLElement>("work-submit-btn-top");
  const taskBox = byId<HTMLElement>("work-task-box");
  const submitForm = byId<HTMLFormElement>("work-submit-form");
  const resultJson = byId<HTMLTextAreaElement>("work-result-json");
  const resultLabel = byId<HTMLElement>("work-result-label");
  const submitBtn = submitForm?.querySelector<HTMLButtonElement>('button[type="submit"]');

  const mediaEditor = createMediaAnnotationEditor({
    mediaTool: byId<HTMLElement>("work-media-tool"),
    instructions: byId<HTMLElement>("work-media-instructions"),
    labelPalette: byId<HTMLElement>("work-label-palette"),
    activeLabelNote: byId<HTMLElement>("work-active-label"),
    zoomToolbar: byId<HTMLElement>("work-media-toolbar"),
    zoomRange: byId<HTMLInputElement>("work-zoom-range"),
    zoomOutBtn: byId<HTMLButtonElement>("work-zoom-out-btn"),
    zoomInBtn: byId<HTMLButtonElement>("work-zoom-in-btn"),
    zoomResetBtn: byId<HTMLButtonElement>("work-zoom-reset-btn"),
    mediaStage: byId<HTMLElement>("work-media-stage"),
    annotationList: byId<HTMLElement>("work-annotation-list"),
    clearBtn: byId<HTMLButtonElement>("work-clear-annotations-btn"),
    resultJson,
    resultLabel,
    submitBtn,
  });

  function resetCurrentTask(message) {
    state.currentTask = null;
    submitForm.classList.add("hidden");
    topSubmitBtn?.classList.add("hidden");
    mediaEditor.reset();
    renderEmptyTaskBox(taskBox, message);
  }

  function prepareTaskForm(task) {
    renderCurrentTask(taskBox, task);
    submitForm.classList.toggle("hidden", !task);
    topSubmitBtn?.classList.toggle("hidden", !task);

    if (!task) {
      mediaEditor.reset();
      return;
    }

    if (["image", "video"].includes(task.source_type)) {
      mediaEditor.loadTask(task);
      return;
    }

    mediaEditor.reset();
    resultLabel.textContent = "Результат разметки";
    resultJson.readOnly = false;
    resultJson.value = JSON.stringify(
      {
        label: "positive",
        confidence: 0.95,
      },
      null,
      2
    );
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }

  async function loadNextTask({ emptyMessage }) {
    const task = await api(`/api/v1/rooms/${currentRoomId}/tasks/next/`);
    state.currentTask = task;
    prepareTaskForm(task);

    if (!task) {
      renderEmptyTaskBox(taskBox, emptyMessage || "Доступных задач больше нет.");
      if (emptyMessage) {
        showFlash(emptyMessage, "success");
      }
      return null;
    }
    return task;
  }

  async function loadDashboard() {
    const dashboard = await api(`/api/v1/rooms/${currentRoomId}/dashboard/`);
    state.roomDashboard = dashboard;

    if (!dashboard.actor.can_annotate) {
      showFlash("Рабочая среда доступна только участникам комнаты, которые могут размечать задачи.", "error");
      window.setTimeout(() => {
        window.location.href = `/rooms/${currentRoomId}/`;
      }, 900);
      return;
    }

    const canStartWorking = dashboard.actor.can_annotate;
    const shouldShowJoin = !canStartWorking && dashboard.room.membership_status !== "owner";
    joinBtn?.classList.toggle("hidden", shouldShowJoin === false);
    if (joinBtn) {
      joinBtn.disabled = !shouldShowJoin;
      joinBtn.textContent = "Войти в комнату";
    }

    if (!canStartWorking) {
      resetCurrentTask("Сначала войди в комнату, чтобы получить задачу на разметку.");
    } else if (!state.currentTask) {
      await loadNextTask({
        emptyMessage: "Доступных задач больше нет.",
      });
    }
  }

  joinBtn?.addEventListener("click", async () => {
    clearFlash();
    try {
      await api(`/api/v1/rooms/${currentRoomId}/join/`, { method: "POST", body: {} });
      await loadDashboard();
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  submitForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFlash();

    if (!state.currentTask) {
      showFlash("Подожди загрузки задачи.", "error");
      return;
    }

    if (["image", "video"].includes(state.currentTask.source_type) && mediaEditor.hasUnlabeledAnnotations()) {
      showFlash("Назначь лейблы всем выделенным областям перед отправкой.", "error");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(resultJson.value);
    } catch (error) {
      showFlash("Результат должен быть валидным JSON.", "error");
      return;
    }

    try {
      const completedTaskId = state.currentTask.id;
      await api(`/api/v1/tasks/${state.currentTask.id}/submit/`, {
        method: "POST",
        body: { result_payload: payload },
      });
      resetCurrentTask("Загружаем следующую задачу...");
      await loadDashboard();
      if (!state.currentTask) {
        showFlash(`Задача #${completedTaskId} успешно размечена. Доступных задач больше нет.`, "success");
      } else {
        showFlash(`Задача #${completedTaskId} успешно размечена. Следующая задача уже готова.`, "success");
      }
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  });

  state.pageRefresh = async () => {
    if (!state.user) {
      return;
    }

    try {
      await loadDashboard();
    } catch (error) {
      showFlash(getErrorMessage(error), "error");
    }
  };
}

function initPage() {
  switch (currentPage) {
    case "rooms":
      initRoomsPage();
      break;
    case "profile":
      initProfilePage();
      break;
    case "room-create":
      initRoomCreatePage();
      break;
    case "room-detail":
      initRoomDetailPage();
      break;
    case "room-work":
      initRoomWorkPage();
      break;
    default:
      state.pageRefresh = async () => {};
      break;
  }
}

initPage();
initGlobalHeader();
