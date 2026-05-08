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
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 8;
const DEFAULT_MAP_ZOOM = window.matchMedia("(max-width: 620px)").matches ? 1.45 : 1;
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
const defaultMapCenter = getDefaultMapCenter();

if (savedAuth && !initialAuth) {
  localStorage.removeItem(AUTH_KEY);
}

const state = {
  auth: initialAuth,
  loginError: "",
  loginMode: "vendedor",
  view: "mapa",
  lots: initialLots,
  history: readJson(HISTORY_KEY, []),
  syncStatus: firebaseStore.enabled ? "syncing" : "local",
  syncMessage: firebaseStore.enabled ? "Sincronizando Firebase" : firebaseStore.reason,
  mapZoom: DEFAULT_MAP_ZOOM,
  mapCenter: defaultMapCenter,
  mapAspect: PLANO.width / PLANO.height,
  search: "",
  statusFilter: "all",
  groupFilter: "all",
  selectedId: null,
  toast: ""
};

const app = document.querySelector("#app");
let mapResizeTimer = 0;

init();

window.addEventListener("resize", () => {
  window.clearTimeout(mapResizeTimer);
  mapResizeTimer = window.setTimeout(() => syncMapAspect(), 80);
});

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

function getDefaultMapCenter() {
  const bounds = getLotsBounds();
  if (!bounds) {
    return { x: PLANO.width / 2, y: PLANO.height / 2 };
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

function getLotsBounds() {
  const points = (PLANO.lots || []).flatMap((lot) => lot.points || []);
  if (!points.length) return null;
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point[0]),
      minY: Math.min(bounds.minY, point[1]),
      maxX: Math.max(bounds.maxX, point[0]),
      maxY: Math.max(bounds.maxY, point[1])
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampMapZoom(zoom) {
  return clamp(Number(zoom) || DEFAULT_MAP_ZOOM, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
}

function getMapView(zoom = state.mapZoom, center = state.mapCenter) {
  const nextZoom = clampMapZoom(zoom);
  const { width, height } = getMapViewSize(nextZoom);
  const maxX = Math.max(0, PLANO.width - width);
  const maxY = Math.max(0, PLANO.height - height);
  const x = clamp((center?.x ?? PLANO.width / 2) - width / 2, 0, maxX);
  const y = clamp((center?.y ?? PLANO.height / 2) - height / 2, 0, maxY);

  return {
    x,
    y,
    width,
    height,
    center: {
      x: x + width / 2,
      y: y + height / 2
    }
  };
}

function getMapViewSize(zoom) {
  const mapAspect = PLANO.width / PLANO.height;
  const viewportAspect = state.mapAspect || mapAspect;
  if (viewportAspect >= mapAspect) {
    const width = PLANO.width / zoom;
    return {
      width,
      height: width / viewportAspect
    };
  }

  const height = PLANO.height / zoom;
  return {
    width: height * viewportAspect,
    height
  };
}

function applyMapView() {
  state.mapZoom = clampMapZoom(state.mapZoom);
  const view = getMapView();
  state.mapCenter = view.center;
  return view;
}

function mapViewBoxAttr() {
  const view = applyMapView();
  return [view.x, view.y, view.width, view.height].map(formatMapNumber).join(" ");
}

function formatMapNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function normalizeAuth(auth) {
  const user = APP_USERS[auth?.user];
  if (auth?.role === "vendedor" && auth.name?.trim()) {
    return {
      user: auth.user || "vendedor",
      name: auth.name.trim(),
      role: "vendedor",
      loggedAt: auth.loggedAt || ""
    };
  }
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

function isAdmin() {
  return state.auth?.role === "admin";
}

function isSeller() {
  return state.auth?.role === "vendedor";
}

function roleLabel() {
  if (isAdmin()) return "Admin";
  if (isSeller()) return "Vendedor";
  return "Ventas";
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
          <span>Tipo de usuario</span>
          <select class="select" id="loginMode">
            <option value="vendedor" ${state.loginMode === "vendedor" ? "selected" : ""}>Vendedor</option>
            <option value="admin" ${state.loginMode === "admin" ? "selected" : ""}>Administrador</option>
          </select>
        </label>

        <div class="login-panel" id="sellerLoginPanel" ${state.loginMode === "admin" ? "hidden" : ""}>
          <label class="field">
            <span>Nombre del vendedor</span>
            <input class="input" id="sellerName" autocomplete="name" placeholder="Nombre" />
          </label>
        </div>

        <div class="login-panel" id="adminLoginPanel" ${state.loginMode === "admin" ? "" : "hidden"}>
          <label class="field">
            <span>Usuario</span>
            <select class="select" id="loginUser" autocomplete="username">
              ${Object.entries(APP_USERS)
                .map(([key, user]) => `<option value="${key}">${escapeHtml(user.name)}</option>`)
                .join("")}
            </select>
          </label>

          <label class="field">
            <span>Contrasena</span>
            <input class="input" id="loginPassword" type="password" autocomplete="current-password" />
          </label>
        </div>

        ${state.loginError ? `<p class="login-error">${escapeHtml(state.loginError)}</p>` : ""}
        <button class="primary-btn" style="width:100%;margin-top:18px" type="submit">Ingresar</button>
        <p class="small-text" style="margin-top:12px">${escapeHtml(syncLabel())}</p>
      </form>
    </main>
  `;

  const loginMode = document.querySelector("#loginMode");
  const sellerPanel = document.querySelector("#sellerLoginPanel");
  const adminPanel = document.querySelector("#adminLoginPanel");
  loginMode.addEventListener("change", () => {
    const adminMode = loginMode.value === "admin";
    state.loginMode = loginMode.value;
    state.loginError = "";
    sellerPanel.hidden = adminMode;
    adminPanel.hidden = !adminMode;
  });

  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = document.querySelector("#loginMode").value;
    state.loginMode = mode;

    if (mode === "vendedor") {
      const sellerName = document.querySelector("#sellerName").value.trim();
      if (sellerName.length < 2) {
        state.loginError = "Escribe el nombre del vendedor";
        render();
        return;
      }
      state.auth = {
        user: `vendedor-${Date.now()}`,
        name: sellerName,
        role: "vendedor",
        loggedAt: new Date().toISOString()
      };
      state.loginError = "";
      writeJson(AUTH_KEY, state.auth);
      render();
      return;
    }

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
          <span>${escapeHtml(state.auth.name)} · ${roleLabel()}</span>
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
    ["Vendidos", total.vendidos, STATUS.vendido.color]
  ];
  if (isAdmin()) {
    cards.push(["Ingresos Bs.", formatMoney(total.ingresos), "#818cf8"]);
  }
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
        ${isAdmin() ? `<button class="ghost-btn" id="exportBtn" type="button">Exportar JSON</button>` : ""}
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
          <div class="map-wrap" id="mapWrap">
            <div class="vector-stage">
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
      <span class="zoom-readout" id="zoomReadout">${Math.round(state.mapZoom * 100)}%</span>
      <button class="map-control-btn" id="zoomIn" type="button" aria-label="Acercar">+</button>
      <button class="map-reset-btn" id="zoomReset" type="button">Centrar</button>
    </div>
  `;
}

function renderVectorMap(visible) {
  return `
    <svg
      id="vectorMap"
      class="vector-map"
      viewBox="${mapViewBoxAttr()}"
      preserveAspectRatio="xMidYMid meet"
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
        ${isAdmin() && data.precio ? `<br />Bs. ${formatMoney(Number(data.precio))}` : ""}
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
        ${isAdmin() ? `<button class="ghost-btn" id="clearHistoryBtn" type="button">Limpiar historial</button>` : ""}
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
          ${isAdmin() && item.precio ? ` · Bs. ${formatMoney(Number(item.precio))}` : ""}
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
  const sellerLocked = isSeller() && data.status === "vendido";
  const statusControl = isAdmin()
    ? `
          <label class="field">
            <span>Estado</span>
            <select class="select" id="formStatus">
              ${Object.entries(STATUS)
                .map(([key, status]) => `<option value="${key}" ${data.status === key ? "selected" : ""}>${status.label}</option>`)
                .join("")}
            </select>
          </label>
        `
    : `
          <input id="formStatus" type="hidden" value="reservado" />
          <div class="seller-rule">
            Vendedor: solo puede guardar este nicho como reservado.
          </div>
        `;

  if (sellerLocked) {
    return `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal">
          <div class="modal-head">
            <div>
              <h2>Nicho ${escapeHtml(id)}</h2>
              <p class="small-text">Grupo ${escapeHtml(lot?.grupo || "-")}</p>
            </div>
            ${renderBadge(data.status)}
          </div>
          <div class="modal-body">
            <div class="seller-rule danger">
              Este nicho ya esta vendido. Un vendedor no puede cambiarlo.
            </div>
            <div class="modal-actions single">
              <button class="primary-btn" id="cancelModal" type="button">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

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
          ${statusControl}
          <label class="field">
            <span>${isSeller() ? "Responsable de reserva" : "Comprador o responsable"}</span>
            <input class="input" id="formBuyer" value="${escapeAttr(data.comprador || "")}" placeholder="Nombre completo" />
          </label>
          ${
            isAdmin()
              ? `
                  <label class="field">
                    <span>Precio Bs.</span>
                    <input class="input" id="formPrice" type="number" min="0" step="1" value="${escapeAttr(data.precio || "")}" placeholder="0" />
                  </label>
                `
              : ""
          }
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
    setMapZoom(state.mapZoom / 1.25);
  });

  document.querySelector("#zoomIn")?.addEventListener("click", () => {
    setMapZoom(state.mapZoom * 1.25);
  });

  document.querySelector("#zoomReset")?.addEventListener("click", () => {
    state.mapZoom = DEFAULT_MAP_ZOOM;
    state.mapCenter = defaultMapCenter;
    updateMapSvg();
  });

  document.querySelector("#clearHistoryBtn")?.addEventListener("click", () => {
    if (!isAdmin()) return;
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

  bindMapGestures();

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

function bindMapGestures() {
  const svg = document.querySelector("#vectorMap");
  const wrap = document.querySelector("#mapWrap");
  if (!svg || !wrap) return;
  syncMapAspect(svg);

  const pointers = new Map();
  const gesture = {
    downTargetLot: null,
    downClient: null,
    lastPoint: null,
    lastTap: null,
    moved: false,
    pinch: null,
    suppressClick: false
  };

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.18 : 0.85;
    zoomMapAtClient(svg, event.clientX, event.clientY, state.mapZoom * factor);
  }, { passive: false });

  svg.addEventListener("dblclick", (event) => {
    if (event.target.closest?.("[data-lot]")) return;
    event.preventDefault();
    suppressNextMapClick(gesture);
    zoomMapAtClient(svg, event.clientX, event.clientY, state.mapZoom * 1.8);
  });

  svg.addEventListener("click", (event) => {
    if (!gesture.suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    gesture.suppressClick = false;
  }, true);

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    pointers.set(event.pointerId, pointFromClient(event));
    gesture.downTargetLot = event.target.closest?.("[data-lot]") || null;
    gesture.downClient = pointFromClient(event);
    gesture.lastPoint = svgPointFromClient(svg, event.clientX, event.clientY);
    gesture.moved = false;
    gesture.pinch = null;
    wrap.classList.add("is-touching");

    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Some older browsers do not allow capture on SVG nodes.
    }

    if (pointers.size === 2) {
      startPinchGesture(svg, pointers, gesture);
    }
  });

  svg.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, pointFromClient(event));

    if (pointers.size >= 2) {
      if (!gesture.pinch) startPinchGesture(svg, pointers, gesture);
      updatePinchGesture(svg, pointers, gesture);
      wrap.classList.add("is-dragging");
      return;
    }

    const currentPoint = svgPointFromClient(svg, event.clientX, event.clientY);
    if (!currentPoint || !gesture.lastPoint) return;
    const movedBy = gesture.downClient ? distance(pointFromClient(event), gesture.downClient) : 0;
    if (movedBy > 6) {
      gesture.moved = true;
      wrap.classList.add("is-dragging");
      state.mapCenter = {
        x: state.mapCenter.x - (currentPoint.x - gesture.lastPoint.x),
        y: state.mapCenter.y - (currentPoint.y - gesture.lastPoint.y)
      };
      updateMapSvg(svg);
    }
    gesture.lastPoint = svgPointFromClient(svg, event.clientX, event.clientY);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    svg.addEventListener(eventName, (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);

      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        gesture.lastPoint = svgPointFromClient(svg, remaining.x, remaining.y);
        gesture.pinch = null;
        return;
      }

      wrap.classList.remove("is-touching", "is-dragging");
      if (gesture.moved) {
        suppressNextMapClick(gesture);
      } else if (!gesture.downTargetLot) {
        handleBlankMapTap(svg, event, gesture);
      }
      gesture.downTargetLot = null;
      gesture.downClient = null;
      gesture.lastPoint = null;
      gesture.moved = false;
      gesture.pinch = null;
    });
  });
}

