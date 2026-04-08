# SiteAmoeba — Development Workflow

## Branch Strategy

| Branch | Purpose | Deploys to |
|--------|---------|------------|
| `main` | Production-ready code only | `app.siteamoeba.com` (Railway production) |
| `staging` | QA and testing before production | `staging-api.siteamoeba.com` (Railway staging) |

**Rule: nothing goes to `main` that hasn't been tested on staging first.**

---

## Versioning

We use semantic versioning: `MAJOR.MINOR.PATCH`

| Type | When | Example |
|------|------|---------|
| PATCH | Bug fixes, copy changes, small tweaks | `1.1.0` → `1.1.1` |
| MINOR | New features, non-breaking changes | `1.1.0` → `1.2.0` |
| MAJOR | Breaking changes, major redesigns | `1.1.0` → `2.0.0` |

Current version: **v1.1.0**

---

## Workflow for Every Change

### 1. Make changes on `staging`

```bash
git checkout staging
# make changes
git add -A
git commit -m "feat: description of change"
git push origin staging
```

Then deploy to staging:
```bash
RAILWAY_API_TOKEN=d1f61cf2-... railway up \
  --project 9dcf00bb-c86d-4be9-9aed-0da0c80f2ed2 \
  --service 6b73d393-8e4d-485b-b872-31448c030cf2 \
  --environment 4b63b3f2-c649-4e77-b9f9-d8a598ae4a98 \
  --detach
```

### 2. Test on staging

- Visit `staging-api.siteamoeba.com` and verify the change works
- Check for regressions in core flows: scan → campaign → widget → conversion
- Check admin error panel for any new errors

### 3. Promote to production

Once verified on staging:

```bash
git checkout main
git merge staging --no-edit
npm version patch   # or minor/major
git push origin main --follow-tags
```

Then deploy to production:
```bash
RAILWAY_API_TOKEN=d1f61cf2-... railway up \
  --project 9dcf00bb-c86d-4be9-9aed-0da0c80f2ed2 \
  --service 6b73d393-8e4d-485b-b872-31448c030cf2 \
  --environment production \
  --detach
```

---

## Commit Message Format

```
type: short description

Types:
  feat      New feature
  fix       Bug fix
  chore     Maintenance (deps, version bumps, cleanup)
  refactor  Code change that isn't a fix or feature
  docs      Documentation only
```

Examples:
- `feat: add minimize button to Brain chat panel`
- `fix: deleted variants still showing in campaign UI`
- `chore: bump version to 1.1.1`

---

## Emergency Hotfix (production is broken)

```bash
# Fix directly on main (only for critical production issues)
git checkout main
# make the fix
git commit -m "fix: critical description"
git push origin main --follow-tags

# Then backport to staging so branches stay in sync
git checkout staging
git merge main --no-edit
git push origin staging
```

---

## Core User Flows to Test Before Any Production Deploy

1. **New user signup** → can create an account and log in
2. **Page scan** → enter URL, AI scans, sections appear, campaign created
3. **Widget** → pixel installs, visitor is tracked, variant rotates correctly
4. **Conversion** → Stripe webhook fires, revenue appears in dashboard
5. **Brain Chat** → response generates with BYOK key (paid user)
6. **Settings** → AI provider saves correctly, Stripe connects

---

## Railway Environment IDs (for reference)

| Environment | ID |
|---|---|
| Production | `f1571fa5-1034-431b-a311-0161ab2f089c` |
| Staging | `4b63b3f2-c649-4e77-b9f9-d8a598ae4a98` |

Service ID (same service, both envs): `6b73d393-8e4d-485b-b872-31448c030cf2`
