const mockUsers = JSON.parse(document.getElementById("mock-users-data").textContent);

const state = {
  user: null,
  rooms: [],
  selectedRoom: null,
  currentTask: null,
};

const roleLabels = {
  customer: "Заказчик",
  annotator: "Разметчик",
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

const elements = {
  userPicker: document.getElementById("user-picker"),
  userIdInput: document.getElementById("user-id-input"),
  useUserBtn: document.getElementById("use-user-btn"),
  currentUserCard: document.getElementById("current-user-card"),
  roomsList: document.getElementById("rooms-list"),
  roomsEmpty: document.getElementById("rooms-empty"),
  roomDetail: document.getElementById("room-detail"),
  roomRoleBadge: document.getElementById("room-role-badge"),
  customerTools: document.getElementById("customer-tools"),
  annotatorTools: document.getElementById("annotator-tools"),
  createRoomForm: document.getElementById("create-room-form"),
  inviteForm: document.getElementById("invite-form"),
  joinRoomBtn: document.getElementById("join-room-btn"),
  nextTaskBtn: document.getElementById("next-task-btn"),
  taskCard: document.getElementById("task-card"),
  submitTaskForm: document.getElementById("submit-task-form"),
  resultPayloadInput: document.getElementById("result-payload-input"),
  requestLog: document.getElementById("request-log"),
  flashBox: document.getElementById("flash-box"),
  refreshRoomsBtn: document.getElementById("refresh-rooms-btn"),
  clearLogBtn: document.getElementById("clear-log-btn"),
};

function translateRole(role) {
  return roleLabels[role] || role;
}

function translateMembership(status) {
  return membershipLabels[status] || status;
}

function translateTaskStatus(status) {
  return taskStatusLabels[status] || status;
}

function log(message, payload) {
  const timestamp = new Date().toLocaleTimeString();
  const renderedPayload = payload ? `\n${JSON.stringify(payload, null, 2)}` : "";
  elements.requestLog.textContent = `[${timestamp}] ${message}${renderedPayload}\n\n${elements.requestLog.textContent}`;
}

function showFlash(message, type = "success") {
  elements.flashBox.className = `flash-box flash-box--${type}`;
  elements.flashBox.textContent = message;
  elements.flashBox.classList.remove("hidden");
}

function clearFlash() {
  elements.flashBox.classList.add("hidden");
  elements.flashBox.textContent = "";
}

function getStoredUserId() {
  return window.localStorage.getItem("datasetai-user-id");
}

function setStoredUserId(userId) {
  window.localStorage.setItem("datasetai-user-id", String(userId));
}

function detectUserById(userId) {
  const numericId = Number(userId);
  return mockUsers.find((user) => user.id === numericId) || {
    id: numericId,
    username: `user_${numericId}`,
    role: "unknown",
  };
}

function renderUserPicker() {
  if (!mockUsers.length) {
    elements.userPicker.innerHTML = '<div class="empty-state">Тестовые пользователи не найдены. Выполни команду `python manage.py seed_mvp_data`.</div>';
    return;
  }

  elements.userPicker.innerHTML = mockUsers
    .map((user) => `
      <button class="user-chip" data-user-id="${user.id}" type="button">
        <strong>#${user.id} ${user.username}</strong>
        <span class="user-chip__role">${translateRole(user.role)}</span>
      </button>
    `)
    .join("");

  elements.userPicker.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = Number(button.dataset.userId);
      elements.userIdInput.value = String(userId);
      activateUser(userId);
    });
  });
}

function renderCurrentUser() {
  if (!state.user) {
    elements.currentUserCard.className = "current-user current-user--empty";
    elements.currentUserCard.textContent = "Пользователь не выбран";
    elements.customerTools.classList.add("hidden");
    elements.annotatorTools.classList.add("hidden");
    return;
  }

  elements.currentUserCard.className = "current-user";
  elements.currentUserCard.innerHTML = `
    <strong>#${state.user.id} ${state.user.username}</strong>
    <div class="room-detail__meta">Роль: ${translateRole(state.user.role)}</div>
  `;

  elements.customerTools.classList.toggle("hidden", state.user.role !== "customer");
  elements.annotatorTools.classList.toggle("hidden", state.user.role !== "annotator");

  elements.userPicker.querySelectorAll(".user-chip").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.userId) === state.user.id);
  });
}

