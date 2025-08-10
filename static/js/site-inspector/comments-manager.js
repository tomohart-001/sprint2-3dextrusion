/**
 * Comments Manager
 * Handles comment placement, viewing, and management on the map
 *
 * Depends on:
 *  - BaseManager
 *  - mapboxgl
 *  - window.eventBus (optional but recommended)
 */
class CommentsManager extends BaseManager {
  constructor(map) {
    super("CommentsManager");
    this.map = map;
    this.isCommenting = false;
    this.showCommentsEnabled = false;
    this.commentsControlExpanded = false;

    this.comments = [];       // [{ id, coordinates:[lng,lat], text, timestamp, user, marker, popup }]
    this.commentPopups = [];  // [mapboxgl.Popup]
    this.projectId = null;

    // Bound handlers (so add/remove listener symmetry is guaranteed)
    this.handleCommentClick = this.handleCommentClick.bind(this);
    this.handleUIClick = this.handleUIClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  async initialize() {
    this.info("Initializing Comments Manager…");
    this._cacheDom();
    this._ensureCollapsed();
    this._wireUi();
    await this.loadProjectComments();
    this.info("Comments Manager initialized");
  }

  /* ----------------------- DOM + wiring ----------------------- */

  _cacheDom() {
    this.el = {
      control: document.getElementById("commentsControl"),
      toggle: document.getElementById("commentsControlToggle"),
      expanded: document.getElementById("commentsExpandedContent"),
      showBtn: document.getElementById("commentsToolButton"),
      addBtn: document.getElementById("addCommentButton"),
      closeBtn: document.getElementById("commentsCloseButton"),

      // Other UI we listen to in order to exit comment mode
      // (IDs aligned to your latest HTML)
      inspectorPanel: document.getElementById("inspectorPanel"),
      selectEdgesButton: document.getElementById("selectEdgesButton"),
      previewBuildableAreaButton: document.getElementById("previewBuildableAreaButton"),
      calculateBuildableAreaButton: document.getElementById("calculateBuildableAreaButton"),
      drawFloorplanButton: document.getElementById("drawFloorplanButton"),
      buildingsToggle: document.getElementById("buildingsToggle"),
      styleSelector: document.getElementById("styleSelector"),
      measureToolButton: document.getElementById("measureToolButton")
    };
  }

  _ensureCollapsed() {
    if (!this.el.control || !this.el.expanded) return;
    this.el.control.classList.remove("expanded");
    this.el.expanded.classList.remove("is-open");
    this.el.toggle?.setAttribute("aria-pressed", "false");
  }

  _wireUi() {
    // Expand/collapse the comments card; comments visibility is controlled separately
    this.el.toggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleCommentsControl();
    });

