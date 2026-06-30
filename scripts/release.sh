#!/usr/bin/env bash
#
# Teact npm release script — run this yourself when you want to publish.
#
#   ./scripts/release.sh            # build, publish, point `latest` at this version
#   ./scripts/release.sh --git-tag  # also create and push a git tag
#
# Before running:
#   1. Bump versions with the changeset flow:  bun changeset  &&  bun run version
#   2. Make sure you're logged in to npm:      npm whoami   (else: npm login)
#
# What it does:
#   - Builds every package
#   - Publishes each package (in dependency order) under the `alpha` dist-tag,
#     skipping any version already on npm (so re-runs are safe)
#   - Moves the `latest` dist-tag to this version  ← the critical step that makes
#     `bun create teact` and `npm install @teactjs/*` resolve the new release.
#     (Publishing with --tag alpha alone never moves `latest`.)
#
set -euo pipefail

cd "$(dirname "$0")/.."

GIT_TAG=false
OTP=""
for arg in "$@"; do
  case "$arg" in
    --git-tag) GIT_TAG=true ;;
    --otp=*) OTP="${arg#*=}" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# npm 2FA: pass --otp=<code> to publish/dist-tag when an OTP was provided.
OTP_FLAG=""
[[ -n "$OTP" ]] && OTP_FLAG="--otp=$OTP"

# Publish order: dependencies first.
PACKAGES=(renderer react runtime core telegram storage testing ui cli create-teact)

# npm package name for each dir (create-teact is unscoped).
pkg_name() {
  case "$1" in
    create-teact) echo "create-teact" ;;
    *) echo "@teactjs/$1" ;;
  esac
}

VERSION="$(bun --print "require('./packages/core/package.json').version")"
DIST_TAG="alpha"

echo "──────────────────────────────────────────────"
echo " Teact release"
echo "   version : ${VERSION}"
echo "   npm tag : $DIST_TAG  (+ moving 'latest')"
echo "──────────────────────────────────────────────"

# --- preflight ------------------------------------------------------------
if ! npm whoami >/dev/null 2>&1; then
  echo "✗ Not logged in to npm. Run 'npm login' first." >&2
  exit 1
fi
echo "✓ npm user: $(npm whoami)"

if [[ "${VERSION}" != *"-alpha."* ]]; then
  read -r -p "⚠ Version '${VERSION}' is not an -alpha. Continue? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

# --- build ----------------------------------------------------------------
echo ""
echo "▶ Building all packages…"
bun run build

# --- publish --------------------------------------------------------------
echo ""
echo "▶ Publishing…"
for dir in "${PACKAGES[@]}"; do
  name="$(pkg_name "$dir")"
  if npm view "$name@${VERSION}" version >/dev/null 2>&1; then
    echo "  • $name@${VERSION} already on npm — skipping publish"
  else
    echo "  • publishing $name@${VERSION}"
    ( cd "packages/$dir" && npm publish --access public --tag "$DIST_TAG" $OTP_FLAG )
  fi
done

# --- move the `latest` dist-tag ------------------------------------------
echo ""
echo "▶ Pointing 'latest' at ${VERSION}…"
for dir in "${PACKAGES[@]}"; do
  name="$(pkg_name "$dir")"
  npm dist-tag add "$name@${VERSION}" latest $OTP_FLAG >/dev/null
  echo "  • $name  latest → ${VERSION}"
done

# --- optional git tag -----------------------------------------------------
if [[ "$GIT_TAG" == true ]]; then
  echo ""
  echo "▶ Tagging git…"
  git tag "v${VERSION}"
  git push --follow-tags
  echo "  • pushed tag v${VERSION}"
fi

echo ""
echo "✅ Released ${VERSION}."
echo "   Verify:  npm view create-teact dist-tags"
echo "   Test:    bun create teact my-bot"
