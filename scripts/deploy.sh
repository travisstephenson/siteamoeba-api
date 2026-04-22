#!/usr/bin/env bash
# deploy.sh — deploy the current working tree to staging or production on Railway.
#
# Usage:
#   scripts/deploy.sh staging      # deploy current branch to staging
#   scripts/deploy.sh production   # deploy current branch to production
#
# This project does NOT use auto-deploy-on-push. Deploys are explicit so we
# always know what's on staging vs. production. To use this script:
#   1. Commit your changes on a feature branch.
#   2. Run `scripts/deploy.sh staging` to test on staging.
#   3. Once verified, `git checkout main && git merge <branch>` to promote.
#   4. Run `scripts/deploy.sh production` to ship.
#
# The script builds locally (so failures are immediate) and then ships the
# built artifacts to Railway.
set -euo pipefail

ENVIRONMENT="${1:-}"
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo "Usage: $0 staging|production" >&2
  exit 1
fi

RAILWAY_API_TOKEN="${RAILWAY_API_TOKEN:-d1f61cf2-b64f-46a7-b911-d6ea71d4a517}"
PROJECT="9dcf00bb-c86d-4be9-9aed-0da0c80f2ed2"
SERVICE="6b73d393-8e4d-485b-b872-31448c030cf2"

if [[ "$ENVIRONMENT" == "staging" ]]; then
  ENV_ID="4b63b3f2-c649-4e77-b9f9-d8a598ae4a98"
else
  ENV_ID="f1571fa5-1034-431b-a311-0161ab2f089c"
  # Safety: only allow production deploys from main
  BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
  if [[ "$BRANCH" != "main" ]]; then
    echo "ERROR: production deploys must originate from 'main' (you are on '$BRANCH')." >&2
    echo "Merge your feature branch into main first, then deploy." >&2
    exit 2
  fi
  # Safety: require a clean working tree
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: working tree is dirty. Commit or stash before deploying to production." >&2
    exit 3
  fi
fi

echo "==> Building for $ENVIRONMENT..."
npm run build

echo "==> Deploying to $ENVIRONMENT..."
RAILWAY_API_TOKEN="$RAILWAY_API_TOKEN" \
  npx -y @railway/cli@latest up \
  --project "$PROJECT" \
  --service "$SERVICE" \
  --environment "$ENV_ID" \
  --detach

echo "==> Deploy initiated. Watch at: https://railway.com/project/$PROJECT"
