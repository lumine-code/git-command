const { parseCommandLine } = require("../lib/command-line");

describe("Git argument parsing", () => {
  it("splits ordinary arguments and quoted values", () => {
    expect(parseCommandLine("commit -m \"A useful message\" --author='A User'")).toEqual([
      "commit",
      "-m",
      "A useful message",
      "--author=A User",
    ]);
  });

  it("preserves empty quoted arguments and Windows paths", () => {
    expect(parseCommandLine('show "" C:\\work\\file.txt "C:\\two words\\file.txt"')).toEqual([
      "show",
      "",
      "C:\\work\\file.txt",
      "C:\\two words\\file.txt",
    ]);
  });

  it("supports escaped whitespace and quotes", () => {
    expect(parseCommandLine('log --grep=fix\\ parser "say \\"hello\\""')).toEqual([
      "log",
      "--grep=fix parser",
      'say "hello"',
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCommandLine('commit -m "unfinished')).toThrowError(
      "Unterminated double quote.",
    );
  });
});
