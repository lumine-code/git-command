const { CompositeDisposable, Disposable } = require("lumine");

const { ACTIONS } = require("./command-list");
const FILE_ACTIONS = require("./action-scope");
const controllerLoader = new (require("./controller-loader"))();
let CommandList = null;
let Controller = null;

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "git-command",
      tips: [
        "You can open every common Git workflow with {{ 'git-command:show-command-list' | keystroke }}",
      ],
    };
  },

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.controller = null;
    this.commandList = null;
    this.commandLists = new Map();
    this.diffService = null;
    this.diffServiceEdge = null;

    const commands = {
      "git-command:show-command-list": {
        description: "Open the picker listing every Git command this package runs.",
        modal: "Git command",
        didDispatch: (event) => this.showCommandList(event),
      },
    };
    for (const item of ACTIONS) {
      commands[`git-command:${item.action}`] = {
        description: item.detail,
        ...(item.modal ? { modal: item.label } : {}),
        didDispatch: (event) => this.performAction(item.action, event),
      };
    }
    this.subscriptions.add(lumine.commands.add("lumine-workspace", commands));
  },

  deactivate() {
    this.subscriptions?.dispose();
    for (const record of this.commandLists.values()) {
      record.lease.dispose();
      void record.list.destroy();
    }
    this.commandLists.clear();
    this.controller?.destroy();
    this.subscriptions = null;
    this.commandList = null;
    this.controller = null;
    this.diffService = null;
    this.diffServiceEdge = null;
  },

  consumeDiff(diffService) {
    const edge = { diffService };
    this.diffServiceEdge = edge;
    this.diffService = diffService;
    this.controller?.setDiffService(diffService);
    return new Disposable(() => {
      if (this.diffServiceEdge !== edge) return;
      this.diffServiceEdge = null;
      this.diffService = null;
      this.controller?.setDiffService(null);
    });
  },

  ensureController() {
    if (!this.controller) {
      Controller ||= require("./controller");
      this.controller = new Controller({ diffService: this.diffService });
    }
    return this.controller;
  },

  loadController() {
    return controllerLoader.load();
  },

  async withController(event, invoke) {
    const owner = this.subscriptions;
    if (!owner || owner.disposed) return;
    const window =
      event?.context?.window ??
      lumine.workspace.getWindowForElement(event?.target) ??
      lumine.workspace.getMainWindow();
    let closed = false;
    const lease = window.onWillDestroy(() => {
      closed = true;
    });
    owner.add(lease);
    const owns = () => this.subscriptions === owner && !owner.disposed && !closed;
    try {
      const LoadedController = await this.loadController();
      if (!owns()) return;
      Controller = LoadedController;
      const controller = this.controller ?? new Controller({ diffService: this.diffService });
      if (!owns()) {
        controller.destroy();
        return;
      }
      this.controller = controller;
      return await invoke(controller, window);
    } catch (error) {
      if (owns())
        lumine.notifications.addError("Unable to load the Git command runtime.", {
          detail: error.message,
          dismissable: true,
        });
    } finally {
      owner.remove(lease);
      lease.dispose();
    }
  },

  performAction(action, event) {
    if (this.controller) return this.controller.perform(action, { event });
    const scope = FILE_ACTIONS.has(action) ? "file" : "repository";
    const context = lumine.repositories.getCommandContext(event, { scope });
    return this.withController(event, (controller, window) => {
      if (context.repository?.isDestroyed?.()) return;
      if (
        scope === "file" &&
        context.editor &&
        (context.editor.isDestroyed() || context.editor.getPath() !== context.path)
      )
        return;
      return controller.perform(action, { event, context, window });
    });
  },

  showCommandList(event) {
    if (this.controller) return this.ensureCommandList(event?.context?.window).toggle();
    return this.withController(event, (_controller, window) =>
      this.ensureCommandList(window).toggle(),
    );
  },

  ensureCommandList(window = lumine.workspace.getMainWindow()) {
    let record = this.commandLists.get(window);
    if (!record) {
      CommandList ||= require("./command-list").CommandList;
      const list = new CommandList(this.ensureController(), window);
      const lease = window.onWillDestroy(() => {
        this.commandLists.delete(window);
        lease.dispose();
        void list.destroy();
      });
      record = { list, lease };
      this.commandLists.set(window, record);
      if (window.isMain()) this.commandList = list;
    }
    return record.list;
  },
};
