# SiteAmoeba Development Workflow

## Environments

| Name | URL | Database | Widget serves from |
|---|---|---|---|
| **production** | `https://app.siteamoeba.com` | prod Postgres | `api.siteamoeba.com` |
| **staging** | `https://staging-api.siteamoeba.com` | staging Postgres (isolated snapshot of prod) | `staging-api.siteamoeba.com` |

Staging and production are completely isolated — writes in one never affect the other.

## Day-to-day workflow

1. **Never commit directly to `main`.** Branch off for every change:
   ```bash
   git checkout main && git pull
   git checkout -b feature/<short-name>
   ```

2. **Deploy your branch to staging to test it:**
   ```bash
   scripts/deploy.sh staging
   ```
   Staging will rebuild and serve your branch within ~90 seconds. Test against the staging URL, staging DB, and staging widget.

3. **When satisfied, merge to `main` and deploy to production:**
   ```bash
   git checkout main && git merge feature/<name>
   git push origin main
   scripts/deploy.sh production
   ```
   The deploy script refuses to ship to production unless you are on `main` with a clean working tree.

## Refreshing staging with the latest prod data

Staging should periodically be refreshed from production so its test data looks realistic. To do that:

```bash
# from the sandbox / local
PGPASSWORD=<prod_password> /usr/lib/postgresql/18/bin/pg_dump \
  -h crossover.proxy.rlwy.net -p 40694 -U postgres -d railway \
  --no-owner --no-acl --format=custom \
  -f /tmp/prod_snapshot.dump

PGPASSWORD=stagingdbpassword123 /usr/lib/postgresql/18/bin/pg_restore \
  -h shortline.proxy.rlwy.net -p 16854 -U postgres -d railway \
  --no-owner --no-acl --clean --if-exists \
  /tmp/prod_snapshot.dump
```

Do this sparingly — it overwrites whatever experimental state is in staging.

## Connecting to each database

**Staging:**
```
host: shortline.proxy.rlwy.net
port: 16854
user: postgres
pass: stagingdbpassword123
db:   railway
```

**Production:**
```
host: crossover.proxy.rlwy.net
port: 40694
user: postgres
pass: KAJtGvTuRLGdpdduPedeRzDyZdGdzwiT
db:   railway
```

## Environment variables

Both environments share most variables, but these differ:

| Variable | staging | production |
|---|---|---|
| `DATABASE_URL` | postgres-staging.railway.internal | production proxy |
| `PUBLIC_API_URL` | `https://staging-api.siteamoeba.com` | `https://api.siteamoeba.com` |
| `APP_ENV` | `staging` | (unset, defaults to production) |

`APP_ENV=staging` is what code can key off of to add visible banners, relax rate limits, or enable feature flags that shouldn't reach real users.
