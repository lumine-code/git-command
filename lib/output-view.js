const { Emitter } = require("lumine");
const DiffReport = require("./diff-report");

class OutputView {
  constructor({ uri, title, subtitle, content, diffData, diffService, copyState }) {
    this.uri = uri;
    this.title = title;
    this.subtitle = subtitle;
    this.emitter = new Emitter();
    this.revision = 0;
    this.initialCopyState = copyState;

    this.element = document.createElement("section");
    this.element.className = "git-command-output native-key-bindings";
    this.element.tabIndex = -1;
    this.element.addEventListener("focus", () => this.focus());
    this.element.addEventListener("focusin", (event) => {
      if (event.target !== this.element) this.lastFocus = event.target;
    });

    this.header = document.createElement("header");
    this.heading = document.createElement("strong");
    this.copyButton = document.createElement("button");
    this.copyButton.className = "btn btn-sm icon icon-clippy";
    this.copyButton.textContent = "Copy";
    this.copyButton.addEventListener("click", () => lumine.clipboard.write(this.copyText));
    this.header.append(this.heading, this.copyButton);

    this.pre = document.createElement("pre");
    this.update({ title, subtitle, content, diffData, diffService });
  }

  update({ title, subtitle, content, diffData, diffService }) {
    if (this.destroyed) return Promise.resolve();
    this.title = title;
    this.subtitle = subtitle;
    this.heading.textContent = subtitle ? `${title} — ${subtitle}` : title;
    if (this.diffData !== diffData || this.copyText !== String(content || "")) this.revision++;
    this.diffData = diffData;
    this.diffService = diffService;
    this.copyText = diffData
      ? diffData.sections
          .map(({ title, rawPatch, text }) => `${title}\n\n${text ?? rawPatch}`)
          .join("\n\n")
      : String(content || "");
    this.pre.textContent = diffData ? "" : this.copyText;
    let updated;
    if (diffData) {
      // Lumine's block-code styles override the browser's hidden attribute.
      // Keep text-report chrome out of the flex layout while displaying a diff.
      this.header.remove();
      this.pre.remove();
      if (this.diffReport) {
        updated = this.diffReport.update({ data: diffData, diffService, title });
      } else {
        this.diffReport = new DiffReport({
          data: diffData,
          diffService,
          title,
          copyState: this.initialCopyState,
        });
        this.initialCopyState = null;
        this.element.append(this.diffReport.element);
      }
    } else {
      this.diffReport?.destroy();
      this.diffReport = null;
      this.element.append(this.header, this.pre);
    }
    this.emitter.emit("did-change-title");
    return updated;
  }

  setDiffService(diffService) {
    if (this.diffService !== diffService) this.revision++;
    this.diffService = diffService;
    return this.diffReport?.update({ diffService });
  }

  copy({ signal } = {}) {
    signal?.throwIfAborted();
    if (this.destroyed) throw new DOMException("Command output was closed", "AbortError");
    const props = {
      uri: this.uri,
      title: this.title,
      subtitle: this.subtitle,
      content: this.copyText,
      diffData: this.diffData && structuredClone(this.diffData),
      diffService: this.diffService,
      copyState: this.diffReport?.captureCopyState(),
    };
    let copy;
    try {
      copy = this.createCopy ? this.createCopy(props) : new OutputView(props);
    } catch (error) {
      props.copyState?.copySnapshot?.dispose();
      throw error;
    }
    const scrollTop = this.element.scrollTop;
    requestAnimationFrame(() => {
      if (!copy.destroyed) copy.element.scrollTop = scrollTop;
    });
    return copy;
  }

  focus() {
    if (this.destroyed) return;
    if (this.lastFocus?.isConnected && this.element.contains(this.lastFocus))
      this.lastFocus.focus();
    else this.diffReport?.focus();
  }

  getPaneItemRevision() {
    return this.revision;
  }

  isDestroyed() {
    return this.destroyed === true;
  }

  getElement() {
    return this.element;
  }

  getURI() {
    return this.uri;
  }

  getTitle() {
    return this.title;
  }

  getLongTitle() {
    return this.subtitle ? `${this.title} — ${this.subtitle}` : this.title;
  }

  getIconName() {
    return "terminal";
  }

  // Deliberately no serialize(): command output can contain arbitrary,
  // sensitive, and very large stdout. It is a session-only snapshot and must
  // not be copied into the persisted window state.

  onDidChangeTitle(callback) {
    return this.emitter.on("did-change-title", callback);
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.diffReport?.destroy();
    this.diffReport = null;
    this.diffData = null;
    this.copyText = "";
    this.element.remove();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }
}

class OutputManager {
  constructor({ diffService = null } = {}) {
    this.diffService = diffService;
    this.views = new Map();
    this.allViews = new Set();
    this.pending = new Map();
    this.opener = lumine.workspace.addOpener((uri) => this.open(uri));
  }

  open(uri) {
    if (this.destroyed) return undefined;
    if (!String(uri).startsWith("git-command://output/")) return undefined;
    const existing = this.views.get(uri);
    if (existing) return existing;
    const props = this.pending.get(uri);
    if (!props) return undefined;

    const view = this.createView({ uri, ...props, diffService: this.diffService });
    this.views.set(uri, view);
    return view;
  }

  createView(props) {
    if (this.destroyed) throw new Error("The command output provider is unavailable.");
    const view = new OutputView(props);
    this.allViews.add(view);
    view.createCopy = (copyProps) => this.createView(copyProps);
    view.onDidDestroy(() => {
      this.allViews.delete(view);
      if (this.views.get(view.uri) === view) this.views.delete(view.uri);
    });
    return view;
  }

  async show(key, props) {
    if (this.destroyed) return undefined;
    const uri = `git-command://output/${encodeURIComponent(key)}`;
    this.pending.set(uri, props);
    const existing = this.views.get(uri);
    try {
      if (existing) await existing.update({ ...props, diffService: this.diffService });
      if (this.destroyed) return undefined;
      // A copied snapshot may share this URI. Explicitly open the manager's
      // current output object so a fresh command never repurposes that copy.
      return await lumine.workspace.open(existing || this.open(uri));
    } finally {
      if (this.pending.get(uri) === props) this.pending.delete(uri);
    }
  }

  setDiffService(diffService) {
    this.diffService = diffService;
    for (const view of this.allViews) view.setDiffService(diffService);
  }

  destroy() {
    this.destroyed = true;
    this.diffService = null;
    this.opener.dispose();
    for (const view of Array.from(this.allViews)) {
      const pane = lumine.workspace.paneForItem(view);
      if (pane) pane.destroyItem(view, true);
      else view.destroy();
    }
    this.views.clear();
    this.allViews.clear();
    this.pending.clear();
  }
}

module.exports = { OutputManager, OutputView };
