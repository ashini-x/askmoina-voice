(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const status = $("#status");
  const number = (id, value) => { const node = $(id); if (node) node.textContent = Number(value || 0).toLocaleString(); };
  const date = (value) => {
    if (!value) return "—";
    const parsed = new Date(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : ""));
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  };
  const duration = (seconds) => {
    if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
    const total = Math.max(0, Math.round(Number(seconds)));
    return Math.floor(total / 60) + "m " + (total % 60) + "s";
  };
  const cell = (row, value) => {
    const td = document.createElement("td");
    td.textContent = value == null || value === "" ? "—" : String(value);
    row.appendChild(td);
  };
  async function getJson(path) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (response.status === 401) { window.location.assign("/admin"); throw new Error("Please sign in again."); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error("Admin data could not be loaded.");
    return result;
  }
  async function load() {
    if (status) status.textContent = "Refreshing analytics…";
    try {
      const [overview, sessions, events] = await Promise.all([
        getJson("/admin/api/overview"),
        getJson("/admin/api/sessions"),
        getJson("/admin/api/events"),
      ]);
      number("#totalSessions", overview.totalSessions);
      number("#recentSessions", overview.sessions24h);
      number("#uniqueVisitors", overview.visitors24h);
      number("#voiceMinutes", Math.floor(Number(overview.durationSeconds30d || 0) / 60));
      number("#failures", overview.failures24h);
      number("#activeSessions", overview.activeObserved);
      const sessionBody = $("#sessions");
      sessionBody.replaceChildren();
      for (const item of sessions.sessions) {
        const row = document.createElement("tr");
        cell(row, date(item.started_at));
        cell(row, item.visitor_id ? String(item.visitor_id).slice(0, 13) : "anonymous");
        cell(row, duration(item.duration_seconds));
        cell(row, item.outcome);
        cell(row, Number(item.setup_completed) === 1 ? "Complete" : "Unconfirmed");
        cell(row, item.model);
        sessionBody.appendChild(row);
      }
      if (!sessions.sessions.length) {
        const row = document.createElement("tr"); const td = document.createElement("td");
        td.colSpan = 6; td.textContent = "No voice sessions have been recorded yet."; row.appendChild(td); sessionBody.appendChild(row);
      }
      const eventBody = $("#events");
      eventBody.replaceChildren();
      for (const item of events.events) {
        const row = document.createElement("tr");
        cell(row, date(item.created_at));
        cell(row, item.user_id ? String(item.user_id).slice(0, 13) : "anonymous");
        cell(row, item.event_type);
        cell(row, duration(item.duration_seconds));
        eventBody.appendChild(row);
      }
      if (!events.events.length) {
        const row = document.createElement("tr"); const td = document.createElement("td");
        td.colSpan = 4; td.textContent = "No operational events have been recorded yet."; row.appendChild(td); eventBody.appendChild(row);
      }
      if (status) status.textContent = "Updated " + new Date().toLocaleTimeString() + " · model " + overview.model + " · " + overview.location + " · version " + overview.version + ". " + overview.note;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "Unable to load analytics.";
    }
  }
  const refresh = $("#refresh");
  if (refresh) refresh.addEventListener("click", () => void load());
  void load();
  window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
})();