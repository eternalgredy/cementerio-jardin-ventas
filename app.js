import { firebaseStore } from "./firebase-store.js";

const LOTES = Array.isArray(window.LOTES_DATA) ? window.LOTES_DATA : [];
const PLANO = window.PLANO_VECTOR || { width: 1000, height: 1000, lots: [], base: [] };
const DEBUG_CELLS = new URLSearchParams(window.location.search).get("debug") === "cuadros";

const STATUS = {
  disponible: {
    label: "Disponible",
    color: "#22c55e",
    bg: "#dcfce7",
    text: "#166534"
  },
  reservado: {
    label: "Reservado",
    color: "#f59e0b",
    bg: "#fef3c7",
    text: "#92400e"
  },
  vendido: {
    label: "Vendido",
    color: "#ef4444",
    bg: "#fee2e2",
    text: "#991b1b"
  }
};

const STORAGE_KEY = "jardin-nichos-ventas-v1";
const HISTORY_KEY = "jardin-nichos-historial-v1";
const AUTH_KEY = "jardin-nichos-auth-v1";
const APP_USERS = {
  rocio: {
    name: "Rocio",
    role: "admin",
    passwordHash: "8f6e743f3a8ef585dc4859ef28378897abad6e9855f6eafb88c481c2c9c9d7c4"
  },
  soto: {
    name: "Soto",
    role: "admin",
    passwordHash: "d63e838c04e4c012f1186c0bc5d6c783db642b7163eb556d2304d9b897526cb5"
  }
};
const initialLots = {
  ...buildInitialLots(),
  ...(readJson(STORAGE_KEY, null) || {})
};
const savedAuth = readJson(AUTH_KEY, null);
const initialAuth = normalizeAuth(savedAuth);

if (savedAuth && !initialAuth) {
  localStorage.removeItem(AUTH_KEY);
}

const state = {
  auth: initialAuth,
  loginError: "",
  view: "mapa",
  lots: initialLots,
  history: readJson(HISTORY_KEY, []),
  syncStatus: firebaseStore.enabled ? "syncing" : "local",
  syncMessage: firebaseStore.enabled ? "Sincronizando Firebase" : firebaseStore.reason,
  mapZoom: window.matchMedia("(max-width: 620px)").matches ? 1.45 : 1,
  search: "",
  statusFilter: "all",
  groupFilter: "all",
  selectedId: null,
  toast: ""
};

const app = document.querySelector("#app");

init();

async function init() {
  render();
  await loadFirebaseState();
}

async function loadFirebaseState() {
  if (!firebaseStore.enabled) return;
  try {
    const [remoteLots, remoteHistory] = await Promise.all([firebaseStore.getLots(), firebaseStore.getHistory()]);
    state.lots = {
      ...buildInitialLots(),
      ...state.lots,
      ...remoteLots
    };
    state.history = remoteHistory.length ? remoteHistory : state.history;
    state.syncStatus = "online";
    state.syncMessage = "Firebase conectado";
    writeJson(STORAGE_KEY, state.lots);
    writeJson(HISTORY_KEY, state.history);
  } catch (error) {
    state.syncStatus = "error";
    state.syncMessage = "Firebase sin conexion";
    console.error(error);
  }
  render();
}

