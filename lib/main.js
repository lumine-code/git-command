const { CompositeDisposable, Disposable } = require("lumine");

const { ACTIONS } = require("./command-list");
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
        didDispatch: (event) => this.ensureCommandList(event.context?.window).toggle(),
      },
    };
    for (const item of ACTIONS) {
      commands[`git-command:${item.action}`] = {
        description: item.detail,
        ...(item.modal ? { modal: item.label } : {}),
        didDispatch: (event) => this.ensureController().perform(item.action, { event }),
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
