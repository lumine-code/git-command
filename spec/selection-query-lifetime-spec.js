const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
/* global conditionPromise */
describe("Git selection metadata request ownership", () => {
  let directory, root, repository, controller, gates;
  beforeEach(async () => {
    jasmine.useRealClock();
    root = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(root, "git-selection-owned-")));
    repository = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    const operations = repository.getOperations();
    await operations.executeGit([
      "remote",
      "add",
      "current",
      "https://controlled.invalid/repository",
    ]);
    await lumine.workspace.open();
    lumine.repositories.setActiveRepository(repository, { pin: true });
    jasmine.attachToDOM(lumine.workspace.getElement());
    controller = (
      await lumine.packages.activatePackage("git-command")
    ).mainModule.ensureController();
    gates = [];
  });
  afterEach(async () => {
    for (const gate of gates) gate.resolve({ branches: [], remotes: [] });
    await Promise.all(gates.map((gate) => gate.task).filter(Boolean));
    lumine.repositories.setActiveRepository(null);
    await lumine.packages.deactivatePackage("git-command");
    for (const editor of lumine.workspace.getTextEditors()) editor.destroy();
    await lumine.repositories.forget(repository);
    if (
      path.dirname(directory) !== root ||
      !path.basename(directory).startsWith("git-selection-owned-")
    )
      throw new Error("Unsafe owned scratch cleanup");
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  function holdFirstRefs() {
    const original = repository.ensureRefsSnapshot.bind(repository);
    let resolve, reject;
    const promise = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const gate = { promise, resolve, reject };
    gates.push(gate);
    const requested = spyOn(repository, "ensureRefsSnapshot").and.callFake(() =>
      requested.calls.count() === 1 ? promise : original(),
    );
    return { gate, requested };
  }
  it("keeps a newer remote picker when an older branch query completes", async () => {
    const { gate, requested } = holdFirstRefs();
    gate.task = controller.perform("checkout");
    await conditionPromise(() => requested.calls.count() === 1);
    await controller.perform("fetch");
    controller.modals.selectList.setQuery("preserve current input");
    expect(controller.modals.selectList.getItems().map((item) => item.remote)).toEqual(["current"]);
    gate.resolve({ branches: [{ name: "obsolete", isHead: false }], remotes: [] });
    await gate.task;
    expect(controller.modals.selectList.getItems().map((item) => item.remote)).toEqual(["current"]);
    expect(controller.modals.selectList.getQuery()).toBe("preserve current input");
    expect(controller.modals.selectListHost.isVisible()).toBe(true);
  });
  it("does not report a superseded branch query failure into the current flow", async () => {
    const { gate, requested } = holdFirstRefs();
    gate.task = controller.perform("checkout");
    await conditionPromise(() => requested.calls.count() === 1);
    await controller.perform("fetch");
    const error = spyOn(lumine.notifications, "addError");
    gate.reject(new Error("obsolete metadata"));
    await gate.task;
    expect(error).not.toHaveBeenCalled();
    expect(controller.modals.selectList.getItems().map((item) => item.remote)).toEqual(["current"]);
  });
  it("preserves a current metadata failure", async () => {
    const { gate, requested } = holdFirstRefs();
    gate.task = controller.perform("checkout");
    await conditionPromise(() => requested.calls.count() === 1);
    const error = spyOn(lumine.notifications, "addError");
    gate.reject(new Error("current metadata"));
    await gate.task;
    expect(error).toHaveBeenCalledWith("Git checkout failed", {
      detail: "current metadata",
      dismissable: true,
    });
  });
});
