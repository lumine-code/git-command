const fs = require("fs");
const os = require("os");
const path = require("path");

describe("git-command", () => {
  let controller;
  let editor;
  let filePath;
  let main;
  let repository;
  let workingDirectory;

  beforeEach(async () => {
    atom.config.set("git-command.protectCommits", false);
    atom.config.set("git-command.protectPushes", false);
    workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "git-command-"));
    repository = await atom.repositories.initialize(workingDirectory, { initialBranch: "main" });
    const operations = repository.getOperations();
    await operations.setConfig("user.name", "Git Command Specs");
    await operations.setConfig("user.email", "specs@lumine.invalid");

    filePath = path.join(workingDirectory, "example.txt");
    fs.writeFileSync(filePath, "initial\n");
    await operations.stageFiles(["example.txt"]);
    await operations.commit("Initial commit");

    editor = await atom.workspace.open(filePath);
    jasmine.attachToDOM(atom.workspace.getElement());
    const activation = atom.packages.activatePackage("git-command");
    atom.commands.dispatch(atom.workspace.getElement(), "git-command:menu");
    await activation;
    main = atom.packages.getActivePackage("git-command").mainModule;
    controller = main.controller;
    main.commandList.hide();
  });

  afterEach(async () => {
    await atom.packages.deactivatePackage("command-palette");
    await atom.packages.deactivatePackage("git-command");
    for (const pane of atom.workspace.getPanes()) {
      for (const item of pane.getItems()) {
        await pane.destroyItem(item, { force: true });
      }
    }
    atom.repositories.forget(repository);
    atom.config.unset("git-command.protectCommits");
    atom.config.unset("git-command.protectPushes");
    try {
      fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows can retain a short-lived worker handle after a Git operation.
    }
  });

  it("registers its commands and opens the select list in a modal panel", () => {
    atom.commands.dispatch(atom.workspace.getElement(), "git-command:menu");

    expect(main.commandList.selectList.isVisible()).toBe(true);
    expect(main.commandList.selectList.getPanel().isVisible()).toBe(true);
    expect(main.commandList.selectList.element.textContent).toContain("Quick commit current file");

    const commands = atom.commands.findCommands({ target: atom.workspace.getElement() });
    expect(commands.find(({ name }) => name === "git-command:menu").modal).toBe("Git command");
    expect(commands.find(({ name }) => name === "git-command:commit").modal).toBe("Commit");
  });

  it("routes a dispatched action through the controller", () => {
    spyOn(controller, "perform").and.returnValue(Promise.resolve());

    atom.commands.dispatch(atom.workspace.getElement(), "git-command:stage-all");

    expect(controller.perform).toHaveBeenCalledWith("stage-all");
  });

  it("coexists with the bundled Command Palette", async () => {
    const activation = atom.packages.activatePackage("command-palette");
    atom.commands.dispatch(atom.workspace.getElement(), "command-palette:toggle");
    const commandPalette = await activation;
    await atom.views.getNextUpdatePromise();

    const list = commandPalette.mainModule.list.selectListView;
    expect(list.isVisible()).toBe(true);
    expect(list.props.items.some(({ name }) => name === "git-command:menu")).toBe(true);
  });

  it("stages the active file through repository operations", async () => {
    editor.setText("changed\n");
    await editor.save();

    await controller.stageCurrentFile();

    const result = await atom.repositories.executeGit(
      ["diff", "--cached", "--name-only"],
      workingDirectory,
    );
    expect(result.stdout.trim()).toBe("example.txt");
  });

  it("shows central status data in an output pane", async () => {
    editor.setText("changed\n");
    await editor.save();

    await controller.showStatus();

    const output = atom.workspace.getActivePaneItem();
    expect(output.getTitle()).toBe("Git Status");
    expect(output.getElement().textContent).toContain("example.txt");
  });

  it("previews and quick-commits the active file", async () => {
    editor.setText("quick change\n");
    await editor.save();

    await controller.quickCommitCurrentFile({ crumb: "Quick commit" });
    expect(controller.modals.preview.textContent).toContain("-initial");
    expect(controller.modals.preview.textContent).toContain("+quick change");

    await controller.modals.confirmInput("Quick update");

    const result = await atom.repositories.executeGit(
      ["log", "-1", "--format=%s"],
      workingDirectory,
    );
    expect(result.stdout.trim()).toBe("Quick update");
  });

  it("creates stashes through the repository operation facade", async () => {
    editor.setText("stash me\n");
    await editor.save();

    controller.stash();
    await controller.modals.confirmInput("Saved work");

    const result = await atom.repositories.executeGit(["stash", "list"], workingDirectory);
    expect(result.stdout).toContain("Saved work");
    expect(fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n")).toBe("initial\n");
  });

  it("blocks commits on configured protected branches", async () => {
    atom.config.set("git-command.protectCommits", true);
    atom.config.set("git-command.protectedBranches", ["main"]);
    spyOn(atom.notifications, "addWarning");

    await controller.commit();

    expect(atom.notifications.addWarning).toHaveBeenCalled();
    expect(controller.modals.inputDialog.isVisible()).toBe(false);
  });

  it("removes its commands when deactivated", async () => {
    await atom.packages.deactivatePackage("git-command");
    spyOn(controller, "perform");

    atom.commands.dispatch(atom.workspace.getElement(), "git-command:status");

    expect(controller.perform).not.toHaveBeenCalled();
  });
});