function renderRooms() {
  if (!state.rooms.length) {
    elements.roomsList.innerHTML = "";
    elements.roomsEmpty.classList.remove("hidden");
    return;
  }

  elements.roomsEmpty.classList.add("hidden");
  elements.roomsList.innerHTML = state.rooms.map((room) => `
    <button class="room-item ${state.selectedRoom && state.selectedRoom.id === room.id ? "active" : ""}" data-room-id="${room.id}" type="button">
      <div class="room-item__title">${room.title}</div>
      <span class="room-item__meta">Комната #${room.id} · ${translateMembership(room.membership_status || "owner")}</span>
    </button>
  `).join("");

  elements.roomsList.querySelectorAll("[data-room-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const roomId = Number(button.dataset.roomId);
      selectRoom(roomId);
    });
  });
}

function renderRoomDetail() {
  if (!state.selectedRoom) {
    elements.roomRoleBadge.textContent = "Комната не выбрана";
    elements.roomDetail.className = "room-detail empty-state";
    elements.roomDetail.textContent = "Выбери комнату в списке слева.";
    return;
  }

  const ownershipLabel = state.user.role === "customer"
    ? "owner"
    : state.selectedRoom.membership_status || "invited";

  elements.roomRoleBadge.textContent = translateMembership(ownershipLabel);
  elements.roomDetail.className = "room-detail";
  elements.roomDetail.innerHTML = `
    <h3>${state.selectedRoom.title}</h3>
    <p>${state.selectedRoom.description || "Описание пока не заполнено."}</p>
    <div class="room-detail__meta">Комната #${state.selectedRoom.id} · создана пользователем #${state.selectedRoom.created_by_id}</div>
  `;
}

function renderTask() {
  if (!state.currentTask) {
    elements.taskCard.className = "task-card empty-state";
    elements.taskCard.textContent = "Задача пока не загружена.";
    elements.submitTaskForm.classList.add("hidden");
    return;
  }

  elements.taskCard.className = "task-card";
  elements.taskCard.innerHTML = `
    <h3>Задача #${state.currentTask.id}</h3>
    <p>Статус: ${translateTaskStatus(state.currentTask.status)}</p>
    <pre class="payload-preview">${JSON.stringify(state.currentTask.input_payload, null, 2)}</pre>
  `;
  elements.submitTaskForm.classList.remove("hidden");
}

async function api(path, options = {}) {
  if (!state.user) {
    throw new Error("Сначала выберите пользователя.");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-User-Id": String(state.user.id),
    ...(options.headers || {}),
  };

  const requestOptions = {
    method: options.method || "GET",
    headers,
  };

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  log(`${requestOptions.method} ${path}`, options.body);
  const response = await fetch(path, requestOptions);

  if (response.status === 204) {
    log(`RESPONSE 204 ${path}`, { detail: "Пустой ответ" });
    return null;
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const detail = data?.detail || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  log(`RESPONSE ${response.status} ${path}`, data);
  return data;
}

async function loadRooms() {
  if (!state.user) {
    return;
  }

  clearFlash();
  try {
    const path = state.user.role === "customer" ? "/api/v1/rooms/" : "/api/v1/me/rooms/";
    const rooms = await api(path);
    state.rooms = rooms || [];
    if (state.selectedRoom) {
      state.selectedRoom = state.rooms.find((room) => room.id === state.selectedRoom.id) || null;
    }
    renderRooms();
    renderRoomDetail();
  } catch (error) {
    showFlash(error.message, "error");
  }
}

async function selectRoom(roomId) {
  clearFlash();
  try {
    const room = await api(`/api/v1/rooms/${roomId}/`);
    state.selectedRoom = room;
    state.currentTask = null;
    renderRooms();
    renderRoomDetail();
    renderTask();
  } catch (error) {
    showFlash(error.message, "error");
  }
}

async function activateUser(userId) {
  const numericId = Number(userId);
  if (!numericId) {
    showFlash("Укажи корректный идентификатор пользователя.", "error");
    return;
  }

  state.user = detectUserById(numericId);
  state.rooms = [];
  state.selectedRoom = null;
  state.currentTask = null;
  setStoredUserId(numericId);
  renderCurrentUser();
  renderRooms();
  renderRoomDetail();
  renderTask();
  await loadRooms();
}

elements.useUserBtn.addEventListener("click", async () => {
  await activateUser(elements.userIdInput.value);
});

elements.refreshRoomsBtn.addEventListener("click", async () => {
  await loadRooms();
});

elements.clearLogBtn.addEventListener("click", () => {
  elements.requestLog.textContent = "Интерфейс готов к работе.";
});

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFlash();

  const formData = new FormData(event.currentTarget);
  const payload = {
    title: formData.get("title"),
    description: formData.get("description"),
  };

  try {
    const room = await api("/api/v1/rooms/", { method: "POST", body: payload });
    showFlash(`Комната #${room.id} создана.`);
    event.currentTarget.reset();
    await loadRooms();
    await selectRoom(room.id);
  } catch (error) {
    showFlash(error.message, "error");
  }
});

