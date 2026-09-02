const Controller = require("../lib/controller");

describe("Git diff display", () => {
  it("renders staged index and unstaged patches through the typed diff API", async () => {
    const controller = Object.create(Controller.prototype);
    controller.runRaw = jasmine.createSpy("runRaw");
    const repository = {
      ensureStatusSnapshot: () =>
        Promise.resolve({ head: { unborn: false, oid: "a".repeat(64) }, files: [] }),
      getDiff: jasmine.createSpy("getDiff").and.callFake(({ to }) =>
        Promise.resolve({
          schemaVersion: 1,
          files: [],
          rawPatch: to?.type === "index" ? "+staged-index\n" : "+worktree\n",
        }),
      ),
    };

    const text = await controller.diffText(repository, ["example.txt"]);

    expect(repository.getDiff.calls.argsFor(0)[0]).toEqual({
      from: { type: "commit", revision: "HEAD" },
      to: { type: "index" },
      paths: ["example.txt"],
      format: "patch",
    });
    expect(repository.getDiff.calls.argsFor(1)[0]).toEqual({
      paths: ["example.txt"],
      format: "patch",
    });
    expect(controller.runRaw).not.toHaveBeenCalled();
    expect(text).toContain("+staged-index");
    expect(text).toContain("+worktree");
  });

  it("uses an algorithm-neutral empty endpoint for an unborn index", async () => {
    const controller = Object.create(Controller.prototype);
    const repository = {
      ensureStatusSnapshot: () => Promise.resolve({ head: { unborn: true }, files: [] }),
      getDiff: jasmine
        .createSpy("getDiff")
        .and.returnValue(Promise.resolve({ schemaVersion: 1, files: [], rawPatch: "" })),
    };

    await controller.diffText(repository);

    expect(repository.getDiff.calls.argsFor(0)[0].from).toEqual({ type: "empty" });
  });
});
