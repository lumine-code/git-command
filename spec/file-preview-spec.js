const fs = require("fs");
const os = require("os");
const path = require("path");
const { MAX_PREVIEW_LENGTH, readFilePreview } = require("../lib/file-preview");

describe("Untracked file previews", () => {
  let directory;
  let filePath;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-preview-"));
    filePath = path.join(directory, "untracked.txt");
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("preserves small UTF-8 files", async () => {
    const text = "Zażółć gęślą jaźń 🦊\n";
    fs.writeFileSync(filePath, text);
    expect(await readFilePreview(filePath)).toBe(text);
  });

  it("truncates previews by text length", async () => {
    const text = "ż".repeat(MAX_PREVIEW_LENGTH + 1);
    fs.writeFileSync(filePath, text);
    expect(await readFilePreview(filePath)).toBe(`${text.slice(0, MAX_PREVIEW_LENGTH)}\n…`);
  });

  it("bounds the bytes read from a large untracked file", async () => {
    fs.writeFileSync(filePath, "x");
    fs.truncateSync(filePath, 128 * 1024 * 1024);
    const open = fs.promises.open.bind(fs.promises);
    let bytesRead = 0;
    let closed = false;
    spyOn(fs.promises, "open").and.callFake(async (...args) => {
      const file = await open(...args);
      const read = file.read.bind(file);
      const close = file.close.bind(file);
      file.read = async (...readArgs) => {
        const result = await read(...readArgs);
        bytesRead += result.bytesRead;
        return result;
      };
      file.close = async () => {
        closed = true;
        return close();
      };
      return file;
    });

    expect((await readFilePreview(filePath)).endsWith("\n…")).toBe(true);
    expect(bytesRead).toBeLessThanOrEqual((MAX_PREVIEW_LENGTH + 1) * 4);
    expect(closed).toBe(true);
  });
});
