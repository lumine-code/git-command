const { Emitter } = require("atom");

class OutputView {
  constructor({ uri, title, subtitle, content }) {
    this.uri = uri;
    this.title = title;
    this.subtitle = subtitle;
    this.emitter = new Emitter();

    this.element = document.createElement("section");
    this.element.className = "git-command-output native-key-bindings";
    this.element.tabIndex = -1;

    const header = document.createElement("header");
    this.heading = document.createElement("strong");
    this.copyButton = document.createElement("button");
    this.copyButton.className = "btn btn-sm icon icon-clippy";
    this.copyButton.textContent = "Copy";
    this.copyButton.addEventListener("click", () => atom.clipboard.write(this.pre.textContent));
    header.append(this.heading, this.copyButton);

    this.pre = document.createElement("pre");
    this.element.append(header, this.pre);
    this.update({ title, subtitle, content });
  }

  update({ title, subtitle, content }) {
    this.title = title;
    this.subtitle = subtitle;
    this.heading.textContent = subtitle ? `${title} — ${subtitle}` : title;
    this.pre.textContent = String(content || "");
    this.emitter.emit("did-change-title");
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

  onDidChangeTitle(callback) {
    return this.emitter.on("did-change-title", callback);
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.remove();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }
}

class OutputManager {
  constructor() {
    this.views = new Map();
    this.pending = new Map();
    this.opener = atom.workspace.addOpener((uri) => this.open(uri));
  }

  open(uri) {
    if (!String(uri).startsWith("git-command://output/")) return undefined;
    const existing = this.views.get(uri);
    if (existing) return existing;
    const props = this.pending.get(uri);
    if (!props) return undefined;

    const view = new OutputView({ uri, ...props });
    this.views.set(uri, view);
    view.onDidDestroy(() => this.views.delete(uri));
    return view;
  }

  async show(key, props) {
    const uri = `git-command://output/${encodeURIComponent(key)}`;
    this.pending.set(uri, props);
    const existing = this.views.get(uri);
    if (existing) existing.update(props);
    const view = await atom.workspace.open(uri);
    this.pending.delete(uri);
    return view;
  }

  destroy() {
    this.opener.dispose();
    for (const view of Array.from(this.views.values())) {
      const pane = atom.workspace.paneForItem(view);
      if (pane) pane.destroyItem(view, { force: true });
      else view.destroy();
    }
    this.views.clear();
    this.pending.clear();
  }
}

module.exports = { OutputManager, OutputView };
