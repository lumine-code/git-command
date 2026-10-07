// Each tab owns an independent patch: the same path may have different index
// and worktree contents. Never combine these snapshots by filename.
module.exports = class DiffReport {
  constructor({ data, patchView, title }) {
    this.element = document.createElement("div");
    this.element.className = "git-command-diff-report";
    this.tabs = document.createElement("div");
    this.tabs.className = "git-command-diff-tabs btn-group native-key-bindings";
    this.tabs.setAttribute("aria-label", "Changes to compare");
    this.tabs.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.buttons = new Map();
    this.body = document.createElement("div");
    this.body.className = "git-command-diff-body";
    this.element.append(this.tabs, this.body);
    this.selected = "staged";
    this.diffView = "unified";
    this.title = title;
    try {
      this.ready = this.update({ data, patchView, title });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  update({ data = this.data, patchView = this.patchView, title = this.title }) {
    if (this.destroyed) return Promise.resolve();
    const changed = data !== this.data || patchView !== this.patchView;
    this.title = title;
    if (changed) {
      if (patchView !== this.patchView) this.clearView();
      this.disposePatches();
      this.data = data;
      this.patchView = patchView;
      this.sections = data.sections;
      if (!this.sections.some(({ id }) => id === this.selected)) {
        this.selected = this.sections[0]?.id;
      }
      // Start on actual changes, while keeping empty snapshots available.
      if (!this.initialized) {
        this.selected =
          this.sections.find(({ files, rawPatch }) => files?.length || rawPatch?.trim())?.id ||
          this.selected;
        this.initialized = true;
      }
    }
    this.renderTabs();
    return this.showSelected();
  }

  renderTabs() {
    this.tabs.hidden = this.sections.length < 2;
    const currentIds = new Set(this.sections.map(({ id }) => id));
    for (const [id, button] of this.buttons) {
      if (currentIds.has(id)) continue;
      button.remove();
      this.buttons.delete(id);
    }
    for (const [index, section] of this.sections.entries()) {
      let button = this.buttons.get(section.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => this.select(section.id));
        this.buttons.set(section.id, button);
      }
      button.className = `btn btn-sm${this.selected === section.id ? " selected" : ""}`;
      button.textContent = section.title;
      button.setAttribute("aria-pressed", String(this.selected === section.id));
      if (this.tabs.children[index] !== button) {
        this.tabs.insertBefore(button, this.tabs.children[index] || null);
      }
    }
  }

  select(id) {
    if (this.destroyed || !this.sections.some((section) => section.id === id)) {
      return Promise.resolve();
    }
    this.selected = id;
    this.renderTabs();
    return this.showSelected();
  }

  showSelected() {
    if (this.destroyed) return Promise.resolve();
    const section = this.sections.find(({ id }) => id === this.selected);
    if (!section) return Promise.resolve();
    if (section.text !== undefined || !this.patchView?.ChangesView) {
      this.clearView();
      const fragment = document.createDocumentFragment();
      if (section.text === undefined) {
        const notice = document.createElement("p");
        notice.className = "git-command-diff-unavailable text-subtle";
        notice.textContent = this.patchView
          ? "Visual diff is unavailable because the patch-view service does not provide this view."
          : "Visual diff is unavailable because the patch-view service is inactive.";
        fragment.append(notice);
      }
      const pre = document.createElement("pre");
      pre.textContent = (section.text ?? section.rawPatch.trim()) || "No changes.";
      fragment.append(pre);
      this.body.replaceChildren(fragment);
      return Promise.resolve();
    }

    let patch = this.patches?.get(section.id);
    if (!patch) {
      patch = this.patchView.buildPatch(section, { preserveOriginal: true });
      this.patches ||= new Map();
      this.patches.set(section.id, patch);
    }
    const props = {
      title: `${this.title} — ${section.title}`,
      multiFilePatch: patch,
      readOnly: true,
      initialDiffView: this.diffView,
      onDiffViewChange: (diffView) => (this.diffView = diffView),
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
      repository: { getWorkingDirectoryPath: () => this.data.workingDirectory },
      surface: () => {},
      refPatchController: { setter: (controller) => (this.patchController = controller) },
    };
    if (this.view) return this.view.update(props);
    this.view = new this.patchView.ChangesView(props);
    this.body.replaceChildren(this.view.element);
    return Promise.resolve();
  }

  clearView() {
    if (!this.view) return;
    const view = this.view;
    this.diffView = view.getDiffView() || this.diffView;
    this.view = null;
    view.element.remove();
    view.destroy();
  }

  clearPatch() {
    this.clearView();
    this.disposePatches();
  }

  disposePatches() {
    for (const patch of this.patches?.values() || []) patch.dispose();
    this.patches = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearPatch();
    this.patchView = null;
    this.data = null;
    this.sections = [];
    this.patchController = null;
    this.buttons.clear();
    this.tabs.replaceChildren();
    this.body.replaceChildren();
    this.element.remove();
  }
};