function pointFromClient(event) {
  return { x: event.clientX, y: event.clientY };
}

function svgPointFromClient(svg, clientX, clientY) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(matrix.inverse());
}

function startPinchGesture(svg, pointers, gesture) {
  const [first, second] = [...pointers.values()];
  const midpoint = midpointOf(first, second);
  gesture.pinch = {
    distance: Math.max(1, distance(first, second)),
    zoom: state.mapZoom,
    view: getMapView(),
    anchor: svgPointFromClient(svg, midpoint.x, midpoint.y)
  };
  gesture.moved = true;
}

function updatePinchGesture(svg, pointers, gesture) {
  const [first, second] = [...pointers.values()];
  if (!first || !second || !gesture.pinch?.anchor) return;
  const nextZoom = gesture.pinch.zoom * (distance(first, second) / gesture.pinch.distance);
  const midpoint = midpointOf(first, second);
  setMapZoom(nextZoom, gesture.pinch.anchor, gesture.pinch.view, svg);
  const currentMidpoint = svgPointFromClient(svg, midpoint.x, midpoint.y);
  if (currentMidpoint) {
    state.mapCenter = {
      x: state.mapCenter.x + (gesture.pinch.anchor.x - currentMidpoint.x),
      y: state.mapCenter.y + (gesture.pinch.anchor.y - currentMidpoint.y)
    };
    updateMapSvg(svg);
  }
}

