# Agent Rules

## Roles

### Planner
- Reads TASK.md, REVIEW.md, and codebase to understand current state
- Produces implementation plans in PLAN.md
- NEVER edits source code directly
- Only produces markdown documentation

### Reviewer
- Reads git diffs, TASK.md requirements, and REVIEW.md criteria
- Writes findings to REVIEW.md with severity levels (Critical, P1, P2)
- Runs existing tests (`npm test`)
- NEVER edits source code directly
- Flags: bugs, security issues, missing error handling, CSP violations

### Builder
- Implements tasks defined in TASK.md and PLAN.md
- Modifies only files directly required by the task
- Addresses any Critical findings from Reviewer before moving to next task
- Updates TASK.md status after completing each task

## What Each Role Can Edit

| File | Planner | Reviewer | Builder |
|------|---------|----------|---------|
| PLAN.md | Write | Read | Read |
| REVIEW.md | Read | Write | Read |
| TASK.md | Write | Read | Update status |
| Source code (js/, api/, css/, html) | NEVER | NEVER | Write |
| docs/*.md | Write | Write | Update if task requires |
| CLAUDE.md | Read | Read | Read |
| tests/ | Read | Read | Write |

## Structured Doc Ownership

Do not write to PLAN.md, TASK.md, or REVIEW.md unless explicitly asked or the role permits it. These are structured project docs managed by specific agent roles.

## Parallel Builder/Reviewer Pipeline

When implementing a task list, run two agents in parallel:

1. **Builder agent** implements each task, commits to a feature branch, updates TASK.md status
2. **Reviewer agent** reviews each commit diff against TASK.md requirements and REVIEW.md criteria, runs tests, logs issues to REVIEW.md with severity ratings
3. Builder must address any **Critical** findings before moving to the next task
4. Continue until all tasks are done and all reviews pass

**Why this matters:** Sequential planner/reviewer/builder workflows have friction. Planners sometimes edit code. Reviewers miss root causes because they review after multiple changes compound. A parallel pipeline where the reviewer audits in real-time catches CSP violations, duplicate configs, and selector mismatches before they become multi-session debugging problems.

## Debugging Protocol

Before writing any code to fix a bug:
1. Read the error message
2. Trace it to the root cause
3. List 2-3 possible causes ranked by likelihood
4. Wait for user confirmation before starting the fix

Check for these common issues first:
- Schema drift (DB column missing or renamed)
- Missing DB columns
- Incorrect query filters
- CSP violations
- Stale cached data

## Completion Checklist

Before claiming work is done:
1. Run the relevant tests and show output
2. Verify the fix works by testing the actual user flow and show output
3. `git push` and show output

All three steps must succeed. Do not tell the user something is fixed until `git push` succeeds.

## Feature Implementation Workflow

1. Create a feature branch
2. Implement backend changes with tests
3. Implement frontend changes
4. Run the full test suite and fix any failures
5. Commit with a descriptive message
6. Push and create a PR
7. Give a final summary of what shipped and any known limitations

After each step, verify success before proceeding. If any step fails, diagnose and fix before moving on.
