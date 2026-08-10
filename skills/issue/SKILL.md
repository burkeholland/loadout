---
name: issue
description: >
  Write and file a GitHub issue that is ruthlessly short and instantly clear.
  Use whenever the user wants to create, file, open, log, or raise a GitHub
  issue - including bug reports, feature requests, and follow-up tasks. Also
  use when the user says "/issue", "file an issue for this", "open a bug",
  "log this", or asks to turn a problem you just diagnosed into an issue.
  Searches for duplicates before filing, and optimizes for a reader who will
  spend 30 seconds on it and then has to fix it, so it caps length, strips
  filler, and forces a deletion pass.
---

# Issue

File a GitHub issue with the `create_issue` tool.

Write it for a stranger who will read it in 30 seconds and then has to fix it. They have no context, no memory of the conversation, and no patience.

## Rules

- **Title:** one line, under 10 words, names the actual problem - not a vague symptom.
- **Body:** under 150 words. Plain language. Spell out anything an outsider would not know.
- Open with the problem in one sentence. No preamble, no restating the title.
- Use only these sections: **What happens**, **Steps to reproduce**, **Expected**. Add **Cause** or **Suggested fix** only if you have evidence for it, one sentence each.
- **Steps to reproduce:** numbered, one action per line, no commentary.
- Include only load-bearing evidence - the single number, error, or log line that proves the problem. Cut anything that merely reinforces it.
- No hedging unless you are genuinely unsure; then name the uncertainty in one clause.
- No background, no alternatives considered, no impact speculation, no summary at the end.

## Search for duplicates first

Before writing anything, search the repo for an existing issue covering the same thing. Use `gh issue list --search "<keywords>" --state all --limit 20` (or `gh search issues`), and try two or three different phrasings - the error text, the feature name, and the component. Include closed issues; a closed duplicate is still an answer.

If you find a plausible match, stop. Do not file. Report back to the user with:

- The issue number, title, and state.
- One sentence on why it looks like the same problem.
- Proposed next steps - comment on the existing issue with the new detail, reopen it, file anyway because the overlap is only partial, or drop it.

Then wait for the user to choose. Only file a new issue once they confirm.

If the search turns up nothing relevant, say so in one line and keep going.

## Before you write

Check `.github/ISSUE_TEMPLATE/` (and the legacy `.github/ISSUE_TEMPLATE.md`). If a template fits, follow its structure and stay just as brief inside it. For YAML issue forms, render each field as a `### Label` heading followed by its answer, and do not drop sections; write "N/A" if one does not apply.

If you do not have enough to fill in **Steps to reproduce** or **Expected**, ask the user rather than guessing or padding.

## Before you submit

Reread the body and delete every sentence that does not change what the reader does next.

## After

Do not echo the issue number, URL, or body back to the user. The confirmation card covers it.
