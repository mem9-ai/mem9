#!/usr/bin/env bash
#
# publish.sh — build, verify, and publish @mem9/mem9 to npm.
#
# Usage:
#   ./publish.sh
#   ./publish.sh patch --channel alpha
#   ./publish.sh prepatch --channel rc
#   ./publish.sh prerelease --channel rc
#   ./publish.sh patch
#
# Defaults:
#   increment = preminor
#   channel   = rc
#
# Token lookup order:
#   1. openclaw-plugin/.publish.env
#   2. ~/.env

set -euo pipefail

readonly script_dir="$(cd "${0%/*}" && pwd)"
readonly package_json="$script_dir/package.json"
readonly package_lock="$script_dir/package-lock.json"
readonly local_env_file="$script_dir/.publish.env"
readonly fallback_env_file="$HOME/.env"
readonly npmrc_path="$script_dir/.npmrc"
readonly npm_cache_dir="$script_dir/.npm-cache-publish"
readonly default_increment="preminor"
readonly default_channel="rc"
readonly package_name="@mem9/mem9"

increment="$default_increment"
channel=""
current_version=""
target_version=""
npm_tag=""
token=""
versions_json=""
pack_files_json=""
restore_files=0
had_package_lock=0
package_json_backup=""
package_lock_backup=""

die() {
	printf '\033[1;31merror:\033[0m %s\n' "$1" >&2
	exit 1
}

info() {
	printf '\033[1;34m==>\033[0m %s\n' "$1"
}

ok() {
	printf '\033[1;32m  ✓\033[0m %s\n' "$1"
}

warn() {
	printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2
}

confirm() {
	local prompt="$1"
	printf '\033[1;33m%s\033[0m [y/N] ' "$prompt"
	read -r answer
	[[ "$answer" =~ ^[Yy]$ ]] || die "aborted"
}

show_help() {
	cat <<'EOF'
Usage:
  ./publish.sh [major|minor|patch|premajor|preminor|prepatch|prerelease] [--channel rc|beta|alpha]

Defaults:
  increment = preminor
  channel   = rc

Examples:
  ./publish.sh
  ./publish.sh patch --channel alpha
  ./publish.sh prepatch --channel rc
  ./publish.sh prerelease --channel rc
  ./publish.sh patch

Behavior:
  - major|minor|patch publish a stable version to the npm latest tag.
  - major|minor|patch with --channel alpha|beta|rc automatically become
    premajor|preminor|prepatch for that prerelease channel.
  - premajor|preminor|prepatch|prerelease publish a prerelease to the selected channel tag.
  - prerelease can stay on the same prerelease channel or move forward (alpha -> beta -> rc),
    but it cannot move backward within the same x.y.z base version.
  - The script reads NPM_ACCESSTOKEN from openclaw-plugin/.publish.env first, then falls back to ~/.env.
EOF
}

cleanup() {
	rm -f "$npmrc_path"
	rm -rf "$npm_cache_dir"

	if [[ "$restore_files" -eq 1 && -n "$package_json_backup" && -f "$package_json_backup" ]]; then
		cp "$package_json_backup" "$package_json"
		if [[ "$had_package_lock" -eq 1 && -n "$package_lock_backup" && -f "$package_lock_backup" ]]; then
			cp "$package_lock_backup" "$package_lock"
		else
			rm -f "$package_lock"
		fi
	fi
}

trap cleanup EXIT

is_prerelease_increment() {
	case "$increment" in
		premajor|preminor|prepatch|prerelease) return 0 ;;
		*) return 1 ;;
	esac
}

normalize_increment_for_channel() {
	case "$increment" in
		major) increment="premajor" ;;
		minor) increment="preminor" ;;
		patch) increment="prepatch" ;;
	esac
}

channel_rank() {
	case "$1" in
		alpha) printf '1' ;;
		beta) printf '2' ;;
		rc) printf '3' ;;
		*) die "unknown channel '$1'" ;;
	esac
}

parse_args() {
	local positional=""

	while [[ $# -gt 0 ]]; do
		case "$1" in
			-h|--help)
				show_help
				exit 0
				;;
			-c|--channel)
				[[ $# -ge 2 ]] || die "--channel requires a value"
				channel="$2"
				shift 2
				;;
			major|minor|patch|premajor|preminor|prepatch|prerelease)
				[[ -z "$positional" ]] || die "only one increment argument is allowed"
				positional="$1"
				shift
				;;
			*)
				die "unknown argument '$1' (try --help)"
				;;
		esac
	done

	if [[ -n "$positional" ]]; then
		increment="$positional"
	fi

	if [[ -n "$channel" ]]; then
		case "$channel" in
			alpha|beta|rc) ;;
			premajor|preminor|prepatch|prerelease)
				die "--channel must be alpha, beta, or rc. Use '$channel' as the increment, or use 'patch --channel alpha' style syntax."
				;;
			*)
				die "--channel must be one of: rc, beta, alpha"
				;;
		esac
	fi

	if is_prerelease_increment; then
		:
	elif [[ -n "$channel" ]]; then
		normalize_increment_for_channel
	else
		npm_tag="latest"
		return
	fi

	if [[ -z "$channel" ]]; then
		channel="$default_channel"
	fi

	npm_tag="$channel"
}

load_token() {
	local env_file=""
	if [[ -f "$local_env_file" ]]; then
		env_file="$local_env_file"
	elif [[ -f "$fallback_env_file" ]]; then
		env_file="$fallback_env_file"
	else
		die "NPM_ACCESSTOKEN not found. Create openclaw-plugin/.publish.env or add it to ~/.env"
	fi

	token=$(grep -E '^NPM_ACCESSTOKEN=' "$env_file" | head -1 | cut -d'=' -f2- || true)
	token="${token%\"}"
	token="${token#\"}"
	token="${token%\'}"
	token="${token#\'}"

	[[ -n "$token" ]] || die "NPM_ACCESSTOKEN not set in $env_file"
	ok "loaded npm token from ${env_file/#$HOME/\~}"
}

read_package_version() {
	node -e 'const fs = require("node:fs"); const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(pkg.version);' "$package_json"
}

ensure_private_npm_cache() {
	mkdir -p "$npm_cache_dir"
	export npm_config_cache="$npm_cache_dir"
}

fetch_registry_versions() {
	ensure_private_npm_cache
	info "fetching npm registry versions"
	versions_json="$(cd "$script_dir" && npm view "$package_name" versions --json)"
	ok "fetched published version list"
}

highest_published_stable() {
	VERSIONS_JSON="$versions_json" node <<'EOF'
const versions = JSON.parse(process.env.VERSIONS_JSON);
const list = Array.isArray(versions) ? versions : [versions];
const stable = list.filter((v) => !v.includes("-"));
stable.sort((a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
});
process.stdout.write(stable[stable.length - 1] ?? "");
EOF
}

version_base() {
	node -e 'process.stdout.write(process.argv[1].split("-")[0]);' "$1"
}

fetch_packaged_files() {
	ensure_private_npm_cache
	pack_files_json="$(cd "$script_dir" && npm pack --dry-run --json)"
}

find_packaged_tracked_changes() {
	local tracked="$1"
	TRACKED_FILES="$tracked" PACK_FILES_JSON="$pack_files_json" node <<'EOF'
const tracked = (process.env.TRACKED_FILES ?? "")
  .split("\n")
  .map((item) => item.trim())
  .filter(Boolean);
const pack = JSON.parse(process.env.PACK_FILES_JSON ?? "[]");
const packaged = new Set(
  pack.flatMap((entry) => Array.isArray(entry.files) ? entry.files.map((file) => file.path) : []),
);
const intersection = tracked.filter((file) => packaged.has(file));
process.stdout.write(intersection.join("\n"));
EOF
}

compare_release_versions() {
	local left="$1"
	local right="$2"
	node -e '
const [left, right] = process.argv.slice(1);
const parse = (v) => v.split(".").map((part) => Number(part));
const a = parse(left);
const b = parse(right);
for (let i = 0; i < 3; i += 1) {
  if (a[i] < b[i]) process.exit(1);
  if (a[i] > b[i]) process.exit(0);
}
process.exit(0);
' "$left" "$right"
}

check_registry_baseline() {
	local highest_release
	local local_base

	highest_release="$(highest_published_stable)"
	current_version="$(read_package_version)"
	local_base="$(version_base "$current_version")"

	if [[ "$current_version" == *-* ]]; then
		if ! compare_release_versions "$local_base" "$highest_release"; then
			die "package.json base version $local_base is behind the highest published stable version $highest_release"
		fi
		if [[ "$local_base" == "$highest_release" ]]; then
			die "package.json version $current_version is on an already released base version. Sync package.json with npm first."
		fi
	else
		[[ "$current_version" == "$highest_release" ]] || die "package.json version $current_version must match the highest published stable version $highest_release before publishing"
	fi

	ok "package.json version $current_version is aligned with npm registry"
}

validate_prerelease_channel() {
	[[ "$increment" == "prerelease" ]] || return 0
	[[ "$current_version" == *-* ]] || die "prerelease requires the current version to already be a prerelease; use prepatch, preminor, or premajor instead"

	local current_channel
	current_channel="$(node -e '
const match = process.argv[1].match(/-(alpha|beta|rc)(?:\.|)(\d+)$/);
process.stdout.write(match ? match[1] : "");
' "$current_version")"

	[[ -n "$current_channel" ]] || die "current prerelease channel in $current_version is not one of alpha, beta, or rc"

	if [[ "$(channel_rank "$channel")" -lt "$(channel_rank "$current_channel")" ]]; then
		die "cannot move prerelease backward within $current_version (requested $channel from $current_channel)"
	fi
}

compute_target_version() {
	local preview_dir="$npm_cache_dir/version-preview"
	rm -rf "$preview_dir"
	mkdir -p "$preview_dir"
	cp "$package_json" "$preview_dir/package.json"
	if [[ -f "$package_lock" ]]; then
		cp "$package_lock" "$preview_dir/package-lock.json"
	fi

	local cmd=(npm version "$increment" --no-git-tag-version --ignore-scripts)
	if is_prerelease_increment; then
		cmd+=(--preid "$channel")
	fi

	(cd "$preview_dir" && "${cmd[@]}" >/dev/null)
	target_version="$(node -e 'const fs = require("node:fs"); const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(pkg.version);' "$preview_dir/package.json")"
	rm -rf "$preview_dir"

	ok "computed target version $target_version"
}

ensure_target_version_available() {
	if VERSIONS_JSON="$versions_json" TARGET_VERSION="$target_version" node <<'EOF'
const versions = JSON.parse(process.env.VERSIONS_JSON);
const list = Array.isArray(versions) ? versions : [versions];
process.exit(list.includes(process.env.TARGET_VERSION) ? 1 : 0);
EOF
	then
		ok "target version $target_version is not yet published"
	else
		local status="$?"
		case "$status" in
			1) die "target version $target_version already exists on npm registry" ;;
			*) die "failed to validate target version against npm registry" ;;
		esac
	fi
}

preflight() {
	info "preflight checks"

	command -v node >/dev/null || die "node not found"
	command -v npm >/dev/null || die "npm not found"
	command -v git >/dev/null || die "git not found"
	[[ -f "$package_json" ]] || die "package.json not found"
	ok "node $(node --version) / npm $(npm --version)"

	local tracked
	tracked="$(git -C "$script_dir" diff --name-only HEAD -- . 2>/dev/null || true)"
	if [[ -n "$tracked" ]]; then
		fetch_packaged_files

		local packaged_tracked
		packaged_tracked="$(find_packaged_tracked_changes "$tracked")"
		if [[ -n "$packaged_tracked" ]]; then
			warn "tracked changes detected in files that would be published:"
			printf '  %s\n' $packaged_tracked
			die "commit or stash packaged file changes before publishing"
		fi

		warn "tracked changes detected, but none of them will be published:"
		printf '  %s\n' $tracked
		ok "continuing because packaged files are clean"
	else
		ok "no tracked changes under openclaw-plugin"
	fi

	local untracked
	untracked="$(git -C "$script_dir" ls-files --others --exclude-standard -- . || true)"
	if [[ -n "$untracked" ]]; then
		warn "untracked files detected under openclaw-plugin:"
		printf '  %s\n' $untracked
		confirm "continue with untracked files present?"
	else
		ok "no untracked files under openclaw-plugin"
	fi
}

run_typecheck() {
	info "running typecheck"
	(cd "$script_dir" && npm run typecheck)
	ok "typecheck passed"
}

run_pack_dryrun() {
	info "dry-run pack (verifying publish contents)"
	local pack_output
	pack_output="$(cd "$script_dir" && npm pack --dry-run 2>&1)"
	printf '%s\n' "$pack_output"
	ok "pack dry-run ok"
}

backup_package_files() {
	package_json_backup="$npm_cache_dir/package.json.bak"
	cp "$package_json" "$package_json_backup"
	if [[ -f "$package_lock" ]]; then
		had_package_lock=1
		package_lock_backup="$npm_cache_dir/package-lock.json.bak"
		cp "$package_lock" "$package_lock_backup"
	fi
	restore_files=1
}

set_version() {
	info "setting package version"
	local cmd=(npm version "$increment" --no-git-tag-version --ignore-scripts)
	if is_prerelease_increment; then
		cmd+=(--preid "$channel")
	fi

	(cd "$script_dir" && "${cmd[@]}" >/dev/null)
	local actual_version
	actual_version="$(read_package_version)"
	[[ "$actual_version" == "$target_version" ]] || die "version mismatch after npm version: expected $target_version, got $actual_version"
	ok "version set to $actual_version"
}

write_npmrc() {
	printf '//registry.npmjs.org/:_authToken=%s\n' "$token" > "$npmrc_path"
}

do_publish() {
	info "publishing $package_name with tag '$npm_tag'"
	write_npmrc
	(cd "$script_dir" && NPM_CONFIG_USERCONFIG="$npmrc_path" npm publish --tag "$npm_tag" --access public --auth-type=legacy)
	ok "published successfully"
}

verify_publish() {
	info "verifying published package"
	sleep 2

	local live_version
	live_version="$(cd "$script_dir" && npm view "$package_name@$target_version" version 2>/dev/null || true)"
	if [[ "$live_version" == "$target_version" ]]; then
		ok "$package_name@$target_version is live on the registry"
	else
		warn "$package_name@$target_version is not yet visible; registry propagation may still be in progress"
	fi

	local tag_version
	tag_version="$(cd "$script_dir" && npm view "$package_name@$npm_tag" version 2>/dev/null || true)"
	if [[ "$tag_version" == "$target_version" ]]; then
		ok "$package_name@$npm_tag -> $tag_version"
	else
		warn "$package_name@$npm_tag currently resolves to '$tag_version' (expected '$target_version')"
	fi
}

print_plan() {
	printf '\n'
	info "publish plan"
	printf '  package:      %s\n' "$package_name"
	printf '  current:      %s\n' "$current_version"
	printf '  increment:    %s\n' "$increment"
	if is_prerelease_increment; then
		printf '  channel:      %s\n' "$channel"
	else
		printf '  channel:      stable\n'
	fi
	printf '  target:       %s\n' "$target_version"
	printf '  npm tag:      %s\n' "$npm_tag"
	printf '  registry:     https://registry.npmjs.org\n'
	printf '\n'
}

main() {
	parse_args "$@"
	preflight
	fetch_registry_versions
	check_registry_baseline
	validate_prerelease_channel
	compute_target_version
	ensure_target_version_available
	print_plan

	if [[ "$npm_tag" == "latest" ]]; then
		warn "you are about to publish a stable release to the latest tag"
		confirm "continue with a latest-tag publish?"
	fi

	run_typecheck
	run_pack_dryrun
	confirm "proceed with publish?"

	load_token
	backup_package_files
	set_version
	do_publish
	restore_files=0
	verify_publish

	printf '\n'
	info "done! install with:"
	printf '  npm install %s@%s\n' "$package_name" "$npm_tag"
	printf '  npm install %s@%s\n' "$package_name" "$target_version"
	printf '\n'
}

main "$@"
