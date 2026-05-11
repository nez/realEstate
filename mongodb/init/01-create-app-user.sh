#!/bin/bash
# Runs once on a virgin mongo data directory (first-boot init via the official
# mongo image's /docker-entrypoint-initdb.d hook). Creates a least-privilege
# application user with readWrite on the suumo DB only — the scraper and CLI
# use this user instead of the root admin account.
#
# For deployments where data already exists, run the equivalent createUser
# command manually via `mongosh` once; see README.

set -euo pipefail

APP_USER="${MONGO_APP_USERNAME:-suumo_app}"
APP_DB="${MONGO_INITDB_DATABASE:-suumo}"

if [[ -z "${MONGO_APP_PASSWORD:-}" ]]; then
  echo "MONGO_APP_PASSWORD is not set — skipping app-user creation." >&2
  exit 0
fi

echo "Creating app user '$APP_USER' with readWrite on '$APP_DB'..."
mongosh --quiet --eval "
  const dbName = '${APP_DB}';
  const user = '${APP_USER}';
  const pwd = '${MONGO_APP_PASSWORD}';
  const target = db.getSiblingDB(dbName);
  try {
    target.createUser({
      user: user,
      pwd: pwd,
      roles: [{ role: 'readWrite', db: dbName }]
    });
    print('App user created on ' + dbName);
  } catch (e) {
    if (String(e.message).includes('already exists')) {
      print('App user already exists, skipping.');
    } else {
      throw e;
    }
  }
"
