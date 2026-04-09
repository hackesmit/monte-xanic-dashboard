# Documentation Index

## Where to Start

| If you need to... | Read |
|-------------------|------|
| Understand the project | [README.md](../README.md) (project root) |
| Understand the system design | [Architecture.md](Architecture.md) |
| Know what each JS module does | [Frontend-Architecture.md](Frontend-Architecture.md) |
| Look up a database table | [Database.md](Database.md) |
| Understand a chemistry field | [Data-Dictionary.md](Data-Dictionary.md) |
| Understand the API | [API.md](API.md) |
| Review security model | [Security.md](Security.md) |
| Deploy or set up locally | [Operations.md](Operations.md) |
| Check test coverage | [Test-Coverage.md](Test-Coverage.md) |
| See what is built vs planned | [Roadmap.md](Roadmap.md) |
| Understand the domain | [Domain-Model.md](Domain-Model.md) |
| Know upload/validation rules | [Data-Validation.md](Data-Validation.md) |
| Understand agent workflow rules | [AGENT_RULES.md](AGENT_RULES.md) |

## Canonical Sources

| Topic | Canonical Doc |
|-------|--------------|
| Current implementation state | [Architecture.md](Architecture.md) and source code |
| Database schema | [Database.md](Database.md) and `sql/*.sql` |
| API contracts | [API.md](API.md) and `api/*.js` |
| Agent/builder/reviewer rules | [AGENT_RULES.md](AGENT_RULES.md) |
| Code conventions for Claude Code | [CLAUDE.md](../CLAUDE.md) |
| What is shipped vs planned | [Roadmap.md](Roadmap.md) |

## Current State vs Recommendations

Every doc in this directory distinguishes between:
- **Implemented now** -- described as fact
- **Recommended** -- labeled "Recommended" or in a "Recommended Future Improvements" section
- **Deferred** -- labeled "Deferred" with rationale

If a section does not have a "Recommended" qualifier, it describes current behavior verified against the codebase.
