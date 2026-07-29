const { formatBlame, formatCommits, formatStatus, parseStashes } = require("../lib/formatters");

describe("Git output formatters", () => {
  const repository = {
    getWorkingDirectory: () => "/workspace/example",
  };

  it("formats a status snapshot with branch, counts, and paths", () => {
    const output = formatStatus(
      {
        head: { name: "feature", detached: false },
        upstream: { name: "origin/feature", ahead: 2, behind: 1 },
        counts: { total: 2, staged: 1, unstaged: 1, conflicted: 0 },
        files: [
          {
            path: "new.txt",
            originalPath: null,
            indexStatus: "A",
            worktreeStatus: null,
            untracked: false,
          },
          {
            path: "renamed.txt",
            originalPath: "old.txt",
            indexStatus: null,
            worktreeStatus: "M",
            untracked: false,
          },
        ],
      },
      repository,
    );

    expect(output).toContain("feature -> origin/feature (+2 -1)");
    expect(output).toContain("A  new.txt");
    expect(output).toContain(" M old.txt -> renamed.txt");
  });

  it("formats commit bodies and blame rows", () => {
    const date = new Date("2026-01-02T03:04:05Z");
    expect(
      formatCommits([
        {
          sha: "0123456789abcdef",
          author: { name: "Lumine", date },
          subject: "Subject",
          body: "First line\nSecond line",
        },
      ]),
    ).toContain("0123456789  2026-01-02  Lumine");

    expect(
      formatBlame({
        lines: [
          {
            line: 7,
            sha: "abcdef0123456789",
            author: { name: "A User" },
            summary: "Change a line",
          },
        ],
      }),
    ).toContain("    7  abcdef01  A User  Change a line");
  });

  it("parses machine-formatted stash rows", () => {
    const stashes = parseStashes("stash@{0}\0two minutes ago\0On main: work\n");
    expect(stashes.length).toBe(1);
    expect(stashes[0]).toEqual(
      jasmine.objectContaining({
        reference: "stash@{0}",
        relativeDate: "two minutes ago",
        subject: "On main: work",
      }),
    );
  });
});
