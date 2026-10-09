describe("Large blame report", () => {
  it("formats a valid large repository blame snapshot without expanding it into call arguments", () => {
    const { formatBlame } = require("../lib/formatters");
    const lines = Array.from({ length: 150_000 }, (_, index) => ({
      line: index + 1,
      sha: "0123456789abcdef",
      author: { name: index === 0 ? "Long author name wider than the report" : "User" },
      summary: "Controlled line",
    }));
    const report = formatBlame({ lines });
    expect(report.split("\n").length).toBe(lines.length);
    expect(report).toContain("150000  01234567");
    expect(report.split("\n")[0]).toContain("Long author name wider t");
  });
});