    // Show/hide comments on the map
    this.el.showBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleShowComments();
    });

    // Start placing a new comment
    this.el.addBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startCommenting();
    });

    // Collapse the expanded card
    this.el.closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeCommentsControl();
    });

    // Exit comment mode when other tools/inputs are used
    [
      this.el.inspectorPanel,
      this.el.selectEdgesButton,
      this.el.previewBuildableAreaButton,
      this.el.calculateBuildableAreaButton,
      this.el.drawFloorplanButton,
      this.el.buildingsToggle,
      this.el.styleSelector,
      this.el.measureToolButton,
      // broader selectors:
      ...document.querySelectorAll(".boundary-option, .setback-input")
    ]
      .filter(Boolean)
      .forEach((node) => node.addEventListener("click", this.handleUIClick));

    document.addEventListener("keydown", this.handleKeyDown);

    // Event bus wiring (optional)
    if (window.eventBus?.on) {
      window.eventBus.on("tool-activated", (tool) => {
        if (tool !== "comments" && this.isCommenting) this.stopCommenting();
      });
      window.eventBus.on("project-changed", (data) => {
        this.projectId = data?.projectId ?? this.projectId;
        this.loadProjectComments();
      });
    }
  }

  /* ----------------------- Expand / collapse ----------------------- */

  toggleCommentsControl() {
    const { control, expanded, toggle } = this.el;
    if (!control || !expanded) {
      this.error("Comments control elements not found");
      return;
    }
    this.commentsControlExpanded = !this.commentsControlExpanded;
    control.classList.toggle("expanded", this.commentsControlExpanded);
    expanded.classList.toggle("is-open", this.commentsControlExpanded);
    toggle?.setAttribute("aria-pressed", String(this.commentsControlExpanded));

    if (!this.commentsControlExpanded && this.isCommenting) {
      this.stopCommenting(); // collapsing ends placement but keeps visibility state as-is
    }
  }

  closeCommentsControl() {
    const { control, expanded, toggle } = this.el;
    if (!control || !expanded) return;
    this.commentsControlExpanded = false;
    control.classList.remove("expanded");
    expanded.classList.remove("is-open");
    toggle?.setAttribute("aria-pressed", "false");
    if (this.isCommenting) this.stopCommenting();
  }

  /* ----------------------- Visibility toggle ----------------------- */

  toggleShowComments() {
    this.showCommentsEnabled = !this.showCommentsEnabled;
    if (this.showCommentsEnabled) this.showExistingComments();
    else this.hideComments();
    this._updateShowBtn();
  }

  _updateShowBtn() {
    const btn = this.el.showBtn;
    if (!btn) return;
    btn.classList.toggle("is-on", this.showCommentsEnabled);
    btn.setAttribute("aria-pressed", String(this.showCommentsEnabled));
  }

  /* ----------------------- Placement mode ----------------------- */

  startCommenting() {
    if (!this.map || !this.map.getCanvas) {
      this.warn("Map not ready; cannot start commenting.");
      return;
    }

    // Expand the control if closed
    if (!this.commentsControlExpanded) this.toggleCommentsControl();

    // Show existing comments if hidden
    if (!this.showCommentsEnabled) {
      this.showCommentsEnabled = true;
      this._updateShowBtn();
      this.showExistingComments();
    }

    // Begin capture
    if (!this.isCommenting) {
      this.isCommenting = true;
      this.map.getCanvas().style.cursor = "crosshair";
      // Avoid double binding
      this.map.off("click", this.handleCommentClick);
      this.map.on("click", this.handleCommentClick);

      const addBtn = this.el.addBtn;
      if (addBtn) {
        addBtn.textContent = "Click map to add comment";
        addBtn.dataset.active = "true";
      }

      window.eventBus?.emit?.("tool-activated", "comments");
      this.info("Comments tool started – click on the map to add a comment");
    }
  }

  stopCommenting() {
    if (!this.isCommenting) return;

    this.isCommenting = false;

    if (this.map?.off) this.map.off("click", this.handleCommentClick);
    if (this.map?.getCanvas) this.map.getCanvas().style.cursor = "";

    const addBtn = this.el.addBtn;
    if (addBtn) {
      addBtn.textContent = "Add new comment";
      delete addBtn.dataset.active;
    }

    // Only hide if user explicitly disabled visibility
    if (!this.showCommentsEnabled) this.hideComments();

    this.info("Comments tool stopped");
  }

  handleCommentClick(e) {
    if (!this.isCommenting || !e?.lngLat) return;

    // Prevent creating a new comment when clicking a marker/popup
    const tgt = e.originalEvent?.target;
    if (tgt && (tgt.closest?.(".comment-marker") || tgt.closest?.(".mapboxgl-popup"))) {
      return;
    }

    const lng = Number(e.lngLat.lng);
    const lat = Number(e.lngLat.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    this._openCommentModal([lng, lat]);
  }

  /* ----------------------- Modal ----------------------- */

  _ensureModalAnimationsOnce() {
    if (document.getElementById("cm-modal-animations")) return;
    const s = document.createElement("style");
    s.id = "cm-modal-animations";
    s.textContent = `
      @keyframes cmFadeIn { from {opacity:0} to {opacity:1} }
      @keyframes cmSlideIn { from {transform: translateY(-20px) scale(.96); opacity:0} to {transform:none; opacity:1} }
    `;
    document.head.appendChild(s);
  }

  _openCommentModal(coordinates) {
    this._ensureModalAnimationsOnce();

    const modal = document.createElement("div");
    modal.className = "comment-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    modal.innerHTML = `
      <div class="comment-modal-content">
        <div class="comment-modal-header">
          <div class="comment-header-content"><h3 class="comment-title">Add Comment</h3></div>
          <button class="comment-modal-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="comment-modal-body">
          <textarea id="commentText" placeholder="Enter your comment here..." rows="4" maxlength="500"></textarea>
          <div class="comment-character-count"><span id="commentCharCount">0</span>/500</div>
        </div>
        <div class="comment-modal-footer">
          <button class="comment-btn-cancel" type="button">Cancel</button>
          <button class="comment-btn-save" type="button">Save Comment</button>
        </div>
      </div>
    `;

    // Inline minimal styles to keep this self-contained;
    // you can move these into CSS (see snippet below).
    Object.assign(modal.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,.6)",
      backdropFilter: "blur(8px)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: "10000",
      animation: "cmFadeIn .2s ease-out"
    });
    const content = modal.querySelector(".comment-modal-content");
    Object.assign(content.style, {
      background: "linear-gradient(135deg,#fff 0%,#f8f9fa 100%)",
      border: "1px solid rgba(0,0,0,.1)", borderRadius: "16px",
      width: "90%", maxWidth: "440px", overflow: "hidden",
      boxShadow: "0 20px 60px rgba(0,0,0,.15)",
      animation: "cmSlideIn .28s ease-out"
    });

    const header = modal.querySelector(".comment-modal-header");
    Object.assign(header.style, {
      background: "linear-gradient(135deg,#4a6cf7 0%, #3a5ae0 100%)",
      padding: "20px", display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: "1px solid rgba(255,255,255,.2)"
    });
    const title = modal.querySelector(".comment-title");
    Object.assign(title.style, { margin: 0, color: "#fff", fontSize: "18px", fontWeight: "600" });

    const closeBtn = modal.querySelector(".comment-modal-close");
    Object.assign(closeBtn.style, {
      background: "rgba(255,255,255,.1)", border: "none", color: "#fff",
      width: "32px", height: "32px", borderRadius: "8px", cursor: "pointer"
    });

    const body = modal.querySelector(".comment-modal-body");
    body.style.padding = "20px";

    const textarea = modal.querySelector("#commentText");
    Object.assign(textarea.style, {
      width: "100%", minHeight: "100px", padding: "12px 14px", borderRadius: "10px",
      border: "1px solid rgba(0,0,0,.2)", outline: "none", fontSize: "14px"
    });

    const cc = modal.querySelector(".comment-character-count");
    Object.assign(cc.style, { marginTop: "8px", textAlign: "right", fontSize: "12px", color: "rgba(0,0,0,.6)" });

    const footer = modal.querySelector(".comment-modal-footer");
    Object.assign(footer.style, {
      display: "flex", gap: "12px", justifyContent: "flex-end",
      padding: "16px 20px", borderTop: "1px solid rgba(0,0,0,.08)"
    });

    const cancelBtn = modal.querySelector(".comment-btn-cancel");
    const saveBtn = modal.querySelector(".comment-btn-save");

    // Interactions
    const charCount = modal.querySelector("#commentCharCount");
    textarea.addEventListener("input", () => {
      const n = textarea.value.length;
      charCount.textContent = String(n);
      cc.style.color = n > 450 ? "#dc3545" : n > 400 ? "#ffc107" : "rgba(0,0,0,.6)";
    });

    const closeModal = () => {
      modal.remove();
      // if user aborted, and we started commenting from button, keep mode on until they click map or exit
    };

    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

    saveBtn.addEventListener("click", async () => {
      const text = textarea.value.trim();
      if (!text) return;
      const ok = await this.saveComment(coordinates, text);
      if (ok) {
        await this.loadProjectComments(); // refresh canonical set
      } else {
        // fallback local display
        this.displayComment({
          coordinates,
          text,
          timestamp: new Date().toISOString(),
          user: await this.getCurrentUsername()
        }, true);
      }
      closeModal();
    });

    document.body.appendChild(modal);
    textarea.focus();
  }

  /* ----------------------- Persistence ----------------------- */

  async saveComment(coordinates, text) {
    try {
      const projectId = this.getProjectId();
      if (!projectId) throw new Error("No project ID");

      const [lng, lat] = Array.isArray(coordinates) && coordinates.length >= 2
        ? [Number(coordinates[0]), Number(coordinates[1])]
        : [NaN, NaN];

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("Bad coordinates");

      const payload = {
        project_id: parseInt(projectId, 10),
        coordinates: [lng, lat],
        text: String(text),
        type: "site_comment"
      };

      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Save failed ${res.status}: ${msg}`);
      }

      const json = await res.json();
      if (!json?.success) throw new Error(json?.error || "Save failed");

      this.info("Comment saved");
      return true;
    } catch (err) {
      this.error("Failed to save comment:", err);
      return false;
    }
  }

  async loadProjectComments() {
    try {
      const projectId = this.getProjectId();
      if (!projectId) {
        this.warn("No project ID for loading comments");
        return;
      }
      const res = await fetch(`/api/comments?project_id=${encodeURIComponent(projectId)}&type=site_comment`);
      if (!res.ok) {
        this.warn(`Load comments failed: ${res.status} ${await res.text()}`);
        return;
      }
      const json = await res.json();
      if (!json?.success || !Array.isArray(json.comments)) {
        this.info("No comments found");
        this.clearComments();
        return;
      }

      // reset and display
      this.clearComments();
      json.comments.forEach((c) => {
        this.displayComment({
          id: c.id,
          coordinates: c.coordinates,
          text: c.text,
          timestamp: c.timestamp,
          user: c.user
        }, false);
      });

      if (this.showCommentsEnabled) this.showExistingComments();
      this.info(`Loaded ${json.comments.length} comments`);
    } catch (err) {
      this.error("Error loading comments:", err);
    }
  }

  async deleteComment(commentId) {
    try {
      const projectId = this.getProjectId();
      if (projectId) {
        const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
        if (!res.ok) this.warn("Failed to delete comment from DB");
      }

      const idx = this.comments.findIndex((c) => String(c.id) === String(commentId));
      if (idx !== -1) {
        const c = this.comments[idx];
        c.marker?.remove();
        c.popup?.remove();
        this.comments.splice(idx, 1);
      }
    } catch (err) {
      this.error("Failed to delete comment:", err);
    }
  }

  /* ----------------------- Map rendering ----------------------- */

  showExistingComments() {
    this.comments.forEach((c) => {
      if (!c.marker || !c.popup) this._addCommentGraphics(c);
      const el = c.marker?.getElement?.();
      if (el) el.style.display = "flex";
    });
  }

  hideComments() {
    // hide, don't destroy (so we can re-show instantly)
    this.comments.forEach((c) => {
      c.popup?.remove?.();
      const el = c.marker?.getElement?.();
      if (el) el.style.display = "none";
    });
  }

  clearComments() {
    this.comments.forEach((c) => {
      c.marker?.remove?.();
      c.popup?.remove?.();
    });
    this.comments = [];
    this.commentPopups = [];
  }

  displayComment(commentData, autoShow = true) {
    const comment = {
      ...commentData,
      id: commentData.id || String(Date.now()),
      marker: null,
      popup: null,
      coordinates: this._normalizeLngLat(commentData.coordinates),
      user: commentData.user || "User",
      timestamp: commentData.timestamp || new Date().toISOString(),
      text: String(commentData.text ?? "")
    };

    this.comments.push(comment);
    this._addCommentGraphics(comment);

    // If visibility is off and we're not in placement, hide fresh graphics
    if (!autoShow && !this.showCommentsEnabled && !this.isCommenting && comment.marker) {
      const el = comment.marker.getElement?.();
      if (el) el.style.display = "none";
    }
  }

  _addCommentGraphics(comment) {
    if (!this.map) return;

    // Marker
    if (!comment.marker) {
      const markerEl = document.createElement("div");
      markerEl.className = "comment-marker";
      markerEl.textContent = "💬";
      Object.assign(markerEl.style, {
        width: "24px", height: "24px", background: "#007cbf", color: "#fff",
        borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "12px", cursor: "pointer", border: "2px solid #fff",
        boxShadow: "0 2px 4px rgba(0,0,0,.2)"
      });

      const marker = new mapboxgl.Marker(markerEl).setLngLat(comment.coordinates).addTo(this.map);
      comment.marker = marker;

      markerEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (comment.popup?.isOpen?.()) comment.popup.remove();
        else comment.popup?.addTo?.(this.map);
      });
    }

    // Popup (DOM-based; safe handlers; escaped text)
    if (!comment.popup) {
      const popup = new mapboxgl.Popup({
        closeButton: true, closeOnClick: false, className: "comment-popup",
        anchor: "bottom", offset: [0, -10]
      }).setLngLat(comment.coordinates);

      const node = this._renderPopupDom(comment);
      popup.setDOMContent(node);

      comment.popup = popup;
      this.commentPopups.push(popup);
    }
  }

  _renderPopupDom(comment) {
    const wrap = document.createElement("div");
    wrap.className = "comment-content";
    wrap.style.cssText =
      "background:linear-gradient(135deg,#fff 0%,#f8f9fa 100%);border:1px solid rgba(0,0,0,.15);border-radius:12px;padding:16px;min-width:250px;max-width:300px;box-shadow:0 8px 24px rgba(0,0,0,.15);backdrop-filter:blur(10px);";

    const header = document.createElement("div");
    header.className = "comment-header";
    header.style.cssText =
      "margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(0,0,0,.1);display:flex;justify-content:space-between;align-items:center;";

    const userEl = document.createElement("span");
    userEl.className = "comment-user";
    userEl.textContent = comment.user || "User";
    userEl.style.cssText = "font-weight:600;font-size:13px;color:#4a6cf7;";
    header.appendChild(userEl);
    wrap.appendChild(header);

    const textEl = document.createElement("div");
    textEl.className = "comment-text";
    textEl.textContent = comment.text; // textContent => no HTML injection
    textEl.style.cssText =
      "font-size:14px;line-height:1.5;color:#1a1a1a;margin-bottom:12px;word-wrap:break-word;";
    wrap.appendChild(textEl);

    const footer = document.createElement("div");
    footer.className = "comment-actions";
    footer.style.cssText = "display:flex;justify-content:space-between;align-items:center;";

    const timeEl = document.createElement("span");
    timeEl.className = "comment-time";
    timeEl.textContent = this.formatTimestamp(comment.timestamp);
    timeEl.style.cssText = "font-size:11px;color:rgba(0,0,0,.6);";
    footer.appendChild(timeEl);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "comment-delete-btn";
    delBtn.textContent = "🗑";
    delBtn.title = "Delete comment";
    delBtn.style.cssText =
      "background:rgba(108,117,125,.1);border:1px solid rgba(108,117,125,.3);color:#6c757d;width:28px;height:28px;border-radius:6px;font-size:12px;cursor:pointer;";
    delBtn.addEventListener("click", () => this.deleteComment(comment.id));
    footer.appendChild(delBtn);

    wrap.appendChild(footer);
    return wrap;
  }

  /* ----------------------- Helpers ----------------------- */

  handleUIClick(e) {
    const modal = document.querySelector(".comment-modal");
    if (this.isCommenting && modal && !modal.contains(e.target)) {
      this.info("Exiting comment mode due to external UI click");
      this.stopCommenting();
    }
  }

  handleKeyDown(e) {
    if (this.isCommenting && e.key === "Escape") {
      this.info("Escape pressed; exiting comment mode");
      this.stopCommenting();
    }
  }

  getProjectId() {
    return (
      this.projectId ||
      window.siteInspectorCore?.projectId ||
      sessionStorage.getItem("current_project_id") ||
      new URLSearchParams(window.location.search).get("project_id")
    );
  }

  _normalizeLngLat(coords) {
    if (Array.isArray(coords) && coords.length >= 2) {
      const [a, b] = coords;
      // If the first number looks like lat (|a|<=90) and second looks like lng, swap
      if (Math.abs(a) <= 90 && Math.abs(b) > 90) return [b, a];
      return [Number(a), Number(b)];
    } else if (coords && typeof coords === "object") {
      const lng = Number(coords.lng ?? coords.x);
      const lat = Number(coords.lat ?? coords.y);
      return [lng, lat];
    }
    return [NaN, NaN];
  }

  formatTimestamp(ts) {
    const d = new Date(ts);
    try {
      return (
        d.toLocaleDateString() +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    } catch {
      return d.toISOString();
    }
  }

  getAllComments() {
    // useful for dashboards
    return this.comments.slice();
  }

  dispose() {
    this.info("Disposing Comments Manager…");
    this.stopCommenting();
    this.clearComments();

    // Remove exit listeners
    [
      this.el.inspectorPanel,
      this.el.selectEdgesButton,
      this.el.previewBuildableAreaButton,
      this.el.calculateBuildableAreaButton,
      this.el.drawFloorplanButton,
      this.el.buildingsToggle,
      this.el.styleSelector,
      this.el.measureToolButton,
      ...document.querySelectorAll(".boundary-option, .setback-input")
    ]
      .filter(Boolean)
      .forEach((node) => node.removeEventListener("click", this.handleUIClick));

    document.removeEventListener("keydown", this.handleKeyDown);
    this.info("Comments Manager disposed");
  }
}

// Export to global (as your code expects)
window.CommentsManager = CommentsManager;