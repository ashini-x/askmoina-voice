(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const projectSelect = $("project");
  const form = $("query-form");
  const submit = $("submit-query");
  const connection = $("connection");
  let projects = [];

  function setStatus(message, error = false) {
    const node = $("form-status");
    node.textContent = message;
    node.classList.toggle("error", error);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The test Worker returned an invalid response.");
    }
    if (!response.ok || data.ok !== true) {
      const detail = data && data.error && data.error.message;
      const code = data && data.error && data.error.code;
      const error = new Error(detail || "The BRVIN request could not be completed.");
      error.code = code || "UNKNOWN";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function updateSubmit() {
    const selected = projects.find((item) => item.projectId === projectSelect.value);
    const hasInput = $("query").value.trim().length > 0 || $("page-number").value.trim().length > 0;
    submit.disabled = !selected || !selected.ready || !hasInput;
  }

  function renderProjects(items) {
    projects = items;
    projectSelect.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = items.length ? "Select a project" : "No authorised projects";
    projectSelect.append(first);

    for (const project of items) {
      const option = document.createElement("option");
      option.value = project.projectId;
      option.textContent = project.name + (project.ready ? "" : " · not ready");
      option.disabled = !project.ready;
      projectSelect.append(option);
    }
    projectSelect.disabled = items.length === 0;
    updateSubmit();
  }

  async function loadProjects() {
    connection.classList.remove("ready", "offline");
    connection.textContent = "Checking BRVIN connection…";
    setStatus("Loading projects assigned to this test application…");
    try {
      const data = await api("/api/projects");
      renderProjects(data.projects || []);
      connection.textContent = "Connected to BRVIN";
      connection.classList.add("ready");
      setStatus(data.projects && data.projects.length
        ? "Choose an authorised project and enter a query or physical PDF page."
        : "This application has no active project grants yet.");
    } catch (error) {
      renderProjects([]);
      connection.textContent = "Not connected";
      connection.classList.add("offline");
      setStatus(error.message, true);
      $("result-message").textContent = error.message;
    }
  }

  function clearResults() {
    $("passages").replaceChildren();
    $("result-message").hidden = false;
    $("result-message").textContent = "Retrieving evidence…";
    $("result-count").textContent = "Request in progress";
  }

  function renderPassages(data) {
    const container = $("passages");
    container.replaceChildren();
    const passages = data.passages || [];
    $("result-count").textContent = passages.length + (passages.length === 1 ? " passage" : " passages") +
      " · " + Number(data.searchedSources || 0) + " source(s)";

    if (!passages.length) {
      $("result-message").hidden = false;
      $("result-message").textContent = "BRVIN returned no matching passage for this authorised project and request.";
      return;
    }

    $("result-message").hidden = true;
    for (const item of passages) {
      const card = document.createElement("article");
      card.className = "passage";
      const head = document.createElement("div");
      head.className = "passage-head";
      const citation = document.createElement("p");
      citation.className = "citation";
      citation.textContent = item.citation || (item.bookTitle + " · PDF page " + item.pdfPage);
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = Number.isFinite(Number(item.score)) ? "Score " + Number(item.score).toFixed(3) : "";
      head.append(citation, score);

      const text = document.createElement("p");
      text.className = "passage-text";
      text.textContent = item.text || "";

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [
        item.section ? "Section: " + item.section : "",
        item.printedPage ? "Printed page: " + item.printedPage : "",
      ].filter(Boolean).join(" · ");

      card.append(head, text);
      if (meta.textContent) card.append(meta);
      container.append(card);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    updateSubmit();
    if (submit.disabled) return;

    const pageValue = $("page-number").value.trim();
    const payload = {
      projectId: projectSelect.value,
      query: $("query").value.trim(),
      ...(pageValue ? { pageNumber: Number(pageValue) } : {}),
    };
    submit.disabled = true;
    submit.textContent = "Retrieving…";
    clearResults();
    try {
      const data = await api("/api/retrieve", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderPassages(data);
      setStatus("Retrieval completed. Evidence is shown with its BRVIN source and physical PDF page.");
    } catch (error) {
      $("result-message").hidden = false;
      $("result-message").textContent = error.message;
      $("result-count").textContent = "Request not completed";
      setStatus(error.message, true);
    } finally {
      submit.textContent = "Retrieve evidence";
      updateSubmit();
    }
  });

  projectSelect.addEventListener("change", updateSubmit);
  $("query").addEventListener("input", updateSubmit);
  $("page-number").addEventListener("input", updateSubmit);
  $("refresh-projects").addEventListener("click", loadProjects);
  loadProjects();
})();