elements.inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFlash();

  if (!state.selectedRoom) {
    showFlash("Сначала выберите комнату.", "error");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const payload = {
    annotator_id: Number(formData.get("annotator_id")),
  };

  try {
    const response = await api(`/api/v1/rooms/${state.selectedRoom.id}/invite/`, {
      method: "POST",
      body: payload,
    });
    showFlash(`Разметчик #${response.user_id} приглашен в комнату #${response.room_id}.`);
    event.currentTarget.reset();
  } catch (error) {
    showFlash(error.message, "error");
  }
});

elements.joinRoomBtn.addEventListener("click", async () => {
  clearFlash();

  if (!state.selectedRoom) {
    showFlash("Сначала выберите комнату.", "error");
    return;
  }

  try {
    const membership = await api(`/api/v1/rooms/${state.selectedRoom.id}/join/`, {
      method: "POST",
    });
    showFlash(`Статус участия обновлен: ${translateMembership(membership.status)}.`);
    await loadRooms();
    await selectRoom(state.selectedRoom.id);
  } catch (error) {
    showFlash(error.message, "error");
  }
});

elements.nextTaskBtn.addEventListener("click", async () => {
  clearFlash();

  if (!state.selectedRoom) {
    showFlash("Сначала выберите комнату.", "error");
    return;
  }

  try {
    const task = await api(`/api/v1/rooms/${state.selectedRoom.id}/tasks/next/`);
    if (!task) {
      state.currentTask = null;
      renderTask();
      showFlash("Доступных задач больше нет.", "success");
      return;
    }

    state.currentTask = task;
    renderTask();
    showFlash(`Задача #${task.id} загружена.`);
  } catch (error) {
    showFlash(error.message, "error");
  }
});

elements.submitTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFlash();

  if (!state.currentTask) {
    showFlash("Сначала запросите задачу.", "error");
    return;
  }

  let resultPayload;
  try {
    resultPayload = JSON.parse(elements.resultPayloadInput.value);
  } catch (error) {
    showFlash("Поле результата должно содержать корректный JSON.", "error");
    return;
  }

  try {
    const annotation = await api(`/api/v1/tasks/${state.currentTask.id}/submit/`, {
      method: "POST",
      body: { result_payload: resultPayload },
    });
    showFlash(`Разметка #${annotation.id} отправлена.`);
    state.currentTask = null;
    renderTask();
    await loadRooms();
  } catch (error) {
    showFlash(error.message, "error");
  }
});

renderUserPicker();
renderCurrentUser();
renderRooms();
renderRoomDetail();
renderTask();

const storedUserId = getStoredUserId();
if (storedUserId) {
  elements.userIdInput.value = storedUserId;
  activateUser(storedUserId);
}
