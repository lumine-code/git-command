const { CompositeDisposable } = require("lumine");

const { ACTIONS, CommandList } = require("./command-list");
const Controller = require("./controller");

module.exports = {
  activate() {
    this.subscriptions = new CompositeDisposable();
    this.controller = new Controller();
    this.commandList = new CommandList(this.controller);

    const commands = {
      "git-command:show-command-list": {
        description: "Open the picker listing every Git command this package runs.",
        modal: "Git command",
        didDispatch: () => this.commandList.toggle(),
      },
    };
    for (const item of ACTIONS) {
      commands[`git-command:${item.action}`] = {
        description: item.detail,
        ...(item.modal ? { modal: item.label } : {}),
        didDispatch: () => this.controller.perform(item.action),
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
  },
};
