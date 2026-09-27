#!/bin/sh
# Bootstraps MinIO for GroZerry. Runs as the root user exactly once per
# `docker compose up`; the backend itself only ever holds the restricted app
# credentials created here. Every step is idempotent.
set -eu

POLICY_NAME="grozerry-app"

log() { printf '[minio-init] %s\n' "$*"; }

if [ "$APP_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  log "MINIO_ACCESS_KEY must differ from MINIO_ROOT_USER: the app must not run as root."
  exit 1
fi

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

log "buckets: $PUBLIC_BUCKET (anonymous read of known objects, no listing), $PRIVATE_BUCKET (private)"
mc mb --ignore-existing "local/$PUBLIC_BUCKET" >/dev/null
mc mb --ignore-existing "local/$PRIVATE_BUCKET" >/dev/null

# Product photos, store logos and profile pictures are meant to be seen by
# anyone browsing the app: anonymous GET of a known object, nothing else.
# Not `mc anonymous set download` — that preset also grants s3:ListBucket,
# which would let anyone enumerate every image in the bucket.
cat > /tmp/public-read.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::$PUBLIC_BUCKET/*"]
    }
  ]
}
POLICY
mc anonymous set-json /tmp/public-read.json "local/$PUBLIC_BUCKET" >/dev/null
# Driving licences and every not-yet-confirmed upload live here: no anonymous
# access at all. Reads happen through short-lived signed links.
mc anonymous set none "local/$PRIVATE_BUCKET" >/dev/null

# Direct uploads land in pending/ until the API confirms them. Anything left
# there is an abandoned upload (photo picked, form never submitted): expire it
# after a day. Imported as a whole document, so re-running replaces rather
# than stacks duplicate rules.
mc ilm import "local/$PRIVATE_BUCKET" < /bootstrap/private-lifecycle.json >/dev/null
log "lifecycle: pending/ uploads expire after 1 day"

# Least privilege for the backend: read/write objects in the two buckets and
# check that they exist. No bucket creation, no policy changes, no admin API,
# no access to anything else on the server. (Written with a heredoc because
# the mc image ships without sed/grep/awk.)
cat > /tmp/app-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LocateAndCheckTheTwoBuckets",
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::$PUBLIC_BUCKET",
        "arn:aws:s3:::$PRIVATE_BUCKET"
      ]
    },
    {
      "Sid": "ObjectReadWriteOnly",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::$PUBLIC_BUCKET/*",
        "arn:aws:s3:::$PRIVATE_BUCKET/*"
      ]
    }
  ]
}
POLICY
mc admin policy create local "$POLICY_NAME" /tmp/app-policy.json >/dev/null

# Re-adding an existing user updates its secret, which is what we want when
# MINIO_SECRET_KEY is rotated in .env.
mc admin user add local "$APP_ACCESS_KEY" "$APP_SECRET_KEY" >/dev/null
# Match the exact JSON field, not just the name: the access key itself
# (grozerry-app-…) contains the policy name, so a bare substring test passes
# for a user with no policy attached at all.
USER_INFO="$(mc admin user info local "$APP_ACCESS_KEY" --json)"
case "$USER_INFO" in
  *"\"policyName\":\"$POLICY_NAME\""*) ;;
  *) mc admin policy attach local "$POLICY_NAME" --user "$APP_ACCESS_KEY" >/dev/null ;;
esac

# Verify rather than assume: fail the bootstrap loudly if the app user still
# has no policy, instead of reporting success and leaving uploads to fail.
USER_INFO="$(mc admin user info local "$APP_ACCESS_KEY" --json)"
case "$USER_INFO" in
  *"\"policyName\":\"$POLICY_NAME\""*) ;;
  *) log "ERROR: policy '$POLICY_NAME' is not attached to '$APP_ACCESS_KEY'"; exit 1 ;;
esac
log "app user '$APP_ACCESS_KEY' has policy '$POLICY_NAME' (object read/write on the two buckets only)"

log "done"
