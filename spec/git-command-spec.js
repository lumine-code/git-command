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
    lumine.config.set("git-command.protectCommits", false);
    lumine.config.set("git-command.protectPushes", false);
    workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "git-command-"));
    repository = await lumine.repositories.initialize(workingDirectory, { initialBranch: "main" });
    const operations = repository.getOperations();
    await operations.setConfig("user.name", "Git Command Specs");
    await operations.setConfig("user.email", "specs@lumine.invalid");

    filePath = path.join(workingDirectory, "example.txt");
    fs.writeFileSync(filePath, "initial\n");
    await operations.stageFiles(["example.txt"]);
    await operations.commit("Initial commit");

    editor = await lumine.workspace.open(filePath);
    jasmine.attachToDOM(lumine.workspace.getElement());
    const activation = lumine.packages.activatePackage("git-command");
    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:show-command-list");
    await activation;
    main = lumine.packages.getActivePackage("git-command").mainModule;
    controller = main.controller;
    main.commandList.hide();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("command-palette");
    await lumine.packages.deactivatePackage("git-command");
    for (const pane of lumine.workspace.getPanes()) {
      for (const item of pane.getItems()) {
        await pane.destroyItem(item, { force: true });
      }
    }
    lumine.repositories.forget(repository);
    lumine.config.unset("git-command.protectCommits");
    lumine.config.unset("git-command.protectPushes");
    try {
      fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows can retain a short-lived worker handle after a Git operation.
    }
  });

  it("registers its commands and opens the select list in a modal panel", () => {
    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:show-command-list");

    expect(main.commandList.selectList.isVisible()).toBe(true);
    expect(main.commandList.selectList.getPanel().isVisible()).toBe(true);
    expect(main.commandList.selectList.element.textContent).toContain("Quick commit current file");

    const commands = lumine.commands.findCommands({ target: lumine.workspace.getElement() });
    expect(commands.find(({ name }) => name === "git-command:show-command-list").modal).toBe(
      "Git command",
    );
    expect(commands.find(({ name }) => name === "git-command:commit").modal).toBe("Commit");
  });

  it("routes a dispatched action through the controller", () => {
    spyOn(controller, "perform").and.returnValue(Promise.resolve());

    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:stage-all");

    expect(controller.perform).toHaveBeenCalledWith("stage-all");
  });

  it("coexists with the bundled Command Palette", async () => {
    const activation = lumine.packages.activatePackage("command-palette");
    lumine.commands.dispatch(lumine.workspace.getElement(), "command-palette:toggle");
    const commandPalette = await activation;
    await lumine.views.getNextUpdatePromise();

    const list = commandPalette.mainModule.list.selectListView;
    expect(list.isVisible()).toBe(true);
    expect(list.props.items.some(({ name }) => name === "git-command:show-command-list")).toBe(
      true,
    );
  });

  it("stages the active file through repository operations", async () => {
    editor.setText("changed\n");
    await editor.save();

    await controller.stageCurrentFile();

    const result = await lumine.repositories.executeGit(
      ["diff", "--cached", "--name-only"],
      workingDirectory,
    );
    expect(result.stdout.trim()).toBe("example.txt");
  });

  it("shows central status data in an output pane", async () => {
    editor.setText("changed\n");
    await editor.save();

    await controller.showStatus();

    const output = lumine.workspace.getActivePaneItem();
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

    const result = await lumine.repositories.executeGit(
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

    const result = await lumine.repositories.executeGit(["stash", "list"], workingDirectory);
    expect(result.stdout).toContain("Saved work");
    expect(fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n")).toBe("initial\n");
  });

  it("blocks commits on configured protected branches", async () => {
    lumine.config.set("git-command.protectCommits", true);
    lumine.config.set("git-command.protectedBranches", ["main"]);
    spyOn(lumine.notifications, "addWarning");

    await controller.commit();

    expect(lumine.notifications.addWarning).toHaveBeenCalled();
    expect(controller.modals.inputDialog.isVisible()).toBe(false);
  });

  it("removes its commands when deactivated", async () => {
    await lumine.packages.deactivatePackage("git-command");
    spyOn(controller, "perform");

    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:status");

    expect(controller.perform).not.toHaveBeenCalled();
  });
});
