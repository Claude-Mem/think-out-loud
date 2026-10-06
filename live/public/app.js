"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const ui = {
    connection: byId("connection"),
    connectionText: byId("connection-text"),
    connectionError: byId("connection-error"),
    pauseButton: byId("pause-button"),
    pauseLabel: byId("pause-label"),
    streamMessage: byId("stream-message"),
    empty: byId("empty-state"),
    current: byId("current-thought"),
    previousSection: byId("previous-section"),
    previous: byId("previous-thoughts"),
    previousCount: byId("previous-count"),
    historyButton: byId("history-button"),
    adapter: byId("adapter-note"),
    announcement: byId("announcement"),
    sessionName: byId("session-name"),
    sessionInput: byId("session-input"),
    sessionForm: byId("session-form"),
    sessionError: byId("session-error"),
  };

  const sessionId = new URLSearchParams(window.location.search).get("session") || "main";
  const sessionQuery = `?session=${encodeURIComponent(sessionId)}`;
  const entries = new Map();
  let liveState = { notes: [], feedback: [], adapter: {} };
  let viewState = liveState;
  let paused = false;
  let allHistory = false;
  let lastCurrentId = null;
  let eventSource;

  const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const asText = (value) => typeof value === "string" ? value : "";
  const announce = (message) => { ui.announcement.textContent = message; };

  ui.sessionName.textContent = sessionId;
  ui.sessionInput.value = sessionId;
  document.title = `Think out loud · ${sessionId}`;

  function connectStatus(state, message) {
    ui.connection.dataset.state = state;
    ui.connectionText.textContent = message;
  }

  function cleanState(value) {
    if (!value || !Array.isArray(value.notes) || !Array.isArray(value.feedback)) {
      throw new Error("The live update could not be read. Reconnecting to the workspace.");
    }
    return {
      notes: value.notes.filter((note) => note && typeof note.id === "string"),
      feedback: value.feedback.filter((reply) => reply && typeof reply.id === "string"),
      adapter: value.adapter && typeof value.adapter === "object" ? value.adapter : {},
    };
  }

  function noteSignature(note) {
    return JSON.stringify([
      note.status, note.original, note.display, note.error, note.thoughtNumber,
      note.totalThoughts, note.nextThoughtNeeded, note.needsMoreThoughts, note.isRevision,
      note.revisesThought, note.branchId, note.branchFromThought,
    ]);
  }

  function pendingUpdates() {
    const previous = new Map(viewState.notes.map((note) => [note.id, noteSignature(note)]));
    let added = 0;
    let changed = 0;
    for (const note of liveState.notes) {
      if (!previous.has(note.id)) added += 1;
      else if (previous.get(note.id) !== noteSignature(note)) changed += 1;
    }
    return { added, changed, count: added + changed };
  }

  function updatePauseControl() {
    const pending = pendingUpdates();
    ui.pauseButton.setAttribute("aria-pressed", String(paused));
    ui.pauseLabel.textContent = paused ? `Resume${pending.count ? ` · ${pending.count} ${pending.changed ? "updates" : "new"}` : " reading"}` : "Pause reading";
    ui.pauseButton.setAttribute("aria-label", paused ? `Resume reading${pending.count ? `, ${pending.count} updates available` : ""}` : "Pause reading");
    ui.streamMessage.hidden = !paused;
    const incoming = pending.count ? ` ${pending.count} ${pending.changed ? (pending.count === 1 ? "update is" : "updates are") : (pending.count === 1 ? "new thought is" : "new thoughts are")} waiting.` : " New notes keep arriving in the background.";
    ui.streamMessage.textContent = `Reading is paused, so you can take your time.${incoming}`;
  }

  function pauseForReply() {
    if (paused) return;
    paused = true;
    updatePauseControl();
    announce("Reading paused while you add your thought. Incoming notes keep arriving.");
  }

  function receiveState(value) {
    const nextState = cleanState(value);
    liveState = nextState;
    ui.connectionError.hidden = true;
    if (paused) viewState = { ...viewState, feedback: nextState.feedback, adapter: nextState.adapter };
    else viewState = nextState;
    renderView();
    updatePauseControl();
  }

  function readableTime(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function progressLabel(note) {
    if (Number.isFinite(note.thoughtNumber)) {
      return Number.isFinite(note.totalThoughts) ? `Thought ${note.thoughtNumber} of ${note.totalThoughts}` : `Thought ${note.thoughtNumber}`;
    }
    return "Working note";
  }

  function noteTitle(note) {
    if (note.status === "ready" && note.display && asText(note.display.title)) return note.display.title;
    if (note.status === "error") return "This thought needs a little help";
    return "Making this thought easier to follow";
  }

  function createEntry(note) {
    const article = el("article", "note-current");
    const metadata = el("div", "note-metadata");
    const content = el("div", "note-content");
    const replyTrail = el("div", "reply-trail");
    replyTrail.hidden = true;
    const actions = el("div", "note-actions");
    const addButton = el("button", "add-thought-button", "Add your thought");
    addButton.type = "button";
    addButton.setAttribute("aria-expanded", "false");
    const original = el("details", "original-details");
    const originalSummary = el("summary", "", "Read original");
    const originalText = el("p", "original-text");
    original.append(originalSummary, originalText);
    const composer = el("form", "reply-composer");
    composer.hidden = true;
    const inputId = `reply-${entries.size + 1}`;
    const label = el("label", "", "What would you add?");
    label.htmlFor = inputId;
    const textarea = el("textarea");
    textarea.id = inputId;
    textarea.name = "thought";
    textarea.rows = 3;
    textarea.maxLength = 8000;
    textarea.placeholder = "A question, an idea, a different direction…";
    const error = el("p", "field-error");
    error.id = `${inputId}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;
    const bottom = el("div", "composer-bottom");
    const hint = el("p", "composer-hint", "The agent picks this up at its next checkpoint.");
    hint.id = `${inputId}-hint`;
    textarea.setAttribute("aria-describedby", `${hint.id} ${error.id}`);
    const buttons = el("div", "composer-buttons");
    const cancel = el("button", "cancel-button", "Cancel");
    cancel.type = "button";
    const send = el("button", "send-button", "Send thought");
    send.type = "submit";
    buttons.append(cancel, send);
    bottom.append(hint, buttons);
    composer.append(label, textarea, error, bottom);
    actions.append(addButton, original);
    article.append(metadata, content, replyTrail, actions, composer);
    const previousShell = el("details", "note-previous");
    const previousSummary = el("summary", "previous-toggle");
    const previousNumber = el("span", "previous-number");
    const previousTitle = el("span", "previous-title");
    const previousReplyCount = el("span", "previous-reply-count");
    const previousChevron = el("span", "chevron");
    previousChevron.setAttribute("aria-hidden", "true");
    previousSummary.append(previousNumber, previousTitle, previousReplyCount, previousChevron);
    const previousBody = el("div", "previous-body");
    previousShell.append(previousSummary, previousBody);
    const entry = {
      note, article, metadata, content, replyTrail, actions, originalText,
      addButton, composer, textarea, error, send, cancel,
      previousShell, previousBody, previousNumber, previousTitle,
      previousReplyCount, signature: null, feedbackSignature: null,
    };

    addButton.addEventListener("click", () => {
      pauseForReply();
      composer.hidden = false;
      addButton.setAttribute("aria-expanded", "true");
      textarea.focus({ preventScroll: true });
    });
    cancel.addEventListener("click", () => {
      composer.hidden = true;
      addButton.setAttribute("aria-expanded", "false");
      error.hidden = true;
      textarea.removeAttribute("aria-invalid");
      addButton.focus({ preventScroll: true });
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!send.disabled) composer.requestSubmit();
      }
    });
    composer.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (send.disabled) return;
      const text = textarea.value;
      if (!text.trim()) {
        error.textContent = "Add a thought before sending.";
        error.hidden = false;
        textarea.setAttribute("aria-invalid", "true");
        textarea.focus({ preventScroll: true });
        return;
      }
      error.hidden = true;
      textarea.removeAttribute("aria-invalid");
      send.disabled = true;
      cancel.disabled = true;
      textarea.readOnly = true;
      send.textContent = "Sending…";
      try {
        const result = await request(`/api/notes/${encodeURIComponent(note.id)}/replies`, { method: "POST", body: JSON.stringify({ text }) });
        const reply = result.reply;
        if (reply && typeof reply.id === "string") {
          const existing = liveState.feedback.findIndex((item) => item.id === reply.id);
          if (existing >= 0) liveState.feedback[existing] = { ...reply, deliveredAt: liveState.feedback[existing].deliveredAt || reply.deliveredAt };
          else liveState.feedback.push(reply);
          viewState = { ...viewState, feedback: liveState.feedback };
          updateReplies(entry);
        }
        textarea.value = "";
        composer.hidden = true;
        addButton.setAttribute("aria-expanded", "false");
        addButton.focus({ preventScroll: true });
        announce("Your thought is in the agent’s inbox. The status will change when the agent picks it up.");
      } catch (failure) {
        error.textContent = failure.message || "Your thought could not be sent. Your draft is still here; try again.";
        error.hidden = false;
        textarea.focus({ preventScroll: true });
      } finally {
        send.disabled = false;
        cancel.disabled = false;
        textarea.readOnly = false;
        send.textContent = "Send thought";
      }
    });
    entries.set(note.id, entry);
    return entry;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    let result;
    try { result = await response.json(); } catch { throw new Error("The workspace could not be reached. Your draft is still here; try again."); }
    if (!response.ok) throw new Error(asText(result.error) || `The request could not be completed (${response.status}). Try again.`);
    return result;
  }

  function updateMetadata(entry, current) {
    const note = entry.note;
    const fragments = [];
    if (current) fragments.push(el("span", "current-label", "Current thought"), el("span", "meta-separator"));
    fragments.push(el("span", "", progressLabel(note)));
    const timeText = readableTime(note.createdAt);
    if (timeText) {
      const time = el("time", "", timeText);
      time.dateTime = asText(note.createdAt);
      fragments.push(el("span", "meta-separator"), time);
    }
    if (note.nextThoughtNeeded === false && note.needsMoreThoughts !== true) fragments.push(el("span", "meta-separator"), el("span", "", "Step complete"));
    const relationships = [];
    if (note.isRevision && note.revisesThought !== undefined) relationships.push(`Revises thought ${note.revisesThought}`);
    if (asText(note.branchId)) relationships.push(`Branch: ${note.branchId}${note.branchFromThought !== undefined ? ` from thought ${note.branchFromThought}` : ""}`);
    if (relationships.length) fragments.push(el("span", "note-branch", relationships.join(" · ")));
    entry.metadata.replaceChildren(...fragments);
    entry.previousNumber.textContent = Number.isFinite(note.thoughtNumber) ? String(note.thoughtNumber).padStart(2, "0") : "↳";
    entry.previousTitle.textContent = noteTitle(note);
  }

  function updateContent(entry) {
    const note = entry.note;
    const signature = noteSignature(note);
    if (entry.signature === signature) return;
    entry.signature = signature;
    entry.originalText.textContent = asText(note.original);
    const fragments = [];
    const heading = el("h2", "", noteTitle(note));
    fragments.push(heading);
    if (note.status === "ready" && note.display) {
      const display = note.display;
      if (asText(display.nextAction)) {
        const action = el("div", "next-action");
        action.append(el("p", "next-action-label", "↳ Next action"), el("p", "next-action-text", display.nextAction));
        fragments.push(action);
      }
      if (asText(display.summary)) fragments.push(el("p", "thought-summary", display.summary));
      if (Array.isArray(display.steps)) {
        const steps = display.steps.filter((step) => typeof step === "string" && step.trim()).slice(0, 5);
        if (steps.length) {
          const list = el("ol", "thought-steps");
          for (const step of steps) list.append(el("li", "", step));
          fragments.push(list);
        }
      }
      if (asText(display.uncertainty)) {
        const uncertainty = el("p", "uncertainty");
        uncertainty.append(el("strong", "", "Still open: "), document.createTextNode(display.uncertainty));
        fragments.push(uncertainty);
      }
    } else if (note.status === "error") {
      fragments.push(el("p", "note-state-copy", asText(note.error) || "This note could not be reshaped yet. Read the original below, or try the presentation again."));
      const retry = el("button", "retry-button", "Try presentation again");
      retry.type = "button";
      const retryError = el("p", "retry-error");
      retryError.setAttribute("role", "alert");
      retryError.hidden = true;
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "Trying again…";
        retryError.hidden = true;
        try {
          await request(`/api/notes/${encodeURIComponent(note.id)}/retry`, { method: "POST", body: "{}" });
          retry.textContent = "Presentation queued";
          announce("The presentation is being tried again.");
        } catch (failure) {
          retryError.textContent = failure.message;
          retryError.hidden = false;
          retry.disabled = false;
          retry.textContent = "Try presentation again";
        }
      });
      fragments.push(retry, retryError);
    } else {
      heading.className = "transforming-heading";
      const dots = el("span", "thinking-indicator");
      dots.setAttribute("aria-hidden", "true");
      dots.append(el("span"), el("span"), el("span"));
      heading.append(dots);
      fragments.push(el("p", "note-state-copy", "The working note has arrived. Its clearer presentation is on the way. You can read the original or add your thought now."));
    }
    entry.content.replaceChildren(...fragments);
  }

  function updateReplies(entry) {
    const replies = viewState.feedback.filter((reply) => reply.noteId === entry.note.id);
    replies.sort((left, right) => asText(left.createdAt).localeCompare(asText(right.createdAt)));
    const signature = JSON.stringify(replies);
    if (entry.feedbackSignature === signature) return;
    entry.feedbackSignature = signature;
    entry.replyTrail.hidden = !replies.length;
    entry.previousReplyCount.textContent = replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "";
    entry.previousReplyCount.hidden = !replies.length;
    if (!replies.length) { entry.replyTrail.replaceChildren(); return; }
    const fragments = [el("p", "reply-trail-heading", replies.length === 1 ? "Your thought" : "Your thoughts")];
    for (const reply of replies) {
      const item = el("div", "reply");
      const status = el("span", "reply-status", reply.deliveredAt ? "Picked up by the agent" : "Waiting in the agent’s inbox");
      status.dataset.delivered = String(Boolean(reply.deliveredAt));
      if (reply.deliveredAt) status.title = `Picked up at ${readableTime(reply.deliveredAt)}`;
      item.append(el("p", "", asText(reply.text)), status);
      fragments.push(item);
    }
    entry.replyTrail.replaceChildren(...fragments);
  }

  function placeInOrder(container, elements) {
    // Avoid moving unchanged nodes: a live update must not steal input focus.
    for (let index = 0; index < elements.length; index += 1) {
      if (container.children[index] !== elements[index]) container.insertBefore(elements[index], container.children[index] || null);
    }
    while (container.children.length > elements.length) container.lastElementChild.remove();
  }

  function renderView() {
    const notes = [...viewState.notes].sort((left, right) => asText(right.createdAt).localeCompare(asText(left.createdAt)));
    const visible = allHistory ? notes : notes.slice(0, 5);
    // Keep an open draft reachable even when the reader explicitly resumes.
    if (!allHistory) {
      for (const note of notes.slice(5)) {
        const existing = entries.get(note.id);
        if (existing && !existing.composer.hidden) visible.push(note);
      }
    }
    const current = visible[0];
    ui.empty.hidden = Boolean(current);
    ui.previousSection.hidden = visible.length < 2;
    ui.previousCount.textContent = `${Math.max(0, visible.length - 1)} shown`;
    ui.historyButton.hidden = notes.length <= 5;
    ui.historyButton.textContent = allHistory ? "Show fewer thoughts" : `Show ${notes.length - 5} older ${notes.length - 5 === 1 ? "thought" : "thoughts"}`;
    ui.historyButton.setAttribute("aria-expanded", String(allHistory));
    ui.adapter.hidden = viewState.adapter.available !== false;
    ui.adapter.textContent = "The presentation adapter is unavailable. You can still read originals and add your thoughts.";

    const currentElements = [];
    const previousElements = [];
    for (let index = 0; index < visible.length; index += 1) {
      const note = visible[index];
      const entry = entries.get(note.id) || createEntry(note);
      entry.note = note;
      updateMetadata(entry, index === 0);
      updateContent(entry);
      updateReplies(entry);
      if (index === 0) {
        entry.article.className = "note-current";
        currentElements.push(entry.article);
      } else {
        entry.article.className = "note-inner";
        if (entry.article.parentElement !== entry.previousBody) entry.previousBody.append(entry.article);
        if (!entry.composer.hidden) entry.previousShell.open = true;
        previousElements.push(entry.previousShell);
      }
    }
    placeInOrder(ui.current, currentElements);
    placeInOrder(ui.previous, previousElements);
    if (current && lastCurrentId !== current.id) {
      if (lastCurrentId) announce("A new working note has arrived.");
      lastCurrentId = current.id;
    }
  }

  ui.pauseButton.addEventListener("click", () => {
    paused = !paused;
    if (!paused) {
      // Explicit resume can move an open composer into history; preserve it.
      const active = document.activeElement;
      const selectionStart = active instanceof HTMLTextAreaElement ? active.selectionStart : null;
      const selectionEnd = active instanceof HTMLTextAreaElement ? active.selectionEnd : null;
      viewState = liveState;
      renderView();
      if (active instanceof HTMLTextAreaElement && document.contains(active)) {
        const parentDetails = active.closest(".note-previous");
        if (parentDetails) parentDetails.open = true;
        active.focus({ preventScroll: true });
        active.setSelectionRange(selectionStart, selectionEnd);
      }
      announce("Reading resumed. The latest thought is now shown.");
    } else announce("Reading paused. Incoming notes will wait until you resume.");
    updatePauseControl();
  });

  ui.historyButton.addEventListener("click", () => {
    allHistory = !allHistory;
    renderView();
  });

  ui.sessionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextSession = ui.sessionInput.value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(nextSession)) {
      ui.sessionError.textContent = "Start with a letter or number. Use up to 80 letters, numbers, periods, hyphens, or underscores.";
      ui.sessionError.hidden = false;
      ui.sessionInput.setAttribute("aria-invalid", "true");
      ui.sessionInput.focus();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("session", nextSession);
    window.location.assign(url.toString());
  });

  function beginEvents() {
    eventSource = new EventSource(`/api/events${sessionQuery}`);
    eventSource.onopen = () => connectStatus("connected", "Live · connected");
    eventSource.addEventListener("state", (event) => {
      try { receiveState(JSON.parse(event.data)); }
      catch (failure) {
        ui.connectionError.textContent = failure.message;
        ui.connectionError.hidden = false;
      }
    });
    eventSource.onerror = () => connectStatus("reconnecting", "Reconnecting");
  }

  async function start() {
    try {
      receiveState(await request(`/api/state${sessionQuery}`));
    } catch (failure) {
      ui.connectionError.textContent = failure.message;
      ui.connectionError.hidden = false;
    }
    beginEvents();
  }

  window.addEventListener("pagehide", () => { if (eventSource) eventSource.close(); });
  start();
})();