function handleBlankMapTap(svg, event, gesture) {
  const now = Date.now();
  const tap = pointFromClient(event);
  const lastTap = gesture.lastTap;
  if (lastTap && now - lastTap.at < 320 && distance(tap, lastTap) < 28) {
    suppressNextMapClick(gesture);
    zoomMapAtClient(svg, event.clientX, event.clientY, state.mapZoom * 1.8);
    gesture.lastTap = null;
    return;
  }
  gesture.lastTap = { ...tap, at: now };
}

function midpointOf(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function suppressNextMapClick(gesture) {
  gesture.suppressClick = true;
  window.setTimeout(() => {
    gesture.suppressClick = false;
  }, 450);
}

function zoomMapAtClient(svg, clientX, clientY, zoom) {
  const anchor = svgPointFromClient(svg, clientX, clientY);
  setMapZoom(zoom, anchor, getMapView(), svg);
}

function setMapZoom(zoom, anchor = null, sourceView = getMapView(), svg = document.querySelector("#vectorMap")) {
  const nextZoom = clampMapZoom(zoom);
  if (anchor) {
    const { width, height } = getMapViewSize(nextZoom);
    const focusX = (anchor.x - sourceView.x) / sourceView.width;
    const focusY = (anchor.y - sourceView.y) / sourceView.height;
    state.mapCenter = {
      x: anchor.x - focusX * width + width / 2,
      y: anchor.y - focusY * height + height / 2
    };
  }
  state.mapZoom = nextZoom;
  updateMapSvg(svg);
}

function syncMapAspect(svg = document.querySelector("#vectorMap")) {
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const nextAspect = rect.width / rect.height;
  if (Math.abs(nextAspect - state.mapAspect) < 0.01) return;
  state.mapAspect = nextAspect;
  updateMapSvg(svg);
}

function updateMapSvg(svg = document.querySelector("#vectorMap")) {
  const view = applyMapView();
  if (svg) {
    svg.setAttribute("viewBox", [view.x, view.y, view.width, view.height].map(formatMapNumber).join(" "));
  }
  const readout = document.querySelector("#zoomReadout");
  if (readout) {
    readout.textContent = `${Math.round(state.mapZoom * 100)}%`;
  }
}

function saveLotFromForm(event) {
  event.preventDefault();
  const id = state.selectedId;
  const current = lotData(id);

  if (isSeller() && current.status === "vendido") {
    state.selectedId = null;
    showToast("Un vendedor no puede cambiar nichos vendidos");
    render();
    return;
  }

  const next = {
    status: isSeller() ? "reservado" : document.querySelector("#formStatus").value,
    comprador: document.querySelector("#formBuyer").value.trim(),
    precio: isSeller() ? current.precio || "" : document.querySelector("#formPrice").value,
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
