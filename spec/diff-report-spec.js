describe("Git command visual diff snapshots", () => {
  let DiffReport;
  let report;
  let bridge;
  let patches;
  let views;
  let data;

  beforeEach(() => {
    DiffReport = require("../lib/diff-report");
    patches = [];
    views = [];
    data = {
      workingDirectory: __dirname,
      sections: [
        { id: "staged", title: "Staged Changes", rawPatch: "-old\n+index\n" },
        { id: "unstaged", title: "Unstaged Changes", rawPatch: "-index\n+worktree\n" },
      ],
    };
    bridge = {
      filterDiff: (rawPatch) => ({ filtered: rawPatch, removed: [] }),
      parseDiff: (rawPatch) => [{ rawPatch }],
      buildMultiFilePatch: jasmine.createSpy("buildMultiFilePatch").and.callFake((diffs) => {
        const patch = { rawPatch: diffs[0].rawPatch, dispose: jasmine.createSpy("dispose patch") };
        patches.push(patch);
        return patch;
      }),
      ChangesView: class {
        constructor(props) {
          this.props = props;
          this.diffView = props.initialDiffView;
          this.element = document.createElement("div");
          this.element.className = "git-panel-ChangesView";
          this.destroy = jasmine.createSpy("destroy view");
          views.push(this);
          props.refPatchController.setter(this);
          this.update(props);
        }

        update(props) {
          this.props = props;
          this.element.textContent = props.multiFilePatch.rawPatch;
          return Promise.resolve();
        }

        getDiffView() {
          return this.diffView;
        }

        setDiffView(diffView) {
          this.diffView = diffView;
          this.props.onDiffViewChange(diffView);
          return Promise.resolve();
        }
      },
    };
  });

  afterEach(() => report?.destroy());

  it("keeps index and worktree snapshots separate for both layouts", async () => {
    report = new DiffReport({ data, gitPanel: bridge, title: "Git Diff" });
    expect(report.view.getDiffView()).toBe("unified");
    for (const mode of ["unified", "side-by-side"]) {
      await report.view.setDiffView(mode);
      await report.select("staged");
      expect(report.view.props.multiFilePatch.rawPatch).toBe("-old\n+index\n");
      await report.select("unstaged");
      expect(report.view.props.multiFilePatch.rawPatch).toBe("-index\n+worktree\n");
      expect(report.view.getDiffView()).toBe(mode);
      expect(report.tabs.querySelector(".selected").textContent).toBe("Unstaged Changes");
      expect(report.view.props.readOnly).toBe(true);
    }
    expect(patches.length).toBe(2);
    expect(views.length).toBe(1);
  });

  it("preserves the selected snapshot and layout when refreshing a report", async () => {
    report = new DiffReport({ data, gitPanel: bridge, title: "Git Diff" });
    await report.view.setDiffView("side-by-side");
    await report.select("unstaged");
    const obsolete = [...patches];
    const previousView = report.view;
    await report.update({
      data: { ...data, sections: data.sections.map((section) => ({ ...section })) },
    });
    expect(report.selected).toBe("unstaged");
    expect(report.view.getDiffView()).toBe("side-by-side");
    expect(report.view).toBe(previousView);
    expect(previousView.destroy).not.toHaveBeenCalled();
    for (const patch of obsolete) expect(patch.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps snapshot buttons stable so selecting a tab preserves keyboard focus", async () => {
    report = new DiffReport({ data, gitPanel: bridge, title: "Git Diff" });
    jasmine.attachToDOM(report.element);
    const button = report.tabs.children[1];
    button.focus();
    await report.select("unstaged");
    expect(report.tabs.children[1]).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.classList.contains("selected")).toBe(true);
  });

  it("releases provider-owned state on service loss and recreates it on return", async () => {
    report = new DiffReport({ data, gitPanel: bridge, title: "Git Diff" });
    await report.view.setDiffView("side-by-side");
    const previousView = report.view;
    const previousPatch = patches[0];
    await report.update({ gitPanel: null });
    expect(previousView.destroy).toHaveBeenCalledTimes(1);
    expect(previousPatch.dispose).toHaveBeenCalledTimes(1);
    expect(report.view).toBeNull();
    expect(report.body.textContent).toContain("git-panel service is inactive");
    expect(report.body.textContent).toContain("+index");
    await report.update({ gitPanel: bridge });
    expect(report.view.getDiffView()).toBe("side-by-side");
    expect(report.view.props.multiFilePatch).not.toBe(previousPatch);
  });

  it("displays the reason for an older provider without activating another package", () => {
    const activate = spyOn(lumine.packages, "activatePackage");
    report = new DiffReport({ data, gitPanel: {}, title: "Git Diff" });
    expect(report.body.textContent).toContain("does not provide this view");
    expect(report.body.textContent).toContain("+index");
    expect(activate).not.toHaveBeenCalled();
  });

  it("keeps an untracked text preview and restores the comparison layout afterwards", async () => {
    data.sections.push({
      id: "untracked",
      title: "Untracked Files",
      text: "new.txt\n\nnew contents",
    });
    report = new DiffReport({ data, gitPanel: bridge, title: "Git Diff" });
    await report.view.setDiffView("side-by-side");
    await report.select("untracked");
    expect(report.body.textContent).toContain("new contents");
    expect(report.view).toBeNull();
    await report.select("staged");
    expect(report.view.getDiffView()).toBe("side-by-side");
  });

  it("releases every source snapshot once on repeated destruction", async () => {
    report = new DiffReport({ data, gitPanel: bridge, title: "Git Diff" });
    await report.select("unstaged");
    const currentView = report.view;
    report.destroy();
    report.destroy();
    expect(currentView.destroy).toHaveBeenCalledTimes(1);
    for (const patch of patches) expect(patch.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("Git command asynchronous diff reports", () => {
  let controller;
  let repository;
  let resolveFirst;

  beforeEach(() => {
    const Controller = require("../lib/controller");
    controller = Object.create(Controller.prototype);
    controller.diffRequests = new Map();
    controller.commitRequest = 0;
    controller.outputs = {
      show: jasmine.createSpy("show output").and.resolveTo(),
      destroy: () => {},
    };
    controller.modals = { destroy: () => {} };
    repository = { getWorkingDirectory: () => __dirname };
  });

  it("ignores an older result after a newer request for the same pane", async () => {
    const first = new Promise((resolve) => (resolveFirst = resolve));
    const newer = { sections: [], workingDirectory: __dirname };
    spyOn(controller, "diffData").and.returnValues(first, Promise.resolve(newer));
    const pending = controller.showDiff(repository, "diff", "Git Diff");
    await controller.showDiff(repository, "diff", "Git Diff");
    resolveFirst({ sections: [], workingDirectory: "obsolete" });
    await pending;
    expect(controller.outputs.show).toHaveBeenCalledTimes(1);
    expect(controller.outputs.show.calls.mostRecent().args[1].diffData).toBe(newer);
  });

  it("ignores a pending diff read after controller destruction", async () => {
    spyOn(controller, "diffData").and.returnValue(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const pending = controller.showDiff(repository, "diff", "Git Diff");
    controller.destroy();
    resolveFirst({ sections: [], workingDirectory: __dirname });
    await pending;
    expect(controller.outputs.show).not.toHaveBeenCalled();
  });

  it("does not replace a newer input workflow with a delayed commit preview", async () => {
    controller.modals.inputRevision = 0;
    controller.modals.showInput = jasmine.createSpy("show commit dialog");
    controller.getRepository = () => repository;
    controller.isProtected = () => Promise.resolve(false);
    spyOn(controller, "diffData").and.returnValue(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const pending = controller.commitDialog({});
    await Promise.resolve();
    controller.modals.inputRevision++;
    resolveFirst({ sections: [], workingDirectory: __dirname });
    await pending;
    expect(controller.modals.showInput).not.toHaveBeenCalled();
  });
});
