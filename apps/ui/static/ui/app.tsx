import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/*
 * Main browser entry for the React UI.
 *
 * Django still owns routing and server-side concerns. This file reads the
 * bootstrap JSON emitted by `UiContextMixin`, mounts a single React root and
 * renders the requested page component.
 */

type ToastType = "success" | "error" | "warning" | "info";

type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  display_name: string;
} | null;

type FormFieldState = {
  name: string;
  label: string;
  value: string;
  errors: string[];
  widget_type: string;
};

type FormState = {
  fields: Record<string, FormFieldState>;
  non_field_errors: string[];
};

type BootstrapData = {
  page: string;
  page_title: string;
  active_page: string;
  room_id: number | null;
  video_id: number | null;
  profile_user_id: number | null;
  app_debug_mode: boolean;
  stats: {
    users: number;
    rooms: number;
    tasks: number;
  };
  auth_user: AuthUser;
  csrf_token: string;
  messages: Array<{
    message: string;
    type: ToastType;
    persistent?: boolean;
  }>;
  assets: {
    brand_mark: string;
  };
  page_payload: {
    form?: FormState | null;
    invite_token?: string | null;
  };
};

type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  formData?: FormData;
  allowAnonymous?: boolean;
};

type LabelItem = {
  id: number;
  name: string;
  color: string;
  sort_order?: number;
};

type RoomItem = {
  id: number;
  title: string;
  description: string;
  description_pdf_url: string | null;
  description_pdf_name: string;
  dataset_label: string;
  dataset_type: string;
  annotation_workflow: string;
  cross_validation_enabled: boolean;
  cross_validation_annotators_count: number;
  cross_validation_similarity_threshold: number;
  review_voting_enabled: boolean;
  review_votes_required: number;
  review_acceptance_threshold: number;
  owner_is_annotator: boolean;
  default_assignment_quota: number | null;
  deadline: string | null;
  created_by_id: number;
  membership_status: string | null;
  membership_role: string | null;
  has_password: boolean;
  total_tasks: number;
  completed_tasks: number;
  progress_percent: number;
  is_pinned: boolean;
  pin_sort_order: number | null;
  last_accessed_at: string | null;
  labels: LabelItem[];
  export_formats: Array<{ value: string; label: string }>;
  created_at: string;
  updated_at: string;
};

type RoomDatasetFilter = "all" | "text" | "image" | "video";
type RoomListFilter = "all" | "pinned" | "owned" | "active" | "review";

type ActivitySeriesItem = {
  date: string;
  count: number;
};

type UserProfile = {
  id: number;
  email: string;
  full_name: string;
  display_name: string;
  can_edit?: boolean;
  overview: {
    accessible_rooms_count: number;
    created_rooms_count: number;
    joined_rooms_count: number;
    completed_tasks: number;
    in_progress_tasks: number;
    invitations_count: number;
  };
  activity: ActivitySeriesItem[];
};

type DashboardAnnotator = {
  user_id: number;
  email: string;
  full_name: string;
  display_name: string;
  status: string;
  role: string;
  joined_at: string | null;
  completed_tasks: number;
  in_progress_tasks: number;
  remaining_tasks: number | null;
  progress_percent: number;
  task_quota: number | null;
  custom_task_quota: number | null;
  quota_source: "custom" | "default" | "none";
  quota_used: number;
  quota_remaining: number | null;
  quota_exhausted: boolean;
  quota_progress_percent: number;
  activity: ActivitySeriesItem[];
};

type JoinRequestItem = {
  id: number;
  user_id: number;
  email: string;
  full_name: string;
  display_name: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_display_name: string | null;
};

type RoomDashboard = {
  room: {
    id: number;
    title: string;
    description: string;
    description_pdf_url: string | null;
    description_pdf_name: string;
    dataset_label: string;
    dataset_type: string;
    annotation_workflow: string;
    cross_validation_enabled: boolean;
    cross_validation_annotators_count: number;
    cross_validation_similarity_threshold: number;
    review_voting_enabled: boolean;
    review_votes_required: number;
    review_acceptance_threshold: number;
    owner_is_annotator: boolean;
    default_assignment_quota: number | null;
    deadline: string | null;
    has_password: boolean;
    is_pinned: boolean;
    created_by_id: number;
    membership_status: string | null;
    membership_role: string | null;
  };
  invite: {
    url: string;
    token: string;
  };
  labels: LabelItem[];
  export_formats: Array<{ value: string; label: string }>;
  overview: {
    total_tasks: number;
    completed_tasks: number;
    remaining_tasks: number;
    progress_percent: number;
  };
  membership_role_options: Array<{ value: string; label: string }>;
  actor: {
    id: number;
    email: string;
    full_name: string;
    display_name: string;
    role: string;
    can_manage: boolean;
    can_review: boolean;
    can_annotate: boolean;
    can_invite: boolean;
    can_assign_roles: boolean;
    can_assign_quotas: boolean;
    can_edit_room: boolean;
    can_export: boolean;
    can_delete_room: boolean;
  };
  join_requests?: JoinRequestItem[];
  annotator_stats?: {
    completed_tasks: number;
    in_progress_tasks: number;
    remaining_tasks: number | null;
    progress_percent: number;
    task_quota: number | null;
    custom_task_quota: number | null;
    quota_source: "custom" | "default" | "none";
    quota_used: number;
    quota_remaining: number | null;
    quota_exhausted: boolean;
    quota_progress_percent: number;
    activity: ActivitySeriesItem[];
  };
  annotators?: DashboardAnnotator[];
  video_tasks?: Array<{
    id: number;
    source_name: string | null;
    source_file_url: string | null;
    input_payload: Record<string, any>;
  }>;
};

type TaskItem = {
  id: number;
  room_id: number;
  parent_task_id: number | null;
  status: string;
  current_round: number;
  validation_score: number | null;
  input_payload: Record<string, any>;
  source_type: string;
  workflow_stage: string;
  source_name: string | null;
  source_file_url: string | null;
  video_frame_context: VideoFrameContext | null;
  created_at: string;
  updated_at: string;
};

type VideoFrameContextItem = {
  task_id: number;
  source_name: string | null;
  source_file_url: string | null;
  frame_number: number;
  timestamp: number;
  role: string;
  state: string;
  generated_from_frames?: number[];
  trajectory_warnings?: string[];
};

type VideoFrameContext = {
  video_asset_id: number;
  video_name: string;
  current: VideoFrameContextItem;
  previous: VideoFrameContextItem | null;
  next: VideoFrameContextItem | null;
};

type ReviewTaskFilter = "validation" | "validation_voted" | "generated" | "final" | "incomplete";
type RoomDetailSectionId = "overview" | "personal" | "dataset" | "team" | "review" | "export" | "settings";

type ReviewTaskListItem = {
  id: number;
  status: string;
  current_round: number;
  validation_score: number | null;
  source_type: string;
  workflow_stage: string;
  source_name: string | null;
  source_file_url: string | null;
  annotations_count: number;
  annotator_ids: number[];
  review_state: string;
  required_annotations_count: number;
  submitted_annotations_count: number;
  review_outcome: string;
  validation_votes_required: number;
  validation_acceptance_threshold: number;
  validation_votes_count: number;
  validation_approve_votes_count: number;
  validation_reject_votes_count: number;
  actor_validation_vote: string | null;
  can_vote: boolean;
  video_frame_state: string | null;
  trajectory_warnings: string[];
  tracking_confidence?: number | null;
  updated_at: string;
};

type RoomDatasetTaskItem = TaskItem & {
  assignments_count: number;
  submitted_annotations_count: number;
};

type RoomDatasetUploadResponse = {
  added_count: number;
  tasks: RoomDatasetTaskItem[];
};

type VideoItem = {
  id: number;
  room_id: number;
  source_name: string | null;
  source_file_url: string | null;
  fps: number;
  width: number;
  height: number;
  duration: number;
  frame_count: number;
  input_payload: Record<string, any>;
};

type VideoSelectionItem = {
  id: number;
  video_id: number;
  start_frame: number;
  end_frame: number;
  status: string;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
};

type FrameAnnotationObject = {
  id?: string;
  label: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type FrameAnnotationPayload = {
  id: number;
  task_id: number;
  video_id: number;
  frame_index: number;
  status: "annotated" | "empty" | "uncertain";
  objects: FrameAnnotationObject[];
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
};

type FrameAnnotationTaskItem = {
  id: number;
  video_id: number;
  frame_index: number;
  time_ms: number;
  source_segment_id: number | null;
  status: string;
  assigned_to_id: number | null;
  frame_image_url: string | null;
  annotation: FrameAnnotationPayload | null;
  created_at: string;
  updated_at: string;
};

const frameTaskStatusLabels: Record<string, string> = {
  pending: "ожидает",
  in_progress: "в работе",
  done: "сохранено",
  skipped: "пропущено",
  uncertain: "не уверен",
};

type AnnotationItem = {
  id: number;
  task_id: number;
  assignment_id: number;
  annotator_id: number;
  annotator_display_name: string;
  round_number: number;
  review_outcome: string;
  result_payload: Record<string, any>;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

type RoomInvitePreview = {
  room: {
    id: number;
    title: string;
    description: string;
    description_pdf_url: string | null;
    description_pdf_name: string;
    dataset_label: string;
    has_password: boolean;
    created_by_display_name: string;
  };
  invite_url: string;
  actor: {
    id: number;
    email: string;
    full_name: string;
    display_name: string;
    access_status: string;
    can_request_access: boolean;
  } | null;
  membership: {
    id: number;
    status: string;
    role: string;
    joined_at: string | null;
  } | null;
  join_request: {
    id: number;
    status: string;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by_display_name: string | null;
  } | null;
};

type ReviewTaskDetail = {
  task: TaskItem;
  consensus_payload: Record<string, any> | null;
  consensus_available: boolean;
  can_reject_all: boolean;
  review_state: string;
  required_annotations_count: number;
  submitted_annotations_count: number;
  validation_votes_required: number;
  validation_acceptance_threshold: number;
  validation_votes_count: number;
  validation_approve_votes_count: number;
  validation_reject_votes_count: number;
  actor_validation_vote: string | null;
  can_vote: boolean;
  annotations: AnnotationItem[];
  review_outcome: string;
  video_frame_state?: string | null;
  generated_payload?: Record<string, any> | null;
  generated_from_frames?: number[];
  trajectory_warnings?: string[];
  tracking_confidence?: number | null;
};

type EditableSubmissionListItem = {
  id: number;
  status: string;
  current_round: number;
  validation_score: number | null;
  source_type: string;
  workflow_stage: string;
  source_name: string | null;
  source_file_url: string | null;
  editable: boolean;
  editable_reason: string | null;
  submitted_at: string;
};

type EditableSubmissionDetail = {
  task: TaskItem;
  annotation: AnnotationItem;
  editable: boolean;
  editable_reason: string | null;
};

type EditorWorkspaceMode = "queue" | "submitted" | "review";

type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
  persistent: boolean;
};

type AppContextValue = {
  bootstrap: BootstrapData;
  authUser: AuthUser;
  setAuthUser: React.Dispatch<React.SetStateAction<AuthUser>>;
  theme: string;
  setTheme: (theme: string) => void;
  addToast: (message: string, type?: ToastType, options?: { persistent?: boolean }) => void;
  clearToasts: (includePersistent?: boolean) => void;
  removeToast: (id: number) => void;
  api: <T = any>(path: string, options?: ApiRequestOptions) => Promise<T>;
};

// React always starts from a bootstrap payload emitted by Django. The fallback
// keeps the bundle safe to import even if the script tag is missing.
const bootstrap = readJsonScript<BootstrapData>("ui-bootstrap-data") || {
  page: "home",
  page_title: "DataSetAI",
  active_page: "home",
  room_id: null,
  video_id: null,
  profile_user_id: null,
  app_debug_mode: false,
  stats: { users: 0, rooms: 0, tasks: 0 },
  auth_user: null,
  csrf_token: "",
  messages: [],
  assets: { brand_mark: "" },
  page_payload: {},
};

// Shared app services live in context so screens can reuse API, toast and
// theme logic without prop drilling through every page component.
const AppContext = React.createContext<AppContextValue | null>(null);

const roleLabels: Record<string, string> = {
  owner: "Владелец",
  customer: "Заказчик",
  annotator: "Исполнитель",
  admin: "Админ",
  tester: "Ревьюер",
};

const membershipLabels: Record<string, string> = {
  owner: "Владелец",
  invited: "Приглашен",
  joined: "В комнате",
  pending: "Ожидает решения",
  approved: "Одобрено",
  rejected: "Отклонено",
};

const taskStatusLabels: Record<string, string> = {
  pending: "Ожидает разметки",
  in_progress: "В работе",
  in_review: "На ревью",
  submitted: "Отправлена",
};

const datasetModeLabels: Record<string, string> = {
  image: "Фото",
  video: "Видео",
};

const sourceTypeLabels: Record<string, string> = {
  text: "Текст",
  image: "Фото",
  video: "Видео",
};

const annotationWorkflowLabels: Record<string, string> = {
  standard: "Обычная разметка",
  text_detect_text: "Object detect + text",
};

const ROOM_TITLE_MAX_LENGTH = 128;
const ROOM_DATASET_LABEL_MAX_LENGTH = 255;
const ROOM_DESCRIPTION_MAX_LENGTH = 2000;
const ROOM_PASSWORD_MAX_LENGTH = 64;
const ROOM_LABEL_NAME_MAX_LENGTH = 64;
const ROOM_ANNOTATOR_IDS_MAX_LENGTH = 255;
const ROOM_DEADLINE_MAX_DAYS_AHEAD = 365;

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

const datasetModeConfig: Record<
  string,
  {
    hint: string;
    accept: string;
    multiple: boolean;
    usesFiles: boolean;
    usesLabels: boolean;
  }
> = {
  image: {
    hint: "Загрузи набор фотографий или ZIP-архив с изображениями. Для каждой фотографии будет создана отдельная bbox-задача.",
    accept: "image/*,.zip,application/zip",
    multiple: true,
    usesFiles: true,
    usesLabels: true,
  },
  video: {
    hint: "Загрузи набор видеороликов или ZIP-архив с видео. Для каждого видео будут доступны bbox-разметки по кадрам.",
    accept: "video/*,.zip,application/zip",
    multiple: true,
    usesFiles: true,
    usesLabels: true,
  },
};

const FLASH_DEFAULT_DURATION = 5000;
const ACTIVITY_CELL_SIZE = 14;
const ACTIVITY_CELL_GAP = 4;
const ACTIVITY_CALENDAR_PADDING = 24;
const ACTIVITY_MIN_WEEKS = 8;
const ACTIVITY_MAX_WEEKS = 52;

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

function useApp() {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("App context is not available.");
  }
  return context;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Неизвестная ошибка.");
}

function getSearchParam(name: string) {
  return new URLSearchParams(window.location.search).get(name) || "";
}

function getBooleanSearchParam(name: string, fallback = false) {
  const value = getSearchParam(name).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

function getRoomCreatePresetSearch() {
  const rawDatasetMode = getSearchParam("dataset_mode") || getSearchParam("dataset");
  const datasetMode = datasetModeConfig[rawDatasetMode] ? rawDatasetMode : "image";
  const rawWorkflow = getSearchParam("annotation_workflow") || getSearchParam("workflow");
  const annotationWorkflow =
    rawWorkflow === "text_detect_text" && (datasetMode === "image" || datasetMode === "video") ? rawWorkflow : "standard";
  const rawLabel = getSearchParam("label").trim();
  return {
    datasetMode,
    annotationWorkflow,
    title: getSearchParam("title").trim(),
    datasetLabel: getSearchParam("dataset_label").trim(),
    crossValidationEnabled: getBooleanSearchParam("cross_validation"),
    reviewVotingEnabled: getBooleanSearchParam("review_voting"),
    labels:
      rawLabel && datasetModeConfig[datasetMode]?.usesLabels
        ? [{ name: rawLabel, color: pickRandomLabelColor() }]
        : ([] as Array<{ name: string; color: string }>),
  };
}

type RoomCreateScenarioPreset = {
  id: string;
  title: string;
  summary: string;
  meta: string;
  datasetMode: string;
  annotationWorkflow: string;
  defaultTitle: string;
  datasetLabel: string;
  labelName?: string;
};

type RoomCreateStepId = "scenario" | "main" | "data" | "team" | "quality";

const roomCreateScenarioPresets: RoomCreateScenarioPreset[] = [
  {
    id: "image",
    title: "Фото bbox",
    summary: "Покадровые изображения с ручной bbox-разметкой.",
    meta: "Изображения",
    datasetMode: "image",
    annotationWorkflow: "standard",
    defaultTitle: "Разметка изображений",
    datasetLabel: "Датасет изображений",
    labelName: "object",
  },
  {
    id: "video",
    title: "Видео по кадрам",
    summary: "Видео с выбором интервалов и ручной bbox-разметкой кадров.",
    meta: "Видео",
    datasetMode: "video",
    annotationWorkflow: "standard",
    defaultTitle: "Разметка видео",
    datasetLabel: "Видеодатасет",
    labelName: "object",
  },
];

const roomCreateWizardSteps: Array<{
  id: RoomCreateStepId;
  title: string;
  eyebrow: string;
  description: string;
}> = [
  {
    id: "scenario",
    title: "Сценарий",
    eyebrow: "Шаг 1",
    description: "Выбери тип комнаты, чтобы форма подстроила датасет, workflow и стартовые labels.",
  },
  {
    id: "main",
    title: "Основное",
    eyebrow: "Шаг 2",
    description: "Название, датасет, описание и дедлайн, которые увидит команда.",
  },
  {
    id: "data",
    title: "Данные",
    eyebrow: "Шаг 3",
    description: "Источник задач, файлы и label palette для bbox-сценариев.",
  },
  {
    id: "team",
    title: "Команда",
    eyebrow: "Шаг 4",
    description: "Доступ, приглашённые участники и лимиты задач.",
  },
  {
    id: "quality",
    title: "Проверка",
    eyebrow: "Шаг 5",
    description: "Пул валидации и пороги принятия итоговой разметки.",
  },
];

function getRoomCreateScenarioId(input: { datasetMode: string; annotationWorkflow: string }) {
  if (input.datasetMode === "video") {
    return "video";
  }
  if (input.datasetMode === "image") {
    return "image";
  }
  return "image";
}

function normalizeToastType(type?: string): ToastType {
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

function formatApiError(data: any, fallbackStatus: number) {
  if (!data) {
    return `Ошибка HTTP ${fallbackStatus}`;
  }

  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }

  if (Array.isArray(data)) {
    return data.join(", ");
  }

  if (typeof data === "object") {
    const messages: string[] = [];
    const apiFieldLabels: Record<string, string> = {
      password: "Пароль",
      deadline: "Дедлайн",
      title: "Название",
      description: "Описание",
      dataset_label: "Название датасета",
      dataset_files: "Файлы датасета",
      media_manifest: "Медиа-манифест",
      task_ids: "Объекты датасета",
      review_votes_required: "Голосов для решения",
      review_acceptance_threshold: "Порог принятия",
    };
    Object.entries(data).forEach(([key, value]) => {
      const fieldName = key === "non_field_errors" ? "Ошибка" : apiFieldLabels[key] || key;
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

  return `Ошибка HTTP ${fallbackStatus}`;
}

async function apiRequest(path: string, authUser: AuthUser, options: ApiRequestOptions = {}) {
  if (!authUser && !options.allowAnonymous) {
    throw new Error("Сначала войди в аккаунт.");
  }

  // Backend expects the current user through the custom X-User-Id auth header.
  // This wrapper also normalizes HTML/JSON error responses into plain messages.
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (authUser) {
    headers["X-User-Id"] = String(authUser.id);
  }
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
          detail:
            "Сервер вернул HTML вместо JSON. Обычно это значит, что backend упал или не применены миграции.",
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

async function downloadRoomExport(roomId: number, exportFormat: string, authUser: AuthUser) {
  if (!authUser) {
    throw new Error("Сначала войди в аккаунт.");
  }

  const response = await fetch(`/api/v1/rooms/${roomId}/export/?export_format=${encodeURIComponent(exportFormat)}`, {
    method: "GET",
    headers: {
      "X-User-Id": String(authUser.id),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { detail: text || `Ошибка HTTP ${response.status}` };
    }
    throw new Error(data?.detail || `Ошибка HTTP ${response.status}`);
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

async function downloadVideoFrameExport(videoId: number, authUser: AuthUser) {
  if (!authUser) {
    throw new Error("Сначала войди в аккаунт.");
  }

  const response = await fetch(`/api/v1/videos/${videoId}/export/`, {
    method: "GET",
    headers: {
      "X-User-Id": String(authUser.id),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { detail: text || `Ошибка HTTP ${response.status}` };
    }
    throw new Error(data?.detail || `Ошибка HTTP ${response.status}`);
  }

  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = filenameMatch?.[1] || `video-${videoId}-frame-annotations.json`;
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatVideoTime(seconds: number) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function formatPercent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatFileSize(bytes: number | null | undefined) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "0 Б";
  }

  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value: string | null | undefined) {
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

function formatDateTimeLocal(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function validateRoomDeadline(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Укажи корректную дату дедлайна.";
  }

  const now = new Date();
  if (date.getTime() <= now.getTime()) {
    return "Укажи дедлайн в будущем.";
  }

  const latestAllowed = new Date(now.getTime() + ROOM_DEADLINE_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  if (date.getTime() > latestAllowed.getTime()) {
    return `Дедлайн можно поставить не дальше чем на ${ROOM_DEADLINE_MAX_DAYS_AHEAD} дней вперёд.`;
  }

  return "";
}

function readStoredDisclosureState(storageKey: string | null, defaultOpen = false) {
  if (!storageKey) {
    return defaultOpen;
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "1") {
      return true;
    }
    if (value === "0") {
      return false;
    }
  } catch (error) {
    return defaultOpen;
  }

  return defaultOpen;
}

function writeStoredDisclosureState(storageKey: string | null, isOpen: boolean) {
  if (!storageKey) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, isOpen ? "1" : "0");
  } catch (error) {
    // Ignore storage errors in restricted environments.
  }
}

function getDisplayName(entity: { display_name?: string | null; full_name?: string | null; email?: string | null }) {
  return entity.display_name || entity.full_name || entity.email || "Без имени";
}

function translateRole(role: string | null | undefined) {
  if (!role) {
    return "Неизвестная роль";
  }
  return roleLabels[role] || role;
}

function translateMembership(status: string | null | undefined) {
  if (!status) {
    return "Неизвестно";
  }
  return membershipLabels[status] || status;
}

function translateTaskStatus(status: string | null | undefined) {
  if (!status) {
    return "Неизвестно";
  }
  return taskStatusLabels[status] || status;
}

function translateReviewOutcome(outcome: string | null | undefined) {
  if (outcome === "accepted") {
    return "Принята";
  }
  if (outcome === "rejected") {
    return "Не принята";
  }
  if (outcome === "incomplete") {
    return "Неполная";
  }
  if (outcome === "validation") {
    return "На голосовании";
  }
  if (outcome === "generated") {
    return "Сгенерирована";
  }
  return "Ожидает проверки";
}

function translateVideoFrameState(state: string | null | undefined) {
  const labels: Record<string, string> = {
    waiting_interpolation: "Ждёт интерполяции",
    pending_manual: "Ручная разметка",
    manual_submitted: "Размечен вручную",
    no_object: "Объекта нет",
    generated_review: "Сгенерирована",
    generated_accepted: "Сгенерирована принята",
    generated_rejected: "Нужна ручная правка",
    abrupt_center_jump: "резкий сдвиг центра",
    abrupt_width_change: "резкое изменение ширины",
    abrupt_height_change: "резкое изменение высоты",
    abrupt_area_change: "резкое изменение площади",
    long_keyframe_gap: "большой разрыв между keyframe",
    low_tracking_confidence: "низкая уверенность автотрекинга",
    overlapping_tracks: "пересечение треков",
    nearby_tracks: "близкие треки",
    duplicate_track_on_frame: "повтор track id на кадре",
  };
  return state ? labels[state] || state : "Нет данных";
}

function translateDatasetMode(mode: string | null | undefined) {
  if (!mode) {
    return "Неизвестно";
  }
  return datasetModeLabels[mode] || mode;
}

function translateSourceType(sourceType: string | null | undefined) {
  if (!sourceType) {
    return "Неизвестно";
  }
  return sourceTypeLabels[sourceType] || sourceType;
}

function translateAnnotationWorkflow(workflow: string | null | undefined) {
  if (!workflow) {
    return "Неизвестно";
  }
  return annotationWorkflowLabels[workflow] || workflow;
}

function translateWorkflowStage(stage: string | null | undefined) {
  if (stage === "text_detection") {
    return "Детекция";
  }
  if (stage === "text_transcription") {
    return "Распознавание текста";
  }
  return "Разметка";
}

function isArchiveFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function getMediaMetadataFiles(files: File[], datasetMode: string) {
  if (datasetMode !== "image" && datasetMode !== "video") {
    return [];
  }
  return files.filter((file) => !isArchiveFile(file));
}

function getTaskItemNumber(task: Pick<TaskItem, "input_payload"> | null | undefined) {
  const rawValue = task?.input_payload?.item_number;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function pickRandomLabelColor() {
  return labelColorPool[Math.floor(Math.random() * labelColorPool.length)];
}

function clampTextLength(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function isTextLimitExceeded(value: string, maxLength: number) {
  return value.length > maxLength;
}

function CharacterLimitLabel({
  label,
  value,
  maxLength,
}: {
  label: string;
  value: string;
  maxLength: number;
}) {
  const isInvalid = isTextLimitExceeded(value, maxLength);

  return (
    <span className="field__label-row">
      <span>{label}</span>
      <span className={`field__limit ${isInvalid ? "is-invalid" : ""}`}>
        {value.length}/{maxLength}
      </span>
    </span>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseDateString(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(dateString: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" })
    .format(parseDateString(dateString))
    .replace(".", "");
}

function shiftDateString(dateString: string, days: number) {
  const date = parseDateString(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function formatWeeksLabel(count: number) {
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

function createDefaultGenericPayload() {
  return {
    label: "positive",
    confidence: 0.95,
  };
}

type WorkEditorScenario = {
  key: "bbox-media" | "text-transcription" | "json";
  emptyStageMessage: string;
  annotationsTitle: string;
};

function getWorkEditorScenario(task: TaskItem | null): WorkEditorScenario {
  if (!task) {
    return {
      key: "bbox-media",
      emptyStageMessage: "Следующая задача подгрузится автоматически.",
      annotationsTitle: "Объекты на сцене",
    };
  }

  if (task.workflow_stage === "text_transcription") {
    return {
      key: "text-transcription",
      emptyStageMessage: "Рамки фиксируются детекцией. Введи текст для каждой области в панели справа.",
      annotationsTitle: "Текстовые области",
    };
  }

  if (task.source_type === "image" || task.source_type === "video") {
    return {
      key: "bbox-media",
      emptyStageMessage:
        task.source_type === "video"
          ? "Поставь видео на паузу и работай по нужному кадру."
          : "Выделяй объекты прямо на сцене и назначай им активный label.",
      annotationsTitle: "Выделенные области",
    };
  }

  return {
    key: "json",
    emptyStageMessage: "Для этой задачи визуальная сцена не требуется. Используй редактор данных справа.",
    annotationsTitle: "Содержимое payload-а",
  };
}

function buildActivityMonthLabels(series: ActivitySeriesItem[]) {
  const labels: Array<{ label: string; weekIndex: number }> = [];
  let previousMonthKey: string | null = null;

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

function buildCalendarSeries(series: ActivitySeriesItem[], targetWeekCount = 52) {
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

function summarizeSelectedFiles(files: File[]) {
  if (!files.length) {
    return "Файлы пока не выбраны.";
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const archiveCount = files.filter((file) => isArchiveFile(file)).length;
  const sizePart = `общий размер ${formatFileSize(totalSize)}`;
  const archivePart = archiveCount ? `ZIP: ${archiveCount}` : "";
  if (files.length === 1) {
    return `Выбран файл: ${files[0].name} · ${sizePart}`;
  }
  const preview = files.slice(0, 3).map((file) => file.name).join(", ");
  const suffix = files.length > 3 ? ` и еще ${files.length - 3}` : "";
  return [`Выбрано ${files.length} файлов · ${sizePart}`, archivePart, `${preview}${suffix}`].filter(Boolean).join(" · ");
}

function readImageMetadata(file: File) {
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

function readVideoMetadata(file: File) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      const frameRate = 25;
      const duration = Number(video.duration.toFixed(3));
      resolve({
        name: file.name,
        width: video.videoWidth,
        height: video.videoHeight,
        duration,
        frame_rate: frameRate,
        frame_count: Math.max(1, Math.round(duration * frameRate)),
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Не удалось прочитать видео ${file.name}.`));
    };
    video.src = objectUrl;
  });
}

async function buildMediaManifest(files: File[], datasetMode: string) {
  const metadataFiles = getMediaMetadataFiles(files, datasetMode);
  if (datasetMode === "image") {
    return Promise.all(metadataFiles.map((file) => readImageMetadata(file)));
  }
  if (datasetMode === "video") {
    return Promise.all(metadataFiles.map((file) => readVideoMetadata(file)));
  }
  return [];
}

function getPayloadAnnotations(payload: any) {
  if (!payload || !Array.isArray(payload.annotations)) {
    return [];
  }
  return payload.annotations.filter(
    (annotation: any) =>
      annotation &&
      Array.isArray(annotation.points) &&
      annotation.points.length === 4 &&
      typeof annotation.label_id === "number"
  );
}

function normalizeEditorWorkspaceMode(
  requestedMode: string | null | undefined,
  options: { canAnnotate: boolean; canReview: boolean }
): EditorWorkspaceMode {
  if (requestedMode === "review" && options.canReview) {
    return "review";
  }
  if (requestedMode === "submitted" && options.canAnnotate) {
    return "submitted";
  }
  if (requestedMode === "queue" && options.canAnnotate) {
    return "queue";
  }
  if (options.canAnnotate) {
    return "queue";
  }
  return "review";
}

function replaceEditorUrlQuery(params: { mode: EditorWorkspaceMode; taskId?: number | null; annotatorId?: number | null }) {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", params.mode);
  if (params.taskId) {
    url.searchParams.set("task", String(params.taskId));
  } else {
    url.searchParams.delete("task");
  }
  if (params.annotatorId) {
    url.searchParams.set("annotator", String(params.annotatorId));
  } else {
    url.searchParams.delete("annotator");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItem;
  onClose: () => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (toast.persistent) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      onClose();
    }, FLASH_DEFAULT_DURATION);
    return () => window.clearTimeout(timeoutId);
  }, [toast.id, toast.persistent, onClose]);

  return (
    <section
      className={`toast-notification toast-notification--${toast.type}${toast.persistent ? " is-persistent" : ""}${isVisible ? " is-visible" : ""}`}
      role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
    >
      <div className="toast-notification__body">
        <span className="toast-notification__accent" aria-hidden="true"></span>
        <div className="toast-notification__content">
          <p className="toast-notification__message">{toast.message}</p>
        </div>
        <button
          type="button"
          className="toast-notification__close"
          aria-label="Закрыть уведомление"
          title="Закрыть уведомление"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {!toast.persistent ? (
        <div className="toast-notification__progress" aria-hidden="true">
          <span className="toast-notification__progress-bar"></span>
        </div>
      ) : null}
    </section>
  );
}

function ActivityBoard({ series }: { series: ActivitySeriesItem[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [weeks, setWeeks] = useState(ACTIVITY_MAX_WEEKS);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    function updateWeeks() {
      // The activity grid adapts to the available width instead of forcing a
      // fixed 52-week layout on narrow sidebars and mobile screens.
      const availableWidth = Math.floor(container.clientWidth || container.getBoundingClientRect().width || 0);
      if (!availableWidth) {
        setWeeks(ACTIVITY_MAX_WEEKS);
        return;
      }
      const weekStride = ACTIVITY_CELL_SIZE + ACTIVITY_CELL_GAP;
      const fittedWeeks = Math.floor((availableWidth - ACTIVITY_CALENDAR_PADDING + ACTIVITY_CELL_GAP) / weekStride);
      setWeeks(clamp(fittedWeeks, ACTIVITY_MIN_WEEKS, ACTIVITY_MAX_WEEKS));
    }

    updateWeeks();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateWeeks);
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWeeks);
    return () => window.removeEventListener("resize", updateWeeks);
  }, []);

  if (!series?.length) {
    return <div className="empty-card">Активность пока отсутствует.</div>;
  }

  const calendarSeries = buildCalendarSeries(series, weeks);
  const maxCount = Math.max(...calendarSeries.map((item) => item.count), 0);
  const calendarWidth = weeks * ACTIVITY_CELL_SIZE + (weeks - 1) * ACTIVITY_CELL_GAP + ACTIVITY_CALENDAR_PADDING;
  const monthLabels = buildActivityMonthLabels(calendarSeries);

  return (
    <div ref={containerRef} className="activity-board__viewport">
      <div className="activity-board__calendar" style={{ width: `${calendarWidth}px`, maxWidth: "100%" }}>
        <div className="activity-board__months" style={{ gridTemplateColumns: `repeat(${weeks}, ${ACTIVITY_CELL_SIZE}px)` }}>
          {monthLabels.map((item) => (
            <span key={`${item.weekIndex}-${item.label}`} className="activity-board__month" style={{ gridColumn: item.weekIndex + 1 }}>
              {item.label}
            </span>
          ))}
        </div>
        <div className="activity-board__grid" style={{ gridTemplateColumns: `repeat(${weeks}, ${ACTIVITY_CELL_SIZE}px)` }}>
          {calendarSeries.map((item) => {
            let level = 0;
            if (item.count > 0 && maxCount > 0) {
              const ratio = item.count / maxCount;
              level = ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : 3;
            }
            return <div key={item.date} className="activity-board__cell" data-level={level} title={`${item.date}: ${item.count}`}></div>;
          })}
        </div>
      </div>
      <div className="activity-board__legend">
        Интенсивность активности за последние {weeks} {formatWeeksLabel(weeks)}
      </div>
    </div>
  );
}

function RoomProgressChart({
  totalTasks,
  completedTasks,
  remainingTasks,
  progressPercent,
}: {
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  progressPercent: number;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const completedOffset = circumference * (1 - clamp(progressPercent || 0, 0, 100) / 100);

  return (
    <article className="room-progress-chart">
      <div className="room-progress-chart__visual">
        <svg viewBox="0 0 140 140" className="room-progress-chart__svg" aria-hidden="true">
          <circle className="room-progress-chart__track" cx="70" cy="70" r={radius}></circle>
          <circle
            className="room-progress-chart__value"
            cx="70"
            cy="70"
            r={radius}
            strokeDasharray={circumference.toFixed(2)}
            strokeDashoffset={completedOffset.toFixed(2)}
          ></circle>
        </svg>
        <div className="room-progress-chart__center">
          <strong>{formatPercent(progressPercent)}</strong>
          <span>готово</span>
        </div>
      </div>
      <div className="room-progress-chart__legend">
        <div className="room-progress-chart__legend-row">
          <span>Всего задач</span>
          <strong>{totalTasks}</strong>
        </div>
        <div className="room-progress-chart__legend-row">
          <span>Выполнено</span>
          <strong>{completedTasks}</strong>
        </div>
        <div className="room-progress-chart__legend-row">
          <span>Осталось</span>
          <strong>{remainingTasks}</strong>
        </div>
      </div>
    </article>
  );
}

function ReviewGraphicPreview({
  task,
  payload,
  labels,
}: {
  task: TaskItem;
  payload: any;
  labels: LabelItem[];
}) {
  if (!task?.source_file_url) {
    return null;
  }

  const annotations = getPayloadAnnotations(payload);
  if (!annotations.length) {
    return null;
  }

  const sourceWidth = Number(task.input_payload?.width || task.input_payload?.source_width || 1);
  const sourceHeight = Number(task.input_payload?.height || task.input_payload?.source_height || 1);
  const isImage = task.source_type === "image";

  return (
    <div className="review-media-stage media-stage">
      <div className="review-media-canvas media-canvas">
        {isImage ? (
          <img className="media-stage__asset" src={task.source_file_url} alt={task.source_name || `task-${task.id}`} />
        ) : (
          <video className="media-stage__asset" src={task.source_file_url} controls preload="metadata"></video>
        )}
        <div className="review-media-overlay media-overlay">
          {annotations.map((annotation: any, index: number) => {
            const label = labels.find((item) => item.id === annotation.label_id);
            const [xMin, yMin, xMax, yMax] = annotation.points;
            return (
              <div
                key={`${annotation.label_id}-${annotation.points.join("-")}-${index}`}
                className="review-media-bbox"
                style={{
                  left: `${(xMin / sourceWidth) * 100}%`,
                  top: `${(yMin / sourceHeight) * 100}%`,
                  width: `${((xMax - xMin) / sourceWidth) * 100}%`,
                  height: `${((yMax - yMin) / sourceHeight) * 100}%`,
                  ["--bbox-color" as any]: label?.color || "#B8B8B8",
                }}
              >
                <span className="review-media-bbox__label">{label?.name || `Label #${annotation.label_id}`}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ReviewTextSummary({
  payload,
  labels,
}: {
  payload: any;
  labels: LabelItem[];
}) {
  const annotations = getPayloadAnnotations(payload).filter((annotation: any) => typeof annotation.text === "string");
  if (!annotations.length) {
    return null;
  }

  return (
    <div className="review-text-summary">
      <div className="review-text-summary__title">Текст</div>
      <div className="review-text-summary__list">
        {annotations.map((annotation: any, index: number) => {
          const label = labels.find((item) => item.id === annotation.label_id);
          return (
            <div key={`${annotation.label_id}-${index}`} className="review-text-summary__item">
              <span className="review-text-summary__label">{label?.name || `Область ${index + 1}`}</span>
              <span className="review-text-summary__value">
                {annotation.text && annotation.text.length ? annotation.text : "Пустой текст"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const nextToastIdRef = useRef(bootstrap.messages.length);
  const [authUser, setAuthUser] = useState<AuthUser>(bootstrap.auth_user);
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme || "light");
  const [toasts, setToasts] = useState<ToastItem[]>(
    bootstrap.messages.map((message, index) => ({
      id: index + 1,
      message: message.message,
      type: normalizeToastType(message.type),
      persistent: Boolean(message.persistent),
    }))
  );

  function setTheme(nextTheme: string) {
    setThemeState(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem("datasetai-theme", nextTheme);
    } catch (error) {
      // no-op
    }
  }

  function addToast(message: string, type: ToastType = "success", options?: { persistent?: boolean }) {
    const text = String(message || "").trim();
    if (!text) {
      return;
    }
    nextToastIdRef.current += 1;
    setToasts((current) => [
      ...current,
      {
        id: nextToastIdRef.current,
        message: text,
        type: normalizeToastType(type),
        persistent: Boolean(options?.persistent),
      },
    ]);
  }

  function clearToasts(includePersistent = false) {
    setToasts((current) => current.filter((item) => item.persistent && !includePersistent));
  }

  function removeToast(id: number) {
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  const contextValue: AppContextValue = {
    bootstrap,
    authUser,
    setAuthUser,
    theme,
    setTheme,
    addToast,
    clearToasts,
    removeToast,
    api: (path, options) => apiRequest(path, authUser, options),
  };
  const isEditorPage = bootstrap.page === "room-work";

  return (
    <AppContext.Provider value={contextValue}>
      <div className={`app-shell${isEditorPage ? " app-shell--editor" : ""}`}>
        {isEditorPage ? null : <Header />}
        <div
          id="toast-region"
          className={`toast-region${isEditorPage ? " toast-region--editor" : ""}`}
          aria-live="polite"
          aria-relevant="additions text"
        >
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
          ))}
        </div>
        <main className={isEditorPage ? "page-layout page-layout--editor" : "page-layout"}>
          <PageRouter />
        </main>
      </div>
    </AppContext.Provider>
  );
}

function Header() {
  const { bootstrap, authUser, theme, setTheme } = useApp();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <header className="site-header">
      <div className="site-header__left">
        <a className="brand-mark" href="/">
          <span className="brand-mark__logo" aria-hidden="true">
            <img className="brand-mark__logo-image" src={bootstrap.assets.brand_mark} alt="" />
          </span>
          <span className="brand-mark__text">
            <strong>DataSetAI</strong>
            <small>Платформа разметки</small>
          </span>
        </a>
        <nav className="site-nav">
          <a className={`site-nav__link ${bootstrap.active_page === "home" ? "is-active" : ""}`} href="/">
            Главная
          </a>
          <a className={`site-nav__link ${bootstrap.active_page === "rooms" ? "is-active" : ""}`} href="/rooms/">
            Комнаты
          </a>
        </nav>
      </div>

      <div className="site-header__right">
        <div className="auth-actions">
          <div className="theme-toggle-shell">
            <input
              id="theme-toggle"
              className="theme-toggle__checkbox"
              type="checkbox"
              checked={theme === "dark"}
              aria-label={`Переключить на ${nextTheme === "dark" ? "тёмную" : "светлую"} тему`}
              title={`Переключить на ${nextTheme === "dark" ? "тёмную" : "светлую"} тему`}
              onChange={(event) => setTheme(event.currentTarget.checked ? "dark" : "light")}
            />
            <label htmlFor="theme-toggle" className="theme-toggle__label"></label>
          </div>
          {authUser ? (
            <>
              <a id="header-profile-link" className="btn btn--muted btn--compact" href={`/users/${authUser.id}/profile/`}>
                {getDisplayName(authUser)}
              </a>
              <form action="/auth/logout/" method="post" className="logout-form">
                <input type="hidden" name="csrfmiddlewaretoken" value={bootstrap.csrf_token} />
                <button className="btn btn--secondary btn--compact" type="submit">
                  Выйти
                </button>
              </form>
            </>
          ) : (
            <>
              <a className="btn btn--muted btn--compact" href="/auth/login/">
                Войти
              </a>
              <a className="btn btn--primary btn--compact" href="/auth/register/">
                Зарегистрироваться
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function PageRouter() {
  const { bootstrap } = useApp();

  // Django decides which page is being served, React only maps the page key to
  // the corresponding screen component.
  switch (bootstrap.page) {
    case "home":
      return <LandingPage />;
    case "rooms":
      return <RoomsPage />;
    case "profile":
      return <ProfilePage />;
    case "room-create":
      return <RoomCreatePage />;
    case "room-edit":
      return <RoomEditPage />;
    case "room-detail":
      return <RoomDetailPage />;
    case "room-work":
      return <RoomWorkPage />;
    case "video-pre-annotation":
      return <VideoPreAnnotationPage />;
    case "frame-annotation":
      return <FrameAnnotationPage />;
    case "room-invite":
      return <RoomInvitePage />;
    case "auth-login":
      return <LoginPage />;
    case "auth-register":
      return <RegisterPage />;
    default:
      return <div className="empty-card">Страница не найдена.</div>;
  }
}

function LandingPage() {
  const { authUser, api } = useApp();
  const [activeTab, setActiveTab] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(Boolean(authUser));
  const [roomsLoadError, setRoomsLoadError] = useState("");

  useEffect(() => {
    if (!authUser) {
      setRooms([]);
      setRoomsLoading(false);
      return;
    }

    let isCancelled = false;

    async function loadLandingRooms() {
      setRoomsLoading(true);
      setRoomsLoadError("");
      try {
        const [ownedRooms, memberRooms] = await Promise.all<RoomItem[]>([api("/api/v1/rooms/"), api("/api/v1/me/rooms/")]);
        if (isCancelled) {
          return;
        }
        const roomMap = new Map<number, RoomItem>();
        [...(ownedRooms || []), ...(memberRooms || [])].forEach((room) => {
          if (!roomMap.has(room.id)) {
            roomMap.set(room.id, room);
          }
        });
        setRooms(
          Array.from(roomMap.values()).sort((left, right) => {
            if (Boolean(left.is_pinned) !== Boolean(right.is_pinned)) {
              return Number(Boolean(right.is_pinned)) - Number(Boolean(left.is_pinned));
            }
            const rightAccess = right.last_accessed_at ? new Date(right.last_accessed_at).getTime() : 0;
            const leftAccess = left.last_accessed_at ? new Date(left.last_accessed_at).getTime() : 0;
            if (rightAccess !== leftAccess) {
              return rightAccess - leftAccess;
            }
            return Number(right.id) - Number(left.id);
          })
        );
      } catch (error) {
        if (!isCancelled) {
          setRoomsLoadError(getErrorMessage(error));
        }
      } finally {
        if (!isCancelled) {
          setRoomsLoading(false);
        }
      }
    }

    void loadLandingRooms();

    return () => {
      isCancelled = true;
    };
  }, [authUser]);

  const workItems = rooms.map((room) => {
    const progress = Math.max(0, Math.min(100, Number(room.progress_percent || 0)));
    const filterType = room.dataset_type === "json" || room.dataset_type === "demo" ? "text" : room.dataset_type || "text";
    return {
      id: room.id,
      tab: room.total_tasks > 0 && progress < 100 ? "active" : "all",
      filter: filterType,
      label: translateDatasetMode(room.dataset_type),
      title: room.title,
      text: room.description || room.dataset_label || "Описание комнаты пока не заполнено.",
      status: formatPercent(progress),
      meta: [room.dataset_label || "Датасет", translateAnnotationWorkflow(room.annotation_workflow || "standard"), `${room.completed_tasks}/${room.total_tasks} задач`],
      href: `/rooms/${room.id}/`,
      action: "Открыть",
    };
  });
  const boardTabs = [
    { id: "all", label: "Все", count: workItems.length },
    { id: "active", label: "В работе", count: workItems.filter((item) => item.tab === "active").length },
  ];
  const filters = [
    { id: "all", label: "Все типы" },
    { id: "text", label: "Текст" },
    { id: "image", label: "Изображения" },
    { id: "video", label: "Видео" },
  ];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleItems = workItems.filter((item) => {
    const matchesTab = activeTab === "all" || item.tab === activeTab;
    const matchesFilter = activeFilter === "all" || item.filter === activeFilter;
    const searchable = `${item.label} ${item.title} ${item.text} ${item.status} ${item.meta.join(" ")}`.toLowerCase();
    const matchesSearch = !normalizedQuery || searchable.includes(normalizedQuery);
    return matchesTab && matchesFilter && matchesSearch;
  });

  return (
    <main className="landing-shell">
      <section className="taskboard-layout" aria-label="Рабочая доска DataSetAI">
        <aside className="taskboard-panel taskboard-panel--filters">
          <div className="taskboard-panel__head">
            <span>Фильтры</span>
            <strong>Тип работы</strong>
          </div>
          <div className="taskboard-filter-list" role="list" aria-label="Фильтр по типу">
            {filters.map((item) => (
              <button
                className={["taskboard-filter", activeFilter === item.id ? "is-active" : ""].filter(Boolean).join(" ")}
                type="button"
                onClick={() => setActiveFilter(item.id)}
                key={item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="taskboard-main" aria-label="Список задач и сценариев">
          <div className="taskboard-toolbar">
            <label className="taskboard-search">
              <span>Поиск</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Название комнаты, датасет или тип данных"
              />
            </label>
            <a className="taskboard-create" href={authUser ? "/rooms/create/" : "/auth/login/"}>
              Создать комнату
            </a>
          </div>

          <div className="taskboard-tabs" role="tablist" aria-label="Разделы главного экрана">
            {boardTabs.map((item) => (
              <button
                className={["taskboard-tab", activeTab === item.id ? "is-active" : ""].filter(Boolean).join(" ")}
                type="button"
                role="tab"
                aria-selected={activeTab === item.id}
                onClick={() => setActiveTab(item.id)}
                key={item.id}
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>

          <div className="taskboard-list">
            {roomsLoading ? (
              <div className="taskboard-empty">
                <strong>Загружаем комнаты</strong>
                <span>Список появится через пару секунд.</span>
              </div>
            ) : roomsLoadError ? (
              <div className="taskboard-empty">
                <strong>Не удалось загрузить комнаты</strong>
                <span>{roomsLoadError}</span>
              </div>
            ) : visibleItems.length ? (
              visibleItems.map((item) => (
                <a className="taskboard-item taskboard-item--room" href={item.href} key={item.id}>
                  <span className="taskboard-item__label">{item.label}</span>
                  <div className="taskboard-item__body">
                    <div className="taskboard-item__title">
                      <h2>{item.title}</h2>
                      <span>{item.status}</span>
                    </div>
                    <p>{item.text}</p>
                    <div className="taskboard-item__meta">
                      {item.meta.map((metaItem) => (
                        <small key={metaItem}>{metaItem}</small>
                      ))}
                    </div>
                  </div>
                  <strong className="taskboard-item__action">{item.action}</strong>
                </a>
              ))
            ) : (
              <div className="taskboard-empty">
                <strong>{authUser ? "Комнат не найдено" : "Войдите, чтобы увидеть комнаты"}</strong>
                <span>{authUser ? "Попробуйте другой запрос или сбросьте фильтр." : "На главной показываются только комнаты, доступные вашему аккаунту."}</span>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function LoginPage() {
  const { bootstrap } = useApp();
  const formState = bootstrap.page_payload.form;
  const nextPath = new URLSearchParams(window.location.search).get("next") || "";
  const emailField = formState?.fields.email;
  const passwordField = formState?.fields.password;

  return (
    <section className="auth-page">
      <div className="auth-card">
        <span className="eyebrow">Авторизация</span>
        <h1>Вход в аккаунт</h1>

        <form method="post" className="auth-form">
          <input type="hidden" name="csrfmiddlewaretoken" value={bootstrap.csrf_token} />
          {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
          {formState?.non_field_errors?.length ? (
            <div className="panel-note">{formState.non_field_errors.join(" ")}</div>
          ) : null}
          <label className="field">
            <span>{emailField?.label || "Email"}</span>
            <input name="email" type="email" defaultValue={emailField?.value || ""} required />
          </label>
          {emailField?.errors?.length ? <div className="panel-note">{emailField.errors.join(" ")}</div> : null}
          <label className="field">
            <span>{passwordField?.label || "Пароль"}</span>
            <input name="password" type="password" required />
          </label>
          {passwordField?.errors?.length ? <div className="panel-note">{passwordField.errors.join(" ")}</div> : null}
          <button className="btn btn--primary" type="submit">
            Войти
          </button>
        </form>
      </div>
    </section>
  );
}

function RegisterPage() {
  const { bootstrap } = useApp();
  const formState = bootstrap.page_payload.form;
  const nextPath = new URLSearchParams(window.location.search).get("next") || "";
  const fullNameField = formState?.fields.full_name;
  const emailField = formState?.fields.email;
  const passwordField = formState?.fields.password;
  const repeatField = formState?.fields.password_repeat;

  return (
    <section className="auth-page">
      <div className="auth-card">
        <span className="eyebrow">Регистрация</span>
        <h1>Создать аккаунт</h1>
        <p>После регистрации ты сможешь создавать комнаты и участвовать в чужих комнатах без выбора глобальной роли.</p>

        <form method="post" className="auth-form">
          <input type="hidden" name="csrfmiddlewaretoken" value={bootstrap.csrf_token} />
          {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
          {formState?.non_field_errors?.length ? (
            <div className="panel-note">{formState.non_field_errors.join(" ")}</div>
          ) : null}
          <label className="field">
            <span>{fullNameField?.label || "ФИО"}</span>
            <input name="full_name" type="text" defaultValue={fullNameField?.value || ""} required />
          </label>
          {fullNameField?.errors?.length ? <div className="panel-note">{fullNameField.errors.join(" ")}</div> : null}
          <label className="field">
            <span>{emailField?.label || "Email"}</span>
            <input name="email" type="email" defaultValue={emailField?.value || ""} required />
          </label>
          {emailField?.errors?.length ? <div className="panel-note">{emailField.errors.join(" ")}</div> : null}
          <label className="field">
            <span>{passwordField?.label || "Пароль"}</span>
            <input name="password" type="password" required />
          </label>
          {passwordField?.errors?.length ? <div className="panel-note">{passwordField.errors.join(" ")}</div> : null}
          <label className="field">
            <span>{repeatField?.label || "Повтори пароль"}</span>
            <input name="password_repeat" type="password" required />
          </label>
          {repeatField?.errors?.length ? <div className="panel-note">{repeatField.errors.join(" ")}</div> : null}
          <button className="btn btn--primary" type="submit">
            Зарегистрироваться
          </button>
        </form>
      </div>
    </section>
  );
}

function RoomsPage() {
  const { authUser, api, addToast, clearToasts } = useApp();
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinBusyRoomId, setPinBusyRoomId] = useState<number | null>(null);
  const [roomSearch, setRoomSearch] = useState("");
  const [roomFilter, setRoomFilter] = useState<RoomListFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState<RoomDatasetFilter>("all");

  function sortRooms(list: RoomItem[]) {
    return [...list].sort((left, right) => {
      if (Boolean(left.is_pinned) !== Boolean(right.is_pinned)) {
        return Number(Boolean(right.is_pinned)) - Number(Boolean(left.is_pinned));
      }

      if (left.is_pinned && right.is_pinned) {
        const leftOrder = left.pin_sort_order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.pin_sort_order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
      }

      const rightAccess = right.last_accessed_at ? new Date(right.last_accessed_at).getTime() : 0;
      const leftAccess = left.last_accessed_at ? new Date(left.last_accessed_at).getTime() : 0;
      if (rightAccess !== leftAccess) {
        return rightAccess - leftAccess;
      }

      const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
      const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
      if (rightCreatedAt !== leftCreatedAt) {
        return rightCreatedAt - leftCreatedAt;
      }

      return Number(right.id) - Number(left.id);
    });
  }

  async function loadRooms() {
    if (!authUser) {
      return;
    }

    setLoading(true);
    try {
      const [ownedRooms, memberRooms] = await Promise.all<RoomItem[]>([api("/api/v1/rooms/"), api("/api/v1/me/rooms/")]);
      const roomMap = new Map<number, RoomItem>();
      [...(ownedRooms || []), ...(memberRooms || [])].forEach((room) => {
        if (!roomMap.has(room.id)) {
          roomMap.set(room.id, room);
        }
      });
      setRooms(sortRooms(Array.from(roomMap.values())));
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
  }, []);

  async function handleTogglePin(event: React.MouseEvent<HTMLButtonElement>, room: RoomItem) {
    event.preventDefault();
    event.stopPropagation();
    clearToasts();
    setPinBusyRoomId(room.id);

    try {
      await api(`/api/v1/rooms/${room.id}/pin/`, {
        method: "POST",
        body: { is_pinned: !room.is_pinned },
      });
      addToast(!room.is_pinned ? `Комната #${room.id} закреплена.` : `Комната #${room.id} откреплена.`, "success");
      await loadRooms();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setPinBusyRoomId(null);
    }
  }

  async function handleReorderPin(event: React.MouseEvent<HTMLButtonElement>, room: RoomItem, direction: "up" | "down") {
    event.preventDefault();
    event.stopPropagation();
    clearToasts();
    setPinBusyRoomId(room.id);

    try {
      await api(`/api/v1/rooms/${room.id}/pin/reorder/`, {
        method: "POST",
        body: { direction },
      });
      await loadRooms();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setPinBusyRoomId(null);
    }
  }

  const pinnedRooms = rooms.filter((room) => room.is_pinned);
  const activeRoomsCount = rooms.filter((room) => room.total_tasks > 0 && room.progress_percent < 100).length;
  const ownedRoomsCount = rooms.filter((room) => room.created_by_id === authUser?.id || (room.membership_role || "owner") === "owner").length;
  const reviewRoomsCount = rooms.filter((room) => ["admin", "owner", "reviewer"].includes(room.membership_role || "owner")).length;
  const normalizedRoomSearch = roomSearch.trim().toLowerCase();
  const hasActiveRoomFilters = Boolean(normalizedRoomSearch || roomFilter !== "all" || datasetFilter !== "all");
  const roomFilters: Array<{ value: RoomListFilter; label: string; count: number }> = [
    { value: "all", label: "Все", count: rooms.length },
    { value: "pinned", label: "Закрепленные", count: pinnedRooms.length },
    { value: "owned", label: "Мои", count: ownedRoomsCount },
    { value: "active", label: "В работе", count: activeRoomsCount },
    { value: "review", label: "Ревью", count: reviewRoomsCount },
  ];
  const datasetFilters: Array<{ value: RoomDatasetFilter; label: string }> = [
    { value: "all", label: "Все типы" },
    { value: "text", label: "Текст" },
    { value: "image", label: "Изображения" },
    { value: "video", label: "Видео" },
  ];

  function roomMatchesFilters(room: RoomItem) {
    if (datasetFilter !== "all" && room.dataset_type !== datasetFilter) {
      return false;
    }

    if (roomFilter === "pinned" && !room.is_pinned) {
      return false;
    }
    if (roomFilter === "owned" && room.created_by_id !== authUser?.id && (room.membership_role || "owner") !== "owner") {
      return false;
    }
    if (roomFilter === "active" && !(room.total_tasks > 0 && room.progress_percent < 100)) {
      return false;
    }
    if (roomFilter === "review" && !["admin", "owner", "reviewer"].includes(room.membership_role || "owner")) {
      return false;
    }

    if (!normalizedRoomSearch) {
      return true;
    }

    return [
      `#${room.id}`,
      `комната ${room.id}`,
      room.title,
      room.description,
      room.dataset_label,
      translateDatasetMode(room.dataset_type),
      translateAnnotationWorkflow(room.annotation_workflow || "standard"),
      translateRole(room.membership_role || "owner"),
      translateMembership(room.membership_status || "owner"),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedRoomSearch);
  }

  const filteredRooms = rooms.filter(roomMatchesFilters);
  const visiblePinnedRooms = hasActiveRoomFilters ? [] : pinnedRooms;
  const visibleMainRooms = hasActiveRoomFilters ? filteredRooms : filteredRooms.filter((room) => !room.is_pinned);
  const mainSectionTitle = hasActiveRoomFilters ? "Найденные комнаты" : "Все комнаты";
  const mainSectionNote = hasActiveRoomFilters
    ? `${filteredRooms.length} из ${rooms.length} комнат подходят под текущие фильтры.`
    : "Комнаты, которые вы создали или к которым у вас уже есть доступ.";

  function renderRoomCard(room: RoomItem) {
    const pinnedIndex = pinnedRooms.findIndex((item) => item.id === room.id);
    const canMoveUp = room.is_pinned && pinnedIndex > 0;
    const canMoveDown = room.is_pinned && pinnedIndex > -1 && pinnedIndex < pinnedRooms.length - 1;
    const role = room.membership_role || "owner";
    const canOpenWork = ["admin", "annotator", "owner"].includes(role);
    const canOpenReview = ["admin", "owner", "reviewer"].includes(role);
    const remainingTasks = Math.max(0, Number(room.total_tasks || 0) - Number(room.completed_tasks || 0));

    return (
      <article
        key={room.id}
        className={`room-card room-card--navigator ${room.is_pinned ? "is-pinned" : ""}`}
        onClick={() => {
          window.location.href = `/rooms/${room.id}/`;
        }}
      >
        <div className="room-card__body">
          <div className="room-card__head">
            <div className="room-card__id">Комната #{room.id}</div>
            <div className="room-card__actions">
              {room.is_pinned ? (
                <div className="room-card__pin-order">
                  <button
                    className="room-card__reorder"
                    type="button"
                    disabled={!canMoveUp || pinBusyRoomId === room.id}
                    aria-label="Поднять закреплённую комнату выше"
                    title="Поднять выше"
                    onClick={(event) => handleReorderPin(event, room, "up")}
                  >
                    ↑
                  </button>
                  <button
                    className="room-card__reorder"
                    type="button"
                    disabled={!canMoveDown || pinBusyRoomId === room.id}
                    aria-label="Опустить закреплённую комнату ниже"
                    title="Опустить ниже"
                    onClick={(event) => handleReorderPin(event, room, "down")}
                  >
                    ↓
                  </button>
                </div>
              ) : null}
              <button
                className="room-card__pin"
                type="button"
                disabled={pinBusyRoomId === room.id}
                aria-pressed={room.is_pinned}
                aria-label={room.is_pinned ? "Убрать комнату из закреплённых" : "Закрепить комнату"}
                title={room.is_pinned ? "Убрать из закреплённых" : "Закрепить комнату"}
                onClick={(event) => handleTogglePin(event, room)}
              >
                {room.is_pinned ? "★" : "☆"}
              </button>
            </div>
          </div>
          <div className="room-card__title">{room.title}</div>
          <div className="room-card__meta">{room.description || "Описание пока не заполнено."}</div>
          <div className="room-card__chips" aria-label="Параметры комнаты">
            <span>{translateDatasetMode(room.dataset_type)}</span>
            <span>{translateAnnotationWorkflow(room.annotation_workflow || "standard")}</span>
            <span>{translateRole(role)}</span>
          </div>
        </div>
        <div className="room-card__progress" aria-label={`Прогресс ${formatPercent(room.progress_percent)}`}>
          <div className="room-card__progress-meta">
            <span>Прогресс</span>
            <strong>{formatPercent(room.progress_percent)}</strong>
          </div>
          <div className="room-card__progress-track">
            <span style={{ width: `${Math.max(0, Math.min(100, Number(room.progress_percent || 0)))}%` }}></span>
          </div>
        </div>
        <div className="room-card__footer">
          <div>
            Задачи: {room.completed_tasks}/{room.total_tasks}
          </div>
          <div>Осталось: {remainingTasks}</div>
          <div>Дедлайн: {formatDate(room.deadline)}</div>
        </div>
        <div className="room-card__quick-actions" aria-label="Быстрые действия">
          <a
            className="btn btn--secondary btn--compact"
            href={`/rooms/${room.id}/`}
            onClick={(event) => event.stopPropagation()}
          >
            Открыть
          </a>
          {canOpenWork ? (
            <a
              className="btn btn--muted btn--compact"
              href={`/rooms/${room.id}/work/`}
              onClick={(event) => event.stopPropagation()}
            >
              Разметка
            </a>
          ) : null}
          {canOpenReview ? (
            <a
              className="btn btn--muted btn--compact"
              href={`/rooms/${room.id}/work/?mode=review`}
              onClick={(event) => event.stopPropagation()}
            >
              Ревью
            </a>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <>
      <section className="page-topbar page-topbar--rooms rooms-navigator-hero">
        <div className="page-topbar__copy">
          <span className="eyebrow">Навигатор комнат</span>
          <h1>Комнаты</h1>
          <p>Быстрый вход в рабочие пространства: закрепляйте важные комнаты, фильтруйте по сценарию и переходите прямо к разметке или ревью.</p>
        </div>
        <div className="rooms-navigator-hero__side">
          <div className="rooms-navigator-metrics" aria-label="Сводка комнат">
            <article>
              <span>Доступно</span>
              <strong>{rooms.length}</strong>
            </article>
            <article>
              <span>Закреплено</span>
              <strong>{pinnedRooms.length}</strong>
            </article>
            <article>
              <span>В работе</span>
              <strong>{activeRoomsCount}</strong>
            </article>
          </div>
          <a className="btn btn--primary rooms-navigator-create" href="/rooms/create/">
            Создать комнату
          </a>
        </div>
      </section>

      <section className="rooms-control-panel" aria-label="Фильтры комнат">
        <label className="rooms-search">
          <span>Поиск</span>
          <input
            value={roomSearch}
            type="text"
            placeholder="Название, ID, датасет или роль"
            onChange={(event) => setRoomSearch(event.currentTarget.value)}
          />
        </label>
        <div className="rooms-filter-bar" aria-label="Фильтр списка комнат">
          {roomFilters.map((filter) => (
            <button
              key={filter.value}
              className={`rooms-filter-chip ${roomFilter === filter.value ? "is-active" : ""}`}
              type="button"
              onClick={() => setRoomFilter(filter.value)}
            >
              <span>{filter.label}</span>
              <strong>{filter.count}</strong>
            </button>
          ))}
        </div>
        <label className="rooms-dataset-filter">
          <span>Тип датасета</span>
          <select value={datasetFilter} onChange={(event) => setDatasetFilter(event.currentTarget.value as RoomDatasetFilter)}>
            {datasetFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {loading ? <div className="empty-card">Загружаем комнаты.</div> : null}
      {!loading && !rooms.length ? (
        <div className="empty-card rooms-empty-state">
          <strong>У вас пока нет доступных комнат.</strong>
          <span>Создайте первую комнату или попросите владельца отправить invite-ссылку.</span>
          <a className="btn btn--primary" href="/rooms/create/">
            Создать комнату
          </a>
        </div>
      ) : null}

      {!loading && rooms.length ? (
        <>
          {visiblePinnedRooms.length ? (
            <section className="room-grid-section room-grid-section--pinned">
              <div className="room-grid-section__header">
                <div className="room-grid-section__divider">
                  <span>Закрепленные</span>
                </div>
                <p>Комнаты, которые должны быть под рукой.</p>
              </div>
              <div className="room-grid room-grid--navigator">{visiblePinnedRooms.map(renderRoomCard)}</div>
            </section>
          ) : null}

          <section className="room-grid-section">
            <div className="room-grid-section__header">
              <div className="room-grid-section__divider">
                <span>{mainSectionTitle}</span>
              </div>
              <p>{mainSectionNote}</p>
            </div>
            {visibleMainRooms.length ? (
              <div className="room-grid room-grid--navigator">{visibleMainRooms.map(renderRoomCard)}</div>
            ) : (
              <div className="empty-card rooms-empty-state">
                <strong>Комнаты не найдены.</strong>
                <span>Попробуйте изменить поиск, фильтр или тип датасета.</span>
                <button
                  className="btn btn--muted"
                  type="button"
                  onClick={() => {
                    setRoomSearch("");
                    setRoomFilter("all");
                    setDatasetFilter("all");
                  }}
                >
                  Сбросить фильтры
                </button>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function ProfilePage() {
  const { bootstrap, authUser, setAuthUser, api, addToast } = useApp();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      if (!authUser) {
        return;
      }

      try {
        const profileUserId = bootstrap.profile_user_id || authUser.id;
        const nextProfile = await api<UserProfile>(
          profileUserId === authUser.id ? "/api/v1/me/profile/" : `/api/v1/users/${profileUserId}/profile/`
        );
        setProfile(nextProfile);
        setFullName(nextProfile.full_name || "");
        setEmail(nextProfile.email || "");
      } catch (error) {
        addToast(getErrorMessage(error), "error");
      }
    }

    loadProfile();
  }, []);

  const overview = profile?.overview;
  const roomSeries = overview
    ? [
        { label: "Доступные", value: Number(overview.accessible_rooms_count || 0) },
        { label: "Созданные", value: Number(overview.created_rooms_count || 0) },
        { label: "Как исполнитель", value: Number(overview.joined_rooms_count || 0) },
        { label: "Приглашения", value: Number(overview.invitations_count || 0) },
      ]
    : [];
  const workSeries = overview
    ? [
        { label: "Размечено", value: Number(overview.completed_tasks || 0) },
        { label: "В работе", value: Number(overview.in_progress_tasks || 0) },
      ]
    : [];

  function renderChartRows(series: Array<{ label: string; value: number }>) {
    const maxValue = Math.max(...series.map((item) => item.value), 0);
    return series.map((item) => {
      const ratio = maxValue > 0 ? item.value / maxValue : 0;
      return (
        <div key={item.label} className="profile-chart-card__row">
          <div className="profile-chart-card__meta">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
          <div className="profile-chart-card__track">
            <div className="profile-chart-card__fill" style={{ width: `${Math.max(ratio * 100, item.value > 0 ? 8 : 0)}%` }}></div>
          </div>
        </div>
      );
    });
  }

  async function handleProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.can_edit) {
      return;
    }

    setSaving(true);
    try {
      const nextProfile = await api<UserProfile>("/api/v1/me/profile/", {
        method: "PATCH",
        body: {
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
        },
      });
      setProfile(nextProfile);
      setFullName(nextProfile.full_name || "");
      setEmail(nextProfile.email || "");
      setAuthUser((current) =>
        current
          ? {
              ...current,
              email: nextProfile.email,
              full_name: nextProfile.full_name,
              display_name: nextProfile.display_name,
            }
          : current
      );
      addToast("Профиль обновлен.", "success");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="page-topbar page-topbar--profile">
        <div className="page-topbar__copy">
          <span className="eyebrow">Профиль</span>
          <h1>Статистика пользователя</h1>
          <p>Сводка по созданным комнатам, участию в разметке и личной активности.</p>
        </div>
      </section>

      <section className="wide-card wide-card--stack wide-card--profile">
        <div className="wide-card__column">
          <h2>О пользователе</h2>
          {profile ? (
            <>
              <div className="summary-stack">
                <div className="summary-row">
                  <span>Пользователь</span>
                  <strong>
                    #{profile.id} {profile.display_name}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Email</span>
                  <strong>{profile.email}</strong>
                </div>
                <div className="summary-row">
                  <span>Создано комнат</span>
                  <strong>{profile.overview.created_rooms_count}</strong>
                </div>
                <div className="summary-row">
                  <span>Комнат как исполнителю</span>
                  <strong>{profile.overview.joined_rooms_count}</strong>
                </div>
                <div className="summary-row">
                  <span>Приглашения / доступы</span>
                  <strong>{profile.overview.invitations_count}</strong>
                </div>
              </div>
              {profile.can_edit ? (
                <form className="auth-form" onSubmit={handleProfileSave}>
                  <label className="field">
                    <span>ФИО</span>
                    <input value={fullName} type="text" required onChange={(event) => setFullName(event.currentTarget.value)} />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input value={email} type="email" required onChange={(event) => setEmail(event.currentTarget.value)} />
                  </label>
                  <button className="btn btn--primary" type="submit" disabled={saving}>
                    {saving ? "Сохраняем..." : "Сохранить профиль"}
                  </button>
                </form>
              ) : null}
            </>
          ) : (
            <div className="summary-stack empty-card">Данные профиля загружаются.</div>
          )}
        </div>
        <div className="wide-card__column wide-card__column--activity">
          <h2>Активность</h2>
          <div className="activity-board">{profile ? <ActivityBoard series={profile.activity} /> : <div className="empty-card">Активность загружается.</div>}</div>
          <div className="card-grid profile-metrics-grid profile-metrics-grid--embedded">
            {overview ? (
              <>
                <article className="profile-chart-card">
                  <div className="profile-chart-card__head">
                    <span>Комнаты</span>
                    <strong>{roomSeries[0]?.value || 0}</strong>
                  </div>
                  <div className="profile-chart-card__rows">{renderChartRows(roomSeries)}</div>
                </article>
                <article className="profile-chart-card">
                  <div className="profile-chart-card__head">
                    <span>Работа</span>
                    <strong>{(workSeries[0]?.value || 0) + (workSeries[1]?.value || 0)}</strong>
                  </div>
                  <div className="profile-chart-card__rows">{renderChartRows(workSeries)}</div>
                </article>
              </>
            ) : (
              <div className="empty-card">Данные профиля загружаются.</div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function RoomInvitePage() {
  const { bootstrap, authUser, api, addToast } = useApp();
  const inviteToken = bootstrap.page_payload.invite_token || "";
  const [preview, setPreview] = useState<RoomInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const nextPath = `${window.location.pathname}${window.location.search}`;

  async function loadPreview() {
    if (!inviteToken) {
      addToast("Invite-токен не найден в URL.", "error");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextPreview = await api<RoomInvitePreview>(`/api/v1/rooms/invite/${inviteToken}/`, {
        allowAnonymous: true,
      });
      setPreview(nextPreview);
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
  }, [inviteToken, authUser?.id]);

  async function handleRequestAccess() {
    if (!inviteToken) {
      return;
    }

    setSubmitting(true);
    try {
      await api(`/api/v1/rooms/invite/${inviteToken}/request/`, {
        method: "POST",
        body: {},
      });
      addToast("Заявка отправлена. Теперь ее должен принять владелец или администратор комнаты.", "success");
      await loadPreview();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  const accessStatus = preview?.actor?.access_status;

  return (
    <>
      <section className="page-topbar page-topbar--room">
        <div className="page-topbar__copy">
          <span className="eyebrow">Invite</span>
          <h1>{preview?.room.title || "Обрабатываем invite-ссылку..."}</h1>
          <p>{preview?.room.description || "Проверяем доступ к комнате и текущее состояние заявки."}</p>
          {preview?.room.description_pdf_url ? (
            <a className="btn btn--muted btn--compact room-description-pdf-link" href={preview.room.description_pdf_url} target="_blank" rel="noreferrer">
              {preview.room.description_pdf_name || "Открыть PDF с описанием"}
            </a>
          ) : null}
        </div>
      </section>

      <section className="wide-card wide-card--stack wide-card--profile">
        <div className="wide-card__column">
          {loading ? (
            <div className="empty-card">Загружаем данные по invite-ссылке.</div>
          ) : preview ? (
            <div className="summary-stack">
              <div className="summary-row">
                <span>Комната</span>
                <strong>#{preview.room.id}</strong>
              </div>
              <div className="summary-row">
                <span>Датасет</span>
                <strong>{preview.room.dataset_label || "Тестовый датасет"}</strong>
              </div>
              <div className="summary-row">
                <span>Владелец</span>
                <strong>{preview.room.created_by_display_name}</strong>
              </div>
              <div className="summary-row">
                <span>Доступ по паролю</span>
                <strong>{preview.room.has_password ? "У комнаты есть пароль" : "Пароль не требуется"}</strong>
              </div>
            </div>
          ) : (
            <div className="empty-card">Invite-ссылка недоступна.</div>
          )}
        </div>

        <div className="wide-card__column">
          {!authUser ? (
            <div className="summary-stack">
              <h2>Нужна авторизация</h2>
              <p>Чтобы отправить заявку в комнату, сначала войди в аккаунт или создай его.</p>
              <div className="form-actions">
                <a className="btn btn--muted" href={`/auth/login/?next=${encodeURIComponent(nextPath)}`}>
                  Войти
                </a>
                <a className="btn btn--primary" href={`/auth/register/?next=${encodeURIComponent(nextPath)}`}>
                  Зарегистрироваться
                </a>
              </div>
            </div>
          ) : accessStatus === "owner" || accessStatus === "joined" || accessStatus === "invited" ? (
            <div className="summary-stack">
              <h2>Доступ уже есть</h2>
              <p>
                {accessStatus === "owner"
                  ? "Ты владелец этой комнаты."
                  : accessStatus === "joined"
                    ? "Ты уже состоишь в комнате."
                    : "Ты уже добавлен в комнату."}
              </p>
              <div className="form-actions">
                <a className="btn btn--primary" href={`/rooms/${preview?.room.id}/`}>
                  Открыть комнату
                </a>
              </div>
            </div>
          ) : accessStatus === "pending" ? (
            <div className="summary-stack">
              <h2>Заявка ожидает решения</h2>
              <p>Владелец или администратор комнаты должны принять запрос на вступление.</p>
            </div>
          ) : accessStatus === "rejected" ? (
            <div className="summary-stack">
              <h2>Заявка отклонена</h2>
              <p>Можно отправить новый запрос по этой invite-ссылке.</p>
              <div className="form-actions">
                <button className="btn btn--primary" type="button" disabled={submitting} onClick={handleRequestAccess}>
                  {submitting ? "Отправляем..." : "Отправить заявку заново"}
                </button>
              </div>
            </div>
          ) : (
            <div className="summary-stack">
              <h2>Запросить доступ</h2>
              <p>После отправки заявки владелец или администратор комнаты смогут выдать доступ.</p>
              <div className="form-actions">
                <button className="btn btn--primary" type="button" disabled={submitting} onClick={handleRequestAccess}>
                  {submitting ? "Отправляем..." : "Отправить заявку"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function RoomCreatePage() {
  const { api, addToast, clearToasts } = useApp();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const presetRef = useRef(getRoomCreatePresetSearch());
  const preset = presetRef.current;
  const [title, setTitle] = useState(preset.title);
  const [password, setPassword] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionPdf, setDescriptionPdf] = useState<File | null>(null);
  const [deadline, setDeadline] = useState("");
  const [annotatorIds, setAnnotatorIds] = useState("");
  const [reviewVotingEnabled, setReviewVotingEnabled] = useState(preset.reviewVotingEnabled);
  const [reviewVotesRequired, setReviewVotesRequired] = useState("1");
  const [reviewAcceptanceThreshold, setReviewAcceptanceThreshold] = useState("100");
  const [ownerIsAnnotator, setOwnerIsAnnotator] = useState(true);
  const [defaultAssignmentQuota, setDefaultAssignmentQuota] = useState("");
  const [datasetMode, setDatasetMode] = useState(preset.datasetMode);
  const [annotationWorkflow, setAnnotationWorkflow] = useState(preset.annotationWorkflow);
  const [datasetLabel, setDatasetLabel] = useState(preset.datasetLabel || "Тестовый датасет");
  const [videoExtractionFps, setVideoExtractionFps] = useState("");
  const [videoFrameStep, setVideoFrameStep] = useState("1");
  const [videoMaxFrames, setVideoMaxFrames] = useState("1000");
  const [videoManualKeyframePercent, setVideoManualKeyframePercent] = useState("10");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [labels, setLabels] = useState<Array<{ name: string; color: string }>>(preset.labels);
  const [selectedScenarioId, setSelectedScenarioId] = useState(getRoomCreateScenarioId(preset));
  const [currentStep, setCurrentStep] = useState<RoomCreateStepId>("scenario");
  const [maxUnlockedStepIndex, setMaxUnlockedStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const config = datasetModeConfig[datasetMode];
    if (config?.usesLabels && !labels.length) {
      setLabels([{ name: "", color: pickRandomLabelColor() }]);
    }
    if (datasetMode !== "image" && datasetMode !== "video" && annotationWorkflow !== "standard") {
      setAnnotationWorkflow("standard");
    }
  }, [datasetMode, annotationWorkflow, labels.length]);

  useEffect(() => {
    setSelectedScenarioId(getRoomCreateScenarioId({ datasetMode, annotationWorkflow }));
  }, [datasetMode, annotationWorkflow]);

  const modeConfig = datasetModeConfig[datasetMode];
  const currentScenario = roomCreateScenarioPresets.find((item) => item.id === selectedScenarioId) || roomCreateScenarioPresets[0];
  const filesPreview = modeConfig.usesFiles
    ? selectedFiles.length
      ? `${selectedFiles.length} файл(ов) выбрано`
      : "Файлы ещё не выбраны"
    : "Загрузка файлов не нужна";
  const reviewPreview = reviewVotingEnabled ? `Пул валидации: ${reviewVotesRequired || 1} голос(ов)` : "Без пула валидации";
  const currentStepIndex = Math.max(
    roomCreateWizardSteps.findIndex((item) => item.id === currentStep),
    0
  );
  const activeStep = roomCreateWizardSteps[currentStepIndex] || roomCreateWizardSteps[0];
  const labelsRequired = (datasetMode === "image" || datasetMode === "video") && annotationWorkflow !== "text_detect_text";
  const titleTooLong = isTextLimitExceeded(title, ROOM_TITLE_MAX_LENGTH);
  const passwordTooLong = isTextLimitExceeded(password, ROOM_PASSWORD_MAX_LENGTH);
  const descriptionTooLong = isTextLimitExceeded(description, ROOM_DESCRIPTION_MAX_LENGTH);
  const annotatorIdsTooLong = isTextLimitExceeded(annotatorIds, ROOM_ANNOTATOR_IDS_MAX_LENGTH);
  const datasetLabelTooLong = isTextLimitExceeded(datasetLabel, ROOM_DATASET_LABEL_MAX_LENGTH);
  const hasLabelNameTooLong = labels.some((item) => isTextLimitExceeded(item.name, ROOM_LABEL_NAME_MAX_LENGTH));
  const deadlineError = validateRoomDeadline(deadline);
  const hasCreateTextLimitError = titleTooLong || passwordTooLong || descriptionTooLong || annotatorIdsTooLong || datasetLabelTooLong || hasLabelNameTooLong;
  const selectedFilesSummary = summarizeSelectedFiles(selectedFiles);
  const roomCreateDraftItems = [
    { label: "Сценарий", value: currentScenario.title },
    { label: "Датасет", value: datasetLabel.trim() || currentScenario.datasetLabel },
    { label: "Тип", value: translateDatasetMode(datasetMode) },
    { label: "Файлы", value: filesPreview },
    { label: "Команда", value: ownerIsAnnotator ? "Создатель размечает" : "Создатель не размечает" },
  ];

  function updateLabel(index: number, key: "name" | "color", value: string) {
    setLabels((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)));
  }

  function applyScenarioPreset(scenario: RoomCreateScenarioPreset) {
    const knownTitles = roomCreateScenarioPresets.map((item) => item.defaultTitle);
    setSelectedScenarioId(scenario.id);
    setDatasetMode(scenario.datasetMode);
    setAnnotationWorkflow(scenario.annotationWorkflow);
    if (!title.trim() || knownTitles.includes(title.trim())) {
      setTitle(scenario.defaultTitle);
    }
    if (!datasetLabel.trim() || datasetLabel === "Тестовый датасет" || roomCreateScenarioPresets.some((item) => item.datasetLabel === datasetLabel)) {
      setDatasetLabel(scenario.datasetLabel);
    }
    if (datasetModeConfig[scenario.datasetMode]?.usesLabels) {
      setLabels((current) => [{ name: scenario.labelName || current[0]?.name || "object", color: current[0]?.color || pickRandomLabelColor() }]);
    } else {
      setLabels([]);
    }
  }


  function validateRoomCreateStep(stepId: RoomCreateStepId) {
    const normalizedLabels = labels.map((item) => ({ name: item.name.trim(), color: item.color })).filter((item) => item.name);
    const normalizedDefaultQuota = defaultAssignmentQuota.trim() === "" ? null : Number(defaultAssignmentQuota.trim());
    const normalizedReviewVotesRequired = Number(reviewVotesRequired || 1);
    const normalizedVideoFps = videoExtractionFps.trim() === "" ? null : Number(videoExtractionFps.trim());
    const normalizedVideoFrameStep = Number(videoFrameStep || 1);
    const normalizedVideoMaxFrames = Number(videoMaxFrames || 1000);
    const normalizedVideoManualPercent = Number(videoManualKeyframePercent || 10);


    if (stepId === "main") {
      if (!title.trim()) {
        throw new Error("Укажи название комнаты.");
      }
      if (titleTooLong || descriptionTooLong || datasetLabelTooLong) {
        throw new Error("Сократи текст в основных полях, которые выделены красным.");
      }
      if (deadlineError) {
        throw new Error(deadlineError);
      }
    }

    if (stepId === "data") {
      if (!selectedFiles.length) {
        throw new Error("Загрузи файл или набор файлов для выбранного типа датасета.");
      }
      if (labelsRequired && !normalizedLabels.length) {
        throw new Error("Добавь хотя бы один лейбл для фото или видео.");
      }
      if (hasLabelNameTooLong) {
        throw new Error("Сократи название лейбла, которое выделено красным.");
      }
      if (
        datasetMode === "video" &&
        (
          (normalizedVideoFps !== null && (!Number.isInteger(normalizedVideoFps) || normalizedVideoFps < 1 || normalizedVideoFps > 120)) ||
          !Number.isInteger(normalizedVideoFrameStep) ||
          normalizedVideoFrameStep < 1 ||
          normalizedVideoFrameStep > 1000 ||
          !Number.isInteger(normalizedVideoMaxFrames) ||
          normalizedVideoMaxFrames < 1 ||
          normalizedVideoMaxFrames > 100000 ||
          !Number.isInteger(normalizedVideoManualPercent) ||
          normalizedVideoManualPercent < 1 ||
          normalizedVideoManualPercent > 100
        )
      ) {
        throw new Error("Проверь настройки разбиения видео: FPS, шаг, лимит кадров и процент keyframe должны быть в допустимых пределах.");
      }
    }

    if (stepId === "team") {
      if (passwordTooLong || annotatorIdsTooLong) {
        throw new Error("Сократи текст в полях команды, которые выделены красным.");
      }
      if (
        normalizedDefaultQuota !== null &&
        (!Number.isFinite(normalizedDefaultQuota) || normalizedDefaultQuota < 0 || !Number.isInteger(normalizedDefaultQuota))
      ) {
        throw new Error("Стандартная квота должна быть целым числом 0 или больше.");
      }
    }

    if (stepId === "quality") {
      if (
        reviewVotingEnabled &&
        (!Number.isFinite(normalizedReviewVotesRequired) ||
          normalizedReviewVotesRequired < 1 ||
          normalizedReviewVotesRequired > 20 ||
          !Number.isInteger(normalizedReviewVotesRequired))
      ) {
        throw new Error("Для пула валидации укажи от 1 до 20 голосов.");
      }
    }
  }

  function validateRoomCreateWizard() {
    for (const [index, step] of roomCreateWizardSteps.entries()) {
      try {
        validateRoomCreateStep(step.id);
      } catch (error) {
        setCurrentStep(step.id);
        setMaxUnlockedStepIndex((current) => Math.max(current, index));
        throw error;
      }
    }
  }

  function getRoomCreateStepSummary(stepId: RoomCreateStepId) {
    if (stepId === "scenario") {
      return currentScenario.title;
    }
    if (stepId === "main") {
      return `${title.trim() || currentScenario.defaultTitle} · ${datasetLabel.trim() || "Датасет без названия"}`;
    }
    if (stepId === "data") {
      return `${translateDatasetMode(datasetMode)} · ${filesPreview}`;
    }
    if (stepId === "team") {
      const invitedCount = annotatorIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean).length;
      return invitedCount ? `Приглашено ID: ${invitedCount} · ${ownerIsAnnotator ? "создатель размечает" : "создатель не размечает"}` : ownerIsAnnotator ? "Создатель размечает задачи" : "Создатель не размечает задачи";
    }
    return reviewPreview;
  }


  function openRoomCreateStep(stepId: RoomCreateStepId) {
    const nextIndex = roomCreateWizardSteps.findIndex((item) => item.id === stepId);
    if (nextIndex > -1 && nextIndex <= maxUnlockedStepIndex) {
      setCurrentStep(stepId);
    }
  }

  function goToNextRoomCreateStep() {
    clearToasts();
    try {
      validateRoomCreateStep(currentStep);
      const nextIndex = Math.min(currentStepIndex + 1, roomCreateWizardSteps.length - 1);
      setMaxUnlockedStepIndex((current) => Math.max(current, nextIndex));
      setCurrentStep(roomCreateWizardSteps[nextIndex].id);
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  function goToPreviousRoomCreateStep() {
    const previousIndex = Math.max(currentStepIndex - 1, 0);
    setCurrentStep(roomCreateWizardSteps[previousIndex].id);
  }

  function goBackFromRoomCreate() {
    const referrer = document.referrer;
    if (referrer) {
      try {
        const previousUrl = new URL(referrer);
        const currentUrl = new URL(window.location.href);
        if (previousUrl.origin === currentUrl.origin && previousUrl.pathname !== currentUrl.pathname) {
          window.location.href = previousUrl.href;
          return;
        }
      } catch (error) {
        // Fall through to the stable landing page fallback.
      }
    }
    window.location.href = "/";
  }

  function getNormalizedRoomCreateValues() {
    const normalizedAnnotatorIds = annotatorIds
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
    const normalizedLabels = labels.map((item) => ({ name: item.name.trim(), color: item.color })).filter((item) => item.name);
    const normalizedDefaultQuota = defaultAssignmentQuota.trim() === "" ? null : Number(defaultAssignmentQuota.trim());
    const normalizedReviewVotesRequired = Number(reviewVotesRequired || 1);
    const normalizedReviewAcceptanceThreshold = clamp(Number(reviewAcceptanceThreshold || 100), 1, 100);
    const normalizedVideoFps = videoExtractionFps.trim() === "" ? null : Number(videoExtractionFps.trim());
    const normalizedVideoFrameStep = Number(videoFrameStep || 1);
    const normalizedVideoMaxFrames = Number(videoMaxFrames || 1000);
    const normalizedVideoManualPercent = Number(videoManualKeyframePercent || 10);

    if (!selectedFiles.length) {
      throw new Error("Загрузи файл или набор файлов для выбранного типа датасета.");
    }

    if (labelsRequired && !normalizedLabels.length) {
      throw new Error("Добавь хотя бы один лейбл для фото или видео.");
    }

    if (
      reviewVotingEnabled &&
      (!Number.isFinite(normalizedReviewVotesRequired) ||
        normalizedReviewVotesRequired < 1 ||
        normalizedReviewVotesRequired > 20 ||
        !Number.isInteger(normalizedReviewVotesRequired))
    ) {
      throw new Error("Для пула валидации укажи от 1 до 20 голосов.");
    }

    if (
      normalizedDefaultQuota !== null &&
      (!Number.isFinite(normalizedDefaultQuota) || normalizedDefaultQuota < 0 || !Number.isInteger(normalizedDefaultQuota))
    ) {
      throw new Error("Стандартная квота должна быть целым числом 0 или больше.");
    }

    if (
      datasetMode === "video" &&
      (
        (normalizedVideoFps !== null && (!Number.isInteger(normalizedVideoFps) || normalizedVideoFps < 1 || normalizedVideoFps > 120)) ||
        !Number.isInteger(normalizedVideoFrameStep) ||
        normalizedVideoFrameStep < 1 ||
        normalizedVideoFrameStep > 1000 ||
        !Number.isInteger(normalizedVideoMaxFrames) ||
        normalizedVideoMaxFrames < 1 ||
        normalizedVideoMaxFrames > 100000 ||
        !Number.isInteger(normalizedVideoManualPercent) ||
        normalizedVideoManualPercent < 1 ||
        normalizedVideoManualPercent > 100
        )
    ) {
      throw new Error("Проверь настройки разбиения видео: FPS, шаг, лимит кадров и процент keyframe должны быть в допустимых пределах.");
    }

    if (hasCreateTextLimitError) {
      throw new Error("Сократи текст в полях, которые выделены красным.");
    }

    if (deadlineError) {
      throw new Error(deadlineError);
    }

    return {
      normalizedAnnotatorIds,
      normalizedLabels,
      normalizedDefaultQuota,
      normalizedReviewVotesRequired,
      normalizedReviewAcceptanceThreshold,
      normalizedVideoFps,
      normalizedVideoFrameStep,
      normalizedVideoMaxFrames,
      normalizedVideoManualPercent,
    };
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearToasts();

    if (currentStepIndex < roomCreateWizardSteps.length - 1) {
      goToNextRoomCreateStep();
      return;
    }

    try {
      validateRoomCreateWizard();
      void submitRoomCreate();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  async function submitRoomCreate() {
    clearToasts();
    setSubmitting(true);

    try {
      const {
        normalizedAnnotatorIds,
        normalizedLabels,
        normalizedDefaultQuota,
        normalizedReviewVotesRequired,
        normalizedReviewAcceptanceThreshold,
        normalizedVideoFps,
        normalizedVideoFrameStep,
        normalizedVideoMaxFrames,
        normalizedVideoManualPercent,
      } = getNormalizedRoomCreateValues();


      const mediaManifest = await buildMediaManifest(selectedFiles, datasetMode);
      const payload = new FormData();

      payload.append("title", title.trim());
      payload.append("description", description.trim());
      if (descriptionPdf) {
        payload.append("description_pdf", descriptionPdf);
      }
      payload.append("password", password.trim());
      payload.append("dataset_mode", datasetMode);
      payload.append("annotation_workflow", annotationWorkflow);
      payload.append("dataset_label", datasetLabel.trim() || "Тестовый датасет");
      payload.append("cross_validation_enabled", "false");
      payload.append("cross_validation_annotators_count", "1");
      payload.append("cross_validation_similarity_threshold", "80");
      payload.append("review_voting_enabled", reviewVotingEnabled ? "true" : "false");
      payload.append("review_votes_required", String(normalizedReviewVotesRequired));
      payload.append("review_acceptance_threshold", String(normalizedReviewAcceptanceThreshold));
      payload.append("owner_is_annotator", ownerIsAnnotator ? "true" : "false");
      if (datasetMode === "video") {
        if (normalizedVideoFps !== null) {
          payload.append("video_extraction_fps", String(normalizedVideoFps));
        }
        payload.append("video_frame_step", String(normalizedVideoFrameStep));
        payload.append("video_max_frames", String(normalizedVideoMaxFrames));
        payload.append("video_manual_keyframe_percent", String(normalizedVideoManualPercent));
      }
      if (normalizedDefaultQuota !== null) {
        payload.append("default_assignment_quota", String(normalizedDefaultQuota));
      }
      normalizedAnnotatorIds.forEach((item) => payload.append("annotator_ids", String(item)));
      selectedFiles.forEach((file) => payload.append("dataset_files", file));

      if (deadline) {
        payload.append("deadline", new Date(deadline).toISOString());
      }
      if (normalizedLabels.length) {
        payload.append("labels", JSON.stringify(normalizedLabels));
      }
      if (mediaManifest.length) {
        payload.append("media_manifest", JSON.stringify(mediaManifest));
      }

      const room = await api<RoomItem>("/api/v1/rooms/", {
        method: "POST",
        formData: payload,
      });
      addToast(`Комната #${room.id} создана. Переходим к ней.`, "success");
      window.setTimeout(() => {
        window.location.href = `/rooms/${room.id}/`;
      }, 700);
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  function renderRoomCreateStep(stepId: RoomCreateStepId, children: React.ReactNode) {
    const stepIndex = roomCreateWizardSteps.findIndex((item) => item.id === stepId);
    const step = roomCreateWizardSteps[stepIndex];
    const isActive = currentStep === stepId;

    if (!step || !isActive) {
      return null;
    }

    return (
      <section key={step.id} className="room-create-section room-create-wizard-section is-active">
        <div className="room-create-step-body">
          {children}
          <div className="room-create-step-actions">
            {currentStepIndex > 0 ? (
              <button className="btn btn--muted" type="button" onClick={goToPreviousRoomCreateStep}>
                Назад
              </button>
            ) : (
              <button className="btn btn--muted" type="button" onClick={goBackFromRoomCreate}>
                Назад
              </button>
            )}
            {currentStepIndex < roomCreateWizardSteps.length - 1 ? (
              <button className="btn btn--primary" type="button" onClick={goToNextRoomCreateStep}>
                Далее
              </button>
            ) : (
              <button className="btn btn--primary" type="submit" disabled={submitting}>
                Создать комнату
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="create-layout create-layout--room-create">
      <form id="room-create-form" className="room-create-form" onSubmit={handleSubmit}>
        <div className="room-create-board">
          <aside className="room-create-stepper" aria-label="Шаги создания комнаты">
            <div className="room-create-stepper__head">
              <span>Создание</span>
              <strong>Комната</strong>
            </div>
            {roomCreateWizardSteps.map((step, index) => {
              const isActive = currentStep === step.id;
              const isUnlocked = index <= maxUnlockedStepIndex;
              return (
                <button
                  key={step.id}
                  className={`room-create-stepper__item ${isActive ? "is-active" : ""} ${isUnlocked ? "is-unlocked" : "is-locked"}`}
                  type="button"
                  disabled={!isUnlocked}
                  aria-current={isActive ? "step" : undefined}
                  onClick={() => openRoomCreateStep(step.id)}
                >
                  <span>{index + 1}</span>
                  <strong>{step.title}</strong>
                  <small>{isUnlocked ? getRoomCreateStepSummary(step.id) : "Заполните предыдущий шаг"}</small>
                </button>
              );
            })}
          </aside>

          <section className="room-create-workspace" aria-labelledby="room-create-active-step">
            <div className="room-create-workspace__head">
              <span className="landing-chip">{activeStep.eyebrow}</span>
              <div>
                <h1 id="room-create-active-step">{activeStep.title}</h1>
                <p>{activeStep.description}</p>
              </div>
            </div>

          {renderRoomCreateStep(
            "scenario",
            <>
            <div className="room-create-section__head">
              <div>
                <span className="eyebrow">Сценарий</span>
                <h2>Выбери стартовый сценарий</h2>
              </div>
              <p>Карточка заполняет тип датасета, workflow, название и базовый label. Все параметры ниже можно изменить вручную.</p>
            </div>
            <div className="room-create-scenario-grid">
              {roomCreateScenarioPresets.map((scenario) => (
                <button
                  key={scenario.id}
                  className={`room-create-scenario-card ${scenario.id === selectedScenarioId ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={scenario.id === selectedScenarioId}
                  onClick={() => applyScenarioPreset(scenario)}
                >
                  <span>{scenario.meta}</span>
                  <strong>{scenario.title}</strong>
                  <p>{scenario.summary}</p>
                </button>
              ))}
            </div>
            </>
          )}

          {renderRoomCreateStep(
            "main",
            <>
            <div className="room-create-section__head">
              <div>
                <span className="eyebrow">Основное</span>
                <h2>Название и контекст</h2>
              </div>
            </div>
            <div className="room-create-fields">
              <label className="field">
                <CharacterLimitLabel label="Название комнаты" value={title} maxLength={ROOM_TITLE_MAX_LENGTH} />
                <input
                  value={title}
                  name="title"
                  type="text"
                  placeholder="Например, Разметка отзывов Q2"
                  required
                  className={titleTooLong ? "field__control--invalid" : ""}
                  aria-invalid={titleTooLong}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </label>
              <label className="field">
                <CharacterLimitLabel label="Название датасета" value={datasetLabel} maxLength={ROOM_DATASET_LABEL_MAX_LENGTH} />
                <input
                  value={datasetLabel}
                  name="dataset_label"
                  type="text"
                  className={datasetLabelTooLong ? "field__control--invalid" : ""}
                  aria-invalid={datasetLabelTooLong}
                  onChange={(event) => setDatasetLabel(event.currentTarget.value)}
                />
              </label>
              <label className="field field--full">
                <CharacterLimitLabel label="Описание" value={description} maxLength={ROOM_DESCRIPTION_MAX_LENGTH} />
                <textarea
                  value={description}
                  name="description"
                  rows={4}
                  placeholder="Кратко опиши задачу и правила разметки"
                  className={descriptionTooLong ? "field__control--invalid" : ""}
                  aria-invalid={descriptionTooLong}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                ></textarea>
              </label>
              <label className="field field--full">
                <span>PDF с описанием</span>
                <input
                  name="description_pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => setDescriptionPdf(event.currentTarget.files?.[0] || null)}
                />
                <div className="panel-note">{descriptionPdf ? descriptionPdf.name : "Можно добавить PDF с правилами или техническим заданием."}</div>
              </label>
              <label className="field">
                <span>Дедлайн (необязательно)</span>
                <input
                  value={deadline}
                  name="deadline"
                  type="datetime-local"
                  className={deadlineError ? "field__control--invalid" : ""}
                  aria-invalid={Boolean(deadlineError)}
                  onChange={(event) => setDeadline(event.currentTarget.value)}
                />
                {deadlineError ? <div className="panel-note">{deadlineError}</div> : null}
              </label>
            </div>
            </>
          )}

          {renderRoomCreateStep(
            "data",
            <>
            <div className="room-create-section__head">
              <div>
                <span className="eyebrow">Данные</span>
                <h2>Источник и разметка</h2>
              </div>
              <p>{modeConfig.hint}</p>
            </div>
            <div className="room-create-fields">
              <label className="field">
                <span>Тип датасета</span>
                <select value={datasetMode} name="dataset_mode" onChange={(event) => setDatasetMode(event.currentTarget.value)}>
                  <option value="image">Фото</option>
                  <option value="video">Видео</option>
                </select>
              </label>
              {(datasetMode === "image" || datasetMode === "video") && (
                <label className="field">
                  <span>Сценарий разметки</span>
                  <select value={annotationWorkflow} name="annotation_workflow" onChange={(event) => setAnnotationWorkflow(event.currentTarget.value)}>
                    <option value="standard">Обычная разметка</option>
                    <option value="text_detect_text">Object detect + text</option>
                  </select>
                </label>
              )}
              {datasetMode === "video" && (
                <>
                  <label className="field">
                    <span>FPS извлечения</span>
                    <input
                      value={videoExtractionFps}
                      name="video_extraction_fps"
                      type="number"
                      min="1"
                      max="120"
                      placeholder="Все кадры"
                      onChange={(event) => setVideoExtractionFps(event.currentTarget.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Шаг кадров</span>
                    <input value={videoFrameStep} name="video_frame_step" type="number" min="1" max="1000" onChange={(event) => setVideoFrameStep(event.currentTarget.value)} />
                  </label>
                  <label className="field">
                    <span>Лимит кадров на видео</span>
                    <input value={videoMaxFrames} name="video_max_frames" type="number" min="1" max="100000" onChange={(event) => setVideoMaxFrames(event.currentTarget.value)} />
                  </label>
                  <label className="field">
                    <span>Ручные keyframe, %</span>
                    <input
                      value={videoManualKeyframePercent}
                      name="video_manual_keyframe_percent"
                      type="number"
                      min="1"
                      max="100"
                      onChange={(event) => setVideoManualKeyframePercent(event.currentTarget.value)}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="dataset-box room-create-upload-box">
              <div>
                <h2>Загрузка датасета</h2>
                <p>Выбери файлы, которые станут задачами комнаты.</p>
              </div>
              <div className="dataset-box__actions dataset-box__actions--stack">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={modeConfig.accept}
                  multiple={modeConfig.multiple}
                  onChange={(event) => setSelectedFiles(Array.from(event.currentTarget.files || []))}
                />
                <div className="panel-note">{summarizeSelectedFiles(selectedFiles)}</div>
              </div>
            </div>

            {modeConfig.usesLabels && (
              <div className="room-create-labels">
                <div className="room-create-section__head room-create-section__head--compact">
                  <div>
                    <span className="eyebrow">Labels</span>
                    <h2>Лейблы для bbox</h2>
                  </div>
                  <p>Цвет каждому label-у назначается случайно, но его можно сразу изменить.</p>
                </div>
                <div className="label-editor-list">
                  {labels.map((label, index) => (
                    <div key={`label-${index}`} className="label-editor-row">
                      <label className="field">
                        <CharacterLimitLabel label="Лейбл" value={label.name} maxLength={ROOM_LABEL_NAME_MAX_LENGTH} />
                        <input
                          className={`label-editor-row__name ${isTextLimitExceeded(label.name, ROOM_LABEL_NAME_MAX_LENGTH) ? "field__control--invalid" : ""}`}
                          type="text"
                          placeholder="Например, car"
                          value={label.name}
                          aria-invalid={isTextLimitExceeded(label.name, ROOM_LABEL_NAME_MAX_LENGTH)}
                          onChange={(event) => updateLabel(index, "name", event.currentTarget.value)}
                        />
                      </label>
                      <label className="field field--color">
                        <span>Цвет</span>
                        <input className="label-editor-row__color" type="color" value={label.color} onChange={(event) => updateLabel(index, "color", event.currentTarget.value)} />
                      </label>
                      <button className="btn btn--muted btn--compact" type="button" onClick={() => setLabels((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        Убрать
                      </button>
                    </div>
                  ))}
                </div>
                <div className="form-actions form-actions--tight">
                  <button className="btn btn--muted" type="button" onClick={() => setLabels((current) => [...current, { name: "", color: pickRandomLabelColor() }])}>
                    Добавить лейбл
                  </button>
                </div>
              </div>
            )}
            </>
          )}

          {renderRoomCreateStep(
            "team",
            <>
            <div className="room-create-section__head">
              <div>
                <span className="eyebrow">Команда</span>
                <h2>Доступ и квоты</h2>
              </div>
            </div>
            <div className="room-create-fields">
              <label className="field">
                <span>Пароль комнаты</span>
                <input
                  value={password}
                  name="password"
                  type="password"
                  placeholder="Например, demo123"
                  className={passwordTooLong ? "field__control--invalid" : ""}
                  aria-invalid={passwordTooLong}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
              </label>
              <label className="field">
                <CharacterLimitLabel label="ID приглашенных участников" value={annotatorIds} maxLength={ROOM_ANNOTATOR_IDS_MAX_LENGTH} />
                <input
                  value={annotatorIds}
                  name="annotator_ids"
                  type="text"
                  placeholder="Например, 2,3,7"
                  className={annotatorIdsTooLong ? "field__control--invalid" : ""}
                  aria-invalid={annotatorIdsTooLong}
                  onChange={(event) => setAnnotatorIds(event.currentTarget.value)}
                />
              </label>
              <label className="field">
                <span>Стандартная квота задач</span>
                <input
                  value={defaultAssignmentQuota}
                  name="default_assignment_quota"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="По количеству задач"
                  onChange={(event) => setDefaultAssignmentQuota(event.currentTarget.value)}
                />
              </label>
              <label className="field field--checkbox">
                <span>Создатель в разметке</span>
                <span className="field--checkbox__control">
                  <span className="field--checkbox__text">Создатель тоже размечает задачи</span>
                  <input checked={ownerIsAnnotator} name="owner_is_annotator" type="checkbox" onChange={(event) => setOwnerIsAnnotator(event.currentTarget.checked)} />
                </span>
              </label>
            </div>
            </>
          )}

          {renderRoomCreateStep(
            "quality",
            <>
            <div className="room-create-section__head">
              <div>
                <span className="eyebrow">Проверка</span>
                <h2>Ревью финальной разметки</h2>
              </div>
            </div>
            <div className="room-create-fields">
              <label className="field field--checkbox">
                <span>Пул валидации</span>
                <span className="field--checkbox__control">
                  <span className="field--checkbox__text">Отправлять финальную разметку на голосование</span>
                  <input checked={reviewVotingEnabled} name="review_voting_enabled" type="checkbox" onChange={(event) => setReviewVotingEnabled(event.currentTarget.checked)} />
                </span>
              </label>
              <label className="field">
                <span>Голосов для решения</span>
                <input
                  value={reviewVotesRequired}
                  name="review_votes_required"
                  type="number"
                  min="1"
                  max="20"
                  disabled={!reviewVotingEnabled}
                  onChange={(event) => setReviewVotesRequired(event.currentTarget.value)}
                />
              </label>
              <label className="field">
                <span>Порог принятия (%)</span>
                <input
                  value={reviewAcceptanceThreshold}
                  name="review_acceptance_threshold"
                  type="number"
                  min="1"
                  max="100"
                  disabled={!reviewVotingEnabled}
                  onChange={(event) => setReviewAcceptanceThreshold(event.currentTarget.value)}
                />
              </label>
            </div>
            </>
          )}

          </section>

          <aside className="room-create-draft" aria-label="Черновик комнаты">
            <div className="room-create-draft__head">
              <span>Черновик</span>
              <strong>{title.trim() || currentScenario.defaultTitle}</strong>
            </div>
            <div className="room-create-draft__list">
              {roomCreateDraftItems.map((item) => (
                <div className="room-create-draft__item" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </form>
    </section>
  );
}

function RoomEditPage() {
  const { bootstrap, api, addToast, clearToasts } = useApp();
  const roomId = bootstrap.room_id;
  const [room, setRoom] = useState<RoomItem | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [datasetLabel, setDatasetLabel] = useState("");
  const [deadline, setDeadline] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [crossValidationEnabled, setCrossValidationEnabled] = useState(false);
  const [crossValidationAnnotatorsCount, setCrossValidationAnnotatorsCount] = useState("2");
  const [crossValidationSimilarityThreshold, setCrossValidationSimilarityThreshold] = useState("80");
  const [reviewVotingEnabled, setReviewVotingEnabled] = useState(false);
  const [reviewVotesRequired, setReviewVotesRequired] = useState("1");
  const [reviewAcceptanceThreshold, setReviewAcceptanceThreshold] = useState("100");
  const [ownerIsAnnotator, setOwnerIsAnnotator] = useState(true);
  const [defaultAssignmentQuota, setDefaultAssignmentQuota] = useState("");
  const [initialHasPassword, setInitialHasPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadRoom() {
      if (!roomId) {
        addToast("Не удалось определить ID комнаты из URL.", "error");
        return;
      }

      try {
        const nextRoom = await api<RoomItem>(`/api/v1/rooms/${roomId}/`);
        setRoom(nextRoom);
        setTitle(nextRoom.title || "");
        setDescription(nextRoom.description || "");
        setDatasetLabel(nextRoom.dataset_label || "Тестовый датасет");
        setDeadline(formatDateTimeLocal(nextRoom.deadline));
        setInitialHasPassword(Boolean(nextRoom.has_password));
        setPasswordEnabled(Boolean(nextRoom.has_password));
        setPassword("");
        setCrossValidationEnabled(Boolean(nextRoom.cross_validation_enabled));
        setCrossValidationAnnotatorsCount(String(Math.max(Number(nextRoom.cross_validation_annotators_count || 1), 2)));
        setCrossValidationSimilarityThreshold(String(Number(nextRoom.cross_validation_similarity_threshold || 80)));
        setReviewVotingEnabled(Boolean(nextRoom.review_voting_enabled));
        setReviewVotesRequired(String(Number(nextRoom.review_votes_required || 1)));
        setReviewAcceptanceThreshold(String(Number(nextRoom.review_acceptance_threshold || 100)));
        setOwnerIsAnnotator(Boolean(nextRoom.owner_is_annotator));
        setDefaultAssignmentQuota(nextRoom.default_assignment_quota == null ? "" : String(nextRoom.default_assignment_quota));
      } catch (error) {
        addToast(getErrorMessage(error), "error");
      }
    }

    loadRoom();
  }, []);

  const titleTooLong = isTextLimitExceeded(title, ROOM_TITLE_MAX_LENGTH);
  const descriptionTooLong = isTextLimitExceeded(description, ROOM_DESCRIPTION_MAX_LENGTH);
  const datasetLabelTooLong = isTextLimitExceeded(datasetLabel, ROOM_DATASET_LABEL_MAX_LENGTH);
  const passwordTooLong = isTextLimitExceeded(password, ROOM_PASSWORD_MAX_LENGTH);
  const deadlineError = validateRoomDeadline(deadline);
  const hasEditTextLimitError = titleTooLong || descriptionTooLong || datasetLabelTooLong || passwordTooLong;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomId) {
      return;
    }

    clearToasts();
    setSubmitting(true);

    try {
      const nextPassword = password.trim();
      const passwordChanged = (!passwordEnabled && initialHasPassword) || Boolean(nextPassword);
      const nextCrossValidationCount = Math.max(Number(crossValidationAnnotatorsCount || 0), 0);
      const nextCrossValidationThreshold = clamp(Number(crossValidationSimilarityThreshold || 0), 1, 100);
      const nextReviewVotesRequired = Number(reviewVotesRequired || 1);
      const nextReviewAcceptanceThreshold = clamp(Number(reviewAcceptanceThreshold || 100), 1, 100);
      const nextDefaultQuota = defaultAssignmentQuota.trim() === "" ? null : Number(defaultAssignmentQuota.trim());

      if (passwordEnabled && !initialHasPassword && !nextPassword) {
        throw new Error("Укажи пароль, чтобы включить защиту комнаты.");
      }

      if (crossValidationEnabled && nextCrossValidationCount < 2) {
        throw new Error("Для перекрестной разметки укажи минимум двух независимых исполнителей.");
      }

      if (
        reviewVotingEnabled &&
        (!Number.isFinite(nextReviewVotesRequired) ||
          nextReviewVotesRequired < 1 ||
          nextReviewVotesRequired > 20 ||
          !Number.isInteger(nextReviewVotesRequired))
      ) {
        throw new Error("Для пула валидации укажи от 1 до 20 голосов.");
      }

      if (
        nextDefaultQuota !== null &&
        (!Number.isFinite(nextDefaultQuota) || nextDefaultQuota < 0 || !Number.isInteger(nextDefaultQuota))
      ) {
        throw new Error("Стандартная квота должна быть целым числом 0 или больше.");
      }

      if (hasEditTextLimitError) {
        throw new Error("Сократи текст в полях, которые выделены красным.");
      }

      if (deadlineError) {
        throw new Error(deadlineError);
      }

      await api(`/api/v1/rooms/${roomId}/`, {
        method: "PATCH",
        body: {
          title: title.trim(),
          description: description.trim(),
          dataset_label: datasetLabel.trim() || "Тестовый датасет",
          deadline: deadline ? new Date(deadline).toISOString() : null,
          password: passwordChanged ? (passwordEnabled ? nextPassword : "") : "",
          has_password: passwordEnabled,
          cross_validation_enabled: crossValidationEnabled,
          cross_validation_annotators_count: crossValidationEnabled ? nextCrossValidationCount : 1,
          cross_validation_similarity_threshold: nextCrossValidationThreshold,
          review_voting_enabled: reviewVotingEnabled,
          review_votes_required: nextReviewVotesRequired,
          review_acceptance_threshold: nextReviewAcceptanceThreshold,
          owner_is_annotator: ownerIsAnnotator,
          default_assignment_quota: nextDefaultQuota,
        },
      });
      addToast(`Настройки комнаты #${roomId} обновлены.`, "success");
      window.setTimeout(() => {
        window.location.href = `/rooms/${roomId}/`;
      }, 700);
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="page-topbar">
        <div className="page-topbar__copy">
          <span className="eyebrow">Редактирование комнаты</span>
          <h1>Настройки комнаты</h1>
          <p>Обнови название, описание, дедлайн, квоты и параметры разметки без изменения самих задач и файлов.</p>
        </div>
      </section>

      <section className="create-layout">
        <form className="form-card" onSubmit={handleSubmit}>
          {room ? (
            <div className="summary-stack room-edit-summary">
              <div className="summary-row">
                <span>ID комнаты</span>
                <strong>#{room.id}</strong>
              </div>
              <div className="summary-row">
                <span>Тип датасета</span>
                <strong>{translateDatasetMode(room.dataset_type)}</strong>
              </div>
              <div className="summary-row">
                <span>Сценарий</span>
                <strong>{translateAnnotationWorkflow(room.annotation_workflow || "standard")}</strong>
              </div>
              <div className="summary-row">
                <span>Доступ</span>
                <strong>{room.has_password ? "С паролем" : "Без пароля"}</strong>
              </div>
            </div>
          ) : (
            <div className="summary-stack room-edit-summary empty-card">Загружаем настройки комнаты.</div>
          )}

          <div className="form-grid">
            <label className="field">
              <CharacterLimitLabel label="Название комнаты" value={title} maxLength={ROOM_TITLE_MAX_LENGTH} />
              <input
                value={title}
                type="text"
                placeholder="Например, Разметка отзывов Q2"
                required
                className={titleTooLong ? "field__control--invalid" : ""}
                aria-invalid={titleTooLong}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <CharacterLimitLabel label="Название датасета" value={datasetLabel} maxLength={ROOM_DATASET_LABEL_MAX_LENGTH} />
              <input
                value={datasetLabel}
                type="text"
                placeholder="Например, Отзывы Q2"
                className={datasetLabelTooLong ? "field__control--invalid" : ""}
                aria-invalid={datasetLabelTooLong}
                onChange={(event) => setDatasetLabel(event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>Стандартная квота задач</span>
              <input
                value={defaultAssignmentQuota}
                type="number"
                min="0"
                step="1"
                placeholder="Не задана"
                onChange={(event) => setDefaultAssignmentQuota(event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>Дедлайн (необязательно)</span>
              <input
                value={deadline}
                type="datetime-local"
                className={deadlineError ? "field__control--invalid" : ""}
                aria-invalid={Boolean(deadlineError)}
                onChange={(event) => setDeadline(event.currentTarget.value)}
              />
              {deadlineError ? <div className="panel-note">{deadlineError}</div> : null}
            </label>
            <label className="field field--checkbox">
              <span>Защита паролем</span>
              <span className="field--checkbox__control">
                <span className="field--checkbox__text">Требовать пароль для входа</span>
                <input checked={passwordEnabled} type="checkbox" onChange={(event) => setPasswordEnabled(event.currentTarget.checked)} />
              </span>
            </label>
            <label className="field field--checkbox">
              <span>Перекрестная разметка</span>
              <span className="field--checkbox__control">
                <span className="field--checkbox__text">Включить</span>
                <input
                  checked={crossValidationEnabled}
                  type="checkbox"
                  onChange={(event) => setCrossValidationEnabled(event.currentTarget.checked)}
                />
              </span>
            </label>
            <label className="field field--checkbox">
              <span>Пул валидации</span>
              <span className="field--checkbox__control">
                <span className="field--checkbox__text">Отправлять финальную разметку на голосование</span>
                <input
                  checked={reviewVotingEnabled}
                  type="checkbox"
                  onChange={(event) => setReviewVotingEnabled(event.currentTarget.checked)}
                />
              </span>
            </label>
            <label className="field field--checkbox">
              <span>Создатель в разметке</span>
              <span className="field--checkbox__control">
                <span className="field--checkbox__text">Создатель тоже размечает задачи</span>
                <input
                  checked={ownerIsAnnotator}
                  type="checkbox"
                  onChange={(event) => setOwnerIsAnnotator(event.currentTarget.checked)}
                />
              </span>
            </label>
            <label className="field">
              <span>Независимых исполнителей (n)</span>
              <input
                value={crossValidationAnnotatorsCount}
                type="number"
                min="2"
                max="20"
                disabled={!crossValidationEnabled}
                onChange={(event) => setCrossValidationAnnotatorsCount(event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>Порог сходства (%)</span>
              <input
                value={crossValidationSimilarityThreshold}
                type="number"
                min="1"
                max="100"
                disabled={!crossValidationEnabled}
                onChange={(event) => setCrossValidationSimilarityThreshold(event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>Голосов для решения</span>
              <input
                value={reviewVotesRequired}
                type="number"
                min="1"
                max="20"
                disabled={!reviewVotingEnabled}
                onChange={(event) => setReviewVotesRequired(event.currentTarget.value)}
              />
            </label>
            <label className="field">
              <span>Порог принятия (%)</span>
              <input
                value={reviewAcceptanceThreshold}
                type="number"
                min="1"
                max="100"
                disabled={!reviewVotingEnabled}
                onChange={(event) => setReviewAcceptanceThreshold(event.currentTarget.value)}
              />
            </label>
            <label className="field field--full">
              <CharacterLimitLabel label="Описание" value={description} maxLength={ROOM_DESCRIPTION_MAX_LENGTH} />
              <textarea
                value={description}
                rows={4}
                placeholder="Кратко опиши задачу и правила разметки"
                className={descriptionTooLong ? "field__control--invalid" : ""}
                aria-invalid={descriptionTooLong}
                onChange={(event) => setDescription(event.currentTarget.value)}
              ></textarea>
            </label>
            <label className="field field--full">
              <span>Новый пароль комнаты</span>
              <input
                value={password}
                type="password"
                disabled={!passwordEnabled}
                className={passwordTooLong ? "field__control--invalid" : ""}
                aria-invalid={passwordTooLong}
                placeholder={initialHasPassword ? "Оставь пустым, чтобы сохранить текущий пароль" : "Задай новый пароль"}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <div className="panel-note room-edit-password-note">
              {passwordEnabled
                ? initialHasPassword
                  ? "Оставь поле пустым, если текущий пароль менять не нужно. Введи новый пароль, если хочешь его заменить."
                  : "Укажи пароль и сохрани форму, чтобы закрыть вход в комнату по паролю."
                : "После сохранения доступ в комнату будет открыт без пароля."}
            </div>
            <div className="panel-note room-edit-note">
              Тип датасета, сценарий разметки, лейблы и загруженные файлы в этой форме не меняются. Перекрестную разметку и стандартную квоту можно
              перенастроить здесь, не меняя сам состав задач.
            </div>
          </div>

          <div className="form-actions">
            <a className="btn btn--muted" href={`/rooms/${roomId}/`}>
              Назад к комнате
            </a>
            <button className="btn btn--primary" type="submit" disabled={submitting}>
              {submitting ? "Сохраняем..." : "Сохранить изменения"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function RoomDetailPage() {
  const { bootstrap, authUser, api, addToast, clearToasts } = useApp();
  const roomId = bootstrap.room_id;
  const datasetFileInputRef = useRef<HTMLInputElement | null>(null);
  const [dashboard, setDashboard] = useState<RoomDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [annotatorSearch, setAnnotatorSearch] = useState("");
  const [reviewSearch, setReviewSearch] = useState("");
  const [datasetTaskSearch, setDatasetTaskSearch] = useState("");
  const [selectedAnnotatorUserId, setSelectedAnnotatorUserId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedQuota, setSelectedQuota] = useState("");
  const [quotaBusy, setQuotaBusy] = useState(false);
  const [reviewTasks, setReviewTasks] = useState<ReviewTaskListItem[]>([]);
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState<number | null>(null);
  const [reviewDetail, setReviewDetail] = useState<ReviewTaskDetail | null>(null);
  const [deleteRoomConfirmOpen, setDeleteRoomConfirmOpen] = useState(false);
  const [deleteRoomPassword, setDeleteRoomPassword] = useState("");
  const [deleteRoomBusy, setDeleteRoomBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [selectedExportFormat, setSelectedExportFormat] = useState("native_json");
  const [joinRequestBusyId, setJoinRequestBusyId] = useState<number | null>(null);
  const [datasetTasks, setDatasetTasks] = useState<RoomDatasetTaskItem[]>([]);
  const [selectedDatasetTaskIds, setSelectedDatasetTaskIds] = useState<number[]>([]);
  const [datasetUploadFiles, setDatasetUploadFiles] = useState<File[]>([]);
  const [datasetTasksLoading, setDatasetTasksLoading] = useState(false);
  const [datasetUploadBusy, setDatasetUploadBusy] = useState(false);
  const [datasetDeleteBusy, setDatasetDeleteBusy] = useState(false);
  const manageSectionStorageKey = roomId ? `datasetai-room:${roomId}:manage` : null;
  const personalSectionStorageKey = roomId ? `datasetai-room:${roomId}:personal` : null;
  const reviewSectionStorageKey = roomId ? `datasetai-room:${roomId}:review` : null;
  const [manageSectionOpen, setManageSectionOpen] = useState(() => readStoredDisclosureState(manageSectionStorageKey, false));
  const [personalSectionOpen, setPersonalSectionOpen] = useState(() => readStoredDisclosureState(personalSectionStorageKey, false));
  const [reviewSectionOpen, setReviewSectionOpen] = useState(() => readStoredDisclosureState(reviewSectionStorageKey, false));
  const [reviewTasksLoading, setReviewTasksLoading] = useState(false);
  const [activeRoomSection, setActiveRoomSection] = useState<RoomDetailSectionId>("overview");

  useEffect(() => {
    writeStoredDisclosureState(manageSectionStorageKey, manageSectionOpen);
  }, [manageSectionOpen, manageSectionStorageKey]);

  useEffect(() => {
    writeStoredDisclosureState(personalSectionStorageKey, personalSectionOpen);
  }, [personalSectionOpen, personalSectionStorageKey]);

  useEffect(() => {
    writeStoredDisclosureState(reviewSectionStorageKey, reviewSectionOpen);
  }, [reviewSectionOpen, reviewSectionStorageKey]);

  useEffect(() => {
    const availableFormats = dashboard?.export_formats || [];
    if (!availableFormats.length) {
      setSelectedExportFormat("native_json");
      return;
    }

    if (!availableFormats.some((item) => item.value === selectedExportFormat)) {
      setSelectedExportFormat(availableFormats[0].value);
    }
  }, [dashboard?.export_formats, selectedExportFormat]);

  async function loadReviewTasks(nextRoomId = roomId) {
    if (!nextRoomId) {
      setReviewTasks([]);
      return [];
    }

    setReviewTasksLoading(true);
    try {
      const tasks = await api<ReviewTaskListItem[]>(`/api/v1/rooms/${nextRoomId}/review/tasks/?filter=validation`);
      const nextTasks = tasks || [];
      setReviewTasks(nextTasks);
      return nextTasks;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setReviewTasks([]);
      return [];
    } finally {
      setReviewTasksLoading(false);
    }
  }

  async function loadDatasetTasks(nextRoomId = roomId) {
    if (!nextRoomId) {
      setDatasetTasks([]);
      setSelectedDatasetTaskIds([]);
      return [];
    }

    setDatasetTasksLoading(true);
    try {
      const tasks = await api<RoomDatasetTaskItem[]>(`/api/v1/rooms/${nextRoomId}/dataset/tasks/`);
      const nextTasks = tasks || [];
      setDatasetTasks(nextTasks);
      setSelectedDatasetTaskIds((current) => current.filter((taskId) => nextTasks.some((task) => task.id === taskId)));
      return nextTasks;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setDatasetTasks([]);
      setSelectedDatasetTaskIds([]);
      return [];
    } finally {
      setDatasetTasksLoading(false);
    }
  }

  function getManageSectionSummary(currentDashboard: RoomDashboard | null) {
    if (!currentDashboard) {
      return "Настройки, доступ и выгрузка собраны в одном разделе.";
    }

    const summaryParts = [
      currentDashboard.actor.can_edit_room ? "настройки" : null,
      currentDashboard.actor.can_export ? "экспорт" : null,
      currentDashboard.actor.can_invite ? "доступ" : null,
    ].filter(Boolean);

    return summaryParts.length
      ? `${summaryParts.join(" • ")} собраны в одном разделе.`
      : "Управляющие инструменты появятся здесь, когда будут доступны.";
  }

  function getReviewSectionSummary(currentDashboard: RoomDashboard | null) {
    if (!currentDashboard) {
      return "Список участников и итоговая проверка собраны в одном разделе.";
    }

    const annotatorsCount = Number(currentDashboard.annotators?.length || 0);
    if (reviewTasksLoading) {
      return `${annotatorsCount} участников • загружаем объекты для проверки.`;
    }
    if (reviewTasks.length) {
      return `${annotatorsCount} участников • ${reviewTasks.length} объектов готовы к просмотру.`;
    }
    return `${annotatorsCount} участников • открой раздел, чтобы загрузить результаты проверки.`;
  }

  async function refresh() {
    if (!roomId) {
      addToast("Не удалось определить ID комнаты из URL.", "error");
      return;
    }

    setLoading(true);
    try {
      // Dashboard is the main read model for this screen: room header, actor
      // permissions, annotator stats and management capabilities arrive in one payload.
      const nextDashboard = await api<RoomDashboard>(`/api/v1/rooms/${roomId}/dashboard/`);
      setDashboard(nextDashboard);

      if (nextDashboard.actor.can_edit_room && ["image", "video"].includes(nextDashboard.room.dataset_type) && manageSectionOpen) {
        await loadDatasetTasks(roomId);
      } else {
        setDatasetTasksLoading(false);
        setDatasetTasks([]);
        setSelectedDatasetTaskIds([]);
      }

      if (nextDashboard.actor.can_review && reviewSectionOpen) {
        await loadReviewTasks(roomId);
      } else {
        setReviewTasksLoading(false);
        setReviewTasks([]);
        setSelectedReviewTaskId(null);
        setReviewDetail(null);
      }
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!dashboard?.actor.can_review || !reviewSectionOpen) {
      return;
    }

    if (!reviewSectionOpen) {
      setSelectedReviewTaskId(null);
      setReviewDetail(null);
      return;
    }

    if (!reviewTasks.length && !reviewTasksLoading) {
      loadReviewTasks();
    }
  }, [dashboard?.actor.can_review, reviewSectionOpen]);

  useEffect(() => {
    if (!dashboard?.actor.can_edit_room || !["image", "video"].includes(dashboard.room.dataset_type) || !manageSectionOpen) {
      return;
    }

    if (!datasetTasks.length && !datasetTasksLoading) {
      loadDatasetTasks();
    }
  }, [dashboard?.actor.can_edit_room, dashboard?.room.dataset_type, manageSectionOpen]);

  const filteredAnnotators = (dashboard?.annotators || []).filter((annotator) => {
    const searchTerm = annotatorSearch.trim().toLowerCase();
    if (!searchTerm) {
      return true;
    }

    return [annotator.display_name, annotator.email, annotator.user_id, translateMembership(annotator.status), translateRole(annotator.role)]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm);
  });

  const activeAnnotator = (dashboard?.annotators || []).find((item) => item.user_id === selectedAnnotatorUserId) || null;
  const activeAnnotatorCanReceiveQuota = Boolean(
    activeAnnotator &&
      (activeAnnotator.status === "joined" || activeAnnotator.status === "owner") &&
      ["owner", "annotator", "admin"].includes(activeAnnotator.role)
  );

  useEffect(() => {
    setSelectedRole(activeAnnotator?.role || "");
  }, [activeAnnotator?.user_id, activeAnnotator?.role]);

  useEffect(() => {
    setSelectedQuota(activeAnnotator?.custom_task_quota == null ? "" : String(activeAnnotator.custom_task_quota));
  }, [activeAnnotator?.user_id, activeAnnotator?.custom_task_quota]);

  const filteredReviewTasks = reviewTasks.filter((task) => {
    const matchesAnnotator = !selectedAnnotatorUserId || (task.annotator_ids || []).includes(selectedAnnotatorUserId);
    if (!matchesAnnotator) {
      return false;
    }

    const searchTerm = reviewSearch.trim().toLowerCase();
    if (!searchTerm) {
      return true;
    }

    return [`задача ${task.id}`, task.source_name, translateSourceType(task.source_type), task.status]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm);
  });

  const filteredDatasetTasks = datasetTasks.filter((task) => {
    const searchTerm = datasetTaskSearch.trim().toLowerCase();
    if (!searchTerm) {
      return true;
    }

    return [
      `задача ${task.id}`,
      `#${task.id}`,
      task.source_name,
      getTaskItemNumber(task),
      translateWorkflowStage(task.workflow_stage),
      translateTaskStatus(task.status),
    ]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm);
  });
  const displayedDatasetTasks = filteredDatasetTasks.slice(0, 300);
  const selectedDatasetTaskCount = selectedDatasetTaskIds.length;
  const allDisplayedDatasetTasksSelected = Boolean(
    displayedDatasetTasks.length && displayedDatasetTasks.every((task) => selectedDatasetTaskIds.includes(task.id))
  );

  useEffect(() => {
    if (!dashboard?.actor.can_review) {
      return;
    }

    if (!filteredReviewTasks.length) {
      setSelectedReviewTaskId(null);
      setReviewDetail(null);
      return;
    }

    if (!filteredReviewTasks.some((task) => task.id === selectedReviewTaskId)) {
      setSelectedReviewTaskId(filteredReviewTasks[0].id);
    }
  }, [dashboard?.actor.can_review, reviewSectionOpen, filteredReviewTasks.map((item) => item.id).join(","), selectedReviewTaskId]);

  useEffect(() => {
    async function loadReviewDetail() {
      if (!reviewSectionOpen || !selectedReviewTaskId) {
        setReviewDetail(null);
        return;
      }
      try {
        const detail = await api<ReviewTaskDetail>(`/api/v1/tasks/${selectedReviewTaskId}/review/`);
        setReviewDetail(detail);
      } catch (error) {
        addToast(getErrorMessage(error), "error");
      }
    }

    loadReviewDetail();
  }, [selectedReviewTaskId, reviewSectionOpen]);

  async function handleCopyInviteLink() {
    if (!dashboard?.invite.url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(dashboard.invite.url);
      addToast("Invite-ссылка скопирована.", "success");
    } catch (error) {
      addToast("Не удалось скопировать invite-ссылку. Скопируй ее вручную из поля.", "warning");
    }
  }

  async function handleRegenerateInvite() {
    if (!roomId) {
      return;
    }

    clearToasts();
    setInviteBusy(true);
    try {
      await api(`/api/v1/rooms/${roomId}/invite/regenerate/`, {
        method: "POST",
        body: {},
      });
      addToast("Invite-ссылка обновлена. Старая ссылка больше не действует.", "success");
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleJoinRequestAction(joinRequestId: number, action: "approve" | "reject") {
    if (!roomId) {
      return;
    }

    clearToasts();
    setJoinRequestBusyId(joinRequestId);
    try {
      await api(`/api/v1/rooms/${roomId}/join-requests/${joinRequestId}/${action}/`, {
        method: "POST",
        body: {},
      });
      addToast(action === "approve" ? "Заявка принята." : "Заявка отклонена.", "success");
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setJoinRequestBusyId(null);
    }
  }

  async function handleRoleSubmit() {
    if (!roomId || !activeAnnotator) {
      return;
    }

    clearToasts();
    try {
      await api(`/api/v1/rooms/${roomId}/memberships/${activeAnnotator.user_id}/role/`, {
        method: "POST",
        body: { role: selectedRole },
      });
      addToast(`Роль пользователя #${activeAnnotator.user_id} обновлена.`, "success");
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  async function handleQuotaSubmit() {
    if (!roomId || !activeAnnotator) {
      return;
    }

    const trimmedQuota = selectedQuota.trim();
    const nextQuota = trimmedQuota === "" ? null : Number(trimmedQuota);
    if (nextQuota !== null && (!Number.isFinite(nextQuota) || nextQuota < 0 || !Number.isInteger(nextQuota))) {
      addToast("Квота должна быть целым числом 0 или больше.", "error");
      return;
    }

    clearToasts();
    setQuotaBusy(true);
    try {
      await api(`/api/v1/rooms/${roomId}/quotas/${activeAnnotator.user_id}/`, {
        method: "POST",
        body: { task_quota: nextQuota },
      });
      addToast(
        nextQuota === null
          ? `Пользователь #${activeAnnotator.user_id} вернется к стандартной квоте комнаты.`
          : `Квота пользователя #${activeAnnotator.user_id} обновлена.`,
        "success"
      );
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setQuotaBusy(false);
    }
  }

  function handleDatasetTaskToggle(taskId: number) {
    setSelectedDatasetTaskIds((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId]
    );
  }

  function handleDatasetSelectDisplayed() {
    if (allDisplayedDatasetTasksSelected) {
      const displayedIds = new Set(displayedDatasetTasks.map((task) => task.id));
      setSelectedDatasetTaskIds((current) => current.filter((taskId) => !displayedIds.has(taskId)));
      return;
    }

    setSelectedDatasetTaskIds((current) => Array.from(new Set([...current, ...displayedDatasetTasks.map((task) => task.id)])));
  }

  async function handleDatasetUpload() {
    if (!roomId || !datasetUploadFiles.length) {
      addToast("Выбери изображения или ZIP-архив для загрузки.", "error");
      return;
    }

    clearToasts();
    setDatasetUploadBusy(true);
    try {
      const mediaManifest = await buildMediaManifest(datasetUploadFiles, "image");
      const payload = new FormData();
      datasetUploadFiles.forEach((file) => payload.append("dataset_files", file));
      if (mediaManifest.length) {
        payload.append("media_manifest", JSON.stringify(mediaManifest));
      }

      const result = await api<RoomDatasetUploadResponse>(`/api/v1/rooms/${roomId}/dataset/upload/`, {
        method: "POST",
        formData: payload,
      });
      addToast(`Добавлено объектов: ${result.added_count}.`, "success");
      setDatasetUploadFiles([]);
      if (datasetFileInputRef.current) {
        datasetFileInputRef.current.value = "";
      }
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setDatasetUploadBusy(false);
    }
  }

  async function handleDatasetDelete() {
    if (!roomId || !selectedDatasetTaskIds.length) {
      addToast("Выбери объекты датасета для удаления.", "error");
      return;
    }

    const shouldDelete = window.confirm(
      `Удалить выбранные объекты датасета (${selectedDatasetTaskIds.length})? Связанные разметки тоже будут удалены.`
    );
    if (!shouldDelete) {
      return;
    }

    clearToasts();
    setDatasetDeleteBusy(true);
    try {
      const result = await api<{ deleted_count: number }>(`/api/v1/rooms/${roomId}/dataset/delete/`, {
        method: "POST",
        body: { task_ids: selectedDatasetTaskIds },
      });
      addToast(`Удалено объектов: ${result.deleted_count}.`, "success");
      setSelectedDatasetTaskIds([]);
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setDatasetDeleteBusy(false);
    }
  }

  async function handleRemoveAnnotator() {
    if (!roomId || !activeAnnotator) {
      return;
    }

    const shouldRemove = window.confirm(
      `Удалить участника #${activeAnnotator.user_id} из комнаты? Он потеряет доступ к задачам и комнате.`
    );
    if (!shouldRemove) {
      return;
    }

    clearToasts();
    try {
      await api(`/api/v1/rooms/${roomId}/memberships/${activeAnnotator.user_id}/`, {
        method: "DELETE",
      });
      addToast(`Участник #${activeAnnotator.user_id} удалён из комнаты.`, "success");
      setSelectedAnnotatorUserId(null);
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  async function handleDeleteRoom() {
    if (!roomId) {
      return;
    }

    if (!deleteRoomConfirmOpen) {
      setDeleteRoomConfirmOpen(true);
      return;
    }

    if (!deleteRoomPassword.trim()) {
      addToast("Введи текущий пароль владельца комнаты, чтобы подтвердить удаление.", "error");
      return;
    }

    clearToasts();
    setDeleteRoomBusy(true);
    try {
      await api(`/api/v1/rooms/${roomId}/`, {
        method: "DELETE",
        body: { password: deleteRoomPassword },
      });
      window.location.href = "/rooms/";
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setDeleteRoomBusy(false);
    }
  }

  function handleCancelDeleteRoom() {
    setDeleteRoomConfirmOpen(false);
    setDeleteRoomPassword("");
  }

  async function handleExport() {
    if (!roomId || !dashboard) {
      return;
    }

    clearToasts();
    try {
      await downloadRoomExport(roomId, selectedExportFormat, authUser);
      addToast("Файл с размеченным датасетом подготовлен.", "success");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  async function handleRejectTask() {
    if (!reviewDetail?.task.id || !reviewDetail.can_reject_all) {
      return;
    }

    const shouldReject = window.confirm(
      "Отклонить эту разметку? Задача будет исключена из итоговой выборки и отправлена на повторную разметку."
    );
    if (!shouldReject) {
      return;
    }

    clearToasts();
    try {
      await api(`/api/v1/tasks/${reviewDetail.task.id}/reject/`, {
        method: "POST",
        body: {},
      });
      setSelectedReviewTaskId(null);
      setReviewDetail(null);
      addToast(`Разметка по задаче #${reviewDetail.task.id} отклонена. Объект возвращен в пул.`, "success");
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  const hasRoomManagementActions = Boolean(
    dashboard &&
      (dashboard.actor.can_edit_room || dashboard.actor.can_delete_room || dashboard.actor.can_export || dashboard.actor.can_invite)
  );
  const firstVideoTask = dashboard?.video_tasks?.[0] || null;
  const canManageDataset = Boolean(dashboard?.actor.can_edit_room && dashboard.room.dataset_type === "image");
  const canManageVideoDataset = Boolean(dashboard?.actor.can_edit_room && dashboard.room.dataset_type === "video");
  const canShowRoomWorkspace = Boolean(dashboard && (dashboard.actor.can_annotate || hasRoomManagementActions));
  const roomWorkflowLabel = dashboard ? translateAnnotationWorkflow(dashboard.room.annotation_workflow || "standard") : "";
  const roomPrimaryAction =
    dashboard?.actor.can_annotate && dashboard.room.dataset_type === "video" && firstVideoTask
      ? { href: `/videos/${firstVideoTask.id}/pre-annotate/`, label: "Выбрать кадры" }
      : dashboard?.actor.can_annotate
        ? { href: `/rooms/${dashboard.room.id}/work/`, label: "Продолжить разметку" }
        : null;
  const roomDetailSections = dashboard
    ? ([
        {
          id: "overview",
          label: "Обзор",
          summary: `${dashboard.overview.completed_tasks}/${dashboard.overview.total_tasks} задач`,
        },
        dashboard.actor.can_annotate
          ? {
              id: "personal",
              label: "Моя статистика",
              summary: formatPercent(dashboard.annotator_stats?.progress_percent || 0),
            }
          : null,
        canManageDataset || canManageVideoDataset
          ? {
              id: "dataset",
              label: "Датасет",
              summary: canManageVideoDataset ? "Видео и интервалы" : "Файлы и объекты",
            }
          : null,
        dashboard.actor.can_invite || dashboard.actor.can_assign_roles || dashboard.actor.can_assign_quotas || Boolean(dashboard.annotators?.length)
          ? {
              id: "team",
              label: "Команда",
              summary: `${dashboard.annotators?.length || 0} участников`,
            }
          : null,
        dashboard.actor.can_review
          ? {
              id: "review",
              label: "Проверка",
              summary: reviewTasksLoading ? "Загрузка" : `${reviewTasks.length} объектов`,
            }
          : null,
        dashboard.actor.can_export
          ? {
              id: "export",
              label: "Экспорт",
              summary: `${dashboard.export_formats.length} форматов`,
            }
          : null,
        dashboard.actor.can_edit_room || dashboard.actor.can_delete_room
          ? {
              id: "settings",
              label: "Настройки",
              summary: dashboard.room.has_password ? "Закрытая" : "Открытая",
            }
          : null,
      ].filter(Boolean) as Array<{ id: RoomDetailSectionId; label: string; summary: string }>)
    : [];
  const activeRoomSectionAvailable = roomDetailSections.some((section) => section.id === activeRoomSection);

  function handleRoomSectionChange(sectionId: RoomDetailSectionId) {
    setActiveRoomSection(sectionId);
    if (["dataset", "team", "export", "settings"].includes(sectionId)) {
      setManageSectionOpen(true);
    }
    if (sectionId === "review") {
      setReviewSectionOpen(true);
    }
  }

  useEffect(() => {
    if (dashboard && !activeRoomSectionAvailable) {
      setActiveRoomSection("overview");
    }
  }, [dashboard, activeRoomSectionAvailable]);

  useEffect(() => {
    if (!dashboard?.actor.can_review || activeRoomSection !== "review") {
      return;
    }

    setReviewSectionOpen(true);
    if (!reviewTasks.length && !reviewTasksLoading) {
      loadReviewTasks();
    }
  }, [dashboard?.actor.can_review, activeRoomSection]);

  useEffect(() => {
    if (
      !dashboard?.actor.can_edit_room ||
      !["image", "video"].includes(dashboard.room.dataset_type) ||
      activeRoomSection !== "dataset"
    ) {
      return;
    }

    setManageSectionOpen(true);
    if (!datasetTasks.length && !datasetTasksLoading) {
      loadDatasetTasks();
    }
  }, [dashboard?.actor.can_edit_room, dashboard?.room.dataset_type, activeRoomSection]);

  if (dashboard) {
    const activeSectionTitle = roomDetailSections.find((section) => section.id === activeRoomSection)?.label || "Обзор";

    return (
      <>
        <section className="room-console">
          <header className="room-console__hero">
            <div className="room-console__hero-copy">
              <span className="eyebrow">Комната #{dashboard.room.id}</span>
              <h1>{dashboard.room.title}</h1>
              <p>{dashboard.room.description || "Описание комнаты пока не добавлено."}</p>
              <div className="room-console-tags" aria-label="Параметры комнаты">
                <span>{translateDatasetMode(dashboard.room.dataset_type)}</span>
                <span>{roomWorkflowLabel}</span>
                <span>{formatDate(dashboard.room.deadline)}</span>
                <span>{dashboard.room.has_password ? "Доступ по паролю" : "Открытый доступ"}</span>
              </div>
            </div>
            <div className="room-console__hero-actions" aria-label="Действия комнаты">
              <a className="btn btn--muted" href="/">
                Главное меню
              </a>
              {roomPrimaryAction ? (
                <a className="btn btn--primary" href={roomPrimaryAction.href}>
                  {roomPrimaryAction.label}
                </a>
              ) : null}
              {dashboard.actor.can_review ? (
                <a className="btn btn--secondary" href={`/rooms/${dashboard.room.id}/work/?mode=review`}>
                  Открыть проверку
                </a>
              ) : null}
              {dashboard.room.description_pdf_url ? (
                <a className="btn btn--muted" href={dashboard.room.description_pdf_url} target="_blank" rel="noreferrer">
                  {dashboard.room.description_pdf_name || "PDF с описанием"}
                </a>
              ) : null}
            </div>
          </header>

          {loading ? <div className="empty-card room-console__loading">Обновляем данные комнаты.</div> : null}

          <div className="room-console__layout">
            <aside className="room-console-nav" aria-label="Разделы комнаты">
              {roomDetailSections.map((section) => (
                <button
                  key={section.id}
                  className={`room-console-nav__item ${activeRoomSection === section.id ? "is-active" : ""}`}
                  type="button"
                  onClick={() => handleRoomSectionChange(section.id)}
                >
                  <span>{section.label}</span>
                  <small>{section.summary}</small>
                </button>
              ))}
            </aside>

            <main className="room-console-main" aria-label={activeSectionTitle}>
              {activeRoomSection === "overview" ? (
                <div className="room-console-section">
                  <div className="room-console-panel room-console-panel--intro">
                    <div>
                      <span className="eyebrow">Состояние комнаты</span>
                      <h2>Обзор работы</h2>
                      <p>
                        Здесь собраны прогресс, быстрые действия и базовые параметры комнаты. Разметка и ревью остаются в отдельном
                        fullscreen-редакторе.
                      </p>
                    </div>
                    <div className="room-console-actions">
                      {roomPrimaryAction ? (
                        <a className="btn btn--primary" href={roomPrimaryAction.href}>
                          {roomPrimaryAction.label}
                        </a>
                      ) : null}
                      {dashboard.actor.can_edit_room ? (
                        <a className="btn btn--muted" href={`/rooms/${dashboard.room.id}/edit/`}>
                          Редактировать
                        </a>
                      ) : null}
                      {dashboard.actor.can_export ? (
                        <button className="btn btn--muted" type="button" onClick={() => handleRoomSectionChange("export")}>
                          Экспорт
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="room-console-card-grid">
                    <article className="room-console-panel">
                      <span className="eyebrow">Датасет</span>
                      <h2>{dashboard.room.dataset_label || "Тестовый датасет"}</h2>
                      <div className="summary-stack">
                        <div className="summary-row">
                          <span>Тип</span>
                          <strong>{translateDatasetMode(dashboard.room.dataset_type)}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Сценарий</span>
                          <strong>{roomWorkflowLabel}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Cross-validation</span>
                          <strong>
                            {dashboard.room.cross_validation_enabled ? `${dashboard.room.cross_validation_annotators_count}x` : "Выкл."}
                          </strong>
                        </div>
                      </div>
                    </article>
                    <article className="room-console-panel">
                      <span className="eyebrow">Контроль качества</span>
                      <h2>Проверка</h2>
                      <div className="summary-stack">
                        <div className="summary-row">
                          <span>Голосование</span>
                          <strong>{dashboard.room.review_voting_enabled ? `${dashboard.room.review_votes_required} голос.` : "Выкл."}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Лейблы</span>
                          <strong>{dashboard.labels.length}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Моя роль</span>
                          <strong>{translateRole(dashboard.actor.role)}</strong>
                        </div>
                      </div>
                    </article>
                  </div>
                </div>
              ) : null}

              {activeRoomSection === "personal" ? (
                <div className="room-console-section">
                  <div className="room-console-panel room-console-panel--intro">
                    <div>
                      <span className="eyebrow">Моя очередь</span>
                      <h2>Личная статистика</h2>
                      <p>
                        {translateRole(dashboard.actor.role)} • {formatPercent(dashboard.annotator_stats?.progress_percent || 0)} •{" "}
                        {dashboard.annotator_stats?.remaining_tasks == null
                          ? "остаток не задан"
                          : `осталось ${dashboard.annotator_stats.remaining_tasks}`}
                      </p>
                    </div>
                    {roomPrimaryAction ? (
                      <a className="btn btn--primary" href={roomPrimaryAction.href}>
                        {roomPrimaryAction.label}
                      </a>
                    ) : null}
                  </div>
                  <div className="room-personal-content room-console-panel">
                    <div className="summary-stack room-personal-summary">
                      <div className="summary-row">
                        <span>Роль в комнате</span>
                        <strong>{translateRole(dashboard.actor.role)}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Выполнено мной</span>
                        <strong>{dashboard.annotator_stats?.completed_tasks || 0}</strong>
                      </div>
                      <div className="summary-row">
                        <span>В работе</span>
                        <strong>{dashboard.annotator_stats?.in_progress_tasks || 0}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Осталось</span>
                        <strong>{dashboard.annotator_stats?.remaining_tasks == null ? "Не задано" : dashboard.annotator_stats.remaining_tasks}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Квота</span>
                        <strong>
                          {dashboard.annotator_stats?.task_quota == null
                            ? "Не задана"
                            : `${dashboard.annotator_stats.quota_used} из ${dashboard.annotator_stats.task_quota}`}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Мой прогресс</span>
                        <strong>{formatPercent(dashboard.annotator_stats?.progress_percent || 0)}</strong>
                      </div>
                    </div>
                    <div className="activity-board">
                      <ActivityBoard series={dashboard.annotator_stats?.activity || []} />
                    </div>
                  </div>
                </div>
              ) : null}

              {activeRoomSection === "dataset" ? (
                <div className="room-console-section">
                  {canManageDataset ? (
                    <div className="room-console-panel room-console-panel--workspace">
                      <div className="panel-card__head">
                        <div>
                          <span className="eyebrow">Датасет</span>
                          <h2>Изображения комнаты</h2>
                        </div>
                      </div>
                      <div className="dataset-manager-upload">
                        <label className="field">
                          <span>Добавить изображения</span>
                          <input
                            ref={datasetFileInputRef}
                            type="file"
                            accept={datasetModeConfig.image.accept}
                            multiple
                            onChange={(event) => setDatasetUploadFiles(Array.from(event.currentTarget.files || []))}
                          />
                        </label>
                        <div className="panel-note">{summarizeSelectedFiles(datasetUploadFiles)}</div>
                        <button
                          className="btn btn--primary"
                          type="button"
                          disabled={datasetUploadBusy || !datasetUploadFiles.length}
                          onClick={handleDatasetUpload}
                        >
                          {datasetUploadBusy ? "Загружаем..." : "Добавить в комнату"}
                        </button>
                      </div>
                      <div className="dataset-manager-toolbar">
                        <label className="field panel-search">
                          <span>Поиск по датасету</span>
                          <input
                            value={datasetTaskSearch}
                            type="text"
                            placeholder="Файл, номер или ID"
                            onChange={(event) => setDatasetTaskSearch(event.currentTarget.value)}
                          />
                        </label>
                        <div className="dataset-manager-toolbar__actions">
                          <button
                            className="btn btn--muted btn--compact"
                            type="button"
                            disabled={!displayedDatasetTasks.length}
                            onClick={handleDatasetSelectDisplayed}
                          >
                            {allDisplayedDatasetTasksSelected ? "Снять выбор" : "Выбрать показанные"}
                          </button>
                          <button
                            className="btn btn--danger btn--compact"
                            type="button"
                            disabled={datasetDeleteBusy || !selectedDatasetTaskCount}
                            onClick={handleDatasetDelete}
                          >
                            {datasetDeleteBusy ? "Удаляем..." : `Удалить (${selectedDatasetTaskCount})`}
                          </button>
                        </div>
                      </div>
                      <div className="summary-stack dataset-manager-summary">
                        <div className="summary-row">
                          <span>Всего объектов</span>
                          <strong>{datasetTasks.length}</strong>
                        </div>
                        <div className="summary-row">
                          <span>По фильтру</span>
                          <strong>{filteredDatasetTasks.length}</strong>
                        </div>
                      </div>
                      {datasetTasksLoading ? (
                        <div className="empty-card">Загружаем состав датасета.</div>
                      ) : !datasetTasks.length ? (
                        <div className="empty-card">В датасете пока нет изображений.</div>
                      ) : !filteredDatasetTasks.length ? (
                        <div className="empty-card">По этому запросу изображения не найдены.</div>
                      ) : (
                        <>
                          <div className="dataset-task-list" aria-label="Изображения датасета">
                            {displayedDatasetTasks.map((task) => (
                              <label key={task.id} className="dataset-task-row">
                                <input
                                  type="checkbox"
                                  checked={selectedDatasetTaskIds.includes(task.id)}
                                  onChange={() => handleDatasetTaskToggle(task.id)}
                                />
                                {task.source_file_url ? (
                                  <img
                                    className="dataset-task-row__thumb"
                                    src={task.source_file_url}
                                    alt={task.source_name || `Задача ${task.id}`}
                                    loading="lazy"
                                  />
                                ) : (
                                  <span className="dataset-task-row__thumb dataset-task-row__thumb--empty" aria-hidden="true"></span>
                                )}
                                <span className="dataset-task-row__meta">
                                  <strong>{task.source_name || `Задача #${task.id}`}</strong>
                                  <span>
                                    #{task.id} · № {getTaskItemNumber(task) || "?"} · {translateTaskStatus(task.status)} ·{" "}
                                    {task.submitted_annotations_count} разметок
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                          {filteredDatasetTasks.length > displayedDatasetTasks.length ? (
                            <div className="panel-note">
                              Показаны первые {displayedDatasetTasks.length} из {filteredDatasetTasks.length}. Уточни поиск, чтобы быстрее найти
                              нужные изображения.
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  {canManageVideoDataset ? (
                    <div className="room-console-panel room-console-panel--workspace">
                      <div className="panel-card__head">
                        <div>
                          <span className="eyebrow">Видео</span>
                          <h2>Видео датасет</h2>
                        </div>
                      </div>
                      <label className="field panel-search">
                        <span>Поиск по видео</span>
                        <input
                          value={datasetTaskSearch}
                          type="text"
                          placeholder="Файл или ID"
                          onChange={(event) => setDatasetTaskSearch(event.currentTarget.value)}
                        />
                      </label>
                      <div className="summary-stack dataset-manager-summary">
                        <div className="summary-row">
                          <span>Видео</span>
                          <strong>{datasetTasks.length}</strong>
                        </div>
                        <div className="summary-row">
                          <span>По фильтру</span>
                          <strong>{filteredDatasetTasks.length}</strong>
                        </div>
                      </div>
                      {datasetTasksLoading ? (
                        <div className="empty-card">Загружаем видео датасета.</div>
                      ) : !datasetTasks.length ? (
                        <div className="empty-card">В датасете пока нет видео.</div>
                      ) : !filteredDatasetTasks.length ? (
                        <div className="empty-card">По этому запросу видео не найдены.</div>
                      ) : (
                        <div className="dataset-task-list" aria-label="Видео датасета">
                          {displayedDatasetTasks.map((task) => (
                            <div key={task.id} className="dataset-task-row dataset-task-row--video">
                              <span className="dataset-task-row__thumb dataset-task-row__thumb--empty" aria-hidden="true"></span>
                              <span className="dataset-task-row__meta">
                                <strong>{task.source_name || `Видео #${task.id}`}</strong>
                                <span>
                                  #{task.id} · {Number(task.input_payload?.frame_count || 0)} кадров · {translateTaskStatus(task.status)}
                                </span>
                              </span>
                              <a className="btn btn--primary btn--compact" href={`/videos/${task.id}/pre-annotate/`}>
                                Выбрать кадры
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeRoomSection === "team" ? (
                <div className="room-console-section">
                  <div className="room-console-split">
                    <div className="room-console-panel room-console-panel--workspace">
                      <div className="panel-card__head">
                        <div>
                          <span className="eyebrow">Команда</span>
                          <h2>Участники комнаты</h2>
                        </div>
                      </div>
                      <label className="field panel-search">
                        <span>Поиск</span>
                        <input
                          value={annotatorSearch}
                          type="text"
                          placeholder="Имя, ID или статус"
                          onChange={(event) => setAnnotatorSearch(event.currentTarget.value)}
                        />
                      </label>
                      {(dashboard.annotators || []).length ? (
                        filteredAnnotators.length ? (
                          <div className="annotators-list annotators-list--scroll">
                            {filteredAnnotators.map((annotator) => (
                              <button
                                key={annotator.user_id}
                                className={`annotator-row ${annotator.user_id === selectedAnnotatorUserId ? "is-active" : ""}`}
                                type="button"
                                onClick={() =>
                                  setSelectedAnnotatorUserId((current) => (current === annotator.user_id ? null : annotator.user_id))
                                }
                              >
                                <div className="annotator-row__meta">
                                  <strong>{annotator.display_name}</strong>
                                  <span>
                                    {translateMembership(annotator.status)} · {translateRole(annotator.role)}
                                  </span>
                                </div>
                                <div className="annotator-row__brief">
                                  <div>{formatPercent(annotator.progress_percent)}</div>
                                  <div>отправлено: {annotator.completed_tasks}</div>
                                  <div>
                                    {annotator.task_quota == null ? "квота не задана" : `квота: ${annotator.quota_used}/${annotator.task_quota}`}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-card">По этому запросу исполнители не найдены.</div>
                        )
                      ) : (
                        <div className="empty-card">В этой комнате пока нет исполнителей.</div>
                      )}
                    </div>

                    <div className="room-console-panel room-console-panel--workspace">
                      <div className="panel-card__head">
                        <h2>Профиль участника</h2>
                      </div>
                      {activeAnnotator ? (
                        <>
                          <div className="summary-stack">
                            <div className="summary-row">
                              <span>Исполнитель</span>
                              <strong>
                                #{activeAnnotator.user_id} {activeAnnotator.display_name}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Статус</span>
                              <strong>{translateMembership(activeAnnotator.status)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Роль</span>
                              <strong>{translateRole(activeAnnotator.role)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Выполнено</span>
                              <strong>{activeAnnotator.completed_tasks}</strong>
                            </div>
                            <div className="summary-row">
                              <span>В работе</span>
                              <strong>{activeAnnotator.in_progress_tasks}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Квота</span>
                              <strong>
                                {activeAnnotator.task_quota == null
                                  ? "Не задана"
                                  : `${activeAnnotator.quota_used} из ${activeAnnotator.task_quota}${
                                      activeAnnotator.quota_source === "default" ? " · стандартная" : ""
                                    }`}
                              </strong>
                            </div>
                          </div>
                          <div className="role-assignment-box">
                            {dashboard.actor.can_assign_roles ? (
                              <label className="field field--compact">
                                <span>Роль участника</span>
                                <select value={selectedRole} onChange={(event) => setSelectedRole(event.currentTarget.value)}>
                                  {dashboard.membership_role_options.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {dashboard.actor.can_assign_quotas && activeAnnotatorCanReceiveQuota ? (
                              <label className="field field--compact">
                                <span>Квота задач</span>
                                <input
                                  value={selectedQuota}
                                  type="number"
                                  min="0"
                                  step="1"
                                  placeholder={
                                    dashboard.room.default_assignment_quota == null
                                      ? "Без стандартной квоты"
                                      : `Стандартная: ${dashboard.room.default_assignment_quota}`
                                  }
                                  onChange={(event) => setSelectedQuota(event.currentTarget.value)}
                                />
                              </label>
                            ) : null}
                            <div className="role-assignment-box__actions">
                              <a className="btn btn--muted btn--compact" href={`/users/${activeAnnotator.user_id}/profile/`}>
                                Открыть профиль
                              </a>
                              {dashboard.actor.can_assign_roles ? (
                                <button className="btn btn--secondary btn--compact" type="button" onClick={handleRoleSubmit}>
                                  Сохранить роль
                                </button>
                              ) : null}
                              {dashboard.actor.can_assign_quotas && activeAnnotatorCanReceiveQuota ? (
                                <button className="btn btn--secondary btn--compact" type="button" disabled={quotaBusy} onClick={handleQuotaSubmit}>
                                  {quotaBusy ? "Сохраняем..." : "Сохранить квоту"}
                                </button>
                              ) : null}
                              {dashboard.actor.can_assign_roles ? (
                                <button className="btn btn--danger btn--compact" type="button" onClick={handleRemoveAnnotator}>
                                  Удалить участника
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="empty-card">Выбери исполнителя в списке слева.</div>
                      )}
                    </div>
                  </div>

                  {dashboard.actor.can_invite ? (
                    <div className="room-console-split">
                      <div className="room-console-panel">
                        <div className="panel-card__head">
                          <h2>Invite-ссылка</h2>
                        </div>
                        <div className="stack-form stack-form--compact">
                          <label className="field">
                            <span>Ссылка для входа</span>
                            <input value={dashboard.invite.url} type="text" readOnly />
                          </label>
                          <button className="btn btn--primary" type="button" onClick={handleCopyInviteLink}>
                            Скопировать ссылку
                          </button>
                          <button className="btn btn--secondary" type="button" disabled={inviteBusy} onClick={handleRegenerateInvite}>
                            {inviteBusy ? "Обновляем..." : "Перегенерировать invite"}
                          </button>
                        </div>
                      </div>
                      <div className="room-console-panel">
                        <div className="panel-card__head">
                          <h2>Заявки на вступление</h2>
                        </div>
                        {dashboard.join_requests?.length ? (
                          <div className="annotators-list manage-request-list-legacy">
                            {dashboard.join_requests.map((joinRequest) => (
                              <div key={joinRequest.id} className="annotator-row manage-request-row-legacy">
                                <div className="annotator-row__meta">
                                  <strong>{joinRequest.display_name}</strong>
                                  <span>
                                    {joinRequest.email} · {translateMembership(joinRequest.status)}
                                  </span>
                                </div>
                                <div className="role-assignment-box__actions">
                                  {joinRequest.status === "pending" ? (
                                    <>
                                      <button
                                        className="btn btn--secondary btn--compact"
                                        type="button"
                                        disabled={joinRequestBusyId === joinRequest.id}
                                        onClick={() => handleJoinRequestAction(joinRequest.id, "approve")}
                                      >
                                        Принять
                                      </button>
                                      <button
                                        className="btn btn--muted btn--compact"
                                        type="button"
                                        disabled={joinRequestBusyId === joinRequest.id}
                                        onClick={() => handleJoinRequestAction(joinRequest.id, "reject")}
                                      >
                                        Отклонить
                                      </button>
                                    </>
                                  ) : (
                                    <span className="panel-note">
                                      {joinRequest.status === "approved"
                                        ? `Принял: ${joinRequest.reviewed_by_display_name || "модератор"}`
                                        : `Отклонил: ${joinRequest.reviewed_by_display_name || "модератор"}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-card">По invite-ссылке пока никто не запросил доступ.</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeRoomSection === "review" ? (
                <div className="room-console-section">
                  <div className="room-console-panel room-console-panel--intro">
                    <div>
                      <span className="eyebrow">Контроль качества</span>
                      <h2>Проверка разметки</h2>
                      <p>На странице комнаты виден список объектов и краткая сводка. Детальное сравнение открывается в редакторе.</p>
                    </div>
                    <a className="btn btn--primary" href={`/rooms/${dashboard.room.id}/work/?mode=review`}>
                      Открыть в редакторе
                    </a>
                  </div>
                  <section className="room-review-grid room-review-grid--console">
                    <div className="room-console-panel room-review-grid__card room-review-grid__card--scroll">
                      <div className="panel-card__head">
                        <h2>Размеченные объекты</h2>
                      </div>
                      <label className="field panel-search">
                        <span>Поиск</span>
                        <input
                          value={reviewSearch}
                          type="text"
                          placeholder="Задача, файл или тип"
                          onChange={(event) => setReviewSearch(event.currentTarget.value)}
                        />
                      </label>
                      {reviewTasksLoading ? (
                        <div className="empty-card">Загружаем объекты для проверки.</div>
                      ) : !reviewTasks.length ? (
                        <div className="empty-card">Размеченных объектов для проверки пока нет.</div>
                      ) : !filteredReviewTasks.length ? (
                        <div className="empty-card">По этому запросу объекты не найдены.</div>
                      ) : (
                        <div className="annotators-list annotators-list--scroll">
                          {filteredReviewTasks.map((task) => (
                            <button
                              key={task.id}
                              className={`annotator-row review-task-row ${task.id === selectedReviewTaskId ? "is-active" : ""}`}
                              type="button"
                              onClick={() => setSelectedReviewTaskId(task.id)}
                            >
                              <div className="annotator-row__meta">
                                <strong>Задача #{task.id}</strong>
                                <span>{task.source_name || translateSourceType(task.source_type)}</span>
                              </div>
                              <div className="annotator-row__brief">
                                <div>{translateReviewOutcome(task.review_outcome)}</div>
                                <div>
                                  {task.review_outcome === "validation"
                                    ? `${task.validation_votes_count}/${task.validation_votes_required} голосов`
                                    : `${task.annotations_count} аннотац.`}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="room-console-panel room-review-grid__card">
                      <div className="panel-card__head">
                        <h2>Сводка объекта</h2>
                      </div>
                      {reviewDetail ? (
                        <div className="summary-stack review-task-detail">
                          <div className="summary-row">
                            <span>Задача</span>
                            <strong>#{reviewDetail.task.id}</strong>
                          </div>
                          <div className="summary-row">
                            <span>Статус</span>
                            <strong>{translateReviewOutcome(reviewDetail.review_outcome)}</strong>
                          </div>
                          <div className="summary-row">
                            <span>Тип</span>
                            <strong>{translateSourceType(reviewDetail.task.source_type)}</strong>
                          </div>
                          <div className="summary-row">
                            <span>Раунд</span>
                            <strong>{reviewDetail.task.current_round}</strong>
                          </div>
                          <div className="summary-row">
                            <span>Сходство</span>
                            <strong>{reviewDetail.task.validation_score == null ? "Не рассчитано" : `${reviewDetail.task.validation_score}%`}</strong>
                          </div>
                          <div className="summary-row">
                            <span>Голоса</span>
                            <strong>
                              {reviewDetail.validation_votes_count}/{reviewDetail.validation_votes_required}
                            </strong>
                          </div>
                          {reviewDetail.task.source_file_url ? (
                            reviewDetail.task.source_type === "image" ? (
                              <img
                                className="review-task-preview"
                                src={reviewDetail.task.source_file_url}
                                alt={reviewDetail.task.source_name || `task-${reviewDetail.task.id}`}
                              />
                            ) : (
                              <video className="review-task-preview" src={reviewDetail.task.source_file_url} controls preload="metadata"></video>
                            )
                          ) : null}
                        </div>
                      ) : (
                        <div className="empty-card">Выбери размеченный объект в списке слева.</div>
                      )}
                    </div>
                  </section>
                </div>
              ) : null}

              {activeRoomSection === "export" ? (
                <div className="room-console-section">
                  <div className="room-console-panel room-console-panel--workspace">
                    <div className="panel-card__head">
                      <div>
                        <span className="eyebrow">Экспорт</span>
                        <h2>Экспорт и лейблы</h2>
                      </div>
                    </div>
                    <div className="label-chip-list label-chip-list--static">
                      {dashboard.labels.length ? (
                        dashboard.labels.map((label) => (
                          <span key={label.id} className="label-chip label-chip--static" style={{ ["--label-color" as any]: label.color }}>
                            <i></i>
                            <span>{label.name}</span>
                          </span>
                        ))
                      ) : (
                        <div className="empty-card">Лейблы для этой комнаты пока не заданы.</div>
                      )}
                    </div>
                    <label className="field field--export-compact">
                      <span>Формат выгрузки</span>
                      <select value={selectedExportFormat} onChange={(event) => setSelectedExportFormat(event.target.value)}>
                        {dashboard.export_formats.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn btn--secondary" type="button" onClick={handleExport}>
                      Выгрузить датасет
                    </button>
                  </div>
                </div>
              ) : null}

              {activeRoomSection === "settings" ? (
                <div className="room-console-section">
                  <div className="room-console-panel room-console-panel--workspace">
                    <div className="panel-card__head">
                      <div>
                        <span className="eyebrow">Управление</span>
                        <h2>Параметры комнаты</h2>
                      </div>
                    </div>
                    <div className="room-settings-panel__locks">
                      <article className="room-settings-panel__lock">
                        <span>Тип датасета</span>
                        <strong>{translateDatasetMode(dashboard.room.dataset_type)}</strong>
                      </article>
                      <article className="room-settings-panel__lock">
                        <span>Сценарий разметки</span>
                        <strong>{translateAnnotationWorkflow(dashboard.room.annotation_workflow || "standard")}</strong>
                      </article>
                      <article className="room-settings-panel__lock">
                        <span>Стандартная квота</span>
                        <strong>{dashboard.room.default_assignment_quota == null ? "Не задана" : dashboard.room.default_assignment_quota}</strong>
                      </article>
                    </div>
                    <p className="panel-note room-settings-panel__note">
                      Название, описание, дедлайн, пароль, стандартная квота и параметры перекрестной разметки редактируются на отдельной странице.
                    </p>
                    <div className="role-assignment-box__actions">
                      {dashboard.actor.can_edit_room ? (
                        <a className="btn btn--muted" href={`/rooms/${dashboard.room.id}/edit/`}>
                          Редактировать комнату
                        </a>
                      ) : null}
                      {dashboard.actor.can_delete_room ? (
                        <button className="btn btn--danger" type="button" onClick={handleDeleteRoom} disabled={deleteRoomBusy}>
                          Удалить комнату
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </main>

            <aside className="room-console-aside" aria-label="Сводка">
              <div className="room-console-aside__panel">
                <span className="eyebrow">Прогресс</span>
                <RoomProgressChart
                  totalTasks={dashboard.overview.total_tasks}
                  completedTasks={dashboard.overview.completed_tasks}
                  remainingTasks={dashboard.overview.remaining_tasks}
                  progressPercent={dashboard.overview.progress_percent}
                />
              </div>
              <div className="room-console-aside__panel">
                <span className="eyebrow">Параметры</span>
                <div className="summary-stack">
                  <div className="summary-row">
                    <span>Дедлайн</span>
                    <strong>{formatDate(dashboard.room.deadline)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Доступ</span>
                    <strong>{dashboard.room.has_password ? "С паролем" : "Без пароля"}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Лейблов</span>
                    <strong>{dashboard.labels.length}</strong>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {deleteRoomConfirmOpen ? (
          <div className="modal-shell" role="presentation" onClick={handleCancelDeleteRoom}>
            <div
              className="modal-card modal-card--danger"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-room-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-card__head">
                <span className="eyebrow">Опасное действие</span>
                <h2 id="delete-room-modal-title">Удалить комнату?</h2>
                <p>
                  Комната, задачи, участники и результаты разметки будут удалены без возможности восстановления. Для подтверждения
                  введи текущий пароль владельца.
                </p>
              </div>
              <label className="field field--full">
                <span>Пароль владельца</span>
                <input
                  value={deleteRoomPassword}
                  type="password"
                  placeholder="Введи текущий пароль аккаунта"
                  autoFocus
                  onChange={(event) => setDeleteRoomPassword(event.currentTarget.value)}
                />
              </label>
              <div className="modal-card__actions">
                <button className="btn btn--muted" type="button" onClick={handleCancelDeleteRoom} disabled={deleteRoomBusy}>
                  Отмена
                </button>
                <button className="btn btn--danger" type="button" onClick={handleDeleteRoom} disabled={deleteRoomBusy}>
                  {deleteRoomBusy ? "Удаляем..." : "Подтвердить удаление"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <section className="page-topbar page-topbar--room room-command-center">
        <div className="page-topbar__copy">
          <span className="eyebrow">{dashboard ? `Комната #${dashboard.room.id}` : "Комната"}</span>
          <h1>{dashboard?.room.title || "Загрузка комнаты..."}</h1>
          <p>{dashboard?.room.description || "Подгружаем статистику и рабочий контур."}</p>
          {dashboard?.room.description_pdf_url ? (
            <a className="btn btn--muted btn--compact room-description-pdf-link" href={dashboard.room.description_pdf_url} target="_blank" rel="noreferrer">
              {dashboard.room.description_pdf_name || "Открыть PDF с описанием"}
            </a>
          ) : null}
          {dashboard ? (
            <div className="room-command-meta" aria-label="Параметры комнаты">
              <article className="room-command-meta__item">
                <span>Датасет</span>
                <strong>{dashboard.room.dataset_label || "Тестовый датасет"}</strong>
              </article>
              <article className="room-command-meta__item">
                <span>Тип</span>
                <strong>{translateDatasetMode(dashboard.room.dataset_type)}</strong>
              </article>
              <article className="room-command-meta__item">
                <span>Сценарий</span>
                <strong>{roomWorkflowLabel}</strong>
              </article>
              <article className="room-command-meta__item">
                <span>Дедлайн</span>
                <strong>{formatDate(dashboard.room.deadline)}</strong>
              </article>
              <article className="room-command-meta__item">
                <span>Доступ</span>
                <strong>{dashboard.room.has_password ? "С паролем" : "Без пароля"}</strong>
              </article>
            </div>
          ) : (
            <div className="empty-card room-header-inline-meta__empty">Загрузка.</div>
          )}
          {dashboard && (roomPrimaryAction || dashboard.actor.can_review || dashboard.actor.can_edit_room || dashboard.actor.can_export) ? (
            <div className="room-header-cta" aria-label="Действия комнаты">
              {roomPrimaryAction ? (
                <a className="btn btn--primary room-header-cta__button" href={roomPrimaryAction.href}>
                  {roomPrimaryAction.label}
                </a>
              ) : null}
              {dashboard.actor.can_review ? (
                <a className="btn btn--secondary room-header-cta__button" href={`/rooms/${dashboard.room.id}/work/?mode=review`}>
                  Открыть проверку
                </a>
              ) : null}
              {dashboard.actor.can_edit_room ? (
                <a className="btn btn--muted room-header-cta__button" href={`/rooms/${dashboard.room.id}/edit/`}>
                  Настройки
                </a>
              ) : null}
              {dashboard.actor.can_export ? (
                <button className="btn btn--muted room-header-cta__button" type="button" onClick={handleExport}>
                  Экспорт
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <aside className="room-header-side">
          {dashboard ? (
            <div className="room-progress-panel">
              <span className="room-progress-panel__eyebrow">Прогресс комнаты</span>
              <RoomProgressChart
                totalTasks={dashboard.overview.total_tasks}
                completedTasks={dashboard.overview.completed_tasks}
                remainingTasks={dashboard.overview.remaining_tasks}
                progressPercent={dashboard.overview.progress_percent}
              />
              <div className="room-progress-brief" aria-label="Сводка задач">
                <div>
                  <span>Всего</span>
                  <strong>{dashboard.overview.total_tasks}</strong>
                </div>
                <div>
                  <span>Готово</span>
                  <strong>{dashboard.overview.completed_tasks}</strong>
                </div>
                <div>
                  <span>Осталось</span>
                  <strong>{dashboard.overview.remaining_tasks}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-card">Загрузка.</div>
          )}
        </aside>
      </section>

      {loading ? <div className="empty-card">Загрузка комнаты.</div> : null}

      {dashboard ? (
        <section className="room-command-strip" aria-label="Сводка комнаты">
          <article className="room-command-stat">
            <span>Участников</span>
            <strong>{dashboard.annotators?.length || 0}</strong>
          </article>
          <article className="room-command-stat">
            <span>Лейблов</span>
            <strong>{dashboard.labels.length}</strong>
          </article>
          <article className="room-command-stat">
            <span>Cross-validation</span>
            <strong>{dashboard.room.cross_validation_enabled ? `${dashboard.room.cross_validation_annotators_count}x` : "Выкл."}</strong>
          </article>
          <article className="room-command-stat">
            <span>Голосование</span>
            <strong>{dashboard.room.review_voting_enabled ? `${dashboard.room.review_votes_required} голос.` : "Выкл."}</strong>
          </article>
        </section>
      ) : null}

      {canShowRoomWorkspace && dashboard ? (
        <section
          className={`workspace-grid workspace-grid--room-top ${dashboard.actor.can_manage ? "workspace-grid--owner-manage" : ""} ${
            hasRoomManagementActions ? "" : "workspace-grid--single"
          }`}
        >
          {dashboard.actor.can_annotate ? (
            <div className="workspace-grid__main workspace-grid__main--room-annotator">
              <details
                className="panel-card section-disclosure room-personal-panel room-personal-panel--disclosure"
                open={personalSectionOpen}
                onToggle={(event) => setPersonalSectionOpen((event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="section-disclosure__summary">
                  <div className="section-disclosure__copy">
                    <span className="eyebrow section-disclosure__eyebrow">Моя очередь</span>
                    <strong>Личная статистика</strong>
                    <p className="section-disclosure__note">
                      {translateRole(dashboard.actor.role)} • {formatPercent(dashboard.annotator_stats?.progress_percent || 0)} •{" "}
                      {dashboard.annotator_stats?.remaining_tasks == null
                        ? "остаток не задан"
                        : `осталось ${dashboard.annotator_stats.remaining_tasks}`}
                    </p>
                  </div>
                  <span className="section-disclosure__icon" aria-hidden="true"></span>
                </summary>
                <div className="section-disclosure__content room-personal-content">
                  <div className="summary-stack room-personal-summary">
                    <div className="summary-row">
                      <span>Роль в комнате</span>
                      <strong>{translateRole(dashboard.actor.role)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Выполнено мной</span>
                      <strong>{dashboard.annotator_stats?.completed_tasks || 0}</strong>
                    </div>
                    <div className="summary-row">
                      <span>В работе</span>
                      <strong>{dashboard.annotator_stats?.in_progress_tasks || 0}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Осталось</span>
                      <strong>{dashboard.annotator_stats?.remaining_tasks == null ? "Не задано" : dashboard.annotator_stats.remaining_tasks}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Квота</span>
                      <strong>
                        {dashboard.annotator_stats?.task_quota == null
                          ? "Не задана"
                          : `${dashboard.annotator_stats.quota_used} из ${dashboard.annotator_stats.task_quota}`}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>Мой прогресс</span>
                      <strong>{formatPercent(dashboard.annotator_stats?.progress_percent || 0)}</strong>
                    </div>
                  </div>
                  <div className="activity-board">
                    <ActivityBoard series={dashboard.annotator_stats?.activity || []} />
                  </div>
                </div>
              </details>
            </div>
          ) : hasRoomManagementActions ? (
            <div className="workspace-grid__main workspace-grid__main--room-annotator">
              <details
                className="panel-card section-disclosure room-personal-panel room-personal-panel--disclosure room-personal-panel--owner"
                open={personalSectionOpen}
                onToggle={(event) => setPersonalSectionOpen((event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="section-disclosure__summary">
                  <div className="section-disclosure__copy">
                    <span className="eyebrow section-disclosure__eyebrow">Панель владельца</span>
                    <strong>Сводка управления</strong>
                    <p className="section-disclosure__note">
                      {translateRole(dashboard.actor.role)} • {dashboard.overview.total_tasks} задач • {dashboard.annotators?.length || 0} участников
                    </p>
                  </div>
                  <span className="section-disclosure__icon" aria-hidden="true"></span>
                </summary>
                <div className="section-disclosure__content room-personal-content">
                  <div className="summary-stack room-personal-summary">
                    <div className="summary-row">
                      <span>Роль</span>
                      <strong>{translateRole(dashboard.actor.role)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Задач в комнате</span>
                      <strong>{dashboard.overview.total_tasks}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Участников</span>
                      <strong>{dashboard.annotators?.length || 0}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Датасет</span>
                      <strong>{translateDatasetMode(dashboard.room.dataset_type)}</strong>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          ) : null}

          {hasRoomManagementActions ? (
            <div className="workspace-grid__side workspace-grid__side--room-controls">
              <details
                className="panel-card section-disclosure section-disclosure--command"
                open={manageSectionOpen}
                onToggle={(event) => setManageSectionOpen((event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="section-disclosure__summary">
                  <div className="section-disclosure__copy">
                    <span className="eyebrow section-disclosure__eyebrow">Управление</span>
                    <strong>Управление комнатой</strong>
                    <p className="section-disclosure__note">{getManageSectionSummary(dashboard)}</p>
                  </div>
                  <span className="section-disclosure__icon" aria-hidden="true"></span>
                </summary>
                <div className="section-disclosure__content">
                  <div className="workspace-grid__side--stack manage-stack manage-stack--command">
                    {(dashboard.actor.can_edit_room || dashboard.actor.can_delete_room) ? (
                      <div className="panel-card room-settings-panel manage-card-legacy manage-card-legacy--settings">
                        <div className="panel-card__head">
                          <h2>Параметры комнаты</h2>
                          {dashboard.actor.can_edit_room ? <span className="eyebrow room-settings-panel__eyebrow">Только владелец</span> : null}
                        </div>
                        <div className="room-settings-panel__locks">
                          <article className="room-settings-panel__lock">
                            <span>Тип датасета</span>
                            <strong>{translateDatasetMode(dashboard.room.dataset_type)}</strong>
                          </article>
                          <article className="room-settings-panel__lock">
                            <span>Сценарий разметки</span>
                            <strong>{translateAnnotationWorkflow(dashboard.room.annotation_workflow || "standard")}</strong>
                          </article>
                          <article className="room-settings-panel__lock">
                            <span>Стандартная квота</span>
                            <strong>{dashboard.room.default_assignment_quota == null ? "Не задана" : dashboard.room.default_assignment_quota}</strong>
                          </article>
                        </div>
                        <div className="room-settings-panel__footer">
                          <p className="panel-note room-settings-panel__note">
                            Название, описание, дедлайн, пароль, стандартная квота и параметры перекрестной разметки редактируются на отдельной странице, чтобы основной экран комнаты не перегружался.
                          </p>
                          <div className="role-assignment-box__actions">
                            {dashboard.actor.can_edit_room ? (
                              <a className="btn btn--muted" href={`/rooms/${dashboard.room.id}/edit/`}>
                                Редактировать комнату
                              </a>
                            ) : null}
                            {dashboard.actor.can_delete_room ? (
                              <button className="btn btn--danger" type="button" onClick={handleDeleteRoom} disabled={deleteRoomBusy}>
                                Удалить комнату
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {canManageDataset ? (
                      <div className="panel-card manage-card-legacy manage-card-legacy--dataset">
                        <div className="panel-card__head">
                          <h2>Датасет</h2>
                          <span className="eyebrow room-settings-panel__eyebrow">Фото и ZIP</span>
                        </div>
                        <div className="dataset-manager-upload">
                          <label className="field">
                            <span>Добавить изображения</span>
                            <input
                              ref={datasetFileInputRef}
                              type="file"
                              accept={datasetModeConfig.image.accept}
                              multiple
                              onChange={(event) => setDatasetUploadFiles(Array.from(event.currentTarget.files || []))}
                            />
                          </label>
                          <div className="panel-note">{summarizeSelectedFiles(datasetUploadFiles)}</div>
                          <button
                            className="btn btn--primary"
                            type="button"
                            disabled={datasetUploadBusy || !datasetUploadFiles.length}
                            onClick={handleDatasetUpload}
                          >
                            {datasetUploadBusy ? "Загружаем..." : "Добавить в комнату"}
                          </button>
                        </div>
                        <div className="dataset-manager-toolbar">
                          <label className="field panel-search">
                            <span>Поиск по датасету</span>
                            <input
                              value={datasetTaskSearch}
                              type="text"
                              placeholder="Файл, номер или ID"
                              onChange={(event) => setDatasetTaskSearch(event.currentTarget.value)}
                            />
                          </label>
                          <div className="dataset-manager-toolbar__actions">
                            <button
                              className="btn btn--muted btn--compact"
                              type="button"
                              disabled={!displayedDatasetTasks.length}
                              onClick={handleDatasetSelectDisplayed}
                            >
                              {allDisplayedDatasetTasksSelected ? "Снять выбор" : "Выбрать показанные"}
                            </button>
                            <button
                              className="btn btn--danger btn--compact"
                              type="button"
                              disabled={datasetDeleteBusy || !selectedDatasetTaskCount}
                              onClick={handleDatasetDelete}
                            >
                              {datasetDeleteBusy ? "Удаляем..." : `Удалить (${selectedDatasetTaskCount})`}
                            </button>
                          </div>
                        </div>
                        <div className="summary-stack dataset-manager-summary">
                          <div className="summary-row">
                            <span>Всего объектов</span>
                            <strong>{datasetTasks.length}</strong>
                          </div>
                          <div className="summary-row">
                            <span>По фильтру</span>
                            <strong>{filteredDatasetTasks.length}</strong>
                          </div>
                        </div>
                        {datasetTasksLoading ? (
                          <div className="empty-card">Загружаем состав датасета.</div>
                        ) : !datasetTasks.length ? (
                          <div className="empty-card">В датасете пока нет изображений.</div>
                        ) : !filteredDatasetTasks.length ? (
                          <div className="empty-card">По этому запросу изображения не найдены.</div>
                        ) : (
                          <>
                            <div className="dataset-task-list" aria-label="Изображения датасета">
                              {displayedDatasetTasks.map((task) => (
                                <label key={task.id} className="dataset-task-row">
                                  <input
                                    type="checkbox"
                                    checked={selectedDatasetTaskIds.includes(task.id)}
                                    onChange={() => handleDatasetTaskToggle(task.id)}
                                  />
                                  {task.source_file_url ? (
                                    <img
                                      className="dataset-task-row__thumb"
                                      src={task.source_file_url}
                                      alt={task.source_name || `Задача ${task.id}`}
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="dataset-task-row__thumb dataset-task-row__thumb--empty" aria-hidden="true"></span>
                                  )}
                                  <span className="dataset-task-row__meta">
                                    <strong>{task.source_name || `Задача #${task.id}`}</strong>
                                    <span>
                                      #{task.id} · № {getTaskItemNumber(task) || "?"} · {translateTaskStatus(task.status)} ·{" "}
                                      {task.submitted_annotations_count} разметок
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                            {filteredDatasetTasks.length > displayedDatasetTasks.length ? (
                              <div className="panel-note">
                                Показаны первые {displayedDatasetTasks.length} из {filteredDatasetTasks.length}. Уточни поиск, чтобы быстрее найти нужные изображения.
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}

                    {canManageVideoDataset ? (
                      <div className="panel-card manage-card-legacy manage-card-legacy--dataset">
                        <div className="panel-card__head">
                          <h2>Видео датасет</h2>
                          <span className="eyebrow room-settings-panel__eyebrow">2 этапа</span>
                        </div>
                        <label className="field panel-search">
                          <span>Поиск по видео</span>
                          <input
                            value={datasetTaskSearch}
                            type="text"
                            placeholder="Файл или ID"
                            onChange={(event) => setDatasetTaskSearch(event.currentTarget.value)}
                          />
                        </label>
                        <div className="summary-stack dataset-manager-summary">
                          <div className="summary-row">
                            <span>Видео</span>
                            <strong>{datasetTasks.length}</strong>
                          </div>
                          <div className="summary-row">
                            <span>По фильтру</span>
                            <strong>{filteredDatasetTasks.length}</strong>
                          </div>
                        </div>
                        {datasetTasksLoading ? (
                          <div className="empty-card">Загружаем видео датасета.</div>
                        ) : !datasetTasks.length ? (
                          <div className="empty-card">В датасете пока нет видео.</div>
                        ) : !filteredDatasetTasks.length ? (
                          <div className="empty-card">По этому запросу видео не найдены.</div>
                        ) : (
                          <div className="dataset-task-list" aria-label="Видео датасета">
                            {displayedDatasetTasks.map((task) => (
                              <div key={task.id} className="dataset-task-row dataset-task-row--video">
                                <span className="dataset-task-row__thumb dataset-task-row__thumb--empty" aria-hidden="true"></span>
                                <span className="dataset-task-row__meta">
                                  <strong>{task.source_name || `Видео #${task.id}`}</strong>
                                  <span>
                                    #{task.id} · {Number(task.input_payload?.frame_count || 0)} кадров · {translateTaskStatus(task.status)}
                                  </span>
                                </span>
                                <a className="btn btn--primary btn--compact" href={`/videos/${task.id}/pre-annotate/`}>
                                  Выбрать кадры
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {dashboard.actor.can_export ? (
                      <div className="panel-card manage-card-legacy manage-card-legacy--export">
                        <div className="panel-card__head">
                          <h2>Экспорт и лейблы</h2>
                        </div>
                        <div className="label-chip-list label-chip-list--static">
                          {dashboard.labels.length ? (
                            dashboard.labels.map((label) => (
                              <span key={label.id} className="label-chip label-chip--static" style={{ ["--label-color" as any]: label.color }}>
                                <i></i>
                                <span>{label.name}</span>
                              </span>
                            ))
                          ) : (
                            <div className="empty-card">Лейблы для этой комнаты пока не заданы.</div>
                          )}
                        </div>
                        <label className="field field--export-compact">
                          <span>Формат выгрузки</span>
                          <select value={selectedExportFormat} onChange={(event) => setSelectedExportFormat(event.target.value)}>
                            {dashboard.export_formats.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="btn btn--secondary" type="button" onClick={handleExport}>
                          Выгрузить датасет
                        </button>
                      </div>
                    ) : null}

                    {dashboard.actor.can_invite ? (
                      <div className="panel-card manage-card-legacy manage-card-legacy--invite">
                        <div className="panel-card__head">
                          <h2>Invite-ссылка</h2>
                        </div>
                        <div className="stack-form stack-form--compact">
                          <label className="field">
                            <span>Ссылка для входа</span>
                            <input value={dashboard.invite.url} type="text" readOnly />
                          </label>
                          <button className="btn btn--primary" type="button" onClick={handleCopyInviteLink}>
                            Скопировать ссылку
                          </button>
                          <button className="btn btn--secondary" type="button" disabled={inviteBusy} onClick={handleRegenerateInvite}>
                            {inviteBusy ? "Обновляем..." : "Перегенерировать invite"}
                          </button>
                        </div>
                        <div className="panel-note">
                          По этой ссылке пользователь сможет авторизоваться и отправить заявку на вступление в комнату. Старый invite перестает работать после регенерации.
                        </div>
                      </div>
                    ) : null}

                    {dashboard.actor.can_invite ? (
                      <div className="panel-card manage-card-legacy manage-card-legacy--requests">
                        <div className="panel-card__head">
                          <h2>Заявки на вступление</h2>
                        </div>
                        {dashboard.join_requests?.length ? (
                          <div className="annotators-list manage-request-list-legacy">
                            {dashboard.join_requests.map((joinRequest) => (
                              <div key={joinRequest.id} className="annotator-row manage-request-row-legacy">
                                <div className="annotator-row__meta">
                                  <strong>{joinRequest.display_name}</strong>
                                  <span>
                                    {joinRequest.email} · {translateMembership(joinRequest.status)}
                                  </span>
                                </div>
                                <div className="role-assignment-box__actions">
                                  {joinRequest.status === "pending" ? (
                                    <>
                                      <button
                                        className="btn btn--secondary btn--compact"
                                        type="button"
                                        disabled={joinRequestBusyId === joinRequest.id}
                                        onClick={() => handleJoinRequestAction(joinRequest.id, "approve")}
                                      >
                                        Принять
                                      </button>
                                      <button
                                        className="btn btn--muted btn--compact"
                                        type="button"
                                        disabled={joinRequestBusyId === joinRequest.id}
                                        onClick={() => handleJoinRequestAction(joinRequest.id, "reject")}
                                      >
                                        Отклонить
                                      </button>
                                    </>
                                  ) : (
                                    <span className="panel-note">
                                      {joinRequest.status === "approved"
                                        ? `Принял: ${joinRequest.reviewed_by_display_name || "модератор"}`
                                        : `Отклонил: ${joinRequest.reviewed_by_display_name || "модератор"}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-card">По invite-ссылке пока никто не запросил доступ.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}

      {dashboard?.actor.can_review ? (
        <details
          className="panel-card section-disclosure"
          open={reviewSectionOpen}
          onToggle={(event) => setReviewSectionOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="section-disclosure__summary">
            <div className="section-disclosure__copy">
              <span className="eyebrow section-disclosure__eyebrow">Контроль качества</span>
              <strong>Проверка разметки</strong>
              <p className="section-disclosure__note">{getReviewSectionSummary(dashboard)}</p>
            </div>
            <span className="section-disclosure__icon" aria-hidden="true"></span>
          </summary>
          <div className="section-disclosure__content">
            <section className="room-review-grid">
              <div className="panel-card room-review-grid__card room-review-grid__card--scroll">
                <div className="panel-card__head">
                  <h2>Участники комнаты</h2>
                </div>
                <label className="field panel-search">
                  <span>Поиск</span>
                  <input value={annotatorSearch} type="text" placeholder="Имя, ID или статус" onChange={(event) => setAnnotatorSearch(event.currentTarget.value)} />
                </label>
                {(dashboard.annotators || []).length ? (
                  filteredAnnotators.length ? (
                    <div className="annotators-list annotators-list--scroll">
                      {filteredAnnotators.map((annotator) => (
                        <button
                          key={annotator.user_id}
                          className={`annotator-row ${annotator.user_id === selectedAnnotatorUserId ? "is-active" : ""}`}
                          type="button"
                          onClick={() =>
                            setSelectedAnnotatorUserId((current) => (current === annotator.user_id ? null : annotator.user_id))
                          }
                        >
                          <div className="annotator-row__meta">
                            <strong>{annotator.display_name}</strong>
                            <span>
                              {translateMembership(annotator.status)} · {translateRole(annotator.role)}
                            </span>
                          </div>
                          <div className="annotator-row__brief">
                            <div>{formatPercent(annotator.progress_percent)}</div>
                            <div>
                              отправлено: {annotator.completed_tasks}
                            </div>
                            <div>
                              {annotator.task_quota == null ? "квота не задана" : `квота: ${annotator.quota_used}/${annotator.task_quota}`}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-card">По этому запросу исполнители не найдены.</div>
                  )
                ) : (
                  <div className="empty-card">В этой комнате пока нет исполнителей.</div>
                )}
              </div>

              <div className="panel-card room-review-grid__card">
                <div className="panel-card__head">
                  <h2>Полная статистика участника</h2>
                </div>
                {activeAnnotator ? (
                  <>
                    <div className="summary-stack">
                      <div className="summary-row">
                        <span>Исполнитель</span>
                        <strong>
                          #{activeAnnotator.user_id} {activeAnnotator.display_name}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Статус</span>
                        <strong>{translateMembership(activeAnnotator.status)}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Роль</span>
                        <strong>{translateRole(activeAnnotator.role)}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Выполнено</span>
                        <strong>{activeAnnotator.completed_tasks}</strong>
                      </div>
                      <div className="summary-row">
                        <span>В работе</span>
                        <strong>{activeAnnotator.in_progress_tasks}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Осталось</span>
                        <strong>{activeAnnotator.remaining_tasks == null ? "Не задано" : activeAnnotator.remaining_tasks}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Квота</span>
                        <strong>
                          {activeAnnotator.task_quota == null
                            ? "Не задана"
                            : `${activeAnnotator.quota_used} из ${activeAnnotator.task_quota}${
                                activeAnnotator.quota_source === "default" ? " · стандартная" : ""
                              }`}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Прогресс</span>
                        <strong>{formatPercent(activeAnnotator.progress_percent)}</strong>
                      </div>
                    </div>
                    <div className="role-assignment-box">
                      {dashboard.actor.can_assign_roles ? (
                        <label className="field field--compact">
                          <span>Роль участника</span>
                          <select value={selectedRole} onChange={(event) => setSelectedRole(event.currentTarget.value)}>
                            {dashboard.membership_role_options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {dashboard.actor.can_assign_quotas && activeAnnotatorCanReceiveQuota ? (
                        <label className="field field--compact">
                          <span>Квота задач</span>
                          <input
                            value={selectedQuota}
                            type="number"
                            min="0"
                            step="1"
                            placeholder={
                              dashboard.room.default_assignment_quota == null
                                ? "Без стандартной квоты"
                                : `Стандартная: ${dashboard.room.default_assignment_quota}`
                            }
                            onChange={(event) => setSelectedQuota(event.currentTarget.value)}
                          />
                        </label>
                      ) : null}
                      <div className="role-assignment-box__actions">
                        <a className="btn btn--muted btn--compact" href={`/users/${activeAnnotator.user_id}/profile/`}>
                          Открыть профиль
                        </a>
                        {dashboard.actor.can_assign_roles ? (
                          <button className="btn btn--secondary btn--compact" type="button" onClick={handleRoleSubmit}>
                            Сохранить роль
                          </button>
                        ) : null}
                        {dashboard.actor.can_assign_quotas && activeAnnotatorCanReceiveQuota ? (
                          <button className="btn btn--secondary btn--compact" type="button" disabled={quotaBusy} onClick={handleQuotaSubmit}>
                            {quotaBusy ? "Сохраняем..." : "Сохранить квоту"}
                          </button>
                        ) : null}
                        {dashboard.actor.can_assign_roles ? (
                          <button className="btn btn--danger btn--compact" type="button" onClick={handleRemoveAnnotator}>
                            Удалить участника
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="activity-board">
                      <ActivityBoard series={activeAnnotator.activity} />
                    </div>
                  </>
                ) : (
                  <div className="empty-card">Выбери исполнителя в списке слева.</div>
                )}
              </div>

              <div className="panel-card room-review-grid__card room-review-grid__card--scroll">
                <div className="panel-card__head">
                  <h2>Размеченные объекты</h2>
                </div>
                <label className="field panel-search">
                  <span>Поиск</span>
                  <input value={reviewSearch} type="text" placeholder="Задача, файл или тип" onChange={(event) => setReviewSearch(event.currentTarget.value)} />
                </label>
                {reviewTasksLoading ? (
                  <div className="empty-card">Загружаем объекты для проверки.</div>
                ) : !reviewTasks.length ? (
                  <div className="empty-card">Размеченных объектов для проверки пока нет.</div>
                ) : !filteredReviewTasks.length ? (
                  <div className="empty-card">По этому запросу объекты не найдены.</div>
                ) : (
                  <div className="annotators-list annotators-list--scroll">
                    {filteredReviewTasks.map((task) => (
                      <button
                        key={task.id}
                        className={`annotator-row review-task-row ${task.id === selectedReviewTaskId ? "is-active" : ""}`}
                        type="button"
                        onClick={() => setSelectedReviewTaskId(task.id)}
                      >
                        <div className="annotator-row__meta">
                          <strong>Задача #{task.id}</strong>
                          <span>{task.source_name || translateSourceType(task.source_type)}</span>
                        </div>
                        <div className="annotator-row__brief">
                          <div>{translateReviewOutcome(task.review_outcome)}</div>
                          <div>
                            {task.review_outcome === "validation"
                              ? `${task.validation_votes_count}/${task.validation_votes_required} голосов`
                              : `${task.annotations_count} аннотац.`}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel-card room-review-grid__card">
                <div className="panel-card__head">
                  <h2>Проверка разметки</h2>
                </div>
                {reviewDetail ? (
                  <div className="summary-stack review-task-detail">
                    <div className="summary-row">
                      <span>Задача</span>
                      <strong>#{reviewDetail.task.id}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Статус</span>
                      <strong>{translateReviewOutcome(reviewDetail.review_outcome)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Тип</span>
                      <strong>{translateSourceType(reviewDetail.task.source_type)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Раунд</span>
                      <strong>{reviewDetail.task.current_round}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Сходство</span>
                      <strong>{reviewDetail.task.validation_score == null ? "Не рассчитано" : `${reviewDetail.task.validation_score}%`}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Голоса</span>
                      <strong>
                        {reviewDetail.validation_votes_count}/{reviewDetail.validation_votes_required}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>За / против</span>
                      <strong>
                        {reviewDetail.validation_approve_votes_count}/{reviewDetail.validation_reject_votes_count}
                      </strong>
                    </div>
                    {reviewDetail.task.source_file_url ? (
                      reviewDetail.task.source_type === "image" ? (
                        <img className="review-task-preview" src={reviewDetail.task.source_file_url} alt={reviewDetail.task.source_name || `task-${reviewDetail.task.id}`} />
                      ) : (
                        <video className="review-task-preview" src={reviewDetail.task.source_file_url} controls preload="metadata"></video>
                      )
                    ) : null}
                  </div>
                ) : (
                  <div className="empty-card">Выбери размеченный объект в списке слева.</div>
                )}
              </div>
            </section>

            <section className="panel-card review-comparison-section">
              <div className="panel-card__head">
                <h2>Ревью в редакторе</h2>
              </div>
              <div className="panel-note">
                Детальное сравнение итоговой разметки и пользовательских версий теперь открывается внутри fullscreen editor-а.
                На странице комнаты оставлен только обзор и быстрый переход в review-режим.
              </div>
              <div className="action-strip">
                <a className="btn btn--primary" href={`/rooms/${dashboard.room.id}/work/?mode=review`}>
                  Открыть проверку в редакторе
                </a>
              </div>
            </section>
          </div>
        </details>
      ) : null}

      {deleteRoomConfirmOpen ? (
        <div className="modal-shell" role="presentation" onClick={handleCancelDeleteRoom}>
          <div
            className="modal-card modal-card--danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-room-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-card__head">
              <span className="eyebrow">Опасное действие</span>
              <h2 id="delete-room-modal-title">Удалить комнату?</h2>
              <p>
                Комната, задачи, участники и результаты разметки будут удалены без возможности восстановления. Для подтверждения
                введи текущий пароль владельца.
              </p>
            </div>
            <label className="field field--full">
              <span>Пароль владельца</span>
              <input
                value={deleteRoomPassword}
                type="password"
                placeholder="Введи текущий пароль аккаунта"
                autoFocus
                onChange={(event) => setDeleteRoomPassword(event.currentTarget.value)}
              />
            </label>
            <div className="modal-card__actions">
              <button className="btn btn--muted" type="button" onClick={handleCancelDeleteRoom} disabled={deleteRoomBusy}>
                Отмена
              </button>
              <button className="btn btn--danger" type="button" onClick={handleDeleteRoom} disabled={deleteRoomBusy}>
                {deleteRoomBusy ? "Удаляем..." : "Подтвердить удаление"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function VideoPreAnnotationPage() {
  const { bootstrap, api, addToast, clearToasts } = useApp();
  const videoId = bootstrap.video_id;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [selections, setSelections] = useState<VideoSelectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);

  const fps = Number(video?.fps || 25);
  const frameCount = Number(video?.frame_count || 0);
  const currentFrame = clampNumber(Math.floor(currentTime * fps), 0, Math.max(frameCount - 1, 0));
  const timelineProgress = frameCount > 1 ? (currentFrame / (frameCount - 1)) * 100 : 0;

  async function refresh() {
    if (!videoId) {
      addToast("Не удалось определить видео из URL.", "error");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextVideo, nextSelections] = await Promise.all([
        api<VideoItem>(`/api/v1/videos/${videoId}/`),
        api<VideoSelectionItem[]>(`/api/v1/videos/${videoId}/selections/`),
      ]);
      setVideo(nextVideo);
      setSelections(nextSelections || []);
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        handlePlayPause();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekToFrame(currentFrame - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekToFrame(currentFrame + 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentFrame, fps, frameCount, playing]);

  function seekToFrame(frameIndex: number) {
    const videoElement = videoRef.current;
    if (!videoElement || !video) {
      return;
    }
    const clampedFrame = clampNumber(frameIndex, 0, Math.max(video.frame_count - 1, 0));
    videoElement.currentTime = clampedFrame / fps;
    setCurrentTime(videoElement.currentTime);
  }

  function handlePlayPause() {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }
    if (videoElement.paused) {
      videoElement.play();
    } else {
      videoElement.pause();
    }
  }

  function handleVideoMetadata(event: React.SyntheticEvent<HTMLVideoElement>) {
    event.currentTarget.currentTime = 0;
    setCurrentTime(0);
    setPlaying(false);
  }

  async function createSelection(startFrame: number, endFrame: number) {
    if (!videoId) {
      return;
    }
    clearToasts();
    setBusy(true);
    try {
      const selection = await api<VideoSelectionItem>(`/api/v1/videos/${videoId}/selections/`, {
        method: "POST",
        body: { start_frame: startFrame, end_frame: endFrame },
      });
      setSelections((current) => [...current, selection].sort((a, b) => a.start_frame - b.start_frame || a.id - b.id));
      addToast(startFrame === endFrame ? `Кадр ${startFrame} добавлен.` : `Интервал ${startFrame}-${endFrame} добавлен.`, "success");
      if (startFrame !== endFrame) {
        setRangeStart(null);
        setRangeEnd(null);
      }
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function updateSelection(selection: VideoSelectionItem) {
    clearToasts();
    setBusy(true);
    try {
      const updated = await api<VideoSelectionItem>(`/api/v1/video-selections/${selection.id}/`, {
        method: "PATCH",
        body: { start_frame: selection.start_frame, end_frame: selection.end_frame },
      });
      setSelections((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      addToast("Интервал обновлен.", "success");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelection(selectionId: number) {
    clearToasts();
    setBusy(true);
    try {
      await api(`/api/v1/video-selections/${selectionId}/`, { method: "DELETE" });
      setSelections((current) => current.filter((item) => item.id !== selectionId));
      addToast("Выбор удален.", "success");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function generateFrameTasksForSelection(selection: VideoSelectionItem) {
    clearToasts();
    setBusy(true);
    try {
      const result = await api<{ created_count: number; skipped_duplicates_count: number }>(
        `/api/v1/video-selections/${selection.id}/generate-frame-tasks/`,
        {
          method: "POST",
          body: {},
        }
      );
      addToast(
        `${formatSelectionTitle(selection)}: создано задач ${result.created_count}, уже существовало ${result.skipped_duplicates_count}.`,
        "success"
      );
      await refresh();
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function startSelectionAnnotation(selection: VideoSelectionItem) {
    if (!videoId) {
      return;
    }
    clearToasts();
    setBusy(true);
    try {
      const updated = await api<VideoSelectionItem>(`/api/v1/video-selections/${selection.id}/`, {
        method: "PATCH",
        body: { start_frame: selection.start_frame, end_frame: selection.end_frame },
      });
      await api(`/api/v1/video-selections/${updated.id}/generate-frame-tasks/`, {
        method: "POST",
        body: {},
      });
      window.location.href = `/videos/${videoId}/frames/?selection=${updated.id}`;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setBusy(false);
    }
  }

  const persistedSelectedFramesCount = selections.reduce((sum, item) => sum + Math.abs(item.end_frame - item.start_frame) + 1, 0);
  const draftRangeFramesCount =
    rangeStart == null || rangeEnd == null ? 0 : Math.abs(Number(rangeEnd) - Number(rangeStart)) + 1;
  const generatedSelectionsCount = selections.filter((item) => item.status === "generated").length;

  function getSelectionFrameCount(selection: VideoSelectionItem) {
    return Math.abs(selection.end_frame - selection.start_frame) + 1;
  }

  function formatSelectionTitle(selection: VideoSelectionItem) {
    const startFrame = Math.min(selection.start_frame, selection.end_frame);
    const endFrame = Math.max(selection.start_frame, selection.end_frame);
    return startFrame === endFrame ? `Кадр ${startFrame}` : `Интервал ${startFrame}-${endFrame}`;
  }

  return (
    <section className="video-workspace">
      <header className="video-workspace__header">
        <div>
          <span className="eyebrow">Предварительная разметка видео</span>
          <h1>{video?.source_name || "Предварительная разметка видео"}</h1>
        </div>
        <div className="video-workspace__actions">
          {video?.room_id ? (
            <a className="btn btn--muted btn--compact" href={`/rooms/${video.room_id}/`}>
              К комнате
            </a>
          ) : null}
          {videoId ? (
            <a className="btn btn--primary btn--compact" href={`/videos/${videoId}/frames/`}>
              Покадровая разметка
            </a>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="empty-card">Загружаем видео.</div>
      ) : video ? (
        <div className="video-preannotator">
          <div className="video-preannotator__stage">
            {video.source_file_url ? (
              <video
                ref={videoRef}
                className="video-preannotator__player"
                src={video.source_file_url}
                preload="metadata"
                onLoadedMetadata={handleVideoMetadata}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
              ></video>
            ) : (
              <div className="empty-card">У видео нет исходного файла.</div>
            )}
            <div className="video-preannotator__timeline">
              <input
                type="range"
                min="0"
                max={Math.max(frameCount - 1, 0)}
                value={currentFrame}
                style={{ ["--timeline-progress" as any]: `${timelineProgress}%` }}
                onChange={(event) => seekToFrame(Number(event.currentTarget.value))}
              />
              <div className="video-preannotator__meta">
                <span>Кадр {currentFrame}</span>
                <span>{formatVideoTime(currentTime)}</span>
                <span>{video.width}×{video.height}</span>
                <span>{frameCount} кадров</span>
              </div>
            </div>
            <div className="video-preannotator__controls">
              <button className="btn btn--secondary btn--compact" type="button" onClick={handlePlayPause}>
                {playing ? "Пауза" : "Воспроизвести"}
              </button>
              <button className="btn btn--muted btn--compact" type="button" onClick={() => seekToFrame(currentFrame - 1)}>
                Предыдущий кадр
              </button>
              <button className="btn btn--muted btn--compact" type="button" onClick={() => seekToFrame(currentFrame + 1)}>
                Следующий кадр
              </button>
              <button className="btn btn--primary btn--compact" type="button" disabled={busy} onClick={() => createSelection(currentFrame, currentFrame)}>
                Отметить кадр
              </button>
              <button className="btn btn--muted btn--compact" type="button" onClick={() => setRangeStart(currentFrame)}>
                Начало интервала
              </button>
              <button className="btn btn--muted btn--compact" type="button" onClick={() => setRangeEnd(currentFrame)}>
                Конец интервала
              </button>
              <button
                className="btn btn--primary btn--compact"
                type="button"
                disabled={busy || rangeStart == null || rangeEnd == null}
                onClick={() => {
                  if (rangeStart != null && rangeEnd != null) {
                    createSelection(rangeStart, rangeEnd);
                  }
                }}
              >
                Добавить интервал
              </button>
            </div>
          </div>

          <aside className="video-preannotator__side">
            <div className="panel-card video-selection-summary">
              <div className="video-selection-summary__head">
                <span className="eyebrow">Интервалы</span>
                <strong>{selections.length}</strong>
              </div>
              <div className="summary-row">
                <span>Начало интервала</span>
                <strong>{rangeStart ?? "-"}</strong>
              </div>
              <div className="summary-row">
                <span>Конец интервала</span>
                <strong>{rangeEnd ?? "-"}</strong>
              </div>
              <div className="summary-row">
                <span>Кадров в интервале</span>
                <strong>{draftRangeFramesCount || "-"}</strong>
              </div>
              <div className="summary-row">
                <span>Добавлено кадров</span>
                <strong>{persistedSelectedFramesCount}</strong>
              </div>
              <div className="summary-row">
                <span>Готовых интервалов</span>
                <strong>{generatedSelectionsCount}</strong>
              </div>
            </div>

            <div className="video-selection-list">
              {selections.length ? (
                selections.map((selection) => {
                  const isGenerated = selection.status === "generated";
                  return (
                    <div key={selection.id} className={`video-selection-row ${isGenerated ? "is-generated" : ""}`}>
                      <div className="video-selection-row__head">
                        <div className="video-selection-row__title">
                          <strong>{formatSelectionTitle(selection)}</strong>
                          <span>{getSelectionFrameCount(selection)} кадров</span>
                        </div>
                        <span className="video-selection-row__status">{isGenerated ? "задачи созданы" : "ожидает"}</span>
                      </div>
                      <div className="video-selection-row__inputs">
                        <label>
                          <span>Начало</span>
                          <input
                            type="number"
                            min="0"
                            value={selection.start_frame}
                            onChange={(event) =>
                              setSelections((current) =>
                                current.map((item) =>
                                  item.id === selection.id ? { ...item, start_frame: Number(event.currentTarget.value) } : item
                                )
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>Конец</span>
                          <input
                            type="number"
                            min="0"
                            value={selection.end_frame}
                            onChange={(event) =>
                              setSelections((current) =>
                                current.map((item) =>
                                  item.id === selection.id ? { ...item, end_frame: Number(event.currentTarget.value) } : item
                                )
                              )
                            }
                          />
                        </label>
                      </div>
                      <div className="video-selection-row__actions">
                        <button className="btn btn--muted btn--compact" type="button" disabled={busy} onClick={() => updateSelection(selection)}>
                          Сохранить интервал
                        </button>
                        <button
                          className="btn btn--muted btn--compact"
                          type="button"
                          disabled={busy}
                          onClick={() => generateFrameTasksForSelection(selection)}
                        >
                          {isGenerated ? "Обновить задачи" : "Создать задачи"}
                        </button>
                        <button
                          className="btn btn--primary btn--compact"
                          type="button"
                          disabled={busy}
                          onClick={() => startSelectionAnnotation(selection)}
                        >
                          Начать разметку
                        </button>
                        <button className="btn btn--danger btn--compact" type="button" disabled={busy} onClick={() => deleteSelection(selection.id)}>
                          Удалить
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-card">Выбери кадр или интервал, чтобы сформировать очередь второго этапа.</div>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="empty-card">Видео не найдено.</div>
      )}
    </section>
  );
}

function normalizeFrameObjects(objects: FrameAnnotationObject[] | undefined) {
  return (objects || []).map((item, index) => ({
    id: item.id || `box-${Date.now()}-${index}`,
    label: item.label || "object",
    bbox: {
      x: Number(item.bbox?.x || 0),
      y: Number(item.bbox?.y || 0),
      width: Number(item.bbox?.width || 0),
      height: Number(item.bbox?.height || 0),
    },
  }));
}

function serializeFrameObjects(objects: FrameAnnotationObject[]) {
  return objects.map((item) => ({
    label: item.label || "object",
    bbox: {
      x: Number(item.bbox.x.toFixed(6)),
      y: Number(item.bbox.y.toFixed(6)),
      width: Number(item.bbox.width.toFixed(6)),
      height: Number(item.bbox.height.toFixed(6)),
    },
  }));
}

function buildFrameAnnotationSnapshot(status: FrameAnnotationPayload["status"], objects: FrameAnnotationObject[]) {
  const normalizedStatus = status === "empty" ? "empty" : "annotated";
  return JSON.stringify({
    status: normalizedStatus,
    objects: normalizedStatus === "empty" ? [] : serializeFrameObjects(objects),
  });
}

function readPositiveIntegerSearchParam(name: string) {
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function replaceFrameAnnotationSelectionQuery(selectionId: number | null) {
  const url = new URL(window.location.href);
  if (selectionId) {
    url.searchParams.set("selection", String(selectionId));
  } else {
    url.searchParams.delete("selection");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function FrameAnnotationPage() {
  const { bootstrap, authUser, api, addToast, clearToasts } = useApp();
  const videoId = bootstrap.video_id;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const initialSelectionIdRef = useRef<number | null>(readPositiveIntegerSearchParam("selection"));
  const loadedFrameSnapshotRef = useRef<string>(buildFrameAnnotationSnapshot("annotated", []));
  const interactionRef = useRef<{
    type: "draw" | "move" | "resize";
    id?: string;
    startX: number;
    startY: number;
    original?: FrameAnnotationObject["bbox"];
    corner?: string;
  } | null>(null);
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [frameSelections, setFrameSelections] = useState<VideoSelectionItem[]>([]);
  const [frameTasks, setFrameTasks] = useState<FrameAnnotationTaskItem[]>([]);
  const [selectedSelectionId, setSelectedSelectionId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [activeTask, setActiveTask] = useState<FrameAnnotationTaskItem | null>(null);
  const [objects, setObjects] = useState<FrameAnnotationObject[]>([]);
  const [draftBox, setDraftBox] = useState<FrameAnnotationObject["bbox"] | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [frameStatus, setFrameStatus] = useState<FrameAnnotationPayload["status"]>("annotated");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function formatFrameSelectionTitle(selection: VideoSelectionItem) {
    const startFrame = Math.min(selection.start_frame, selection.end_frame);
    const endFrame = Math.max(selection.start_frame, selection.end_frame);
    return startFrame === endFrame ? `Кадр ${startFrame}` : `Интервал ${startFrame}-${endFrame}`;
  }

  function frameTaskBelongsToSelection(task: FrameAnnotationTaskItem, selection: VideoSelectionItem) {
    const startFrame = Math.min(selection.start_frame, selection.end_frame);
    const endFrame = Math.max(selection.start_frame, selection.end_frame);
    return task.source_segment_id === selection.id || (task.frame_index >= startFrame && task.frame_index <= endFrame);
  }

  function getFrameTasksForSelection(
    selectionId: number | null,
    tasks: FrameAnnotationTaskItem[] = frameTasks,
    selections: VideoSelectionItem[] = frameSelections
  ) {
    if (selectionId == null) {
      return tasks;
    }
    const selection = selections.find((item) => item.id === selectionId);
    if (!selection) {
      return tasks;
    }
    return tasks.filter((task) => frameTaskBelongsToSelection(task, selection));
  }

  function findSelectionForFrameTask(
    taskId: number | null,
    tasks: FrameAnnotationTaskItem[] = frameTasks,
    selections: VideoSelectionItem[] = frameSelections
  ) {
    if (taskId == null) {
      return null;
    }
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return null;
    }
    return selections.find((selection) => frameTaskBelongsToSelection(task, selection)) || null;
  }

  function pickFrameTaskForSelection(
    selectionId: number | null,
    tasks: FrameAnnotationTaskItem[] = frameTasks,
    selections: VideoSelectionItem[] = frameSelections
  ) {
    const scopedTasks = getFrameTasksForSelection(selectionId, tasks, selections);
    return scopedTasks.find((task) => task.status !== "done") || scopedTasks[0] || null;
  }

  async function refreshQueue(preferredTaskId?: number | null, preferredSelectionId?: number | null) {
    if (!videoId) {
      addToast("Не удалось определить видео из URL.", "error");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextVideo, nextTasks, nextSelections] = await Promise.all([
        api<VideoItem>(`/api/v1/videos/${videoId}/`),
        api<FrameAnnotationTaskItem[]>(`/api/v1/frame-tasks/?video_id=${videoId}`),
        api<VideoSelectionItem[]>(`/api/v1/videos/${videoId}/selections/`),
      ]);
      const safeTasks = nextTasks || [];
      const safeSelections = nextSelections || [];
      setVideo(nextVideo);
      setFrameTasks(safeTasks);
      setFrameSelections(safeSelections);
      const requestedSelectionId = preferredSelectionId !== undefined ? preferredSelectionId : initialSelectionIdRef.current;
      initialSelectionIdRef.current = null;
      const selectionFromPreferredTask = findSelectionForFrameTask(preferredTaskId || null, safeTasks, safeSelections);
      const firstSelectionWithTasks =
        safeSelections.find((selection) => getFrameTasksForSelection(selection.id, safeTasks, safeSelections).length)?.id || null;
      const nextSelectionId =
        requestedSelectionId && safeSelections.some((selection) => selection.id === requestedSelectionId)
          ? requestedSelectionId
          : selectionFromPreferredTask?.id || firstSelectionWithTasks;
      const scopedTasks = getFrameTasksForSelection(nextSelectionId, safeTasks, safeSelections);
      const nextSelectedId =
        preferredTaskId && scopedTasks.some((task) => task.id === preferredTaskId)
          ? preferredTaskId
          : (pickFrameTaskForSelection(nextSelectionId, safeTasks, safeSelections) || safeTasks.find((task) => task.status !== "done") || safeTasks[0])?.id ||
            null;
      setSelectedSelectionId(nextSelectionId);
      setSelectedTaskId(nextSelectedId);
      if (nextSelectedId) {
        await loadFrameTask(nextSelectedId, safeTasks);
      }
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadFrameTask(taskId: number, knownTasks = frameTasks) {
    const task = knownTasks.find((item) => item.id === taskId);
    if (!task || !videoId) {
      return;
    }
    try {
      const detail = await api<FrameAnnotationTaskItem>(`/api/v1/videos/${videoId}/frames/${task.frame_index}/`);
      const nextObjects = normalizeFrameObjects(detail.annotation?.objects);
      const nextStatus = detail.annotation?.status === "empty" ? "empty" : "annotated";
      setActiveTask(detail);
      setFrameTasks((current) => current.map((item) => (item.id === detail.id ? detail : item)));
      setObjects(nextObjects);
      setFrameStatus(nextStatus);
      setSelectedBoxId(null);
      setDraftBox(null);
      loadedFrameSnapshotRef.current = buildFrameAnnotationSnapshot(nextStatus, nextObjects);
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  useEffect(() => {
    refreshQueue();
  }, []);

  useEffect(() => {
    if (selectedTaskId) {
      loadFrameTask(selectedTaskId);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToAdjacentTask(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToAdjacentTask(1);
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveAnnotation();
      } else if (event.key === "Delete") {
        event.preventDefault();
        deleteSelectedBox();
      } else if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        setFrameStatus("empty");
        setObjects([]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTaskId, selectedSelectionId, frameTasks, frameSelections, activeTask, objects, frameStatus]);

  function getSvgPoint(event: React.PointerEvent<SVGElement>) {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: clampNumber((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
      y: clampNumber((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
    };
  }

  function normalizeBbox(x1: number, y1: number, x2: number, y2: number) {
    const x = clampNumber(Math.min(x1, x2), 0, 1);
    const y = clampNumber(Math.min(y1, y2), 0, 1);
    const width = clampNumber(Math.abs(x2 - x1), 0, 1 - x);
    const height = clampNumber(Math.abs(y2 - y1), 0, 1 - y);
    return { x, y, width, height };
  }

  function moveBbox(box: FrameAnnotationObject["bbox"], dx: number, dy: number) {
    return {
      ...box,
      x: clampNumber(box.x + dx, 0, 1 - box.width),
      y: clampNumber(box.y + dy, 0, 1 - box.height),
    };
  }

  function resizeBbox(box: FrameAnnotationObject["bbox"], dx: number, dy: number, corner: string) {
    let x1 = box.x;
    let y1 = box.y;
    let x2 = box.x + box.width;
    let y2 = box.y + box.height;
    if (corner.includes("left")) {
      x1 += dx;
    } else {
      x2 += dx;
    }
    if (corner.includes("top")) {
      y1 += dy;
    } else {
      y2 += dy;
    }
    return normalizeBbox(x1, y1, x2, y2);
  }

  function handleSvgPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget || frameStatus === "empty") {
      return;
    }
    const point = getSvgPoint(event);
    interactionRef.current = { type: "draw", startX: point.x, startY: point.y };
    setDraftBox({ x: point.x, y: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleBoxPointerDown(event: React.PointerEvent<SVGGraphicsElement>, boxId: string, corner?: string) {
    event.stopPropagation();
    const point = getSvgPoint(event);
    const box = objects.find((item) => item.id === boxId);
    if (!box) {
      return;
    }
    setSelectedBoxId(boxId);
    interactionRef.current = {
      type: corner ? "resize" : "move",
      id: boxId,
      startX: point.x,
      startY: point.y,
      original: { ...box.bbox },
      corner,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function handleSvgPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (!interaction) {
      return;
    }
    const point = getSvgPoint(event);
    if (interaction.type === "draw") {
      setDraftBox(normalizeBbox(interaction.startX, interaction.startY, point.x, point.y));
      return;
    }
    const dx = point.x - interaction.startX;
    const dy = point.y - interaction.startY;
    setObjects((current) =>
      current.map((item) => {
        if (item.id !== interaction.id || !interaction.original) {
          return item;
        }
        return {
          ...item,
          bbox:
            interaction.type === "move"
              ? moveBbox(interaction.original, dx, dy)
              : resizeBbox(interaction.original, dx, dy, interaction.corner || "bottom-right"),
        };
      })
    );
  }

  function handleSvgPointerUp() {
    const interaction = interactionRef.current;
    if (interaction?.type === "draw" && draftBox && draftBox.width > 0.003 && draftBox.height > 0.003) {
      const id = `box-${Date.now()}`;
      setObjects((current) => [...current, { id, label: "object", bbox: draftBox }]);
      setSelectedBoxId(id);
      setFrameStatus("annotated");
    }
    interactionRef.current = null;
    setDraftBox(null);
  }

  function deleteSelectedBox() {
    if (!selectedBoxId) {
      return;
    }
    setObjects((current) => current.filter((item) => item.id !== selectedBoxId));
    setSelectedBoxId(null);
  }

  function hasUnsavedFrameChanges() {
    if (!activeTask) {
      return false;
    }
    return buildFrameAnnotationSnapshot(frameStatus, objects) !== loadedFrameSnapshotRef.current;
  }

  function requestTaskSwitch(taskId: number) {
    if (saving || taskId === selectedTaskId) {
      return;
    }
    if (hasUnsavedFrameChanges() && !window.confirm("Несохраненная разметка текущего кадра будет потеряна. Перейти к другой задаче?")) {
      return;
    }
    const nextTask = frameTasks.find((task) => task.id === taskId);
    const currentSelection = selectedSelectionId ? frameSelections.find((selection) => selection.id === selectedSelectionId) || null : null;
    const nextSelection =
      nextTask && currentSelection && frameTaskBelongsToSelection(nextTask, currentSelection)
        ? currentSelection
        : findSelectionForFrameTask(taskId);
    if (nextSelection && nextSelection.id !== selectedSelectionId) {
      setSelectedSelectionId(nextSelection.id);
      replaceFrameAnnotationSelectionQuery(nextSelection.id);
    }
    setSelectedTaskId(taskId);
  }

  function requestSelectionSwitch(selectionId: number | null) {
    if (saving || selectionId === selectedSelectionId) {
      return;
    }
    if (hasUnsavedFrameChanges() && !window.confirm("Несохраненная разметка текущего кадра будет потеряна. Перейти к другому интервалу?")) {
      return;
    }
    const nextTask = pickFrameTaskForSelection(selectionId);
    setSelectedSelectionId(selectionId);
    replaceFrameAnnotationSelectionQuery(selectionId);
    setSelectedTaskId(nextTask?.id || null);
    if (!nextTask) {
      setActiveTask(null);
      setObjects([]);
      setFrameStatus("annotated");
      loadedFrameSnapshotRef.current = buildFrameAnnotationSnapshot("annotated", []);
    }
  }

  function goToAdjacentTask(direction: -1 | 1) {
    const scopedTasks = getFrameTasksForSelection(selectedSelectionId);
    if (!selectedTaskId || !scopedTasks.length) {
      return;
    }
    const currentIndex = scopedTasks.findIndex((task) => task.id === selectedTaskId);
    const nextTask = scopedTasks[clampNumber(currentIndex + direction, 0, scopedTasks.length - 1)];
    if (nextTask) {
      requestTaskSwitch(nextTask.id);
    }
  }

  async function saveAnnotation() {
    if (!activeTask) {
      return;
    }
    clearToasts();
    setSaving(true);
    try {
      const status = frameStatus === "empty" ? "empty" : "annotated";
      const payloadObjects = status === "empty" ? [] : serializeFrameObjects(objects);
      const response = await api<{ task: FrameAnnotationTaskItem }>(`/api/v1/frame-tasks/${activeTask.id}/annotation/`, {
        method: "PUT",
        body: { status, objects: payloadObjects },
      });
      setActiveTask(response.task);
      setFrameTasks((current) => current.map((task) => (task.id === response.task.id ? response.task : task)));
      loadedFrameSnapshotRef.current = buildFrameAnnotationSnapshot(status, status === "empty" ? [] : objects);
      addToast(`Кадр ${activeTask.frame_index} сохранен.`, "success");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!videoId) {
      return;
    }
    try {
      await downloadVideoFrameExport(videoId, authUser);
      addToast("JSON-экспорт покадровых аннотаций подготовлен.", "success");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    }
  }

  const intervalOptions = frameSelections.filter((selection) => getFrameTasksForSelection(selection.id).length);
  const visibleFrameTasks = intervalOptions.length ? getFrameTasksForSelection(selectedSelectionId) : frameTasks;
  const selectedSelection = selectedSelectionId ? frameSelections.find((selection) => selection.id === selectedSelectionId) || null : null;
  const activeIndex = selectedTaskId ? visibleFrameTasks.findIndex((task) => task.id === selectedTaskId) : -1;
  const completedCount = visibleFrameTasks.filter((task) => ["done", "uncertain"].includes(task.status)).length;
  const hasPreviousTask = activeIndex > 0;
  const hasNextTask = activeIndex >= 0 && activeIndex < visibleFrameTasks.length - 1;
  return (
    <section className="video-workspace frame-workspace">
      <header className="video-workspace__header">
        <div>
          <span className="eyebrow">Покадровая разметка</span>
          <h1>{video?.source_name || "Покадровая разметка"}</h1>
        </div>
        <div className="video-workspace__actions">
          {videoId ? (
            <a className="btn btn--muted btn--compact" href={`/videos/${videoId}/pre-annotate/`}>
              Выбор кадров
            </a>
          ) : null}
          <button className="btn btn--secondary btn--compact" type="button" onClick={handleExport}>
            Экспорт JSON
          </button>
        </div>
      </header>

      {loading ? (
        <div className="empty-card">Загружаем очередь кадров.</div>
      ) : frameTasks.length ? (
        <div className="frame-annotator">
          <aside className="frame-annotator__queue">
            <div className="panel-card">
              <div className="summary-row">
                <span>Интервалов</span>
                <strong>{intervalOptions.length || "-"}</strong>
              </div>
              <div className="summary-row">
                <span>Текущий интервал</span>
                <strong>{selectedSelection ? formatFrameSelectionTitle(selectedSelection) : "Все кадры"}</strong>
              </div>
              <div className="summary-row">
                <span>Кадров в интервале</span>
                <strong>{visibleFrameTasks.length}</strong>
              </div>
              <div className="summary-row">
                <span>Сохранено</span>
                <strong>{completedCount}</strong>
              </div>
              <div className="summary-row">
                <span>Текущий кадр</span>
                <strong>{activeIndex >= 0 ? activeIndex + 1 : "-"}</strong>
              </div>
            </div>

            {intervalOptions.length ? (
              <>
                <div className="frame-queue-section-title">Интервалы</div>
                <div className="frame-interval-list">
                  {intervalOptions.map((selection, index) => {
                    const selectionTasks = getFrameTasksForSelection(selection.id);
                    const selectionCompletedCount = selectionTasks.filter((task) => ["done", "uncertain"].includes(task.status)).length;
                    return (
                      <button
                        key={selection.id}
                        className={`frame-interval-row ${selection.id === selectedSelectionId ? "is-active" : ""}`}
                        type="button"
                        onClick={() => requestSelectionSwitch(selection.id)}
                        disabled={saving}
                        aria-current={selection.id === selectedSelectionId ? "true" : undefined}
                      >
                        <strong>{index + 1}. {formatFrameSelectionTitle(selection)}</strong>
                        <span>{selectionCompletedCount}/{selectionTasks.length} кадров</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            <div className="frame-queue-section-title">Кадры интервала</div>
            <div className="frame-task-list">
              {visibleFrameTasks.map((task, index) => (
                <button
                  key={task.id}
                  className={`frame-task-row ${task.id === selectedTaskId ? "is-active" : ""}`}
                  type="button"
                  onClick={() => requestTaskSwitch(task.id)}
                  disabled={saving}
                  aria-current={task.id === selectedTaskId ? "true" : undefined}
                >
                  <strong>Задача {index + 1}: кадр {task.frame_index}</strong>
                  <span>{frameTaskStatusLabels[task.status] || task.status}</span>
                </button>
              ))}
            </div>
          </aside>

          <main className="frame-annotator__stage">
            <div className="frame-annotator__toolbar">
              <button className="btn btn--muted btn--compact" type="button" disabled={!hasPreviousTask || saving} onClick={() => goToAdjacentTask(-1)}>
                Предыдущий
              </button>
              <button className="btn btn--muted btn--compact" type="button" disabled={!hasNextTask || saving} onClick={() => goToAdjacentTask(1)}>
                Следующий
              </button>
              <button
                className={`btn btn--muted btn--compact ${frameStatus === "empty" ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  setFrameStatus("empty");
                  setObjects([]);
                }}
              >
                Объект отсутствует
              </button>
              <button className="btn btn--danger btn--compact" type="button" disabled={!selectedBoxId} onClick={deleteSelectedBox}>
                Удалить bbox
              </button>
              <button className="btn btn--primary btn--compact" type="button" disabled={saving || !activeTask} onClick={saveAnnotation}>
                {saving ? "Сохраняем..." : "Сохранить"}
              </button>
            </div>

            <div className="frame-canvas">
              {activeTask?.frame_image_url ? (
                <div className="frame-canvas__media">
                  <img src={activeTask.frame_image_url} alt={`Кадр ${activeTask.frame_index}`} draggable={false} />
                  <svg
                    ref={svgRef}
                    className="frame-canvas__overlay"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    onPointerDown={handleSvgPointerDown}
                    onPointerMove={handleSvgPointerMove}
                    onPointerUp={handleSvgPointerUp}
                    onPointerCancel={handleSvgPointerUp}
                  >
                    {objects.map((item) => (
                      <g key={item.id} className={`frame-bbox-group ${item.id === selectedBoxId ? "is-selected" : ""}`}>
                        <rect
                          className="frame-bbox"
                          x={item.bbox.x}
                          y={item.bbox.y}
                          width={item.bbox.width}
                          height={item.bbox.height}
                          vectorEffect="non-scaling-stroke"
                          onPointerDown={(event) => handleBoxPointerDown(event, item.id || "", undefined)}
                        />
                        <foreignObject
                          className="frame-bbox-label-wrap"
                          x={item.bbox.x}
                          y={Math.max(item.bbox.y - 0.055, 0)}
                          width="0.22"
                          height="0.045"
                          pointerEvents="none"
                        >
                          <div className="frame-bbox-label">{(item.label || "object") === "object" ? "Объект" : item.label}</div>
                        </foreignObject>
                        {["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => {
                          const cx = corner.includes("left") ? item.bbox.x : item.bbox.x + item.bbox.width;
                          const cy = corner.includes("top") ? item.bbox.y : item.bbox.y + item.bbox.height;
                          return (
                            <circle
                              key={corner}
                              className="frame-bbox-handle"
                              cx={cx}
                              cy={cy}
                              r="0.008"
                              vectorEffect="non-scaling-stroke"
                              onPointerDown={(event) => handleBoxPointerDown(event, item.id || "", corner)}
                            />
                          );
                        })}
                      </g>
                    ))}
                    {draftBox ? (
                      <rect
                        className="frame-bbox frame-bbox--draft"
                        x={draftBox.x}
                        y={draftBox.y}
                        width={draftBox.width}
                        height={draftBox.height}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                  </svg>
                </div>
              ) : (
                <div className="empty-card">Кадр еще не извлечен или FFmpeg недоступен на сервере.</div>
              )}
            </div>
          </main>

          <aside className="frame-annotator__side">
            <div className="panel-card">
              <div className="summary-row">
                <span>Кадр</span>
                <strong>{activeTask?.frame_index ?? "-"}</strong>
              </div>
              <div className="summary-row">
                <span>Время</span>
                <strong>{activeTask ? `${activeTask.time_ms} мс` : "-"}</strong>
              </div>
              <div className="summary-row">
                <span>Bbox</span>
                <strong>{objects.length}</strong>
              </div>
            </div>
            <div className="frame-object-list">
              {objects.length ? (
                objects.map((item, index) => (
                  <button
                    key={item.id}
                    className={`frame-object-row ${item.id === selectedBoxId ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setSelectedBoxId(item.id || null)}
                  >
                    <strong>{(item.label || "object") === "object" ? "Объект" : item.label} #{index + 1}</strong>
                    <span>
                      {item.bbox.x.toFixed(3)}, {item.bbox.y.toFixed(3)} · {item.bbox.width.toFixed(3)}×{item.bbox.height.toFixed(3)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-card">Нарисуй bbox поверх кадра или выбери статус «объект отсутствует».</div>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="empty-card">Сначала сгенерируй задачи покадровой разметки на экране выбора кадров.</div>
      )}
    </section>
  );
}

type MediaEditorController = {
  reset: (placeholderText?: string) => void;
  loadTask: (task: TaskItem | null) => void;
  loadTaskWithPayload: (
    task: TaskItem | null,
    payload: Record<string, any> | null,
    options?: { readOnly?: boolean; placeholderText?: string }
  ) => void;
  hasUnlabeledAnnotations: () => boolean;
  getPayload: () => Record<string, any>;
  destroy: () => void;
};

function createMediaAnnotationEditor(options: {
  mediaTool: HTMLElement;
  labelPalette: HTMLElement;
  zoomToolbar: HTMLElement | null;
  zoomRange: HTMLInputElement | null;
  zoomResetBtn: HTMLButtonElement | null;
  mediaStage: HTMLElement;
  annotationList: HTMLElement;
  clearBtn: HTMLButtonElement | null;
  resultJson: HTMLTextAreaElement;
  resultLabel: HTMLElement;
  submitBtn: HTMLButtonElement | null;
  getLabels: () => LabelItem[];
  getTask: () => TaskItem | null;
  showToast: (message: string, type?: ToastType) => void;
  onPayloadChange: (payload: Record<string, any>) => void;
  onStateChange?: (state: { annotationCount: number; hasUnlabeledAnnotations: boolean }) => void;
}): MediaEditorController {
  type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
  type ResizeMode = "resize" | "move" | "square";

  const editor = {
    annotations: [] as any[],
    activeLabelId: null as number | null,
    mediaElement: null as HTMLImageElement | HTMLVideoElement | null,
    wrapperElement: null as HTMLDivElement | null,
    overlayElement: null as HTMLDivElement | null,
    boxElements: new Map<string, HTMLButtonElement>(),
    draftElement: null as HTMLDivElement | null,
    draftState: null as {
      originX: number;
      originY: number;
      left: number;
      top: number;
      width: number;
      height: number;
      lastX: number;
      lastY: number;
      moved: boolean;
    } | null,
    dragState: null as any,
    resizeState: null as {
      annotation: any;
      corner: ResizeCorner;
      startClientX: number;
      startClientY: number;
      originalPoints: number[];
      referencePoints: number[];
      referenceClientX: number;
      referenceClientY: number;
      mode: ResizeMode;
      moved: boolean;
    } | null,
    panState: null as any,
    panPointerId: null as number | null,
    suppressLabelClickUntil: 0,
    eventsAttached: false,
    activePointerId: null as number | null,
    interactionMetrics: null as any,
    zoomLevel: 1,
    minZoom: 1,
    maxZoom: 4,
    zoomStep: 0.25,
    baseCanvasWidth: 0,
    baseCanvasHeight: 0,
    isPanKeyActive: false,
    readOnly: false,
    geometryObserver: null as ResizeObserver | null,
    geometryFrame: null as number | null,
  };

  function getLabels() {
    return options.getLabels() || [];
  }

  function getTask() {
    return options.getTask();
  }

  function isTextTranscriptionTask() {
    return getTask()?.workflow_stage === "text_transcription";
  }

  function isVideoFrameTask() {
    return getTask()?.input_payload?.origin_source_type === "video" || getTask()?.source_type === "video";
  }

  function getNextTrackId() {
    const usedTrackIds = new Set(
      editor.annotations
        .map((annotation) => String(annotation.track_id || "").trim())
        .filter(Boolean)
    );
    let index = 1;
    while (usedTrackIds.has(`track-${index}`)) {
      index += 1;
    }
    return `track-${index}`;
  }

  function isReadOnly() {
    return editor.readOnly;
  }

  function getLabelById(labelId: number | null) {
    return getLabels().find((label) => label.id === labelId) || null;
  }

  function clampValue(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }

  function getLatestPointerSample(event: PointerEvent) {
    const coalescedEvents = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    return coalescedEvents.length ? coalescedEvents[coalescedEvents.length - 1] : event;
  }

  function isEditableTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || Boolean(target.closest("input, textarea, select, button, [contenteditable='true']")))
    );
  }

  function getFrameRate() {
    return Number(getTask()?.input_payload?.frame_rate) || 25;
  }

  function getCurrentFrame() {
    if (getTask()?.source_type !== "video" || !editor.mediaElement || !(editor.mediaElement instanceof HTMLVideoElement)) {
      return 0;
    }
    return Math.max(0, Math.round(editor.mediaElement.currentTime * getFrameRate()));
  }

  function isVisibleOnCurrentFrame(annotation: any) {
    if (getTask()?.source_type !== "video") {
      return true;
    }
    return annotation.frame === getCurrentFrame();
  }

  function getNaturalSize() {
    if (!editor.mediaElement) {
      return { width: 0, height: 0 };
    }
    if (getTask()?.source_type === "video" && editor.mediaElement instanceof HTMLVideoElement) {
      return {
        width: editor.mediaElement.videoWidth || options.mediaStage.clientWidth,
        height: editor.mediaElement.videoHeight || options.mediaStage.clientHeight,
      };
    }
    if (editor.mediaElement instanceof HTMLImageElement) {
      return {
        width: editor.mediaElement.naturalWidth || options.mediaStage.clientWidth,
        height: editor.mediaElement.naturalHeight || options.mediaStage.clientHeight,
      };
    }
    return { width: 0, height: 0 };
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

  function beginPointerInteraction(pointerId: number) {
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

  function getScaledCanvasSize() {
    if (!editor.wrapperElement) {
      return { width: 0, height: 0 };
    }

    if (editor.zoomLevel > 1 && editor.baseCanvasWidth > 0 && editor.baseCanvasHeight > 0) {
      return {
        width: editor.baseCanvasWidth * editor.zoomLevel,
        height: editor.baseCanvasHeight * editor.zoomLevel,
      };
    }

    const bounds = editor.wrapperElement.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
    };
  }

  function updateStageInteractionState() {
    const scaledCanvas = getScaledCanvasSize();
    const overflowX = Boolean(editor.mediaElement && scaledCanvas.width > options.mediaStage.clientWidth + 0.5);
    const overflowY = Boolean(editor.mediaElement && scaledCanvas.height > options.mediaStage.clientHeight + 0.5);
    const canPan = overflowX || overflowY;
    options.mediaStage.classList.toggle("media-stage--zoomed", canPan);
    options.mediaStage.classList.toggle("media-stage--overflow-x", overflowX);
    options.mediaStage.classList.toggle("media-stage--overflow-y", overflowY);
    options.mediaStage.classList.toggle("media-stage--pan-ready", canPan && editor.isPanKeyActive && !editor.panState);
    options.mediaStage.classList.toggle("media-stage--panning", Boolean(editor.panState));
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
      startScrollLeft: options.mediaStage.scrollLeft,
      startScrollTop: options.mediaStage.scrollTop,
      moved: false,
    };
    options.mediaStage.setPointerCapture(event.pointerId);
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
    editor.panState.moved = editor.panState.moved || Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
    options.mediaStage.scrollLeft = Math.max(editor.panState.startScrollLeft - deltaX, 0);
    options.mediaStage.scrollTop = Math.max(editor.panState.startScrollTop - deltaY, 0);
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
    if (editor.panPointerId !== null && options.mediaStage.hasPointerCapture(editor.panPointerId)) {
      options.mediaStage.releasePointerCapture(editor.panPointerId);
    }
    editor.panState = null;
    editor.panPointerId = null;
    updateStageInteractionState();
  }

  function normalizePoints(points: number[], naturalWidth: number, naturalHeight: number) {
    const xMin = clampValue(Math.min(points[0], points[2]), 0, naturalWidth);
    const yMin = clampValue(Math.min(points[1], points[3]), 0, naturalHeight);
    const xMax = clampValue(Math.max(points[0], points[2]), 0, naturalWidth);
    const yMax = clampValue(Math.max(points[1], points[3]), 0, naturalHeight);
    return [Math.round(xMin), Math.round(yMin), Math.round(xMax), Math.round(yMax)];
  }

  function commitAnnotationPoints(annotation: any, metrics = editor.interactionMetrics) {
    const naturalWidth = metrics?.naturalWidth || getNaturalSize().width || 0;
    const naturalHeight = metrics?.naturalHeight || getNaturalSize().height || 0;
    annotation.points = normalizePoints(annotation.points, naturalWidth, naturalHeight);
  }

  function buildLoadedAnnotations(task: TaskItem, payload: Record<string, any> | null) {
    const sourceAnnotations =
      payload && Array.isArray(payload.annotations)
        ? payload.annotations
        : isTextTranscriptionTask()
          ? task.input_payload?.detected_annotations || []
          : [];

    return sourceAnnotations.map((annotation: any, index: number) => ({
      local_id: `${task.id}-${index}-${annotation?.frame || 0}`,
      type: annotation?.type || "bbox",
      label_id: typeof annotation?.label_id === "number" ? annotation.label_id : null,
      points: Array.isArray(annotation?.points)
        ? normalizePoints(
            annotation.points.map((point: any) => Number(point) || 0),
            Number(task.input_payload?.width || 0) || Number(annotation?.points?.[2] || 0),
            Number(task.input_payload?.height || 0) || Number(annotation?.points?.[3] || 0)
          )
        : [0, 0, 0, 0],
      frame: Number(annotation?.frame || 0),
      attributes: Array.isArray(annotation?.attributes) ? annotation.attributes : [],
      occluded: Boolean(annotation?.occluded),
      track_id: typeof annotation?.track_id === "string" && annotation.track_id.trim() ? annotation.track_id.trim() : "track-1",
      text: typeof annotation?.text === "string" ? annotation.text : "",
    }));
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
          ...(isVideoFrameTask() ? { track_id: annotation.track_id || "track-1" } : {}),
          ...(isTextTranscriptionTask() ? { text: typeof annotation.text === "string" ? annotation.text : "" } : {}),
        })),
    };
  }

  function updateZoomControls() {
    if (!options.zoomToolbar) {
      return;
    }

    const hasMedia = Boolean(editor.mediaElement && editor.wrapperElement);
    options.zoomToolbar.classList.toggle("hidden", !hasMedia);

    const zoomPercent = Math.round(editor.zoomLevel * 100);
    if (options.zoomRange) {
      options.zoomRange.value = String(zoomPercent);
      options.zoomRange.disabled = !hasMedia;
    }
    if (options.zoomResetBtn) {
      options.zoomResetBtn.textContent = `${zoomPercent}%`;
      options.zoomResetBtn.disabled = !hasMedia || editor.zoomLevel === 1;
    }
    updateStageInteractionState();
  }

  function captureBaseCanvasSize(forceUnzoomedMeasure = false) {
    if (!editor.mediaElement) {
      return false;
    }

    if (!forceUnzoomedMeasure && editor.zoomLevel > 1 && editor.baseCanvasWidth > 0 && editor.baseCanvasHeight > 0) {
      return true;
    }

    const wrapper = editor.wrapperElement;
    const shouldMeasureUnzoomed = Boolean(forceUnzoomedMeasure && editor.zoomLevel > 1 && wrapper);
    const previousWidth = wrapper?.style.width || "";
    const previousHeight = wrapper?.style.height || "";
    if (shouldMeasureUnzoomed && wrapper) {
      wrapper.classList.remove("media-canvas--zoom-ready");
      wrapper.style.width = "";
      wrapper.style.height = "";
    }

    const width = editor.mediaElement.clientWidth || editor.mediaElement.getBoundingClientRect().width;
    const height = editor.mediaElement.clientHeight || editor.mediaElement.getBoundingClientRect().height;
    if (shouldMeasureUnzoomed && wrapper) {
      wrapper.classList.add("media-canvas--zoom-ready");
      wrapper.style.width = previousWidth;
      wrapper.style.height = previousHeight;
    }

    if (!width || !height) {
      return false;
    }

    editor.baseCanvasWidth = width;
    editor.baseCanvasHeight = height;
    return true;
  }

  function applyZoom(
    nextZoom: number,
    zoomOptions: { preserveViewport?: boolean; anchorClientX?: number; anchorClientY?: number; force?: boolean } = {}
  ) {
    if (!editor.wrapperElement) {
      editor.zoomLevel = editor.minZoom;
      updateZoomControls();
      return;
    }

    const previousZoom = editor.zoomLevel;
    const clampedZoom = clampValue(nextZoom, editor.minZoom, editor.maxZoom);
    const shouldPreserveViewport = zoomOptions.preserveViewport !== false;
    const force = Boolean(zoomOptions.force);

    if (!force && Math.abs(previousZoom - clampedZoom) < 0.001) {
      updateZoomControls();
      return;
    }

    const stageRect = options.mediaStage.getBoundingClientRect();
    const wrapperRect = editor.wrapperElement.getBoundingClientRect();
    const anchorClientX = typeof zoomOptions.anchorClientX === "number" ? zoomOptions.anchorClientX : stageRect.left + options.mediaStage.clientWidth / 2;
    const anchorClientY = typeof zoomOptions.anchorClientY === "number" ? zoomOptions.anchorClientY : stageRect.top + options.mediaStage.clientHeight / 2;
    const anchorX = anchorClientX - stageRect.left;
    const anchorY = anchorClientY - stageRect.top;
    if (clampedZoom > 1 && (editor.baseCanvasWidth <= 0 || editor.baseCanvasHeight <= 0)) {
      captureBaseCanvasSize();
    }

    const baseWidth = editor.baseCanvasWidth || editor.mediaElement.clientWidth || wrapperRect.width;
    const baseHeight = editor.baseCanvasHeight || editor.mediaElement.clientHeight || wrapperRect.height;
    if (!baseWidth || !baseHeight) {
      return;
    }

    const currentWidth = previousZoom <= 1 ? baseWidth : baseWidth * previousZoom;
    const currentHeight = previousZoom <= 1 ? baseHeight : baseHeight * previousZoom;
    const currentOffsetX = currentWidth < options.mediaStage.clientWidth ? (options.mediaStage.clientWidth - currentWidth) / 2 : 0;
    const currentOffsetY = currentHeight < options.mediaStage.clientHeight ? (options.mediaStage.clientHeight - currentHeight) / 2 : 0;
    const nextWidth = clampedZoom <= 1 ? baseWidth : baseWidth * clampedZoom;
    const nextHeight = clampedZoom <= 1 ? baseHeight : baseHeight * clampedZoom;
    const nextOffsetX = nextWidth < options.mediaStage.clientWidth ? (options.mediaStage.clientWidth - nextWidth) / 2 : 0;
    const nextOffsetY = nextHeight < options.mediaStage.clientHeight ? (options.mediaStage.clientHeight - nextHeight) / 2 : 0;
    const contentAnchorX = clampValue(options.mediaStage.scrollLeft + anchorX - currentOffsetX, 0, currentWidth);
    const contentAnchorY = clampValue(options.mediaStage.scrollTop + anchorY - currentOffsetY, 0, currentHeight);
    const zoomRatio = previousZoom > 0 ? clampedZoom / previousZoom : 1;
    const nextScrollLeft = Math.max(contentAnchorX * zoomRatio + nextOffsetX - anchorX, 0);
    const nextScrollTop = Math.max(contentAnchorY * zoomRatio + nextOffsetY - anchorY, 0);

    if (clampedZoom <= 1) {
      finishPanning();
      editor.zoomLevel = 1;
      editor.wrapperElement.classList.remove("media-canvas--zoom-ready");
      editor.wrapperElement.style.width = "";
      editor.wrapperElement.style.height = "";
      updateZoomControls();
      window.requestAnimationFrame(() => {
        renderBoxes();
        options.mediaStage.scrollLeft = shouldPreserveViewport && previousZoom > 1 ? nextScrollLeft : 0;
        options.mediaStage.scrollTop = shouldPreserveViewport && previousZoom > 1 ? nextScrollTop : 0;
      });
      return;
    }

    editor.zoomLevel = clampedZoom;
    editor.wrapperElement.classList.add("media-canvas--zoom-ready");
    editor.wrapperElement.style.width = `${Math.round(nextWidth)}px`;
    editor.wrapperElement.style.height = `${Math.round(nextHeight)}px`;
    updateZoomControls();
    window.requestAnimationFrame(() => {
      renderBoxes();
      if (shouldPreserveViewport) {
        options.mediaStage.scrollLeft = nextScrollLeft;
        options.mediaStage.scrollTop = nextScrollTop;
      }
    });
  }

  function handleStageResize() {
    scheduleGeometryRefresh(true);
  }

  function scheduleGeometryRefresh(cancelInteraction = false) {
    if (cancelInteraction) {
      cancelActiveInteraction();
    }

    if (editor.geometryFrame !== null) {
      window.cancelAnimationFrame(editor.geometryFrame);
    }

    editor.geometryFrame = window.requestAnimationFrame(() => {
      editor.geometryFrame = window.requestAnimationFrame(() => {
        editor.geometryFrame = null;
        syncCanvasViewport();
      });
    });
  }

  function disconnectGeometryObserver() {
    editor.geometryObserver?.disconnect();
    editor.geometryObserver = null;

    if (editor.geometryFrame !== null) {
      window.cancelAnimationFrame(editor.geometryFrame);
      editor.geometryFrame = null;
    }
  }

  function observeCanvasGeometry() {
    disconnectGeometryObserver();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleGeometryRefresh(true);
    });
    observer.observe(options.mediaStage);
    if (editor.wrapperElement) {
      observer.observe(editor.wrapperElement);
    }
    if (editor.mediaElement) {
      observer.observe(editor.mediaElement);
    }
    if (editor.overlayElement) {
      observer.observe(editor.overlayElement);
    }
    editor.geometryObserver = observer;
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
      captureBaseCanvasSize(true);
      applyZoom(editor.zoomLevel, { preserveViewport: false, force: true });
      return;
    }

    captureBaseCanvasSize();
    updateZoomControls();
    renderBoxes();
  }

  function updateSubmitState() {
    const hasUnlabeledAnnotations = editor.annotations.some((annotation) => !annotation.label_id);
    options.onStateChange?.({
      annotationCount: editor.annotations.length,
      hasUnlabeledAnnotations,
    });

    if (!options.submitBtn) {
      return;
    }
    options.submitBtn.disabled = !getTask() || hasUnlabeledAnnotations;
  }

  function updateResultPreview() {
    const payload = buildPayload();
    options.resultJson.value = JSON.stringify(payload, null, 2);
    options.onPayloadChange(payload);
    updateSubmitState();
  }

  function setActiveLabel(labelId: number | null) {
    editor.activeLabelId = labelId;
    options.labelPalette.querySelectorAll<HTMLButtonElement>("[data-label-id]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.labelId) === labelId);
    });
  }

  function removeAnnotation(localId: string | undefined) {
    if (!localId) {
      return;
    }

    editor.annotations = editor.annotations.filter((annotation) => annotation.local_id !== localId);
    render();
  }

  function updateClearButtonVisibility() {
    options.clearBtn?.classList.toggle("hidden", !editor.annotations.length || isTextTranscriptionTask() || isReadOnly());
  }

  function renderPalette() {
    const labels = getLabels();
    if (!labels.length) {
      options.labelPalette.innerHTML = '<div class="empty-card">Лейблы для этой комнаты не заданы.</div>';
      setActiveLabel(null);
      return;
    }

    if (isTextTranscriptionTask() || isReadOnly()) {
      options.labelPalette.innerHTML = labels
        .map(
          (label) => `
            <div class="label-chip label-chip--static" style="--label-color: ${label.color}">
              <i></i>
              <span>${label.name}</span>
            </div>
          `
        )
        .join("");
      if (isTextTranscriptionTask() || isReadOnly()) {
        setActiveLabel(null);
      }
      return;
    }

    options.labelPalette.innerHTML = labels
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

    options.labelPalette.querySelectorAll<HTMLButtonElement>("[data-label-id]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveLabel(Number(button.dataset.labelId));
      });
    });

    if (!editor.activeLabelId) {
      setActiveLabel(labels[0].id);
    }
  }

  function renderAnnotationList() {
    if (!editor.annotations.length) {
      options.annotationList.className = "annotation-list empty-card";
      options.annotationList.textContent = isTextTranscriptionTask()
        ? "Детекция пока не передала ни одной текстовой области."
        : "Разметка пока отсутствует.";
      return;
    }

    if (isTextTranscriptionTask()) {
      options.annotationList.className = "annotation-list annotation-list--transcription";
      options.annotationList.innerHTML = editor.annotations
        .map((annotation, index) => {
          const label = getLabelById(annotation.label_id);
          return `
            <div class="annotation-row annotation-row--transcription ${isVisibleOnCurrentFrame(annotation) ? "is-current" : ""}">
              <div class="annotation-row__meta">
                <strong>#${index + 1}</strong>
                <span>${label ? label.name : "Без лейбла"}</span>
                <small>frame ${annotation.frame}</small>
              </div>
              <div class="annotation-row__points">[${annotation.points.join(", ")}]</div>
              <textarea data-text-id="${annotation.local_id}" rows="3" placeholder="Введи текст для области" ${isReadOnly() ? "readonly" : ""}>${annotation.text || ""}</textarea>
            </div>
          `;
        })
        .join("");

      if (!isReadOnly()) {
        options.annotationList.querySelectorAll<HTMLTextAreaElement>("[data-text-id]").forEach((textarea) => {
          textarea.addEventListener("input", (event) => {
            const target = event.currentTarget as HTMLTextAreaElement;
            const annotation = editor.annotations.find((item) => item.local_id === target.dataset.textId);
            if (!annotation) {
              return;
            }
            annotation.text = target.value;
            updateResultPreview();
          });
        });
      }
      return;
    }

    options.annotationList.className = "annotation-list";
    options.annotationList.innerHTML = editor.annotations
      .map((annotation, index) => {
        const label = getLabelById(annotation.label_id);
        return `
          <div class="annotation-row ${isVisibleOnCurrentFrame(annotation) ? "is-current" : ""}">
            <div class="annotation-row__meta">
              <strong>#${index + 1}</strong>
              <span>${label ? label.name : "Без лейбла"}</span>
              <small>${isVideoFrameTask() ? `track ${annotation.track_id || "track-1"}` : `frame ${annotation.frame}`}</small>
            </div>
            <div class="annotation-row__points">[${annotation.points.join(", ")}]</div>
            ${
              isVideoFrameTask() && !isReadOnly()
                ? `<label class="annotation-row__track"><span>Track</span><input data-track-id="${annotation.local_id}" value="${annotation.track_id || "track-1"}" maxlength="64" /></label>`
                : ""
            }
            ${isReadOnly() ? "" : `<button class="btn btn--muted btn--compact" type="button" data-remove-id="${annotation.local_id}">Удалить</button>`}
          </div>
        `;
      })
      .join("");

    if (!isReadOnly()) {
      options.annotationList.querySelectorAll<HTMLInputElement>("[data-track-id]").forEach((input) => {
        input.addEventListener("input", (event) => {
          const target = event.currentTarget as HTMLInputElement;
          const annotation = editor.annotations.find((item) => item.local_id === target.dataset.trackId);
          if (!annotation) {
            return;
          }
          annotation.track_id = target.value.trim() || "track-1";
          renderBoxes();
          updateResultPreview();
        });
      });
      options.annotationList.querySelectorAll<HTMLButtonElement>("[data-remove-id]").forEach((button) => {
        button.addEventListener("click", () => {
          removeAnnotation(button.dataset.removeId);
        });
      });
    }
  }

  function removeBoxElement(localId: string) {
    const element = editor.boxElements.get(localId);
    if (!element) {
      return;
    }
    element.remove();
    editor.boxElements.delete(localId);
  }

  function updateBoxElement(element: HTMLButtonElement, annotation: any, naturalWidth: number, naturalHeight: number) {
    const label = getLabelById(annotation.label_id);
    const [xMin, yMin, xMax, yMax] = annotation.points;
    const safeWidth = naturalWidth > 0 ? naturalWidth : Math.max(xMax, 1);
    const safeHeight = naturalHeight > 0 ? naturalHeight : Math.max(yMax, 1);
    element.style.left = `${(xMin / safeWidth) * 100}%`;
    element.style.top = `${(yMin / safeHeight) * 100}%`;
    element.style.width = `${((xMax - xMin) / safeWidth) * 100}%`;
    element.style.height = `${((yMax - yMin) / safeHeight) * 100}%`;
    element.style.setProperty("--bbox-color", label?.color || "#B8B8B8");
    const labelNode = element.firstElementChild instanceof HTMLSpanElement ? element.firstElementChild : null;
    if (labelNode) {
      labelNode.textContent = isVideoFrameTask() && annotation.track_id ? `${label ? label.name : "Без лейбла"} · ${annotation.track_id}` : label ? label.name : "Без лейбла";
    }
  }

  function renderActiveBox(annotation: any, metrics = editor.interactionMetrics, overlayScale: { scaleX: number; scaleY: number } | null = null) {
    if (!editor.overlayElement) {
      return;
    }

    if (!isVisibleOnCurrentFrame(annotation)) {
      removeBoxElement(annotation.local_id);
      return;
    }

    const naturalSize = metrics
      ? { width: metrics.naturalWidth, height: metrics.naturalHeight }
      : getNaturalSize();
    const element = editor.boxElements.get(annotation.local_id) || createBoxElement(annotation);
    if (element.parentNode !== editor.overlayElement) {
      editor.overlayElement.appendChild(element);
    }
    updateBoxElement(element, annotation, naturalSize.width, naturalSize.height);
  }

  function createBoxElement(annotation: any) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `media-bbox${isTextTranscriptionTask() || isReadOnly() ? " media-bbox--readonly" : ""}`;
    element.innerHTML = `
      <span class="media-bbox__label"></span>
      <i class="media-bbox__resize-handle media-bbox__resize-handle--top-left" data-resize-corner="top-left" aria-hidden="true"></i>
      <i class="media-bbox__resize-handle media-bbox__resize-handle--top-right" data-resize-corner="top-right" aria-hidden="true"></i>
      <i class="media-bbox__resize-handle media-bbox__resize-handle--bottom-left" data-resize-corner="bottom-left" aria-hidden="true"></i>
      <i class="media-bbox__resize-handle media-bbox__resize-handle--bottom-right" data-resize-corner="bottom-right" aria-hidden="true"></i>
    `;
    if (isTextTranscriptionTask() || isReadOnly()) {
      element.tabIndex = -1;
      element.setAttribute("aria-disabled", "true");
      editor.boxElements.set(annotation.local_id, element);
      return element;
    }

    element.addEventListener("pointerdown", (event) => {
      startDragging(event, annotation);
    });
    element.querySelectorAll<HTMLElement>("[data-resize-corner]").forEach((handle) => {
      const corner = handle.dataset.resizeCorner as ResizeCorner | undefined;
      if (!corner) {
        return;
      }
      handle.addEventListener("pointerdown", (event) => {
        startResizing(event, annotation, corner);
      });
    });
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < editor.suppressLabelClickUntil) {
        return;
      }
      if (!editor.activeLabelId) {
        options.showToast("Сначала выбери label.", "error");
        return;
      }
      annotation.label_id = editor.activeLabelId;
      render();
    });
    editor.boxElements.set(annotation.local_id, element);
    return element;
  }

  function renderBoxes() {
    if (!editor.overlayElement) {
      return;
    }

    const visibleIds = new Set<string>();

    editor.annotations.forEach((annotation) => {
      if (!isVisibleOnCurrentFrame(annotation)) {
        removeBoxElement(annotation.local_id);
        return;
      }

      visibleIds.add(annotation.local_id);
      renderActiveBox(annotation);
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
    editor.draftState = null;
  }

  function restoreAnnotationFromPoints(annotation: any, points: number[] | null | undefined, metrics = editor.interactionMetrics) {
    if (!annotation || !Array.isArray(points)) {
      return;
    }
    annotation.points = [...points];
    renderActiveBox(annotation, metrics);
  }

  function cancelActiveInteraction() {
    let didCancel = false;

    if (editor.dragState) {
      restoreAnnotationFromPoints(editor.dragState.annotation, editor.dragState.originalPoints);
      editor.dragState = null;
      didCancel = true;
    }

    if (editor.resizeState) {
      restoreAnnotationFromPoints(editor.resizeState.annotation, editor.resizeState.originalPoints);
      editor.resizeState = null;
      didCancel = true;
    }

    if (editor.draftState) {
      clearDraft();
      didCancel = true;
    }

    if (didCancel) {
      endPointerInteraction();
      renderAnnotationList();
      updateResultPreview();
    }

    if (editor.panState) {
      finishPanning();
      didCancel = true;
    }

    return didCancel;
  }

  function updateDraftElement(left: number, top: number, width: number, height: number) {
    if (!editor.draftElement || !editor.draftState) {
      return;
    }

    editor.draftState.left = left;
    editor.draftState.top = top;
    editor.draftState.width = width;
    editor.draftState.height = height;
    editor.draftElement.style.left = `${left}px`;
    editor.draftElement.style.top = `${top}px`;
    editor.draftElement.style.width = `${width}px`;
    editor.draftElement.style.height = `${height}px`;
  }

  function startDragging(event: PointerEvent, annotation: any) {
    if (isTextTranscriptionTask() || isReadOnly()) {
      return;
    }
    if (editor.panState || startPanning(event) || event.button !== 0 || !editor.overlayElement) {
      return;
    }

    if (getTask()?.source_type === "video" && editor.mediaElement instanceof HTMLVideoElement && !editor.mediaElement.paused) {
      options.showToast("Поставь видео на паузу перед перемещением области.", "error");
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

  function getResizedPointsForCorner(options: {
    referencePoints: number[];
    corner: ResizeCorner;
    mode: ResizeMode;
    deltaX: number;
    deltaY: number;
    naturalWidth: number;
    naturalHeight: number;
  }) {
    const { referencePoints, corner, mode, deltaX, deltaY, naturalWidth, naturalHeight } = options;
    const [startXMin, startYMin, startXMax, startYMax] = referencePoints;
    const startWidth = startXMax - startXMin;
    const startHeight = startYMax - startYMin;
    const minWidth = 1;
    const minHeight = 1;
    const isLeftCorner = corner === "top-left" || corner === "bottom-left";
    const isTopCorner = corner === "top-left" || corner === "top-right";

    if (mode === "move") {
      const maxX = Math.max(naturalWidth - startWidth, 0);
      const maxY = Math.max(naturalHeight - startHeight, 0);
      const nextXMin = clampValue(startXMin + deltaX, 0, maxX);
      const nextYMin = clampValue(startYMin + deltaY, 0, maxY);
      return [nextXMin, nextYMin, nextXMin + startWidth, nextYMin + startHeight];
    }

    if (mode === "square") {
      const anchorX = isLeftCorner ? startXMax : startXMin;
      const anchorY = isTopCorner ? startYMax : startYMin;
      const draggedX = (isLeftCorner ? startXMin : startXMax) + deltaX;
      const draggedY = (isTopCorner ? startYMin : startYMax) + deltaY;
      const desiredWidth = Math.abs(draggedX - anchorX);
      const desiredHeight = Math.abs(draggedY - anchorY);
      const maxWidth = Math.max(isLeftCorner ? anchorX : naturalWidth - anchorX, minWidth);
      const maxHeight = Math.max(isTopCorner ? anchorY : naturalHeight - anchorY, minHeight);
      const maxSquare = Math.max(Math.min(maxWidth, maxHeight), minWidth);
      const nextSize = clampValue(
        Math.abs(deltaX) >= Math.abs(deltaY) ? desiredWidth : desiredHeight,
        minWidth,
        maxSquare
      );
      const nextXMin = isLeftCorner ? anchorX - nextSize : anchorX;
      const nextYMin = isTopCorner ? anchorY - nextSize : anchorY;
      const nextXMax = isLeftCorner ? anchorX : anchorX + nextSize;
      const nextYMax = isTopCorner ? anchorY : anchorY + nextSize;
      return [nextXMin, nextYMin, nextXMax, nextYMax];
    }

    let nextXMin = startXMin;
    let nextYMin = startYMin;
    let nextXMax = startXMax;
    let nextYMax = startYMax;

    if (isLeftCorner) {
      nextXMin = clampValue(startXMin + deltaX, 0, startXMax - minWidth);
    } else {
      nextXMax = clampValue(startXMax + deltaX, startXMin + minWidth, naturalWidth);
    }

    if (isTopCorner) {
      nextYMin = clampValue(startYMin + deltaY, 0, startYMax - minHeight);
    } else {
      nextYMax = clampValue(startYMax + deltaY, startYMin + minHeight, naturalHeight);
    }

    return [nextXMin, nextYMin, nextXMax, nextYMax];
  }

  function startResizing(event: PointerEvent, annotation: any, corner: ResizeCorner) {
    if (isTextTranscriptionTask() || isReadOnly()) {
      return;
    }
    if (editor.panState || startPanning(event) || event.button !== 0 || !editor.overlayElement) {
      return;
    }

    if (getTask()?.source_type === "video" && editor.mediaElement instanceof HTMLVideoElement && !editor.mediaElement.paused) {
      options.showToast("Поставь видео на паузу перед изменением размера области.", "error");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    beginPointerInteraction(event.pointerId);
    editor.resizeState = {
      annotation,
      corner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originalPoints: [...annotation.points],
      referencePoints: [...annotation.points],
      referenceClientX: event.clientX,
      referenceClientY: event.clientY,
      mode: "resize",
      moved: false,
    };
  }

  function startDrawing(event: PointerEvent) {
    if (isTextTranscriptionTask() || isReadOnly()) {
      return;
    }
    if (editor.panState || startPanning(event) || event.button !== 0 || !editor.overlayElement) {
      return;
    }

    if (getTask()?.source_type === "video" && editor.mediaElement instanceof HTMLVideoElement && !editor.mediaElement.paused) {
      options.showToast("Поставь видео на паузу перед выделением области.", "error");
      return;
    }

    const sample = getLatestPointerSample(event);
    event.preventDefault();
    const metrics = beginPointerInteraction(event.pointerId);
    if (!metrics) {
      return;
    }
    const startX = Math.min(Math.max(sample.clientX - metrics.left, 0), metrics.width);
    const startY = Math.min(Math.max(sample.clientY - metrics.top, 0), metrics.height);
    editor.draftElement = document.createElement("div");
    editor.draftElement.className = "media-bbox media-bbox--draft";
    editor.overlayElement.appendChild(editor.draftElement);
    editor.draftState = {
      originX: startX,
      originY: startY,
      left: startX,
      top: startY,
      width: 0,
      height: 0,
      lastX: startX,
      lastY: startY,
      moved: false,
    };
  }

  function updateDraft(event: PointerEvent) {
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
      const nextMode: ResizeMode = event.ctrlKey ? "move" : event.shiftKey ? "square" : "resize";
      if (editor.resizeState.mode !== nextMode) {
        editor.resizeState.mode = nextMode;
        editor.resizeState.referencePoints = [...editor.resizeState.annotation.points];
        editor.resizeState.referenceClientX = clientX;
        editor.resizeState.referenceClientY = clientY;
      }

      const deltaX = (clientX - editor.resizeState.referenceClientX) * metrics.scaleToNaturalX;
      const deltaY = (clientY - editor.resizeState.referenceClientY) * metrics.scaleToNaturalY;
      editor.resizeState.moved =
        editor.resizeState.moved ||
        Math.abs(clientX - editor.resizeState.startClientX) > 3 ||
        Math.abs(clientY - editor.resizeState.startClientY) > 3;
      editor.resizeState.annotation.points = getResizedPointsForCorner({
        referencePoints: editor.resizeState.referencePoints,
        corner: editor.resizeState.corner,
        mode: nextMode,
        deltaX,
        deltaY,
        naturalWidth: metrics.naturalWidth || 0,
        naturalHeight: metrics.naturalHeight || 0,
      });
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
      const nextXMin = clampValue(startXMin + deltaX, 0, maxX);
      const nextYMin = clampValue(startYMin + deltaY, 0, maxY);

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

    if (!editor.draftState || !editor.draftElement || !editor.overlayElement) {
      return;
    }

    const currentX = Math.min(Math.max(clientX - metrics.left, 0), metrics.width);
    const currentY = Math.min(Math.max(clientY - metrics.top, 0), metrics.height);
    const draft = editor.draftState;

    if (event.ctrlKey && (draft.width > 0 || draft.height > 0)) {
      const deltaX = currentX - draft.lastX;
      const deltaY = currentY - draft.lastY;
      const nextLeft = clampValue(draft.left + deltaX, 0, Math.max(metrics.width - draft.width, 0));
      const nextTop = clampValue(draft.top + deltaY, 0, Math.max(metrics.height - draft.height, 0));
      draft.originX += nextLeft - draft.left;
      draft.originY += nextTop - draft.top;
      updateDraftElement(nextLeft, nextTop, draft.width, draft.height);
    } else {
      const deltaX = currentX - draft.originX;
      const deltaY = currentY - draft.originY;
      let left = Math.min(draft.originX, currentX);
      let top = Math.min(draft.originY, currentY);
      let width = Math.abs(deltaX);
      let height = Math.abs(deltaY);

      if (event.shiftKey) {
        const maxHorizontal = deltaX >= 0 ? metrics.width - draft.originX : draft.originX;
        const maxVertical = deltaY >= 0 ? metrics.height - draft.originY : draft.originY;
        const size = Math.min(Math.max(Math.abs(deltaX), Math.abs(deltaY)), maxHorizontal, maxVertical);
        const nextX = draft.originX + (deltaX >= 0 ? size : -size);
        const nextY = draft.originY + (deltaY >= 0 ? size : -size);
        left = Math.min(draft.originX, nextX);
        top = Math.min(draft.originY, nextY);
        width = size;
        height = size;
      }

      updateDraftElement(left, top, width, height);
    }

    draft.lastX = currentX;
    draft.lastY = currentY;
    draft.moved = draft.moved || Math.abs(currentX - draft.originX) > 3 || Math.abs(currentY - draft.originY) > 3;
  }

  function finishDrawing(event: PointerEvent) {
    if (editor.activePointerId !== null && event.pointerId !== editor.activePointerId) {
      return;
    }

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
    if (!editor.draftState || !editor.overlayElement || !metrics) {
      clearDraft();
      endPointerInteraction(event.pointerId);
      return;
    }

    const { left, top, width, height } = editor.draftState;

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
        track_id: isVideoFrameTask() ? getNextTrackId() : "track-1",
      });
    }

    clearDraft();
    endPointerInteraction(event.pointerId);
    render();
  }

  function cancelPointerInteraction(event: PointerEvent) {
    if (editor.activePointerId !== null && event.pointerId !== editor.activePointerId) {
      return;
    }
    cancelActiveInteraction();
  }

  function handleOverlayPointerDown(event: PointerEvent) {
    if (event.target !== editor.overlayElement) {
      return;
    }
    startDrawing(event);
  }

  function attachOverlayEvents() {
    if (!editor.overlayElement) {
      return;
    }

    editor.overlayElement.addEventListener("pointerdown", handleOverlayPointerDown);
    editor.overlayElement.addEventListener("pointermove", updateDraft);
    editor.overlayElement.addEventListener("pointerrawupdate", updateDraft as EventListener);
    editor.overlayElement.addEventListener("pointerup", finishDrawing);
    editor.overlayElement.addEventListener("pointercancel", cancelPointerInteraction);
  }

  function detachOverlayEvents(overlay: HTMLDivElement | null) {
    if (!overlay) {
      return;
    }

    overlay.removeEventListener("pointerdown", handleOverlayPointerDown);
    overlay.removeEventListener("pointermove", updateDraft);
    overlay.removeEventListener("pointerrawupdate", updateDraft as EventListener);
    overlay.removeEventListener("pointerup", finishDrawing);
    overlay.removeEventListener("pointercancel", cancelPointerInteraction);
  }

  function handleClearAnnotations() {
    if (isTextTranscriptionTask() || isReadOnly()) {
      return;
    }
    editor.annotations = [];
    render();
  }

  function handleZoomReset() {
    applyZoom(1);
  }

  function handleZoomRangeInput() {
    if (!options.zoomRange) {
      return;
    }

    applyZoom(Number(options.zoomRange.value) / 100);
  }

  function handleStagePointerDown(event: PointerEvent) {
    startPanning(event);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.code === "Escape" && !isEditableTarget(event.target)) {
      if (cancelActiveInteraction()) {
        event.preventDefault();
      }
      return;
    }

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

  function attachPersistentEvents() {
    if (editor.eventsAttached) {
      return;
    }

    options.clearBtn?.addEventListener("click", handleClearAnnotations);
    options.zoomResetBtn?.addEventListener("click", handleZoomReset);
    options.zoomRange?.addEventListener("input", handleZoomRangeInput);
    options.mediaStage.addEventListener("pointerdown", handleStagePointerDown, true);
    options.mediaStage.addEventListener("pointermove", updatePan);
    options.mediaStage.addEventListener("pointerup", finishPanning);
    options.mediaStage.addEventListener("pointercancel", finishPanning);
    options.mediaStage.addEventListener("wheel", handleStageWheel, { passive: false });
    window.addEventListener("resize", handleStageResize);
    window.visualViewport?.addEventListener("resize", handleStageResize);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    editor.eventsAttached = true;
  }

  function detachPersistentEvents() {
    if (!editor.eventsAttached) {
      return;
    }

    options.clearBtn?.removeEventListener("click", handleClearAnnotations);
    options.zoomResetBtn?.removeEventListener("click", handleZoomReset);
    options.zoomRange?.removeEventListener("input", handleZoomRangeInput);
    options.mediaStage.removeEventListener("pointerdown", handleStagePointerDown, true);
    options.mediaStage.removeEventListener("pointermove", updatePan);
    options.mediaStage.removeEventListener("pointerup", finishPanning);
    options.mediaStage.removeEventListener("pointercancel", finishPanning);
    options.mediaStage.removeEventListener("wheel", handleStageWheel);
    window.removeEventListener("resize", handleStageResize);
    window.visualViewport?.removeEventListener("resize", handleStageResize);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleWindowBlur);
    editor.eventsAttached = false;
  }

  function reset(placeholderText?: string) {
    finishPanning();
    disconnectGeometryObserver();
    detachOverlayEvents(editor.overlayElement);
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
    editor.zoomLevel = 1;
    editor.baseCanvasWidth = 0;
    editor.baseCanvasHeight = 0;
    editor.isPanKeyActive = false;
    editor.readOnly = false;
    endPointerInteraction();
    options.mediaTool.classList.add("hidden");
    options.zoomToolbar?.classList.add("hidden");
    options.mediaStage.className = "media-stage empty-card";
    options.mediaStage.textContent = placeholderText || "Файл задачи загрузится после выбора задания.";
    options.labelPalette.innerHTML = "";
    options.resultLabel.textContent = "Результат разметки";
    options.resultJson.readOnly = false;
    options.annotationList.className = "annotation-list empty-card";
    options.annotationList.textContent = "Разметка пока отсутствует.";
    updateZoomControls();
    render();
  }

  function loadTask(task: TaskItem | null) {
    loadTaskWithPayload(task, null, { readOnly: false });
  }

  function loadTaskWithPayload(
    task: TaskItem | null,
    payload: Record<string, any> | null,
    loadOptions: { readOnly?: boolean; placeholderText?: string } = {}
  ) {
    if (!task || !["image", "video"].includes(task.source_type) || !task.source_file_url) {
      reset(loadOptions.placeholderText);
      return;
    }

    finishPanning();
    disconnectGeometryObserver();
    detachOverlayEvents(editor.overlayElement);
    clearDraft();
    endPointerInteraction();
    editor.readOnly = Boolean(loadOptions.readOnly);
    options.mediaTool.classList.remove("hidden");
    options.resultLabel.textContent = isTextTranscriptionTask() ? "Результат OCR-транскрибации" : "Результат bbox-разметки";
    options.resultJson.readOnly = true;
    editor.annotations = buildLoadedAnnotations(task, payload);
    editor.zoomLevel = 1;
    editor.baseCanvasWidth = 0;
    editor.baseCanvasHeight = 0;
    options.zoomToolbar?.classList.remove("hidden");
    updateZoomControls();

    const wrapper = document.createElement("div");
    wrapper.className = "media-canvas";
    const overlay = document.createElement("div");
    overlay.className = "media-overlay";
    const handleMediaReady = () => {
      syncCanvasViewport();
    };

    let mediaElement: HTMLImageElement | HTMLVideoElement;
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
    options.mediaStage.className = "media-stage media-stage--interactive";
    options.mediaStage.innerHTML = "";
    options.mediaStage.appendChild(wrapper);

    editor.mediaElement = mediaElement;
    editor.wrapperElement = wrapper;
    editor.overlayElement = overlay;
    attachOverlayEvents();
    observeCanvasGeometry();
    updateZoomControls();
    if (task.source_type === "image" && mediaElement instanceof HTMLImageElement && mediaElement.complete) {
      window.requestAnimationFrame(handleMediaReady);
    }
    render();
  }

  function destroy() {
    finishPanning();
    disconnectGeometryObserver();
    detachOverlayEvents(editor.overlayElement);
    detachPersistentEvents();
    endPointerInteraction();
    clearDraft();
  }

  attachPersistentEvents();

  return {
    reset,
    loadTask,
    loadTaskWithPayload,
    hasUnlabeledAnnotations() {
      return editor.annotations.some((annotation) => !annotation.label_id);
    },
    getPayload() {
      return buildPayload();
    },
    destroy,
  };
}

function RoomWorkPage() {
  const { bootstrap, api, addToast, clearToasts } = useApp();
  const roomId = bootstrap.room_id;
  const formRef = useRef<HTMLFormElement | null>(null);
  const mediaToolRef = useRef<HTMLDivElement | null>(null);
  const labelPaletteRef = useRef<HTMLDivElement | null>(null);
  const zoomToolbarRef = useRef<HTMLDivElement | null>(null);
  const zoomRangeRef = useRef<HTMLInputElement | null>(null);
  const zoomResetBtnRef = useRef<HTMLButtonElement | null>(null);
  const mediaStageRef = useRef<HTMLDivElement | null>(null);
  const annotationListRef = useRef<HTMLDivElement | null>(null);
  const clearAnnotationsBtnRef = useRef<HTMLButtonElement | null>(null);
  const resultJsonRef = useRef<HTMLTextAreaElement | null>(null);
  const resultLabelRef = useRef<HTMLSpanElement | null>(null);
  const mediaEditorRef = useRef<MediaEditorController | null>(null);
  const currentTaskRef = useRef<TaskItem | null>(null);
  const labelsRef = useRef<LabelItem[]>([]);
  const initialSearchParamsRef = useRef(new URLSearchParams(window.location.search));

  const [dashboard, setDashboard] = useState<RoomDashboard | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<EditorWorkspaceMode>("queue");
  const [currentTask, setCurrentTask] = useState<TaskItem | null>(null);
  const [payloadText, setPayloadText] = useState(JSON.stringify(createDefaultGenericPayload(), null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeInspector, setActiveInspector] = useState<"annotations" | "payload" | null>(null);
  const [submittedTasks, setSubmittedTasks] = useState<EditableSubmissionListItem[]>([]);
  const [submittedTasksLoading, setSubmittedTasksLoading] = useState(false);
  const [selectedSubmittedTaskId, setSelectedSubmittedTaskId] = useState<number | null>(null);
  const [submittedDetail, setSubmittedDetail] = useState<EditableSubmissionDetail | null>(null);
  const [reviewTasks, setReviewTasks] = useState<ReviewTaskListItem[]>([]);
  const [reviewTasksLoading, setReviewTasksLoading] = useState(false);
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState<number | null>(null);
  const [reviewDetail, setReviewDetail] = useState<ReviewTaskDetail | null>(null);
  const [selectedReviewSource, setSelectedReviewSource] = useState<"consensus" | number>("consensus");
  const [reviewFilter, setReviewFilter] = useState<ReviewTaskFilter>("validation");
  const [reviewActionBusy, setReviewActionBusy] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [noObjecting, setNoObjecting] = useState(false);
  const [editorState, setEditorState] = useState({
    annotationCount: 0,
    hasUnlabeledAnnotations: false,
  });

  function parsePositiveInt(value: string | null) {
    const parsed = Number(value || "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function syncPayloadPreview(payload: unknown, fallback = createDefaultGenericPayload()) {
    setPayloadText(JSON.stringify(payload ?? fallback, null, 2));
  }

  function getSelectedReviewPayload(detail: ReviewTaskDetail | null, source: "consensus" | number) {
    if (!detail) {
      return null;
    }
    if (source === "consensus") {
      return detail.consensus_available ? detail.consensus_payload : null;
    }
    return detail.annotations.find((annotation) => annotation.id === source)?.result_payload || null;
  }

  // The editor callbacks outlive individual renders, so refs expose the latest
  // task and labels without recreating the imperative editor on every update.
  currentTaskRef.current = currentTask;
  labelsRef.current = dashboard?.labels || [];
  const canAnnotate = Boolean(dashboard?.actor.can_annotate);
  const canReview = Boolean(dashboard?.actor.can_review);
  const selectedReviewAnnotation =
    selectedReviewSource === "consensus" ? null : reviewDetail?.annotations.find((annotation) => annotation.id === selectedReviewSource) || null;
  const selectedReviewPayload =
    workspaceMode === "review"
      ? getSelectedReviewPayload(reviewDetail, selectedReviewSource)
      : null;
  const submittedPayload = submittedDetail?.annotation.result_payload || null;
  const activeMediaPayload =
    workspaceMode === "queue" ? null : workspaceMode === "submitted" ? submittedPayload : selectedReviewPayload;
  const isReadOnlyStage =
    workspaceMode === "review" || (workspaceMode === "submitted" && Boolean(submittedDetail && !submittedDetail.editable));
  const scenario = getWorkEditorScenario(currentTask);
  const isMediaTask = Boolean(currentTask && ["image", "video"].includes(currentTask.source_type));
  const stagePlaceholderText = loading
    ? "Загружаем редактор и следующую задачу."
    : currentTask
      ? scenario.emptyStageMessage
      : workspaceMode === "queue"
        ? "Доступных задач больше нет. Можно вернуться в комнату или позже запросить новую задачу."
        : workspaceMode === "submitted"
          ? "Выбери свою отправленную разметку слева."
          : "Выбери объект для проверки слева.";
  const submitDisabled =
    submitting ||
    skipping ||
    noObjecting ||
    workspaceMode === "review" ||
    !currentTask ||
    (workspaceMode === "submitted" && Boolean(submittedDetail && !submittedDetail.editable)) ||
    (isMediaTask && !isReadOnlyStage && editorState.hasUnlabeledAnnotations);
  const roomTitle = dashboard?.room.title || (roomId ? `Комната #${roomId}` : "Рабочая среда");
  const stageTitle = currentTask
    ? currentTask.source_name || `Задача #${currentTask.id}`
      : loading
        ? "Загружаем рабочую область"
        : workspaceMode === "queue"
          ? "Очередь задач пуста"
        : workspaceMode === "submitted"
          ? "Отправленные разметки"
          : "Режим ревью";
  const completedTasks = dashboard?.annotator_stats?.completed_tasks ?? dashboard?.overview.completed_tasks ?? 0;
  const remainingTasks = dashboard?.annotator_stats?.remaining_tasks ?? dashboard?.overview.remaining_tasks ?? null;
  const quotaUsed = dashboard?.annotator_stats?.quota_used ?? completedTasks;
  const quotaTarget = dashboard?.annotator_stats?.task_quota ?? null;
  const quotaLabel =
    dashboard?.annotator_stats?.task_quota == null
      ? "Не задана"
      : `${dashboard.annotator_stats.quota_used}/${dashboard.annotator_stats.task_quota}`;
  const taskWidth = Number(currentTask?.input_payload?.width || currentTask?.input_payload?.source_width || 0);
  const taskHeight = Number(currentTask?.input_payload?.height || currentTask?.input_payload?.source_height || 0);
  const taskDimensionsLabel = taskWidth > 0 && taskHeight > 0 ? `${taskWidth}×${taskHeight}` : null;
  const taskFrameValue =
    currentTask?.input_payload?.frame_number ?? currentTask?.input_payload?.frame_index ?? currentTask?.input_payload?.frame ?? null;
  const videoFrameContext = currentTask?.video_frame_context || null;
  const summaryMeta = currentTask ? `#${currentTask.id} / ${roomTitle}` : roomTitle;
  const submitButtonLabel =
    workspaceMode === "queue"
      ? submitting
        ? "Отправляем..."
        : currentTask
          ? "Отправить"
          : "Нет задачи"
      : submitting
        ? "Сохраняем..."
        : submittedDetail?.editable
          ? "Сохранить изменения"
          : "Только чтение";

  function toggleInspector(nextInspector: "annotations" | "payload") {
    setActiveInspector((current) => (current === nextInspector ? null : nextInspector));
  }

  useEffect(() => {
    if (
      !mediaToolRef.current ||
      !labelPaletteRef.current ||
      !mediaStageRef.current ||
      !annotationListRef.current ||
      !resultJsonRef.current ||
      !resultLabelRef.current
    ) {
      return;
    }

    const controller = createMediaAnnotationEditor({
      mediaTool: mediaToolRef.current,
      labelPalette: labelPaletteRef.current,
      zoomToolbar: zoomToolbarRef.current,
      zoomRange: zoomRangeRef.current,
      zoomResetBtn: zoomResetBtnRef.current,
      mediaStage: mediaStageRef.current,
      annotationList: annotationListRef.current,
      clearBtn: clearAnnotationsBtnRef.current,
      resultJson: resultJsonRef.current,
      resultLabel: resultLabelRef.current,
      submitBtn: null,
      getLabels: () => labelsRef.current,
      getTask: () => currentTaskRef.current,
      showToast: (message, type) => addToast(message, type || "info"),
      onPayloadChange: (payload) => setPayloadText(JSON.stringify(payload, null, 2)),
      onStateChange: setEditorState,
    });
    mediaEditorRef.current = controller;

    return () => {
      controller.destroy();
      mediaEditorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mediaEditorRef.current) {
      return;
    }

    if (currentTask && ["image", "video"].includes(currentTask.source_type)) {
      mediaEditorRef.current.loadTaskWithPayload(currentTask, activeMediaPayload, {
        readOnly: isReadOnlyStage,
        placeholderText: stagePlaceholderText,
      });
      return;
    }

    mediaEditorRef.current.reset(stagePlaceholderText);
    if (workspaceMode === "review" && mediaToolRef.current) {
      mediaToolRef.current.classList.remove("hidden");
    }
  }, [activeMediaPayload, currentTask, isReadOnlyStage, stagePlaceholderText, workspaceMode]);

  async function loadDashboard() {
    if (!roomId) {
      addToast("Не удалось определить ID комнаты из URL.", "error");
      return null;
    }

    try {
      const nextDashboard = await api<RoomDashboard>(`/api/v1/rooms/${roomId}/dashboard/`);
      setDashboard(nextDashboard);
      if (!nextDashboard.actor.can_annotate && !nextDashboard.actor.can_review) {
        addToast("Рабочая среда доступна только участникам комнаты с правами разметки или проверки.", "error");
        window.setTimeout(() => {
          window.location.href = `/rooms/${roomId}/`;
        }, 900);
        return null;
      }
      return nextDashboard;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      return null;
    }
  }

  async function loadNextTask(emptyMessage?: string) {
    if (!roomId) {
      return null;
    }

    try {
      const task = await api<TaskItem | null>(`/api/v1/rooms/${roomId}/tasks/next/`);
      setCurrentTask(task);
      if (!task) {
        if (emptyMessage) {
          addToast(emptyMessage, "success");
        }
        syncPayloadPreview(createDefaultGenericPayload());
        return null;
      }

      if (!["image", "video"].includes(task.source_type)) {
        syncPayloadPreview(createDefaultGenericPayload());
      }

      return task;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      return null;
    }
  }

  async function loadSubmittedTasksList() {
    if (!roomId) {
      return [];
    }

    setSubmittedTasksLoading(true);
    try {
      const nextTasks = await api<EditableSubmissionListItem[]>(`/api/v1/rooms/${roomId}/tasks/submitted/mine/`);
      setSubmittedTasks(nextTasks || []);
      return nextTasks || [];
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setSubmittedTasks([]);
      return [];
    } finally {
      setSubmittedTasksLoading(false);
    }
  }

  async function loadSubmittedDetail(taskId: number) {
    try {
      const detail = await api<EditableSubmissionDetail>(`/api/v1/tasks/${taskId}/my-submission/`);
      setSubmittedDetail(detail);
      setCurrentTask(detail.task);
      syncPayloadPreview(detail.annotation.result_payload);
      return detail;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setSubmittedDetail(null);
      setCurrentTask(null);
      syncPayloadPreview(createDefaultGenericPayload());
      return null;
    }
  }

  async function loadReviewTasksList(nextFilter = reviewFilter) {
    if (!roomId) {
      return [];
    }

    setReviewTasksLoading(true);
    try {
      const nextTasks = await api<ReviewTaskListItem[]>(`/api/v1/rooms/${roomId}/review/tasks/?filter=${nextFilter}`);
      setReviewTasks(nextTasks || []);
      return nextTasks || [];
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setReviewTasks([]);
      return [];
    } finally {
      setReviewTasksLoading(false);
    }
  }

  async function loadReviewDetail(taskId: number, requestedAnnotatorId?: number | null) {
    try {
      const detail = await api<ReviewTaskDetail>(`/api/v1/tasks/${taskId}/review/`);
      const fallbackSource = detail.consensus_available ? "consensus" : detail.annotations[0]?.id || "consensus";
      const initialSource =
        requestedAnnotatorId && detail.annotations.some((annotation) => annotation.annotator_id === requestedAnnotatorId)
          ? detail.annotations.find((annotation) => annotation.annotator_id === requestedAnnotatorId)?.id || "consensus"
          : fallbackSource;
      setReviewDetail(detail);
      setSelectedReviewSource(initialSource);
      setCurrentTask(detail.task);
      syncPayloadPreview(getSelectedReviewPayload(detail, initialSource), null);
      return detail;
    } catch (error) {
      addToast(getErrorMessage(error), "error");
      setReviewDetail(null);
      setSelectedReviewSource("consensus");
      setCurrentTask(null);
      syncPayloadPreview(createDefaultGenericPayload());
      return null;
    }
  }

  async function activateWorkspaceMode(
    nextMode: EditorWorkspaceMode,
    options?: { taskId?: number | null; annotatorId?: number | null }
  ) {
    setWorkspaceMode(nextMode);
    setActiveInspector(null);
    setSubmitting(false);
    setCurrentTask(null);
    setLoading(true);

    if (nextMode !== "submitted") {
      setSubmittedDetail(null);
      setSelectedSubmittedTaskId(null);
    }
    if (nextMode !== "review") {
      setReviewDetail(null);
      setSelectedReviewTaskId(null);
      setSelectedReviewSource("consensus");
    }

    try {
      if (nextMode === "queue") {
        await loadNextTask("Доступных задач больше нет.");
        replaceEditorUrlQuery({ mode: "queue" });
        return;
      }

      if (nextMode === "submitted") {
        const nextTasks = await loadSubmittedTasksList();
        const fallbackTaskId = nextTasks[0]?.id || null;
        const nextTaskId = options?.taskId && nextTasks.some((task) => task.id === options.taskId) ? options.taskId : fallbackTaskId;
        setSelectedSubmittedTaskId(nextTaskId || null);
        if (nextTaskId) {
          await loadSubmittedDetail(nextTaskId);
        } else {
          setCurrentTask(null);
          syncPayloadPreview(createDefaultGenericPayload());
        }
        replaceEditorUrlQuery({ mode: "submitted", taskId: nextTaskId || null });
        return;
      }

      const nextTasks = await loadReviewTasksList();
      const fallbackTaskId = nextTasks[0]?.id || null;
      const nextTaskId = options?.taskId && nextTasks.some((task) => task.id === options.taskId) ? options.taskId : fallbackTaskId;
      setSelectedReviewTaskId(nextTaskId || null);
      if (nextTaskId) {
        await loadReviewDetail(nextTaskId, options?.annotatorId || null);
        replaceEditorUrlQuery({ mode: "review", taskId: nextTaskId, annotatorId: options?.annotatorId || null });
      } else {
        setCurrentTask(null);
        syncPayloadPreview(createDefaultGenericPayload());
        replaceEditorUrlQuery({ mode: "review" });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function initialize() {
      const nextDashboard = await loadDashboard();
      if (!nextDashboard) {
        setLoading(false);
        return;
      }

      const nextMode = normalizeEditorWorkspaceMode(initialSearchParamsRef.current.get("mode"), {
        canAnnotate: nextDashboard.actor.can_annotate,
        canReview: nextDashboard.actor.can_review,
      });
      await activateWorkspaceMode(nextMode, {
        taskId: parsePositiveInt(initialSearchParamsRef.current.get("task")),
        annotatorId: parsePositiveInt(initialSearchParamsRef.current.get("annotator")),
      });
    }

    initialize();
  }, []);

  async function refreshDashboardSnapshot() {
    return loadDashboard();
  }

  async function handleModeSwitch(nextMode: EditorWorkspaceMode) {
    if ((nextMode === "queue" || nextMode === "submitted") && !canAnnotate) {
      return;
    }
    if (nextMode === "review" && !canReview) {
      return;
    }
    await activateWorkspaceMode(nextMode);
  }

  async function handleSelectSubmittedTask(taskId: number) {
    setSelectedSubmittedTaskId(taskId);
    setLoading(true);
    try {
      await loadSubmittedDetail(taskId);
      replaceEditorUrlQuery({ mode: "submitted", taskId });
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectReviewTask(taskId: number) {
    setSelectedReviewTaskId(taskId);
    setLoading(true);
    try {
      await loadReviewDetail(taskId);
      replaceEditorUrlQuery({ mode: "review", taskId });
    } finally {
      setLoading(false);
    }
  }

  async function handleReviewFilterChange(nextFilter: ReviewTaskFilter) {
    if (reviewFilter === nextFilter) {
      return;
    }

    setReviewFilter(nextFilter);
    if (workspaceMode !== "review") {
      return;
    }

    setSelectedReviewTaskId(null);
    setReviewDetail(null);
    setSelectedReviewSource("consensus");
    setCurrentTask(null);
    setLoading(true);
    try {
      const nextTasks = await loadReviewTasksList(nextFilter);
      const nextTaskId = nextTasks[0]?.id || null;
      setSelectedReviewTaskId(nextTaskId);
      if (nextTaskId) {
        await loadReviewDetail(nextTaskId);
        replaceEditorUrlQuery({ mode: "review", taskId: nextTaskId });
      } else {
        syncPayloadPreview(createDefaultGenericPayload());
        replaceEditorUrlQuery({ mode: "review" });
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSelectReviewSource(nextSource: "consensus" | number) {
    setSelectedReviewSource(nextSource);
    syncPayloadPreview(getSelectedReviewPayload(reviewDetail, nextSource), null);
    replaceEditorUrlQuery({
      mode: "review",
      taskId: selectedReviewTaskId,
      annotatorId:
        nextSource === "consensus"
          ? null
          : reviewDetail?.annotations.find((annotation) => annotation.id === nextSource)?.annotator_id || null,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workspaceMode === "review") {
      return;
    }
    if (!currentTask) {
      addToast("Подожди загрузки задачи.", "error");
      return;
    }

    clearToasts();
    setSubmitting(true);

    try {
      let payload: Record<string, any>;
      if (["image", "video"].includes(currentTask.source_type)) {
        if (!isReadOnlyStage && mediaEditorRef.current?.hasUnlabeledAnnotations()) {
          throw new Error("Назначь лейблы всем выделенным областям перед отправкой.");
        }
        payload = mediaEditorRef.current?.getPayload() || { annotations: [] };
      } else {
        payload = JSON.parse(payloadText);
      }

      if (workspaceMode === "queue") {
        const completedTaskId = currentTask.id;
        await api(`/api/v1/tasks/${currentTask.id}/submit/`, {
          method: "POST",
          body: { result_payload: payload },
        });
        setCurrentTask(null);
        await refreshDashboardSnapshot();
        const nextTask = await loadNextTask();
        if (!nextTask) {
          addToast(`Задача #${completedTaskId} успешно размечена. Доступных задач больше нет.`, "success");
        } else {
          addToast(`Задача #${completedTaskId} успешно размечена. Следующая задача уже готова.`, "success");
        }
      } else {
        await api(`/api/v1/tasks/${currentTask.id}/my-submission/`, {
          method: "PUT",
          body: { result_payload: payload },
        });
        await refreshDashboardSnapshot();
        const nextTasks = await loadSubmittedTasksList();
        const activeTaskId =
          selectedSubmittedTaskId && nextTasks.some((task) => task.id === selectedSubmittedTaskId)
            ? selectedSubmittedTaskId
            : nextTasks[0]?.id || null;
        setSelectedSubmittedTaskId(activeTaskId);
        if (activeTaskId) {
          await loadSubmittedDetail(activeTaskId);
          replaceEditorUrlQuery({ mode: "submitted", taskId: activeTaskId });
        }
        addToast(`Изменения по задаче #${currentTask.id} сохранены.`, "success");
      }
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkipTask() {
    if (workspaceMode !== "queue" || !currentTask || !["image", "video"].includes(currentTask.source_type)) {
      return;
    }

    clearToasts();
    setSkipping(true);
    try {
      const skippedTaskId = currentTask.id;
      await api(`/api/v1/tasks/${currentTask.id}/skip/`, {
        method: "POST",
        body: {},
      });
      setCurrentTask(null);
      await refreshDashboardSnapshot();
      const nextTask = await loadNextTask();
      addToast(
        nextTask
          ? `Задача #${skippedTaskId} пропущена. Следующая задача уже готова.`
          : `Задача #${skippedTaskId} пропущена. Доступных задач больше нет.`,
        "success"
      );
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setSkipping(false);
    }
  }

  async function handleNoObjectTask() {
    if (workspaceMode !== "queue" || !currentTask || !isMediaTask) {
      return;
    }

    clearToasts();
    setNoObjecting(true);
    try {
      const completedTaskId = currentTask.id;
      await api(`/api/v1/tasks/${currentTask.id}/submit/`, {
        method: "POST",
        body: { result_payload: { annotations: [], frame_state: "no_object" } },
      });
      setCurrentTask(null);
      await refreshDashboardSnapshot();
      const nextTask = await loadNextTask();
      addToast(
        nextTask
          ? `Задача #${completedTaskId}: объекта нет. Следующая задача уже готова.`
          : `Задача #${completedTaskId}: объекта нет. Доступных задач больше нет.`,
        "success"
      );
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setNoObjecting(false);
    }
  }

  async function handleReturnForRevision() {
    if (!reviewDetail?.task.id || !selectedReviewAnnotation) {
      return;
    }

    const shouldReturn = window.confirm(
      `Вернуть разметку автору ${selectedReviewAnnotation.annotator_display_name} на исправление?`
    );
    if (!shouldReturn) {
      return;
    }

    clearToasts();
    setReviewActionBusy(`return-${selectedReviewAnnotation.annotator_id}`);
    try {
      await api(`/api/v1/tasks/${reviewDetail.task.id}/return-for-revision/`, {
        method: "POST",
        body: { annotator_id: selectedReviewAnnotation.annotator_id },
      });
      await refreshDashboardSnapshot();
      addToast(`Задача #${reviewDetail.task.id} возвращена автору на исправление.`, "success");
      await activateWorkspaceMode("review");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setReviewActionBusy(null);
    }
  }

  async function handleValidationVote(decision: "approve" | "reject") {
    if (!reviewDetail?.task.id || !reviewDetail.can_vote) {
      return;
    }

    clearToasts();
    setReviewActionBusy(`vote-${decision}`);
    try {
      await api(`/api/v1/tasks/${reviewDetail.task.id}/validation-vote/`, {
        method: "POST",
        body: { decision },
      });
      await refreshDashboardSnapshot();
      addToast(
        decision === "approve"
          ? `Голос за принятие задачи #${reviewDetail.task.id} учтён.`
          : `Голос за отклонение задачи #${reviewDetail.task.id} учтён.`,
        "success"
      );
      await activateWorkspaceMode("review", { taskId: reviewDetail.task.id });
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setReviewActionBusy(null);
    }
  }

  async function handleRejectTask() {
    if (!reviewDetail?.task.id) {
      return;
    }

    const shouldReject = window.confirm(
      "Отклонить эту разметку? Задача будет исключена из итоговой выборки и отправлена на повторную разметку."
    );
    if (!shouldReject) {
      return;
    }

    clearToasts();
    setReviewActionBusy("reject");
    try {
      await api(`/api/v1/tasks/${reviewDetail.task.id}/reject/`, {
        method: "POST",
        body: {},
      });
      await refreshDashboardSnapshot();
      addToast(`Разметка по задаче #${reviewDetail.task.id} отклонена.`, "success");
      await activateWorkspaceMode("review");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setReviewActionBusy(null);
    }
  }

  async function handleGeneratedDecision(decision: "approve" | "reject" | "no-object") {
    if (!reviewDetail?.task.id || reviewDetail.review_outcome !== "generated") {
      return;
    }

    clearToasts();
    setReviewActionBusy(`generated-${decision}`);
    try {
      await api(`/api/v1/tasks/${reviewDetail.task.id}/generated/${decision === "no-object" ? "no-object" : decision}/`, {
        method: "POST",
        body: {},
      });
      await refreshDashboardSnapshot();
      addToast(
        decision === "approve"
          ? `Сгенерированная разметка задачи #${reviewDetail.task.id} принята.`
          : decision === "no-object"
            ? `Задача #${reviewDetail.task.id} отмечена как кадр без объекта.`
            : `Сгенерированная разметка задачи #${reviewDetail.task.id} отправлена на ручную правку.`,
        "success"
      );
      await activateWorkspaceMode("review");
    } catch (error) {
      addToast(getErrorMessage(error), "error");
    } finally {
      setReviewActionBusy(null);
    }
  }

  return (
    <form ref={formRef} className="room-editor" onSubmit={handleSubmit}>
      <header className="room-editor__topbar">
        <div className="room-editor__identity">
          <a className="room-editor__home-link" href="/" aria-label="Вернуться на сайт">
            DS
          </a>
          <a className="btn btn--muted btn--compact" href={roomId ? `/rooms/${roomId}/` : "/rooms/"}>
            Назад
          </a>
          <div className="room-editor__summary">
            <strong>{stageTitle}</strong>
            <small>{summaryMeta}</small>
          </div>
        </div>

        <div className="room-editor__actions">
          <div className="room-editor__action-group room-editor__tabs" aria-label="Режим работы">
            {canAnnotate ? (
              <button
                className={`btn btn--muted btn--compact ${workspaceMode === "queue" ? "is-active" : ""}`}
                type="button"
                onClick={() => handleModeSwitch("queue")}
              >
                Задача
              </button>
            ) : null}
            {canAnnotate ? (
              <button
                className={`btn btn--muted btn--compact ${workspaceMode === "submitted" ? "is-active" : ""}`}
                type="button"
                onClick={() => handleModeSwitch("submitted")}
              >
                Отправленные
              </button>
            ) : null}
            {canReview ? (
              <button
                className={`btn btn--muted btn--compact ${workspaceMode === "review" ? "is-active" : ""}`}
                type="button"
                onClick={() => handleModeSwitch("review")}
              >
                Ревью
              </button>
            ) : null}
          </div>
          <div className="room-editor__action-group room-editor__action-group--inspect" aria-label="Панели редактора">
            <button className={`btn btn--muted btn--compact ${activeInspector === "annotations" ? "is-active" : ""}`} type="button" onClick={() => toggleInspector("annotations")}>
              Области{editorState.annotationCount ? ` ${editorState.annotationCount}` : ""}
            </button>
            <button className={`btn btn--muted btn--compact ${activeInspector === "payload" ? "is-active" : ""}`} type="button" onClick={() => toggleInspector("payload")}>
              JSON
            </button>
          </div>
          {workspaceMode === "review" ? null : (
            <div className="room-editor__action-group room-editor__action-group--submit" aria-label="Действия с задачей">
              {workspaceMode === "queue" && isMediaTask && currentTask ? (
                <>
                  <button className="btn btn--secondary btn--compact" type="button" disabled={submitting || skipping || noObjecting} onClick={handleNoObjectTask}>
                    {noObjecting ? "Отмечаем..." : "Объекта нет"}
                  </button>
                  <button className="btn btn--muted btn--compact" type="button" disabled={submitting || skipping || noObjecting} onClick={handleSkipTask}>
                    {skipping ? "Пропускаем..." : "Пропустить"}
                  </button>
                </>
              ) : null}
              <button className="btn btn--primary btn--compact room-editor__submit" type="submit" disabled={submitDisabled}>
                {submitButtonLabel}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="room-editor__body">
        <aside className="room-editor__taskrail">
          {workspaceMode === "queue" ? (
            <section className="editor-sidepanel editor-sidepanel--task-meta">
              <div className="editor-sidepanel__head">
                <span className="editor-panel__title">Задача</span>
                {quotaTarget == null ? null : <span className="editor-chip editor-chip--ghost">{quotaUsed}/{quotaTarget}</span>}
              </div>
              <div className="room-editor__meta-stack">
                <div className="room-editor__metric-row">
                  <span>Использовано</span>
                  <strong>{quotaTarget == null ? quotaUsed : `${quotaUsed}/${quotaTarget}`}</strong>
                </div>
                <div className="room-editor__metric-row">
                  <span>Осталось</span>
                  <strong>{remainingTasks == null ? "Не задано" : remainingTasks}</strong>
                </div>
                <div className="room-editor__metric-row">
                  <span>Квота</span>
                  <strong>{quotaLabel}</strong>
                </div>
              </div>

              {currentTask ? (
                <div className="room-editor__meta-stack room-editor__meta-stack--task">
                  <div className="room-editor__meta-row">
                    <span>Объект</span>
                    <strong>{currentTask.source_name || "Без названия"}</strong>
                  </div>
                  <div className="room-editor__meta-row">
                    <span>Номер</span>
                    <strong>#{currentTask.id}</strong>
                  </div>
                  <div className="room-editor__meta-row">
                    <span>Тип</span>
                    <strong>{translateSourceType(currentTask.source_type)}</strong>
                  </div>
                  <div className="room-editor__meta-row">
                    <span>Этап</span>
                    <strong>{translateWorkflowStage(currentTask.workflow_stage)}</strong>
                  </div>
                  <div className="room-editor__meta-row">
                    <span>Раунд</span>
                    <strong>{currentTask.current_round}</strong>
                  </div>
                  {taskDimensionsLabel ? (
                    <div className="room-editor__meta-row">
                      <span>Размер</span>
                      <strong>{taskDimensionsLabel}</strong>
                    </div>
                  ) : null}
                  {taskFrameValue == null || taskFrameValue === "" ? null : (
                    <div className="room-editor__meta-row">
                      <span>Кадр</span>
                      <strong>{taskFrameValue}</strong>
                    </div>
                  )}
                  {videoFrameContext ? (
                    <>
                      <div className="room-editor__meta-row">
                        <span>Видео</span>
                        <strong>{videoFrameContext.video_name}</strong>
                      </div>
                      <div className="room-editor__meta-row">
                        <span>Время</span>
                        <strong>{Number(videoFrameContext.current.timestamp || 0).toFixed(3)} c</strong>
                      </div>
                      <div className="room-editor__meta-row">
                        <span>Статус кадра</span>
                        <strong>{translateVideoFrameState(videoFrameContext.current.state)}</strong>
                      </div>
                    </>
                  ) : null}
                  <div className="editor-sidepanel__note">
                    После отправки редактор сразу запросит следующий объект из очереди.
                  </div>
                </div>
              ) : (
                <div className="empty-card">Активных задач сейчас нет. Можно вернуться в комнату или позже обновить экран.</div>
              )}
            </section>
          ) : null}

          {workspaceMode === "submitted" ? (
            <section className="editor-sidepanel">
              <div className="editor-sidepanel__head">
                <span className="editor-panel__title">Отправленные</span>
                <span className="editor-chip editor-chip--ghost">{submittedTasks.length}</span>
              </div>
              <div className="room-editor__tasklist">
                {submittedTasksLoading ? (
                  <div className="empty-card">Загружаем твои отправленные разметки.</div>
                ) : submittedTasks.length ? (
                  submittedTasks.map((task) => (
                    <button
                      key={task.id}
                      className={`room-editor__taskitem ${task.id === selectedSubmittedTaskId ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleSelectSubmittedTask(task.id)}
                    >
                      <strong>{task.source_name || `Задача #${task.id}`}</strong>
                      <span>Раунд {task.current_round}</span>
                      <small>{task.editable ? "Можно править" : task.editable_reason || "Только чтение"}</small>
                    </button>
                  ))
                ) : (
                  <div className="empty-card">У тебя пока нет отправленных разметок, которые можно открыть в редакторе.</div>
                )}
              </div>
              {submittedDetail && !submittedDetail.editable ? (
                <div className="editor-sidepanel__note">{submittedDetail.editable_reason || "Эта разметка уже зафинализирована."}</div>
              ) : null}
            </section>
          ) : null}

          {workspaceMode === "review" ? (
            <section className="editor-sidepanel">
              <div className="editor-sidepanel__head">
                <span className="editor-panel__title">Ревью</span>
                <span className="editor-chip editor-chip--ghost">{reviewTasks.length}</span>
              </div>
              <div className="room-editor__tasklist">
                {reviewTasksLoading ? (
                  <div className="empty-card">Загружаем объекты для проверки.</div>
                ) : reviewTasks.length ? (
                  reviewTasks.map((task) => (
                    <button
                      key={task.id}
                      className={`room-editor__taskitem ${task.id === selectedReviewTaskId ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleSelectReviewTask(task.id)}
                    >
                      <strong>{task.source_name || `Задача #${task.id}`}</strong>
                      <span>{translateReviewOutcome(task.review_outcome)}</span>
                      <small>
                        {task.review_outcome === "validation"
                          ? `${task.validation_votes_count}/${task.validation_votes_required} голосов`
                          : task.review_outcome === "generated" && task.tracking_confidence != null
                            ? `Автотрекинг ${Math.round(task.tracking_confidence * 100)}%`
                          : `${task.submitted_annotations_count}/${task.required_annotations_count || 0} разметок`}
                      </small>
                    </button>
                  ))
                ) : (
                  <div className="empty-card">Сейчас нет объектов, которые нужно просмотреть в режиме ревью.</div>
                )}
              </div>

              {reviewDetail ? (
                <>
                  <div className="editor-sidepanel__section">
                    <div className="editor-sidepanel__label">Голосование</div>
                    <div className="room-editor__meta-stack">
                      <div className="room-editor__meta-row">
                        <span>Статус</span>
                        <strong>{translateReviewOutcome(reviewDetail.review_outcome)}</strong>
                      </div>
                      {reviewDetail.video_frame_state ? (
                        <div className="room-editor__meta-row">
                          <span>Кадр</span>
                          <strong>{translateVideoFrameState(reviewDetail.video_frame_state)}</strong>
                        </div>
                      ) : null}
                      <div className="room-editor__meta-row">
                        <span>Голоса</span>
                        <strong>
                          {reviewDetail.validation_votes_count}/{reviewDetail.validation_votes_required}
                        </strong>
                      </div>
                      <div className="room-editor__meta-row">
                        <span>За / против</span>
                        <strong>
                          {reviewDetail.validation_approve_votes_count}/{reviewDetail.validation_reject_votes_count}
                        </strong>
                      </div>
                      <div className="room-editor__meta-row">
                        <span>Порог</span>
                        <strong>{reviewDetail.validation_acceptance_threshold}%</strong>
                      </div>
                      <div className="room-editor__meta-row">
                        <span>Мой голос</span>
                        <strong>
                          {reviewDetail.actor_validation_vote === "approve"
                            ? "Принять"
                            : reviewDetail.actor_validation_vote === "reject"
                              ? "Отклонить"
                              : "Не голосовал"}
                        </strong>
                      </div>
                    </div>
                    {reviewDetail.trajectory_warnings?.length ? (
                      <div className="editor-sidepanel__note">
                        Проверь траекторию: {reviewDetail.trajectory_warnings.map((item) => translateVideoFrameState(item)).join(", ")}
                      </div>
                    ) : null}
                    {reviewDetail.tracking_confidence != null ? (
                      <div className="editor-sidepanel__note">
                        Уверенность автотрекинга: {Math.round(reviewDetail.tracking_confidence * 100)}%
                      </div>
                    ) : null}
                  </div>

                  <div className="editor-sidepanel__section">
                    <div className="editor-sidepanel__label">
                      Источник разметки · {reviewDetail.submitted_annotations_count}/{reviewDetail.required_annotations_count || 0}
                    </div>
                    <div className="room-editor__source-switcher">
                      {reviewDetail.consensus_available ? (
                        <button
                          className={`room-editor__source-chip ${selectedReviewSource === "consensus" ? "is-active" : ""}`}
                          type="button"
                          onClick={() => handleSelectReviewSource("consensus")}
                        >
                          Итоговая
                        </button>
                      ) : null}
                      {reviewDetail.annotations.map((annotation) => (
                        <button
                          key={annotation.id}
                          className={`room-editor__source-chip ${selectedReviewSource === annotation.id ? "is-active" : ""}`}
                          type="button"
                          onClick={() => handleSelectReviewSource(annotation.id)}
                        >
                          {annotation.annotator_display_name} · R{annotation.round_number}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="editor-sidepanel__actions">
                    {reviewDetail.review_outcome === "generated" ? (
                      <>
                        <button className="btn btn--primary btn--compact" type="button" disabled={Boolean(reviewActionBusy)} onClick={() => handleGeneratedDecision("approve")}>
                          {reviewActionBusy === "generated-approve" ? "Принимаем..." : "Принять"}
                        </button>
                        <button className="btn btn--secondary btn--compact" type="button" disabled={Boolean(reviewActionBusy)} onClick={() => handleGeneratedDecision("no-object")}>
                          {reviewActionBusy === "generated-no-object" ? "Отмечаем..." : "Объекта нет"}
                        </button>
                        <button className="btn btn--danger btn--compact" type="button" disabled={Boolean(reviewActionBusy)} onClick={() => handleGeneratedDecision("reject")}>
                          {reviewActionBusy === "generated-reject" ? "Возвращаем..." : "В ручную правку"}
                        </button>
                      </>
                    ) : null}
                    {reviewDetail.can_vote ? (
                      <>
                        <button
                          className="btn btn--primary btn--compact"
                          type="button"
                          disabled={Boolean(reviewActionBusy)}
                          onClick={() => handleValidationVote("approve")}
                        >
                          {reviewActionBusy === "vote-approve" ? "Голосуем..." : "Принять"}
                        </button>
                        <button
                          className="btn btn--danger btn--compact"
                          type="button"
                          disabled={Boolean(reviewActionBusy)}
                          onClick={() => handleValidationVote("reject")}
                        >
                          {reviewActionBusy === "vote-reject" ? "Голосуем..." : "Отклонить"}
                        </button>
                      </>
                    ) : null}
                    {selectedReviewAnnotation ? (
                      <button
                        className="btn btn--secondary btn--compact"
                        type="button"
                        disabled={Boolean(reviewActionBusy)}
                        onClick={handleReturnForRevision}
                      >
                        {reviewActionBusy === `return-${selectedReviewAnnotation.annotator_id}` ? "Возвращаем..." : "Вернуть автору"}
                      </button>
                    ) : null}
                    {reviewDetail.can_reject_all ? (
                      <button className="btn btn--danger btn--compact" type="button" disabled={Boolean(reviewActionBusy)} onClick={handleRejectTask}>
                        {reviewActionBusy === "reject" ? "Отклоняем..." : "Отклонить итог"}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </aside>

        <section className="room-editor__stage">
          <div className="room-editor__canvas-shell">
            <div className="room-editor__stage-surface">
              <div ref={mediaStageRef} className="media-stage empty-card">
                {stagePlaceholderText}
              </div>
            </div>

            <div ref={mediaToolRef} className={isMediaTask || workspaceMode === "review" ? "editor-toolbar" : "editor-toolbar hidden"}>
              <div className="editor-toolbar__frame">
                {workspaceMode === "review" ? (
                  <div className="room-editor__review-filters" role="group" aria-label="Фильтр проверки">
                    <button
                      className={`room-editor__filter-chip ${reviewFilter === "validation" ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleReviewFilterChange("validation")}
                    >
                      Голосование
                    </button>
                    <button
                      className={`room-editor__filter-chip ${reviewFilter === "validation_voted" ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleReviewFilterChange("validation_voted")}
                    >
                      Проверено мной
                    </button>
                    <button
                      className={`room-editor__filter-chip ${reviewFilter === "generated" ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleReviewFilterChange("generated")}
                    >
                      Сгенерированные
                    </button>
                    <button
                      className={`room-editor__filter-chip ${reviewFilter === "final" ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleReviewFilterChange("final")}
                    >
                      Финальные
                    </button>
                    <button
                      className={`room-editor__filter-chip ${reviewFilter === "incomplete" ? "is-active" : ""}`}
                      type="button"
                      onClick={() => handleReviewFilterChange("incomplete")}
                    >
                      Неполные
                    </button>
                  </div>
                ) : null}
                {videoFrameContext ? (
                  <div className="room-editor__frame-strip" aria-label="Контекст кадров видео">
                    {[videoFrameContext.previous, videoFrameContext.current, videoFrameContext.next].filter(Boolean).map((frame: any) => (
                      <div
                        key={`${frame.task_id}-${frame.frame_number}`}
                        className={`room-editor__frame-chip ${frame.task_id === currentTask?.id ? "is-active" : ""}`}
                        title={translateVideoFrameState(frame.state)}
                      >
                        <strong>#{frame.frame_number}</strong>
                        <span>{Number(frame.timestamp || 0).toFixed(2)} c</span>
                        <small>{translateVideoFrameState(frame.state)}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div ref={labelPaletteRef} className={`label-chip-list editor-label-palette ${workspaceMode === "review" ? "hidden" : ""}`}></div>
              </div>
              <div ref={zoomToolbarRef} className={isMediaTask ? "editor-toolbar__zoom" : "editor-toolbar__zoom hidden"}>
                <div className="media-zoom">
                  <button ref={zoomResetBtnRef} className="editor-zoom-btn editor-zoom-btn--value" type="button">
                    100%
                  </button>
                  <input ref={zoomRangeRef} className="media-zoom__range" type="range" min="100" max="400" step="25" defaultValue="100" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className={`room-editor__inspector ${activeInspector ? "is-open" : ""}`}>
          <section className={activeInspector === "annotations" ? "editor-panel" : "editor-panel hidden"}>
            <div className="editor-panel__head">
              <span className="editor-panel__title">
                {scenario.annotationsTitle}
                {editorState.annotationCount ? ` (${editorState.annotationCount})` : ""}
              </span>
              <div className="editor-panel__actions">
                <button
                  ref={clearAnnotationsBtnRef}
                  className={`btn btn--muted btn--compact ${editorState.annotationCount && currentTask?.workflow_stage !== "text_transcription" ? "" : "hidden"}`}
                  type="button"
                >
                  Очистить
                </button>
              </div>
            </div>
            <div ref={annotationListRef} className="annotation-list empty-card">
              Разметка пока отсутствует.
            </div>
          </section>

          <section className={activeInspector === "payload" ? "editor-panel" : "editor-panel hidden"}>
            <div className="editor-panel__head">
              <span className="editor-panel__title">Результат</span>
            </div>
            <label className="field editor-field editor-field--payload">
              <span ref={resultLabelRef}>Результат разметки</span>
              <textarea
                ref={resultJsonRef}
                rows={16}
                value={payloadText}
                readOnly={Boolean(currentTask && isMediaTask) || isReadOnlyStage}
                onChange={(event) => setPayloadText(event.currentTarget.value)}
              ></textarea>
            </label>
            {bootstrap.app_debug_mode && currentTask ? (
              <pre className="payload-preview room-editor__debug">{JSON.stringify(currentTask.input_payload, null, 2)}</pre>
            ) : null}
          </section>
        </aside>
      </div>
    </form>
  );
}

createRoot(document.getElementById("app-root")!).render(<App />);
