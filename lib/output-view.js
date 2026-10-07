const { Emitter } = require("lumine");
const DiffReport = require("./diff-report");

class OutputView {
  constructor({ uri, title, subtitle, content, diffData, patchView }) {
    this.uri = uri;
    this.title = title;
    this.subtitle = subtitle;
    this.emitter = new Emitter();

    this.element = document.createElement("section");
    this.element.className = "git-command-output native-key-bindings";
    this.element.tabIndex = -1;

    this.header = document.createElement("header");
    this.heading = document.createElement("strong");
    this.copyButton = document.createElement("button");
    this.copyButton.className = "btn btn-sm icon icon-clippy";
    this.copyButton.textContent = "Copy";
    this.copyButton.addEventListener("click", () => lumine.clipboard.write(this.copyText));
    this.header.append(this.heading, this.copyButton);

    this.pre = document.createElement("pre");
    this.update({ title, subtitle, content, diffData, patchView });
  }

  update({ title, subtitle, content, diffData, patchView }) {
    if (this.destroyed) return Promise.resolve();
    this.title = title;
    this.subtitle = subtitle;
    this.heading.textContent = subtitle ? `${title} — ${subtitle}` : title;
    this.diffData = diffData;
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
        updated = this.diffReport.update({ data: diffData, patchView, title });
      } else {
        this.diffReport = new DiffReport({ data: diffData, patchView, title });
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

  setPatchView(patchView) {
    return this.diffReport?.update({ patchView });
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
  constructor({ patchView = null } = {}) {
    this.patchView = patchView;
    this.views = new Map();
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

    const view = new OutputView({ uri, ...props, patchView: this.patchView });
    this.views.set(uri, view);
    view.onDidDestroy(() => this.views.delete(uri));
    return view;
  }

  async show(key, props) {
    if (this.destroyed) return undefined;
    const uri = `git-command://output/${encodeURIComponent(key)}`;
    this.pending.set(uri, props);
    const existing = this.views.get(uri);
    try {
      if (existing) await existing.update({ ...props, patchView: this.patchView });
      if (this.destroyed) return undefined;
      return await lumine.workspace.open(uri);
    } finally {
      if (this.pending.get(uri) === props) this.pending.delete(uri);
    }
  }

  setPatchView(patchView) {
    this.patchView = patchView;
    for (const view of this.views.values()) view.setPatchView(patchView);
  }

  destroy() {
    this.destroyed = true;
    this.patchView = null;
    this.opener.dispose();
    for (const view of Array.from(this.views.values())) {
      const pane = lumine.workspace.paneForItem(view);
      if (pane) pane.destroyItem(view, { force: true });
      else view.destroy();
    }
    this.views.clear();
    this.pending.clear();
  }
}

module.exports = { OutputManager, OutputView };
