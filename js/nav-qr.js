/* Shared on-demand QR modal. Customer drawer links are enhanced automatically;
 * admin pages call FreshSnacksQR.open() from the protected sitemap/inventory. */
(function () {
  const QR_SCRIPT_ID = "fresh-snacks-qr-generator";

  function loadGenerator() {
    if (typeof window.qrcode === "function") return Promise.resolve();
    const existing = document.getElementById(QR_SCRIPT_ID);
    if (existing) return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = QR_SCRIPT_ID;
      script.src = "js/qrcode.js?v=20260716-nav-qr";
      script.onload = resolve;
      script.onerror = () => reject(new Error("QR generator could not be loaded."));
      document.head.appendChild(script);
    });
  }

  function qrPngBlob(value) {
    const qr = window.qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 8, margin: 24, scalable: false });
    const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        URL.revokeObjectURL(source);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("QR image could not be created.")), "image/png");
      };
      image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("QR image could not be rendered.")); };
      image.src = source;
    });
  }

  function qrSvg(value) {
    const qr = window.qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({
      cellSize: 8,
      margin: 24,
      scalable: true,
      title: "Scannable navigation QR code",
      alt: `QR code for ${value}`,
    });
  }

  function announce(message, error = false) {
    let toast = document.getElementById("nav-qr-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "nav-qr-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  let activeQr = null;

  function ensureDialog() {
    let dialog = document.getElementById("nav-qr-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "nav-qr-dialog";
    dialog.className = "nav-qr-dialog";
    dialog.innerHTML = `
      <div class="nav-qr-modal-head">
        <div><span class="nav-qr-eyebrow">SCAN TO OPEN</span><h2 id="nav-qr-title">Navigation QR code</h2></div>
        <button type="button" class="nav-qr-modal-close" aria-label="Close QR code">&times;</button>
      </div>
      <div class="nav-qr-preview" aria-labelledby="nav-qr-title"></div>
      <div class="nav-qr-readable">
        <span>Destination</span>
        <a target="_blank" rel="noopener noreferrer"></a>
      </div>
      <div class="nav-qr-modal-actions">
        <button type="button" class="nav-qr-copy-link">Copy link</button>
        <button type="button" class="primary nav-qr-copy-image">Copy QR code</button>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".nav-qr-modal-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelector(".nav-qr-copy-image").addEventListener("click", () => copyQrImage(dialog.querySelector(".nav-qr-copy-image")));
    dialog.querySelector(".nav-qr-copy-link").addEventListener("click", () => copyQrLink(dialog.querySelector(".nav-qr-copy-link")));
    return dialog;
  }

  async function copyQrImage(button) {
    if (!activeQr) return;
    button.disabled = true;
    try {
      const blob = await qrPngBlob(activeQr.destination);
      if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") throw new Error("This browser cannot copy QR images.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      button.classList.add("copied");
      announce(`QR code copied for ${activeQr.label}.`);
      setTimeout(() => button.classList.remove("copied"), 1600);
    } catch (error) {
      announce(error.message || "QR code could not be copied.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function copyQrLink(button) {
    if (!activeQr) return;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(activeQr.destination);
      announce(`Link copied for ${activeQr.label}.`);
    } catch (error) {
      announce(error.message || "Link could not be copied.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function openQr(anchor, button) {
    const label = anchor.textContent.trim() || "navigation link";
    const destination = new URL(anchor.getAttribute("href"), location.href).href;
    button.disabled = true;
    try {
      await loadGenerator();
      activeQr = { label, destination };
      const dialog = ensureDialog();
      dialog.querySelector("#nav-qr-title").textContent = label;
      dialog.querySelector(".nav-qr-preview").innerHTML = qrSvg(destination);
      const readable = dialog.querySelector(".nav-qr-readable a");
      readable.href = destination;
      readable.textContent = destination;
      dialog.showModal();
    } catch (error) {
      announce(error.message || "QR code could not be opened.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function openDestination({ label, destination, button }) {
    const anchor = document.createElement("a");
    anchor.href = destination;
    anchor.textContent = label;
    await openQr(anchor, button || document.createElement("button"));
  }

  function enhance(anchor) {
    if (anchor.dataset.qrEnhanced === "true" || !anchor.getAttribute("href")) return;
    anchor.dataset.qrEnhanced = "true";
    const label = anchor.textContent.trim() || "navigation link";
    const row = document.createElement("span");
    row.className = "nav-qr-row";
    anchor.before(row);
    row.appendChild(anchor);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-qr-copy";
    button.title = `Show QR code for ${label}`;
    button.setAttribute("aria-label", `Show QR code for ${label}`);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3V3Zm2 2v3h3V5H5Zm9-2h7v7h-7V3Zm2 2v3h3V5h-3ZM3 14h7v7H3v-7Zm2 2v3h3v-3H5Zm9-2h3v3h-3v-3Zm4 0h3v7h-3v-3h-3v3h-3v-3h3v-3h3v-1Z"/></svg>';
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openQr(anchor, button); });
    row.appendChild(button);
  }

  function scan(root = document) {
    root.querySelectorAll?.("nav.drawer a.drawer-link[href]").forEach(enhance);
  }


  window.FreshSnacksQR = { open: openDestination };

  scan();
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    if (node.matches?.("nav.drawer a.drawer-link[href]")) enhance(node);
    scan(node);
  }))).observe(document.body, { childList: true, subtree: true });
})();
