const { CompositeDisposable } = require("atom");

const CommandPalette = require("./command-palette");
const Controller = require("./controller");

const ACTIONS = [
  "status",
  "stage-current-file",
  "stage-all",
  "unstage-current-file",
  "unstage-all",
  "commit",
  "stage-all-and-commit",
  "quick-commit-current-file",
  "amend",
  "diff-current-file",
  "diff-all",
  "log",
  "log-current-file",
  "blame-current-file",
  "open-changed-files",
  "restore-current-file",
  "checkout",
  "new-branch",
  "merge",
  "rebase",
  "cherry-pick",
  "fetch",
  "fetch-all",
  "pull",
  "push",
  "stash",
  "manage-stashes",
  "run",
];

module.exports = {
  activate() {
    this.subscriptions = new CompositeDisposable();
    this.controller = new Controller();
    this.palette = new CommandPalette(this.controller);

    const commands = {
      "git-command:menu": () => this.palette.toggle(),
    };
    for (const action of ACTIONS) {
      commands[`git-command:${action}`] = () => this.controller.perform(action);
    }
    this.subscriptions.add(atom.commands.add("atom-workspace", commands));
  },

  deactivate() {
    this.subscriptions?.dispose();
    this.palette?.destroy();
    this.controller?.destroy();
    this.subscriptions = null;
    this.palette = null;
    this.controller = null;
  },
};
