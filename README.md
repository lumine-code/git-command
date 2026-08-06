# git-command

Run common Git workflows from a searchable select list in Lumine's modal pane zone.

The package is a modern Lumine adaptation of `akonwi/git-plus`, with focused ideas from `mauricioszabo/simple-git`.

## Features

- **Modal command list**: find common repository actions in a select list hosted by Lumine's modal pane zone.
- **Central execution**: use Lumine's repository registry, operation queue, authentication, and bundled Git.
- **Guided workflows**: choose branches, remotes, commits, and stashes through modal flows.
- **Commit previews**: review staged or current-file changes before entering a commit message.
- **Repository reports**: inspect status, diffs, history, and blame in reusable output panes.
- **Protected branches**: block commits and pushes on configured branch names.
- **File actions**: stage, unstage, restore, or open changed files from the active repository.
- **Git fallback**: run an arbitrary argument line when a specialized action is not available.

## Installation

To install `git-command` search for _git-command_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/git-command`.

## Commands

Commands available in `atom-workspace`:

- `git-command:menu`: show the searchable Git action list in the modal pane zone,
- `git-command:status`: show repository status,
- `git-command:stage-current-file`: stage the active file,
- `git-command:stage-all`: stage every change,
- `git-command:unstage-current-file`: unstage the active file,
- `git-command:unstage-all`: unstage every staged change,
- `git-command:commit`: preview and commit staged changes,
- `git-command:stage-all-and-commit`: stage all changes, preview them, and commit,
- `git-command:quick-commit-current-file`: preview, stage, and commit the active file,
- `git-command:amend`: preview staged changes and amend the latest commit,
- `git-command:diff-current-file`: show the active file's staged and unstaged changes,
- `git-command:diff-all`: show every staged and unstaged change,
- `git-command:log`: show recent repository history,
- `git-command:log-current-file`: show recent history for the active file,
- `git-command:blame-current-file`: show blame information for the active file,
- `git-command:open-changed-files`: open all changed files,
- `git-command:restore-current-file`: restore the active file from `HEAD`,
- `git-command:checkout`: choose and check out a local branch,
- `git-command:new-branch`: create and check out a branch,
- `git-command:merge`: choose a local branch to merge,
- `git-command:rebase`: choose a local branch onto which to rebase,
- `git-command:cherry-pick`: choose a recent commit to cherry-pick,
- `git-command:fetch`: choose a remote to fetch,
- `git-command:fetch-all`: fetch every remote in every open repository,
- `git-command:pull`: pull the current branch from its upstream,
- `git-command:push`: push the current branch,
- `git-command:stash`: create a stash with an optional message,
- `git-command:manage-stashes`: apply, pop, or drop an existing stash,
- `git-command:run`: run an arbitrary Git argument line.

## Customization

You can adjust the package's panes and modal content in your `styles.css`:

```css
.git-command-output pre,
.git-command-preview {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-color);
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
