const { CompositeDisposable } = require("atom");

const { ACTIONS, CommandList } = require("./command-list");
const Controller = require("./controller");

module.exports = {
  activate() {
    this.subscriptions = new CompositeDisposable();
    this.controller = new Controller();
    this.commandList = new CommandList(this.controller);

    const commands = {
      "git-command:menu": {
        displayName: "Git Command: Show Command List",
        modal: "Git command",
        didDispatch: () => this.commandList.toggle(),
      },
    };
    for (const item of ACTIONS) {
      commands[`git-command:${item.action}`] = {
        modal: item.modal ? item.label : undefined,
        didDispatch: () => this.controller.perform(item.action),
      };
    }
    this.subscriptions.add(atom.commands.add("atom-workspace", commands));
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
