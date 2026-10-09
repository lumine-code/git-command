const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
describe("Saved staging feedback", () => {
  let directory, root, repository, editor, controller;
  beforeEach(async () => {
    jasmine.useRealClock();
    root = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(root, "git-stage-feedback-")));
    repository = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    const operations = repository.getOperations();
    await operations.setConfig("user.name", "Controlled Stage");
    await operations.setConfig("user.email", "stage@example.invalid");
    const file = path.join(directory, "example.txt");
    fs.writeFileSync(file, "saved disk version\n");
    await operations.stageFiles(["example.txt"]);
    await operations.commit("Controlled saved baseline");
    editor = await lumine.workspace.open(file);
    lumine.repositories.setActiveRepository(repository, { pin: true });
    controller = (
      await lumine.packages.activatePackage("git-command")
    ).mainModule.ensureController();
  });
  afterEach(async () => {
    lumine.repositories.setActiveRepository(null);
    await lumine.packages.deactivatePackage("git-command");
    editor.destroy();
    await lumine.repositories.forget(repository);
    if (
      path.dirname(directory) !== root ||
      !path.basename(directory).startsWith("git-stage-feedback-")
    )
      throw new Error("Unsafe owned scratch cleanup");
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  it("reports that actual unsaved editor edits were excluded while retaining saved disk staging", async () => {
    editor.setText("unsaved editor version\n");
    const success = spyOn(lumine.notifications, "addSuccess");
    await controller.perform("stage-current-file");
    const indexed = await repository
      .getOperations()
      .executeGit(["show", ":example.txt"], { readOnly: true });
    expect(indexed.stdout).toBe("saved disk version\n");
    expect(editor.getText()).toBe("unsaved editor version\n");
    expect(editor.getFileState()).toBe("modified");
    expect(success).toHaveBeenCalledWith(
      "Staged saved version of example.txt; unsaved editor changes were excluded",
    );
  });
  it("keeps ordinary staging feedback for a saved editor", async () => {
    const success = spyOn(lumine.notifications, "addSuccess");
    await controller.perform("stage-current-file");
    expect(success).toHaveBeenCalledWith("Staged example.txt");
  });
  it("keeps current staging failures and does not announce success", async () => {
    spyOn(repository.getOperations(), "stageFiles").and.rejectWith(
      new Error("Controlled stage failed"),
    );
    const error = spyOn(lumine.notifications, "addError"),
      success = spyOn(lumine.notifications, "addSuccess");
    await controller.perform("stage-current-file");
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Git stage-current-file failed", {
      detail: "Controlled stage failed",
      dismissable: true,
    });
  });
});
