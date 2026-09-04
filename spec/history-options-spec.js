const Controller = require("../lib/controller");

describe("Git history consumers", () => {
  it("requests all refs without passing a Git CLI flag as a revision", async () => {
    const controller = Object.create(Controller.prototype);
    const repository = {
      getCommits: jasmine.createSpy("getCommits").and.resolveTo({ commits: [] }),
    };
    controller.getRepository = () => repository;
    controller.modals = {
      showSelection: jasmine.createSpy("showSelection").and.resolveTo(),
      updateSelection: jasmine.createSpy("updateSelection").and.resolveTo(),
    };

    await controller.cherryPick();

    expect(repository.getCommits).toHaveBeenCalledWith({
      allRefs: true,
      limit: lumine.config.get("git-command.logLimit"),
    });
  });
});
