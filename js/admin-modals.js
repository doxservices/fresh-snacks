/* Shared admin modal helpers - replaces native alert()/confirm()/prompt()
 * with the app's own modal styling (reuses .modal-backdrop/.modal/.modal-actions
 * from styles.css) so the admin pages read as one consistent product instead
 * of mixing in browser-chrome dialogs. Injects its markup into <body> once;
 * safe to include on any admin page regardless of what else is on it. */
(function () {
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
        <div class="form-grid">
          <div class="artwork-upload-item">
            <div class="artwork-preview" id="am-artwork-photo-preview"></div>
            <div class="field">
              <label for="am-artwork-photo-input">Catalog image</label>
              <input id="am-artwork-photo-input" type="file" accept="image/*" />
            </div>
          </div>
          <div class="artwork-upload-item">
            <div class="artwork-preview" id="am-artwork-favorite-preview"></div>
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
  const escArtwork = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.AdminModals = {
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
        const setPreview = (id, src, alt) => {
          $(id).innerHTML = src
            ? `<img src="${escArtwork(src)}" alt="${escArtwork(alt)}" />`
            : `<span>No image</span>`;
        };
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
