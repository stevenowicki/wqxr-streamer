#!/usr/bin/env bash
# Package public/ and ship it to content.stevenowicki.com/wqxr/ via the go-live
# watcher (it holds the AWS creds and uploads to S3 + invalidates CloudFront).
# We only stage a hash-verified tarball + declarative manifest — no AWS here.
set -euo pipefail

BASE="$HOME/Projects/content.stevenowicki.com/go-live"
CONTENT="$(cd "$(dirname "$0")/.." && pwd)/public"

[ -d "$BASE" ] || { echo "go-live dir not found: $BASE" >&2; exit 1; }
mkdir -p "$BASE/staging" "$BASE/deploy"

SLUG="content-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
TAR="$BASE/staging/$SLUG.tar.gz"
tar -czf "$TAR" -C "$CONTENT" .
SHA=$(shasum -a 256 "$TAR" | awk '{print $1}')
SIZE=$(stat -f %z "$TAR")
CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$BASE/staging/manifest-$SLUG.json" <<EOF
{
  "schema_version": "1",
  "slug": "$SLUG",
  "domain": "content.stevenowicki.com",
  "created_at": "$CREATED",
  "tarball": "$SLUG.tar.gz",
  "sha256": "$SHA",
  "size_bytes": $SIZE,
  "deploy": {
    "target_prefix": "wqxr",
    "delete_orphans": false,
    "cache_control": { "default": "public, max-age=300" }
  }
}
EOF

# Commit: tarball first, manifest last (the manifest landing signals readiness).
mv "$TAR" "$BASE/deploy/$SLUG.tar.gz"
mv "$BASE/staging/manifest-$SLUG.json" "$BASE/deploy/manifest-$SLUG.json"

echo "Deployed $SLUG -> https://content.stevenowicki.com/wqxr/"
echo "Watcher result will appear at: $BASE/logs/result-$SLUG.json"
