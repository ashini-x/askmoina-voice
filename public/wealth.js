(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = { schemes: [], simulations: [], activeSimulation: null, searchTimer: 0, searchAbort: null, status: null };
  const money = (paise) => paise == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(paise) / 100);
  const percent = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : (Number(value) * 100).toFixed(2) + "%";
  const navMoney = (nav) => nav == null || !Number.isFinite(Number(nav)) ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 4 }).format(Number(nav));
  const indiaToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
  const dateLabel = (value) => {
    if (!value) return "—";
    const date = new Date(value + "T00:00:00Z");
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  };
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "request_failed");
    return payload;
  };
  const setStatus = (text, isError = false) => {
    const node = $("#builder-status");
    node.textContent = text;
    node.classList.toggle("is-error", isError);
  };
  const showTab = (name) => {
    $$(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === name));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.panel === name));
  };
  const schemeExists = (code) => state.schemes.some((scheme) => scheme.schemeCode === code);
  const renderSelected = () => {
    const host = $("#selected-funds");
    host.replaceChildren();
    state.schemes.forEach((scheme) => {
      const row = document.createElement("div");
      row.className = "selected-fund";
      const title = document.createElement("div");
      title.className = "scheme-title";
      title.textContent = scheme.schemeName;
      const amount = document.createElement("input");
      amount.type = "number";
      amount.min = "100";
      amount.max = "1000000";
      amount.step = "100";
      amount.inputMode = "decimal";
      amount.value = String(scheme.monthlyAmount || 5000);
      amount.setAttribute("aria-label", "Monthly SIP in rupees for " + scheme.schemeName);
      amount.addEventListener("change", () => { scheme.monthlyAmount = Number(amount.value); updateCreateButton(); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + scheme.schemeName);
      remove.addEventListener("click", () => { state.schemes = state.schemes.filter((item) => item.schemeCode !== scheme.schemeCode); renderSelected(); });
      row.append(title, amount, remove);
      host.append(row);
    });
    updateCreateButton();
  };
  const updateCreateButton = () => {
    $("#create-simulation").disabled = !state.schemes.length || state.schemes.some((scheme) => !Number.isFinite(scheme.monthlyAmount) || scheme.monthlyAmount < 100 || scheme.monthlyAmount > 1000000);
  };
  const renderSearchResults = (schemes) => {
    const host = $("#fund-results");
    host.replaceChildren();
    schemes.slice(0, 15).forEach((scheme) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const title = document.createElement("span");
      title.textContent = scheme.schemeName;
      const code = document.createElement("small");
      code.textContent = "Code " + scheme.schemeCode;
      button.append(title, code);
      button.setAttribute("role", "option");
      button.addEventListener("click", () => {
        if (!schemeExists(scheme.schemeCode) && state.schemes.length < 6) {
          state.schemes.push({ ...scheme, monthlyAmount: 5000 });
          renderSelected();
        }
        host.hidden = true;
        $("#fund-search").value = "";
        if (state.schemes.length >= 6) setStatus("A simulation can contain up to six schemes.");
      });
      host.append(button);
    });
    host.hidden = schemes.length === 0;
  };
  const searchFunds = async (query) => {
    if (state.searchAbort) state.searchAbort.abort();
    state.searchAbort = new AbortController();
    $("#search-spinner").hidden = false;
    try {
      const result = await api("/api/wealth/funds/search?q=" + encodeURIComponent(query), { signal: state.searchAbort.signal });
      renderSearchResults(result.schemes || []);
    } catch (error) {
      if (error.name !== "AbortError") setStatus("Fund search is temporarily unavailable. Try again.", true);
    } finally {
      $("#search-spinner").hidden = true;
    }
  };
  const renderSimulationRows = (rows, host) => {
    host.replaceChildren();
    rows.forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "simulation-row";
      const left = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = row.title;
      const meta = document.createElement("small");
      meta.textContent = (row.plan_count || 0) + " schemes · Created " + dateLabel((row.created_at || "").slice(0, 10));
      left.append(title, meta);
      const arrow = document.createElement("span");
      arrow.className = "chevron";
      arrow.textContent = "›";
      button.append(left, arrow);
      button.addEventListener("click", () => loadSimulation(row.simulation_id));
      host.append(button);
    });
  };
  const refreshSimulations = async () => {
    const result = await api("/api/wealth/simulations");
    state.simulations = result.simulations || [];
    renderSimulationRows(state.simulations, $("#simulation-list"));
    renderSimulationRows(state.simulations, $("#fund-simulation-list"));
    $("#overview-empty").hidden = state.simulations.length > 0;
    if (state.simulations.length && !state.activeSimulation) await loadSimulation(state.simulations[0].simulation_id);
  };
  const renderPerformanceChart = (points) => {
    const svg = $("#performance-chart");
    svg.replaceChildren();
    const note = $("#performance-chart-note");
    $("#performance-chart-start").textContent = "—";
    $("#performance-chart-end").textContent = "—";
    if (!Array.isArray(points) || points.length < 2) {
      note.textContent = "A complete shared daily NAV series is not available for this simulation yet. No estimated chart points are shown.";
      return;
    }
    const values = points.map((point) => Number(point.valuePaise));
    const invested = points.map((point) => Number(point.investedPaise));
    if ([...values, ...invested].some((value) => !Number.isFinite(value) || value < 0)) {
      note.textContent = "The provider history did not pass chart validation. No chart is shown.";
      return;
    }
    const max = Math.max(1, ...values, ...invested);
    const width = 360, height = 150, left = 8, right = 8, top = 10, bottom = 10;
    const xAt = (index) => left + (index / Math.max(1, points.length - 1)) * (width - left - right);
    const yAt = (value) => height - bottom - (value / max) * (height - top - bottom);
    const addLine = (className, x1, y1, x2, y2) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", className);
      line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
      svg.append(line);
    };
    [0.25, 0.5, 0.75].forEach((fraction) => addLine("chart-grid-line", left, yAt(max * fraction), width - right, yAt(max * fraction)));
    const makePolyline = (className, series) => {
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      const coordinates = series.map((value, index) => xAt(index) + "," + yAt(value)).join(" ");
      polyline.setAttribute("class", className);
      polyline.setAttribute("points", coordinates);
      svg.append(polyline);
    };
    makePolyline("chart-invested-line", invested);
    makePolyline("chart-value-line", values);
    const last = points[points.length - 1];
    const valueText = money(last.valuePaise);
    svg.setAttribute("aria-label", "From " + dateLabel(points[0].date) + " to " + dateLabel(last.date) +
      ". Paper value " + valueText + ", contributions " + money(last.investedPaise) + ".");
    $("#performance-chart-start").textContent = dateLabel(points[0].date);
    $("#performance-chart-end").textContent = dateLabel(last.date);
    note.textContent = "Actual daily NAV dates shared by all selected schemes; " + points.length +
      " plotted observations. Missing dates are not interpolated.";
  };

  const renderMetrics = (simulation) => {
    $("#portfolio-value").textContent = money(simulation.currentValuePaise);
    $("#portfolio-invested").textContent = money(simulation.investedPaise);
    $("#portfolio-profit").textContent = money(simulation.profitLossPaise);
    $("#portfolio-xirr").textContent = percent(simulation.xirr);
    $("#portfolio-asof").textContent = simulation.latestValuationDate ? "NAV " + dateLabel(simulation.latestValuationDate) : "NAV pending";
    const returnNode = $("#portfolio-return");
    returnNode.textContent = !simulation.valuationComplete
      ? "Latest NAV unavailable — valuation incomplete"
      : simulation.investedPaise <= 0
        ? "No SIP allotments have been priced yet"
        : (simulation.profitLossPaise >= 0 ? "+" : "") + money(simulation.profitLossPaise) + " (" + percent(simulation.absoluteReturn) + ")";
    returnNode.classList.toggle("positive", simulation.profitLossPaise > 0);
    returnNode.classList.toggle("negative", simulation.profitLossPaise < 0);
    $("#portfolio-note").textContent = !simulation.valuationComplete
      ? "Some latest NAVs could not be retrieved. Incomplete valuations are not replaced with estimates."
      : simulation.investedPaise <= 0
        ? "No NAV-matched SIP allotments have completed as of the selected valuation date. Pending schedules remain separate."
        : "Showing this saved simulation only. Values use real dated NAV observations; separate simulations are not added together.";
  };
  const loadSimulation = async (id) => {
    try {
      const result = await api("/api/wealth/simulations/" + encodeURIComponent(id));
      const simulation = result.simulation;
      state.activeSimulation = simulation;
      renderMetrics(simulation);
      renderPerformanceChart(simulation.performanceSeries);
      $("#detail-title").textContent = simulation.title;
      $("#detail-value").textContent = money(simulation.currentValuePaise);
      $("#detail-invested").textContent = money(simulation.investedPaise);
      $("#detail-absolute").textContent = percent(simulation.absoluteReturn);
      $("#detail-xirr").textContent = percent(simulation.xirr);
      const host = $("#detail-funds");
      host.replaceChildren();
      simulation.plans.forEach((plan) => {
        const card = document.createElement("div");
        card.className = "detail-fund";
        const name = document.createElement("strong");
        name.textContent = plan.schemeName;
        const value = document.createElement("span");
        value.className = "detail-number";
        value.textContent = money(plan.currentValuePaise);
        const meta = document.createElement("small");
        const missedCount = Number(plan.missedInstallments || 0);
        const pendingCount = Number(plan.pendingInstallments || 0);
        const missedDates = Array.isArray(plan.missedInstallmentDates) ? plan.missedInstallmentDates : [];
        const pendingDates = Array.isArray(plan.pendingInstallmentDates) ? plan.pendingInstallmentDates : [];
        meta.textContent = money(plan.monthlyAmountPaise) + "/month · " + Number(plan.appliedPurchaseCount || 0) +
          "/" + Number(plan.purchaseCount || 0) + " priced by as-of date · " + pendingCount + " pending · " +
          missedCount + " missed · " + Number(plan.units).toFixed(4) + " units";
        const nav = document.createElement("small");
        nav.className = "detail-nav";
        nav.textContent = plan.latestNav
          ? "Latest NAV " + navMoney(plan.latestNav.nav) + " · observed " + dateLabel(plan.latestNav.date) +
            " · portfolio as of " + dateLabel(plan.latestNav.portfolioValuationDate)
          : "Latest NAV unavailable — current value withheld";
        const performance = document.createElement("span");
        performance.className = "detail-sub";
        performance.textContent = "Abs. " + percent(plan.absoluteReturn) + " · XIRR " + percent(plan.xirr) +
          (pendingDates.length ? " · pending " + pendingDates.slice(0, 2).map(dateLabel).join(", ") + (pendingDates.length > 2 ? "…" : "") : "") +
          (missedDates.length ? " · missed " + missedDates.slice(0, 3).map(dateLabel).join(", ") + (missedDates.length > 3 ? "…" : "") : "");
        card.append(name, value, meta, nav, performance);
        host.append(card);
      });
      $("#detail-disclaimer").textContent = result.disclaimer;
      $("#simulation-detail").hidden = false;
      $("#simulation-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus("Could not load the selected simulation: " + error.message, true);
    }
  };
  const createSimulation = async () => {
    const button = $("#create-simulation");
    const startDate = $("#sip-start").value;
    const endDate = $("#sip-end").value;
    if (!state.schemes.length || !startDate || !endDate) return;
    button.disabled = true;
    button.textContent = "Fetching NAV history…";
    setStatus("Loading actual NAV history and matching SIP dates. No estimated prices are used.");
    try {
      const payload = await api("/api/wealth/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "SIP journey from " + dateLabel(startDate),
          plans: state.schemes.map((scheme) => ({
            schemeCode: scheme.schemeCode,
            monthlyAmountPaise: Math.round(scheme.monthlyAmount * 100),
            startDate,
            endDate,
            sipDay: Number($("#sip-day").value),
          })),
        }),
      });
      setStatus("Simulation created from NAV observations. Loading the latest valuation…");
      await refreshSimulations();
      if (payload.simulationId) await loadSimulation(payload.simulationId);
      showTab("overview");
      state.schemes = [];
      renderSelected();
      setStatus("Historical paper simulation created. Check the missed-installment notes in the detailed record.");
    } catch (error) {
      setStatus("Simulation could not be created: " + error.message + ". No partial result has been displayed.", true);
    } finally {
      button.textContent = "Create historical SIP simulation";
      updateCreateButton();
    }
  };
  const initialize = async () => {
    $("#sip-end").value = indiaToday();
    $$(".tab-button").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
    $$("[data-go-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.goTab)));
    $("#fund-search").addEventListener("input", (event) => {
      const query = event.target.value.trim();
      clearTimeout(state.searchTimer);
      if (query.length < 2) { $("#fund-results").hidden = true; return; }
      state.searchTimer = setTimeout(() => searchFunds(query), 260);
    });
    document.addEventListener("click", (event) => {
      if (!$("#fund-results").contains(event.target) && event.target !== $("#fund-search")) $("#fund-results").hidden = true;
    });
    $("#create-simulation").addEventListener("click", createSimulation);
    $("#close-detail").addEventListener("click", () => { $("#simulation-detail").hidden = true; });
    try {
      state.status = await api("/api/wealth/status");
      $("#stock-feed-status").textContent = !state.status.providers.stockHistoryEnabled
        ? "Disabled pending entitlement review"
        : state.status.providers.stockHistoryReady ? "Token configured" : "Access token missing";
      await refreshSimulations();
    } catch (error) {
      setStatus("Wealth service could not be reached: " + error.message, true);
      $("#stock-feed-status").textContent = "Status unavailable";
    }
  };
  document.addEventListener("DOMContentLoaded", initialize);
})();