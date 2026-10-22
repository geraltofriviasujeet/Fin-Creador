# Fin Creador

A personal financial operating system: record daily money activity, understand your
financial position, manage investments and plan future expenses. Web (Next.js) and mobile
(Expo, Android and iOS) share one Supabase backend, one set of validation rules and one
design-token source.

## Repository

```text
apps/web          Next.js App Router web app
apps/mobile       Expo (React Native) app for Android and iOS
packages/api      Typed database contract and shared auth/profile rules
packages/schemas  Shared validation schemas and region lists
packages/domain   Pure financial rules and formatting
packages/design-tokens  Brand tokens for web and mobile
supabase/         Migrations, pgTAP tests, local config and email templates
scripts/          Repo tooling (secret check)
docs/             Sprint plan, design spec and setup guide
```

## Quick start

Requires Node.js 22.12 or later and npm.

```sh
npm install
cp apps/web/.env.example apps/web/.env.local        # fill in your project's public values
npm run dev                                         # web app on http://localhost:3000
```

For the mobile app, Supabase dashboard settings, tests and CI, see
**[docs/setup.md](docs/setup.md)**.

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app in development mode |
| `npm run dev:mobile` | Expo dev server for the mobile app (Expo Go) |
| `npm run lint` / `npm run typecheck` | Lint and type-check every workspace |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production build of the web app |
| `npm run check:secrets` | Scan tracked files for secrets |

End-to-end and database tests run in GitHub Actions on every pull request
(see [docs/setup.md](docs/setup.md#tests-and-ci)).

## Project docs

- [docs/setup.md](docs/setup.md): environment, Supabase settings, running and testing
- [docs/sprint-plan.md](docs/sprint-plan.md): status, decisions and sprint plan
- [docs/design-spec.md](docs/design-spec.md): visual source of truth
- [CLAUDE.md](CLAUDE.md): engineering rules for this repository
