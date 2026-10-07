const path = require("path");
const { OutputView } = require("../lib/output-view");

describe("Git command output layout", () => {
  let container, view, styles;

  const props = {
    uri: "git-command://output/layout",
    title: "Git Diff",
    diffData: {
      workingDirectory: __dirname,
      sections: [{ id: "unstaged", title: "Unstaged Changes", rawPatch: "-old\n+new\n" }],
    },
    patchView: null,
  };

  beforeEach(() => {
    styles = [
      lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css")),
      lumine.themes.requireStylesheet(
        path.join(
          lumine.themes.resourcePath,
          "static",
          "lumine-ui",
          "styles",
          "private",
          "code.css",
        ),
      ),
    ];
    container = document.createElement("div");
    container.style.cssText = "width:1000px;height:600px";
    jasmine.attachToDOM(container);
  });

  afterEach(() => {
    view?.destroy();
    container.remove();
    for (const style of styles) style.dispose();
  });

  function expectDiffFillsContent() {
    const output = view.element.getBoundingClientRect();
    const report = view.diffReport.element.getBoundingClientRect();
    expect(report.top).toBeCloseTo(output.top, 0);
    expect(report.height).toBeCloseTo(output.height, 0);
    expect(view.element.querySelector(":scope > header")).toBeNull();
  }

  it("gives the diff the entire output area with the editor's block-code styles", () => {
    view = new OutputView(props);
    container.append(view.element);
    expectDiffFillsContent();
  });

  it("restores text output and gives the full content area back to a later diff", async () => {
    view = new OutputView(props);
    container.append(view.element);
    await view.update({ title: "Git Status", content: "example.txt" });
    expect(view.diffReport).toBeNull();
    const text = view.element.querySelector("pre");
    expect(view.element.querySelector(":scope > header").textContent).toContain("Git Status");
    expect(text.textContent).toBe("example.txt");
    expect(text.getBoundingClientRect().height).toBeGreaterThan(500);
    await view.update(props);
    expectDiffFillsContent();
  });
});