function buildInitialLots() {
  return Object.fromEntries(
    LOTES.map((lot) => [
      lot.id,
      {
        status: "disponible",
        comprador: "",
        precio: "",
        nota: "",
        origen: "",
        modifiedBy: "",
        modifiedAt: ""
      }
    ])
  );
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeAuth(auth) {
  const user = APP_USERS[auth?.user];
  if (!user) return null;
  return {
    user: auth.user,
    name: user.name,
    role: user.role,
    loggedAt: auth.loggedAt || ""
  };
}

async function sha256Hex(value) {
  if (!window.crypto?.subtle) {
    throw new Error("Este navegador no permite validar contrasena de forma segura");
  }
  const data = new TextEncoder().encode(value);
  const hash = await window.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function groups() {
  return [...new Set(LOTES.map((lot) => lot.grupo))].sort((a, b) => a.localeCompare(b));
}

function lotData(id) {
  return state.lots[id] || {
    status: "disponible",
    comprador: "",
    precio: "",
    nota: "",
    origen: "",
    modifiedBy: "",
    modifiedAt: ""
  };
}

function totals(lots = LOTES) {
  const total = lots.length;
  const vendidos = lots.filter((lot) => lotData(lot.id).status === "vendido").length;
  const reservados = lots.filter((lot) => lotData(lot.id).status === "reservado").length;
  const disponibles = total - vendidos - reservados;
  const ingresos = lots.reduce((acc, lot) => {
    const data = lotData(lot.id);
    return data.status === "vendido" && data.precio ? acc + Number(data.precio) : acc;
  }, 0);
  return { total, vendidos, reservados, disponibles, ingresos };
}

function filteredLots() {
  const q = state.search.trim().toLowerCase();
  return LOTES.filter((lot) => {
    const data = lotData(lot.id);
    const byStatus = state.statusFilter === "all" || data.status === state.statusFilter;
    const byGroup = state.groupFilter === "all" || lot.grupo === state.groupFilter;
    const bySearch =
      !q ||
      lot.id.toLowerCase().includes(q) ||
      lot.grupo.toLowerCase().includes(q) ||
      (data.comprador || "").toLowerCase().includes(q);
    return byStatus && byGroup && bySearch;
  });
}

function render() {
  if (!state.auth) {
    renderLogin();
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${renderTabs()}
      ${state.view !== "historial" ? renderStatsBar() : ""}
      ${state.view !== "historial" ? renderToolbar() : ""}
      ${state.view === "mapa" ? renderMapView() : ""}
      ${state.view === "ventas" ? renderSalesView() : ""}
      ${state.view === "historial" ? renderHistoryView() : ""}
      ${state.selectedId ? renderModal(state.selectedId) : ""}
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;

  bindEvents();
}

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <form class="login-card" id="loginForm">
        <div class="brand-mark">JR</div>
        <h1>Cementerio Jardin</h1>
        <p style="margin-top:6px">Control de ventas, reservas y disponibilidad de nichos.</p>

        <label class="field">
          <span>Usuario</span>
          <select class="select" id="loginUser" autocomplete="username" required>
            ${Object.entries(APP_USERS)
              .map(([key, user]) => `<option value="${key}">${escapeHtml(user.name)}</option>`)
              .join("")}
          </select>
        </label>

        <label class="field">
          <span>Contrasena</span>
          <input class="input" id="loginPassword" type="password" autocomplete="current-password" required />
        </label>

        ${state.loginError ? `<p class="login-error">${escapeHtml(state.loginError)}</p>` : ""}
        <button class="primary-btn" style="width:100%;margin-top:18px" type="submit">Ingresar</button>
        <p class="small-text" style="margin-top:12px">${escapeHtml(syncLabel())}</p>
      </form>
    </main>
  `;

  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const userKey = document.querySelector("#loginUser").value;
    const password = document.querySelector("#loginPassword").value;
    const user = APP_USERS[userKey];
    let passwordHash = "";

    try {
      passwordHash = await sha256Hex(password);
    } catch (error) {
      state.loginError = error.message;
      render();
      return;
    }

    if (!user || passwordHash !== user.passwordHash) {
      state.loginError = "Usuario o contrasena incorrectos";
      render();
      return;
    }

    state.auth = {
      user: userKey,
      name: user.name,
      role: user.role,
      loggedAt: new Date().toISOString()
    };
    state.loginError = "";
    writeJson(AUTH_KEY, state.auth);
    render();
  });
}

function renderTabs() {
  const tabs = [
    ["mapa", "Mapa"],
    ["ventas", "Ventas"],
    ["historial", "Historial"]
  ];
  return `
    <header class="tabs">
      <div class="tabs-inner">
        ${tabs
          .map(
            ([key, label]) => `
              <button class="tab-btn ${state.view === key ? "active" : ""}" data-view="${key}" type="button">${label}</button>
            `
          )
          .join("")}
        <div class="user-pill">
          <span>${escapeHtml(state.auth.name)} · ${state.auth.role === "admin" ? "Admin" : "Ventas"}</span>
          <button id="logoutBtn" type="button">Salir</button>
        </div>
      </div>
    </header>
  `;
}

function renderStatsBar() {
  const total = totals();
  const cards = [
    ["Total nichos", total.total, "#94a3b8"],
    ["Disponibles", total.disponibles, STATUS.disponible.color],
    ["Reservados", total.reservados, STATUS.reservado.color],
    ["Vendidos", total.vendidos, STATUS.vendido.color],
    ["Ingresos Bs.", formatMoney(total.ingresos), "#818cf8"]
  ];
  return `
    <section class="stats-bar">
      <div class="stats-grid">
        ${cards
          .map(
            ([label, value, color]) => `
              <article class="stat-card">
                <div class="stat-value" style="color:${color}">${value}</div>
                <div class="stat-label">${label}</div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderToolbar() {
  return `
    <section class="toolbar">
      <div class="toolbar-inner">
        <input class="input" id="searchInput" placeholder="Buscar codigo o comprador..." value="${escapeAttr(state.search)}" />
        <select class="select" id="statusFilter">
          <option value="all">Todos los estados</option>
          ${Object.entries(STATUS)
            .map(([key, status]) => `<option value="${key}" ${state.statusFilter === key ? "selected" : ""}>${status.label}</option>`)
            .join("")}
        </select>
        <select class="select" id="groupFilter">
          <option value="all">Todos los grupos</option>
          ${groups()
            .map((group) => `<option value="${group}" ${state.groupFilter === group ? "selected" : ""}>Grupo ${group}</option>`)
            .join("")}
        </select>
        <button class="ghost-btn" id="exportBtn" type="button">Exportar JSON</button>
        <span class="sync-pill ${state.syncStatus}">${escapeHtml(syncLabel())}</span>
      </div>
    </section>
  `;
}

function syncLabel() {
  if (state.syncStatus === "online") return "Firebase conectado";
  if (state.syncStatus === "syncing") return "Sincronizando Firebase";
  if (state.syncStatus === "error") return "Firebase sin conexion, usando copia local";
  return "Configura Firebase para sincronizar datos";
}

function renderMapView() {
  const visible = new Set(filteredLots().map((lot) => lot.id));
  return `
    <main class="content">
      <div class="map-layout">
        <section class="map-panel">
          <div class="map-head">
            <div>
              <div class="map-title">Plano de nichos</div>
              <p class="small-text">Toca un nicho para actualizar venta o reserva.</p>
            </div>
            <div class="map-head-actions">
              ${renderMapControls()}
              ${renderLegend()}
            </div>
          </div>
          <div class="map-wrap">
            <div class="vector-stage" style="--map-zoom:${state.mapZoom}">
              ${renderVectorMap(visible)}
            </div>
          </div>
        </section>
        <aside class="side-panel">
          <div class="side-head">
            <div>
              <div class="side-title">Grupos</div>
              <p class="small-text">Resumen por prefijo.</p>
            </div>
          </div>
          <div class="side-list">
            ${groups().map(renderGroupCard).join("")}
          </div>
        </aside>
      </div>
    </main>
  `;
}

function renderMapControls() {
  return `
    <div class="map-controls" aria-label="Controles de zoom">
      <button class="map-control-btn" id="zoomOut" type="button" aria-label="Alejar">−</button>
      <span class="zoom-readout">${Math.round(state.mapZoom * 100)}%</span>
      <button class="map-control-btn" id="zoomIn" type="button" aria-label="Acercar">+</button>
    </div>
  `;
}

function renderVectorMap(visible) {
  return `
    <svg
      class="vector-map"
      viewBox="0 0 ${PLANO.width} ${PLANO.height}"
      role="img"
      aria-label="Plano vectorial de nichos"
    >
      <rect x="0" y="0" width="${PLANO.width}" height="${PLANO.height}" class="map-bg"></rect>
      <g class="base-lines">
        ${(PLANO.base || []).map(renderBaseShape).join("")}
      </g>
      <g class="cell-outlines">
        ${DEBUG_CELLS ? (PLANO.detectedCells || []).map(renderCellOutline).join("") : ""}
      </g>
      <g class="lot-polygons">
        ${(PLANO.lots || []).map((lot) => renderLotPolygon(lot, visible.has(lot.id))).join("")}
      </g>
      <g class="lot-borders">
        ${(PLANO.lots || []).map((lot) => renderLotBorder(lot, visible.has(lot.id))).join("")}
      </g>
      <g class="lot-labels">
        ${(PLANO.lots || []).map((lot) => renderLotText(lot, visible.has(lot.id))).join("")}
      </g>
    </svg>
  `;
}

function renderBaseShape(shape) {
  const points = pointsAttr(shape.points);
  if (!points) return "";
  return shape.closed
    ? `<polygon points="${points}" class="base-shape"></polygon>`
    : `<polyline points="${points}" class="base-line"></polyline>`;
}

function renderCellOutline(cell) {
  const points = pointsAttr(cell.points);
  return points ? `<polygon points="${points}" class="cell-outline"></polygon>` : "";
}

function renderLotPolygon(lot, visible) {
  const data = lotData(lot.id);
  const status = STATUS[data.status] || STATUS.disponible;
  const selected = state.selectedId === lot.id ? "selected" : "";
  return `
    <polygon
      class="lot-poly ${selected} ${visible ? "" : "hidden"}"
      data-lot="${escapeAttr(lot.id)}"
      points="${pointsAttr(lot.points)}"
      style="--lot-color:${status.color}"
    ></polygon>
  `;
}

function renderLotBorder(lot, visible) {
  const data = lotData(lot.id);
  const status = STATUS[data.status] || STATUS.disponible;
  const selected = state.selectedId === lot.id ? "selected" : "";
  return `
    <polygon
      class="lot-border ${selected} ${visible ? "" : "hidden"}"
      points="${pointsAttr(lot.points)}"
      style="--lot-color:${status.color}"
    ></polygon>
  `;
}

function renderLotText(lot, visible) {
  const label = lot.label || [0, 0];
  return `
    <text
      class="lot-text ${visible ? "" : "hidden"}"
      data-lot="${escapeAttr(lot.id)}"
      x="${label[0]}"
      y="${label[1]}"
    >${escapeHtml(lot.id)}</text>
  `;
}

function pointsAttr(points) {
  return (points || []).map((point) => `${point[0]},${point[1]}`).join(" ");
}

function renderGroupCard(group) {
  const lots = LOTES.filter((lot) => lot.grupo === group);
  const t = totals(lots);
  const pct = t.total ? Math.round((t.vendidos / t.total) * 100) : 0;
  const color = t.vendidos === t.total ? STATUS.vendido.color : t.reservados || t.vendidos ? STATUS.reservado.color : STATUS.disponible.color;
  return `
    <button class="group-card" data-group="${escapeAttr(group)}" type="button">
      <span class="group-letter" style="background:${color}">${escapeHtml(group)}</span>
      <span>
        <strong>Grupo ${escapeHtml(group)}</strong>
        <span class="small-text" style="display:block">${t.total} nichos · ${t.disponibles} disp. · ${t.reservados} res. · ${t.vendidos} vend.</span>
        <span class="progress"><span style="width:${pct}%"></span></span>
      </span>
      <span class="small-text" style="text-align:right">${pct}%<br />vendido</span>
    </button>
  `;
}

function renderSalesView() {
  const lots = filteredLots();
  if (!lots.length) {
    return `<main class="content"><div class="empty">No hay nichos con esos filtros.</div></main>`;
  }

  return `
    <main class="content">
      ${groups()
        .map((group) => {
          const groupLots = lots.filter((lot) => lot.grupo === group);
          if (!groupLots.length) return "";
          const t = totals(groupLots);
          return `
            <section class="group-section">
              <div class="group-head">
                <div>
                  <div class="group-title">Grupo ${escapeHtml(group)}</div>
                  <p class="small-text">${groupLots.length} nichos filtrados</p>
                </div>
                <div class="legend">
                  <span>${t.disponibles} disponibles</span>
                  <span>${t.reservados} reservados</span>
                  <span>${t.vendidos} vendidos</span>
                </div>
              </div>
              <div class="lot-grid">
                ${groupLots.map(renderLotCard).join("")}
              </div>
            </section>
          `;
        })
        .join("")}
    </main>
  `;
}

function renderLotCard(lot) {
  const data = lotData(lot.id);
  const status = STATUS[data.status] || STATUS.disponible;
  return `
    <button class="lot-card" data-lot="${escapeAttr(lot.id)}" type="button" style="border-color:${status.color}">
      <span class="lot-top">
        <span class="lot-id">${escapeHtml(lot.id)}</span>
        ${renderBadge(data.status)}
      </span>
      <span class="lot-detail">
        Grupo ${escapeHtml(lot.grupo)}
        ${data.comprador ? `<br />Comprador: <strong>${escapeHtml(data.comprador)}</strong>` : ""}
        ${data.precio ? `<br />Bs. ${formatMoney(Number(data.precio))}` : ""}
        ${data.modifiedBy ? `<br />Editado por ${escapeHtml(data.modifiedBy)} · ${formatDate(data.modifiedAt)}` : ""}
      </span>
    </button>
  `;
}

function renderHistoryView() {
  const history = state.history;
  return `
    <main class="content">
      <div class="map-head" style="padding-inline:0;border:0">
        <div>
          <div class="map-title">Historial de cambios</div>
          <p class="small-text">${escapeHtml(syncLabel())}</p>
        </div>
        <button class="ghost-btn" id="clearHistoryBtn" type="button">Limpiar historial</button>
      </div>
      ${
        history.length
          ? `<div class="history-list">${history.map(renderHistoryItem).join("")}</div>`
          : `<div class="empty">Sin cambios registrados todavia.</div>`
      }
    </main>
  `;
}

function renderHistoryItem(item) {
  const status = STATUS[item.status] || STATUS.disponible;
  return `
    <article class="history-item">
      <div class="history-avatar">${escapeHtml((item.user || "?").slice(0, 1).toUpperCase())}</div>
      <div>
        <strong>${escapeHtml(item.user || "Usuario")}</strong>
        <span class="small-text"> · ${formatDate(item.at)}</span>
        <div style="margin-top:5px">
          Nicho <strong>${escapeHtml(item.id)}</strong> cambiado a
          <span style="color:${status.color};font-weight:900">${status.label}</span>
          ${item.comprador ? ` · ${escapeHtml(item.comprador)}` : ""}
          ${item.precio ? ` · Bs. ${formatMoney(Number(item.precio))}` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderLegend() {
  return `
    <div class="legend">
      ${Object.entries(STATUS)
        .map(
          ([key, status]) => `
            <span><i class="dot" style="background:${status.color}"></i>${status.label}</span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderBadge(statusKey) {
  const status = STATUS[statusKey] || STATUS.disponible;
  return `<span class="status-badge" style="background:${status.bg};color:${status.text}">${status.label}</span>`;
}

function renderModal(id) {
  const data = lotData(id);
  const lot = LOTES.find((item) => item.id === id);
  return `
    <div class="modal-backdrop" id="modalBackdrop">
      <form class="modal" id="lotForm">
        <div class="modal-head">
          <div>
            <h2>Nicho ${escapeHtml(id)}</h2>
            <p class="small-text">Grupo ${escapeHtml(lot?.grupo || "-")}</p>
          </div>
          ${renderBadge(data.status)}
        </div>
        <div class="modal-body">
          <label class="field">
            <span>Estado</span>
            <select class="select" id="formStatus">
              ${Object.entries(STATUS)
                .map(([key, status]) => `<option value="${key}" ${data.status === key ? "selected" : ""}>${status.label}</option>`)
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Comprador o responsable</span>
            <input class="input" id="formBuyer" value="${escapeAttr(data.comprador || "")}" placeholder="Nombre completo" />
          </label>
          <label class="field">
            <span>Precio Bs.</span>
            <input class="input" id="formPrice" type="number" min="0" step="1" value="${escapeAttr(data.precio || "")}" placeholder="0" />
          </label>
          <label class="field">
            <span>Origen / contacto</span>
            <input class="input" id="formOrigin" value="${escapeAttr(data.origen || "")}" placeholder="Telefono, referido, oficina..." />
          </label>
          <label class="field">
            <span>Nota</span>
            <textarea class="textarea" id="formNote" placeholder="Observaciones">${escapeHtml(data.nota || "")}</textarea>
          </label>
          <div class="modal-actions">
            <button class="ghost-btn" id="cancelModal" type="button">Cancelar</button>
            <button class="primary-btn" type="submit">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.selectedId = null;
      render();
    });
  });

  document.querySelector("#logoutBtn")?.addEventListener("click", () => {
    localStorage.removeItem(AUTH_KEY);
    state.auth = null;
    render();
  });

  document.querySelector("#searchInput")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
    const input = document.querySelector("#searchInput");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });

  document.querySelector("#statusFilter")?.addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    render();
  });

  document.querySelector("#groupFilter")?.addEventListener("change", (event) => {
    state.groupFilter = event.target.value;
    render();
  });

  document.querySelector("#exportBtn")?.addEventListener("click", exportLots);

  document.querySelector("#zoomOut")?.addEventListener("click", () => {
    state.mapZoom = Math.max(0.8, Number((state.mapZoom - 0.2).toFixed(2)));
    render();
  });

  document.querySelector("#zoomIn")?.addEventListener("click", () => {
    state.mapZoom = Math.min(3, Number((state.mapZoom + 0.2).toFixed(2)));
    render();
  });

  document.querySelector("#clearHistoryBtn")?.addEventListener("click", () => {
    state.history = [];
    writeJson(HISTORY_KEY, state.history);
    if (firebaseStore.enabled) {
      firebaseStore.clearHistory().catch((error) => {
        state.syncStatus = "error";
        state.syncMessage = "No se pudo limpiar Firebase";
        console.error(error);
      });
    }
    showToast("Historial limpiado");
    render();
  });

  document.querySelectorAll("[data-lot]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedId = element.dataset.lot;
      render();
    });
  });

  document.querySelectorAll("[data-group]").forEach((element) => {
    element.addEventListener("click", () => {
      state.groupFilter = element.dataset.group;
      state.view = "ventas";
      render();
    });
  });

  document.querySelector("#cancelModal")?.addEventListener("click", closeModal);
  document.querySelector("#modalBackdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "modalBackdrop") closeModal();
  });

  document.querySelector("#lotForm")?.addEventListener("submit", saveLotFromForm);
}

function saveLotFromForm(event) {
  event.preventDefault();
  const id = state.selectedId;
  const next = {
    status: document.querySelector("#formStatus").value,
    comprador: document.querySelector("#formBuyer").value.trim(),
    precio: document.querySelector("#formPrice").value,
    origen: document.querySelector("#formOrigin").value.trim(),
    nota: document.querySelector("#formNote").value.trim(),
    modifiedBy: state.auth.name,
    modifiedAt: new Date().toISOString()
  };

  state.lots = {
    ...state.lots,
    [id]: next
  };
  writeJson(STORAGE_KEY, state.lots);
  pushHistory(id, next);
  state.selectedId = null;
  showToast(`Nicho ${id} actualizado`);
  render();
  persistLot(id, next);
}

function pushHistory(id, data) {
  const entry = {
    id,
    status: data.status,
    comprador: data.comprador,
    precio: data.precio,
    user: state.auth.name,
    at: data.modifiedAt
  };
  state.history = [entry, ...state.history].slice(0, 80);
  writeJson(HISTORY_KEY, state.history);
  if (firebaseStore.enabled) {
    firebaseStore.addHistory(entry).catch((error) => {
      state.syncStatus = "error";
      state.syncMessage = "No se pudo guardar historial en Firebase";
      console.error(error);
      render();
    });
  }
}

function persistLot(id, data) {
  if (!firebaseStore.enabled) return;
  firebaseStore
    .saveLot(id, data)
    .then(() => {
      state.syncStatus = "online";
      state.syncMessage = "Firebase conectado";
      render();
    })
    .catch((error) => {
      state.syncStatus = "error";
      state.syncMessage = "No se pudo guardar en Firebase";
      console.error(error);
      showToast("Guardado local, Firebase fallo");
      render();
    });
}

function closeModal() {
  state.selectedId = null;
  render();
}

function exportLots() {
  const blob = new Blob([JSON.stringify(state.lots, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ventas-nichos.json";
  link.click();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  state.toast = message;
  setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("es-BO", {
    maximumFractionDigits: 0
  });
}

function formatDate(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-BO", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
