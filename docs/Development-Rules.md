# Development Rules

This project is developed in a **single Claude Code console** — one session plans, implements, tests, and ships. (The earlier planner/builder/reviewer multi-agent split has been retired; its artifacts are archived in [archive/](archive/).)

## Planning docs

- New work is designed and planned under `docs/superpowers/specs/` (design specs) and `docs/superpowers/plans/` (implementation plans), produced via the brainstorming → writing-plans flow.
- The legacy root docs `PLAN.md`, `TASK.md`, and `REVIEW.md` now live in `docs/archive/` and no longer drive active work. Trust git history and the test suite over them.

## File boundaries

Respect the module responsibilities in [CLAUDE.md](../CLAUDE.md). Keep changes scoped to the files a task actually needs — don't refactor unrelated code. Data queries go through `dataLoader.js`; chart rendering stays in `charts.js`; see CLAUDE.md for the full table and the Mona-module boundaries.

## Debugging protocol

Before writing any fix:

1. Read the error message.
2. Trace it to the root cause — don't apply surface-level patches.
3. List 2-3 possible causes ranked by likelihood.
4. Confirm the diagnosis before starting the fix.

Check these common issues first: schema drift (DB column missing/renamed), missing DB columns, incorrect query filters, CSP violations, stale cached data.

## Feature workflow

1. Create a feature branch.
2. Implement backend changes with tests.
3. Implement frontend changes.
4. Run the full test suite (`npm test`); fix any failures.
5. Commit with a descriptive message.
6. Push and open a PR.
7. Summarize what shipped and any known limitations.

Verify each step before proceeding. If a step fails, diagnose and fix before moving on.

## Adding a SQL migration

A code change that references a new column MUST ship with its migration applied:

1. Create `sql/migration_<name>.sql`, ending with the `applied_migrations` insert.
2. Append the same `'migration_<name>'` to the `MIGRATIONS` array in `js/migrations-manifest.js`.
3. Run the file in the Supabase SQL Editor before the dependent code reaches production.

The dashboard's migration banner (for `lab`/`admin` users) flags drift between the manifest and `public.applied_migrations`.

## Completion checklist

Before claiming work is done:

1. Run the relevant tests and show output.
2. Verify the actual user flow works and show output.
3. `git push` and show output.

All three must succeed. Don't tell the user something is fixed until `git push` succeeds.
