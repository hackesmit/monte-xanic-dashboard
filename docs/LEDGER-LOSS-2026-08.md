# Ledger loss, xanic-dashboard (discovered 2026-08-20)

The `xd` beads ledger for this rig lost its issue history. This file is the
reconstructed index, so the record survives in git even though the database
does not. Tracked as hq-4up9.

## What happened

On 2026-08-20 a status compile found `bd stats` reporting 1 issue in this rig,
while git history and the beads audit log reference more than twenty real
beads. The database itself was never recreated: `.beads/embeddeddolt/xd/.dolt/config.json`
and `.beads/.local_version` still carry their original `bd init` timestamp of
2026-07-10 19:46. So the rows were deleted from inside a live database rather
than lost to a re-init.

Three independent sources were checked and none holds the history:

| Source | State |
| --- | --- |
| Local Dolt DB (`.beads/embeddeddolt/xd`) | 1 issue, a session-eval flag created 2026-08-20 |
| Remote `refs/dolt/data` | 1 issue, `xd-ok2`, stale since roughly 2026-08-11 |
| Local Dolt backup (`.beads/backup/*.darc`) | mirrors the current empty database |

The backup is the painful one. `backup_state.json` claims a timestamp of
2026-07-11, but a forced restore into a scratch database returned the same
single 2026-08-20 bead. The backup had auto-synced after the loss, so it
overwrote the last good copy. A backup that follows the primary without a
retention window is not a backup.

## What is not known

The exact command that deleted the rows is not attributable from available
evidence. HQ's `state/verify/*.jsonl` recorder covers 2026-08-14, 17 and 18,
but contains no `bd` invocation at all, so the deletion was never captured.
Candidates in bd's own surface are `bd admin cleanup`, `bd prune`, `bd purge`,
`bd gc` and `bd admin reset`, all of which delete issue rows.

One related anomaly: `.beads/last-touched` in this rig contains `xv-01x`, a
xanic-ventas bead id, with mtime 2026-08-18 13:25. That is cross-rig
contamination and matches the cwd resolution bug already filed as hq-dcqb,
where `bd` resolves the ledger from the caller's working directory rather than
the rig. It is a plausible contributor and worth treating as one until ruled
out.

## Reconstructed index

Last known status per bead, from `.beads/interactions.jsonl` (git-tracked, and
the only part of the ledger that survived). The audit log stops at
2026-08-14 02:25 while work continued to 2026-08-18, so anything after that
date is reconstructed from commit messages instead.

| Bead | Last known status | Source |
| --- | --- | --- |
| xd-lav | closed 2026-08-11 | audit log |
| xd-ok2 | closed 2026-08-11 | audit log (remote copy still says open, it is stale) |
| xd-6h1 | closed 2026-08-12 | audit log |
| xd-oe2 | closed 2026-08-12 | audit log |
| xd-c8d | closed 2026-08-12 | audit log |
| xd-d5d | closed 2026-08-12 | audit log |
| xd-5c8 | closed 2026-08-12 | audit log |
| xd-5f1 | closed 2026-08-12 | audit log |
| xd-01g | closed 2026-08-12 | audit log |
| xd-1f3 | **open** 2026-08-13 | audit log, reopened from blocked |
| xd-rgg | closed 2026-08-14 | audit log |
| xd-qub | closed 2026-08-14 | audit log |
| xd-61q | closed 2026-08-14 | audit log |
| xd-4rg | merge recorded 2026-08-14 | commit 89f0d00 |
| xd-ifx | work merged | wine_samples.brix migration |
| xd-kya | work merged | prediction degenerate-fit hardening |
| xd-b0o | work merged | sanitary count classification guard |
| xd-hlm | work merged | login-reload investigation, root cause environmental |
| xd-6r7 | work merged | Seguimiento round-2 review fixes |
| xd-3pm | work merged | Seguimiento date-header serial recovery |

Titles and descriptions are not recoverable for any of these. The work itself
is not lost: every bead above except xd-1f3 has its change merged into `main`,
and the suite is green (303 pass, 0 fail).

## The one live loss

**xd-1f3** was open when the ledger died. From commit 66c85b0: the official
WineXRay v2 API is subscription-gated, so the bead's target is the web app's
own API, reverse engineered, not the paid one. It has been re-created in the
ledger so the work is not silently dropped.

## Follow-ups

1. Off-machine backup with retention, so a post-loss auto-sync cannot overwrite
   the last good copy. The current `.beads/backup` destination fails exactly
   this test.
2. A ledger-health check that compares live issue count against the git-tracked
   `interactions.jsonl` and fails loudly on collapse. Proposed separately;
   hooks are proposal-only for agents.
3. Resolve hq-dcqb, the cwd resolution bug, since it is the best available
   explanation for cross-rig contamination.
