/* Shared admin modal helpers - replaces native alert()/confirm()/prompt()
 * with the app's own modal styling (reuses .modal-backdrop/.modal/.modal-actions
 * from styles.css) so the admin pages read as one consistent product instead
 * of mixing in browser-chrome dialogs. Injects its markup into <body> once;
 * safe to include on any admin page regardless of what else is on it. */
(function () {
  const ARTWORK_RESET_ICON = `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>`;
  const artworkPreviewInner = `<span class="artwork-preview-empty">No image</span><img class="artwork-preview-img" alt="" hidden /><button type="button" class="artwork-preview-reset hidden" title="Reset zoom" aria-label="Reset zoom">${ARTWORK_RESET_ICON}</button>`;

  const mount = document.createElement("div");
  mount.innerHTML = `
    <div class="modal-backdrop" id="am-confirm-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="am-confirm-title">
        <h2 id="am-confirm-title"></h2>
        <p class="muted-small" id="am-confirm-message" style="margin-bottom:16px;"></p>
        <div class="modal-actions">
          <button type="button" id="am-confirm-cancel">Cancel</button>
          <button type="button" class="primary" id="am-confirm-ok">Confirm</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="am-alert-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="am-alert-title">
        <h2 id="am-alert-title"></h2>
        <p class="muted-small" id="am-alert-message" style="margin-bottom:16px;"></p>
        <div class="modal-actions">
          <button type="button" class="primary" id="am-alert-ok">OK</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="am-prompt-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="am-prompt-title">
        <h2 id="am-prompt-title"></h2>
        <p class="muted-small" id="am-prompt-message" style="margin-bottom:10px;"></p>
        <div class="field">
          <input id="am-prompt-input" type="text" />
        </div>
        <div class="modal-actions">
          <button type="button" id="am-prompt-cancel">Cancel</button>
          <button type="button" class="primary" id="am-prompt-ok">OK</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="am-edit-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="am-edit-title">
        <h2 id="am-edit-title">Change listing</h2>
        <div class="form-grid">
          <div class="field">
            <label for="am-edit-qty">Quantity</label>
            <input id="am-edit-qty" type="number" min="0" step="1" />
          </div>
          <div class="field">
            <label for="am-edit-date">Date</label>
            <input id="am-edit-date" type="date" />
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="am-edit-cancel">Cancel</button>
          <button type="button" class="primary" id="am-edit-save">Save</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="am-artwork-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="am-artwork-title">
        <h2 id="am-artwork-title">Update photos</h2>
        <div class="artwork-upload-grid">
          <div class="artwork-upload-item">
            <div class="artwork-preview" id="am-artwork-photo-preview">${artworkPreviewInner}</div>
            <div class="field">
              <label for="am-artwork-photo-input">Catalog image</label>
              <input id="am-artwork-photo-input" type="file" accept="image/*" />
            </div>
          </div>
          <div class="artwork-upload-item">
            <div class="artwork-preview" id="am-artwork-favorite-preview">${artworkPreviewInner}</div>
            <div class="field">
              <label for="am-artwork-favorite-input">Favorite background</label>
              <input id="am-artwork-favorite-input" type="file" accept="image/*" />
            </div>
          </div>
        </div>
        <div class="status" id="am-artwork-status" aria-live="polite"></div>
        <div class="modal-actions">
          <button type="button" class="primary" id="am-artwork-done">Done</button>
        </div>
      </div>
    </div>`;
  document.body.append(...mount.children);

  const $ = (id) => document.getElementById(id);

  // Drag-to-pan + scroll/pinch-to-zoom for the artwork preview boxes. The
  // image sits at object-fit:contain (whole photo visible, nothing cropped)
  // and this only ever adds a transform on top of that, so a fresh/never-
  // touched preview is always the untouched full-image view.
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const artworkZoomState = new WeakMap();

  const getPreviewImg = (container) => container.querySelector(".artwork-preview-img");
  const getPreviewResetBtn = (container) => container.querySelector(".artwork-preview-reset");

  function applyArtworkTransform(container) {
    const state = artworkZoomState.get(container);
    const img = getPreviewImg(container);
    if (!state || !img) return;
    img.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    img.style.cursor = state.scale > MIN_ZOOM ? "grab" : "";
    const resetBtn = getPreviewResetBtn(container);
    if (resetBtn) resetBtn.classList.toggle("hidden", state.scale <= MIN_ZOOM + 0.01);
  }

  // Keeps the image from being panned so far that empty space shows inside
  // the box - computed from the image's natural size rather than its
  // current (already-transformed) rect, so it's correct at any tx/ty.
  function clampArtworkPan(container) {
    const state = artworkZoomState.get(container);
    const img = getPreviewImg(container);
    if (!state || !img || !img.naturalWidth || !container.clientWidth) return;
    const boxW = container.clientWidth;
    const boxH = container.clientHeight;
    const containScale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const curW = img.naturalWidth * containScale * state.scale;
    const curH = img.naturalHeight * containScale * state.scale;
    const maxX = Math.max(0, (curW - boxW) / 2);
    const maxY = Math.max(0, (curH - boxH) / 2);
    state.tx = Math.max(-maxX, Math.min(maxX, state.tx));
    state.ty = Math.max(-maxY, Math.min(maxY, state.ty));
  }

  function resetArtworkZoom(container) {
    artworkZoomState.set(container, { scale: MIN_ZOOM, tx: 0, ty: 0 });
    applyArtworkTransform(container);
  }

  // Idempotent - safe to call every time a preview container is (re)used,
  // even though the <img> inside it gets a new src repeatedly.
  function wireArtworkPreview(container) {
    if (!container || container.dataset.zoomWired) return;
    container.dataset.zoomWired = "1";
    container.title = "Scroll or pinch to zoom - drag to move";
    resetArtworkZoom(container);

    const pointers = new Map();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pinchStartDist = 0;
    let pinchStartScale = MIN_ZOOM;

    container.addEventListener("wheel", (ev) => {
      const img = getPreviewImg(container);
      if (!img || img.hidden) return;
      ev.preventDefault();
      const state = artworkZoomState.get(container);
      state.scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.scale - ev.deltaY * 0.0015 * state.scale));
      if (state.scale <= MIN_ZOOM + 0.001) { state.scale = MIN_ZOOM; state.tx = 0; state.ty = 0; }
      clampArtworkPan(container);
      applyArtworkTransform(container);
    }, { passive: false });

    container.addEventListener("pointerdown", (ev) => {
      const img = getPreviewImg(container);
      if (!img || img.hidden) return;
      // Chrome retargets the click that follows a captured pointer to the
      // capturing element - skip capture for the reset button itself, or
      // its own click handler would never see the click.
      if (ev.target.closest(".artwork-preview-reset")) return;
      container.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
      } else if (pointers.size === 2) {
        dragging = false;
        const pts = [...pointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        pinchStartScale = artworkZoomState.get(container).scale;
      }
    });

    container.addEventListener("pointermove", (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const state = artworkZoomState.get(container);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        state.scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartScale * (dist / pinchStartDist)));
        clampArtworkPan(container);
        applyArtworkTransform(container);
      } else if (dragging && state.scale > MIN_ZOOM) {
        state.tx += ev.clientX - lastX;
        state.ty += ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        clampArtworkPan(container);
        applyArtworkTransform(container);
      }
    });

    const endPointer = (ev) => {
      pointers.delete(ev.pointerId);
      dragging = pointers.size === 1;
      if (dragging) {
        const [pt] = pointers.values();
        lastX = pt.x;
        lastY = pt.y;
      }
    };
    container.addEventListener("pointerup", endPointer);
    container.addEventListener("pointercancel", endPointer);
    container.addEventListener("pointerleave", (ev) => { if (pointers.size <= 1) endPointer(ev); });

    container.addEventListener("dblclick", () => {
      const state = artworkZoomState.get(container);
      if (state.scale > MIN_ZOOM) {
        resetArtworkZoom(container);
      } else {
        state.scale = 2;
        clampArtworkPan(container);
        applyArtworkTransform(container);
      }
    });

    const resetBtn = getPreviewResetBtn(container);
    if (resetBtn) resetBtn.onclick = (ev) => { ev.stopPropagation(); resetArtworkZoom(container); };
  }

  // Sets (or clears) the photo shown in a wired preview box and resets any
  // zoom/pan left over from whatever was previously shown there.
  function setArtworkPreview(container, src, alt) {
    if (!container) return;
    wireArtworkPreview(container);
    const img = getPreviewImg(container);
    const empty = container.querySelector(".artwork-preview-empty");
    if (src) {
      img.src = src;
      img.alt = alt || "";
      img.hidden = false;
      if (empty) empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      if (empty) empty.hidden = false;
    }
    resetArtworkZoom(container);
  }

  window.AdminModals = {
    // Wires drag-to-pan + scroll/pinch-to-zoom onto a .artwork-preview
    // element (see the markup in catalog.html) and sets its photo. Safe to
    // call repeatedly - wiring only happens once per element.
    setArtworkPreview,
    // Promise<boolean> - true if confirmed, false if cancelled/dismissed
    confirm(title, message, opts = {}) {
      return new Promise((resolve) => {
        $("am-confirm-title").textContent = title;
        $("am-confirm-message").textContent = message;
        const backdrop = $("am-confirm-backdrop");
        const okBtn = $("am-confirm-ok");
        const cancelBtn = $("am-confirm-cancel");
        okBtn.textContent = opts.confirmText || "Confirm";
        okBtn.className = opts.danger ? "danger" : "primary";
        const cleanup = (result) => {
          backdrop.classList.remove("show");
          okBtn.onclick = null;
          cancelBtn.onclick = null;
          backdrop.onclick = null;
          resolve(result);
        };
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(false); };
        backdrop.classList.add("show");
        okBtn.focus();
      });
    },

    // Promise<void> - resolves once dismissed
    alert(title, message) {
      return new Promise((resolve) => {
        $("am-alert-title").textContent = title;
        $("am-alert-message").textContent = message;
        const backdrop = $("am-alert-backdrop");
        const okBtn = $("am-alert-ok");
        const cleanup = () => {
          backdrop.classList.remove("show");
          okBtn.onclick = null;
          backdrop.onclick = null;
          resolve();
        };
        okBtn.onclick = cleanup;
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(); };
        backdrop.classList.add("show");
        okBtn.focus();
      });
    },

    // Promise<string|null> - the entered text, or null if cancelled/blank-submitted
    prompt(title, message, defaultValue = "") {
      return new Promise((resolve) => {
        $("am-prompt-title").textContent = title;
        $("am-prompt-message").textContent = message || "";
        $("am-prompt-message").classList.toggle("hidden", !message);
        const input = $("am-prompt-input");
        input.value = defaultValue;
        const backdrop = $("am-prompt-backdrop");
        const okBtn = $("am-prompt-ok");
        const cancelBtn = $("am-prompt-cancel");
        const cleanup = (result) => {
          backdrop.classList.remove("show");
          okBtn.onclick = null;
          cancelBtn.onclick = null;
          backdrop.onclick = null;
          input.onkeydown = null;
          resolve(result);
        };
        okBtn.onclick = () => cleanup(input.value.trim() || null);
        cancelBtn.onclick = () => cleanup(null);
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(null); };
        input.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); okBtn.click(); } };
        backdrop.classList.add("show");
        input.focus();
        input.select();
      });
    },

    // Price/value always comes from the catalogue on the server. Admins may
    // change only the quantity and date of an existing snack listing.
    // Promise<{quantity, createdDate}|null> - null if cancelled
    editListing(current) {
      return new Promise((resolve) => {
        $("am-edit-qty").value = current.quantity ?? 1;
        $("am-edit-date").value = current.createdDate || "";
        const backdrop = $("am-edit-backdrop");
        const saveBtn = $("am-edit-save");
        const cancelBtn = $("am-edit-cancel");
        const cleanup = (result) => {
          backdrop.classList.remove("show");
          saveBtn.onclick = null;
          cancelBtn.onclick = null;
          backdrop.onclick = null;
          resolve(result);
        };
        saveBtn.onclick = () => cleanup({
          quantity: $("am-edit-qty").value,
          createdDate: $("am-edit-date").value,
        });
        cancelBtn.onclick = () => cleanup(null);
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(null); };
        backdrop.classList.add("show");
        $("am-edit-qty").focus();
      });
    },

    // Lets a card upload its own two images without navigating to a
    // separate picker-and-upload section - the modal itself doesn't touch
    // Firestore/Storage, it just drives whatever upload function the
    // caller (catalog.html) passes in, same as editListing leaves the
    // actual save to its caller. Promise<void> - resolves once closed;
    // onUpload(kind, file, onProgress) should return the new image URL.
    uploadArtwork(snack, { onUpload }) {
      return new Promise((resolve) => {
        $("am-artwork-title").textContent = `Update photos - ${snack.name}`;
        const setPreview = (id, src, alt) => setArtworkPreview($(id), src, alt);
        setPreview("am-artwork-photo-preview", snack.photo, `${snack.name} catalog artwork`);
        setPreview("am-artwork-favorite-preview", snack.favoritePhoto, `${snack.name} favorite artwork`);
        const photoInput = $("am-artwork-photo-input");
        const favoriteInput = $("am-artwork-favorite-input");
        const statusEl = $("am-artwork-status");
        photoInput.value = "";
        favoriteInput.value = "";
        statusEl.textContent = "";
        statusEl.className = "status";

        async function runUpload(kind, input, previewId, alt) {
          const file = input.files[0];
          if (!file) return;
          try {
            statusEl.className = "status ok";
            statusEl.textContent = "Optimizing image...";
            const url = await onUpload(kind, file, (percent) => {
              statusEl.textContent = `Uploading ${percent}%...`;
            });
            setPreview(previewId, url, alt);
            input.value = "";
            statusEl.textContent = "Uploaded.";
          } catch (error) {
            statusEl.className = "status err";
            statusEl.textContent = error.message;
          }
        }

        photoInput.onchange = () => runUpload("photo", photoInput, "am-artwork-photo-preview", `${snack.name} catalog artwork`);
        favoriteInput.onchange = () => runUpload("favoritePhoto", favoriteInput, "am-artwork-favorite-preview", `${snack.name} favorite artwork`);

        const backdrop = $("am-artwork-backdrop");
        const doneBtn = $("am-artwork-done");
        const cleanup = () => {
          backdrop.classList.remove("show");
          photoInput.onchange = null;
          favoriteInput.onchange = null;
          doneBtn.onclick = null;
          backdrop.onclick = null;
          resolve();
        };
        doneBtn.onclick = cleanup;
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(); };
        backdrop.classList.add("show");
      });
    },
  };
})();
