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
    this.diffService = null;
    this.diffServiceEdge = null;

    const commands = {
      "git-command:show-command-list": {
        description: "Open the picker listing every Git command this package runs.",
        modal: "Git command",
        didDispatch: () => this.ensureCommandList().toggle(),
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
    this.commandList?.destroy();
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

  ensureCommandList() {
    if (!this.commandList) {
      CommandList ||= require("./command-list").CommandList;
      this.commandList = new CommandList(this.ensureController());
    }
    return this.commandList;
  },
};
