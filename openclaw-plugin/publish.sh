#!/usr/bin/env bash
#
# publish.sh — Build, verify, and publish @mem9/mem9 to npm.
#
# Usage:
#   ./publish.sh              # publish 0.3.4-rc.1 with tag "rc"
#   ./publish.sh 0.3.5        # publish 0.3.5 with tag "rc"
#   ./publish.sh 0.3.5 latest # publish 0.3.5 with tag "latest"
#
# Reads NPM_ACCESSTOKEN from ~/.env

readonly script_dir="$(cd "${0%/*}" && pwd)"
readonly env_file="$HOME/.env"
readonly default_version="0.3.4-rc.1"
readonly default_tag="rc"

# ── helpers ──────────────────────────────────────────────────────────

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

# ── load npm token ───────────────────────────────────────────────────

load_token() {
	[[ -f "$env_file" ]] || die "$env_file not found"

	local token
	token=$(grep -E '^NPM_ACCESSTOKEN=' "$env_file" | head -1 | cut -d'=' -f2-)
	# strip surrounding quotes if present
	token="${token%\"}"
	token="${token#\"}"
	token="${token%\'}"
	token="${token#\'}"

	[[ -n "$token" ]] || die "NPM_ACCESSTOKEN not set in $env_file"
	printf '%s' "$token"
}

# ── resolve version & tag ───────────────────────────────────────────

resolve_version() {
	local version="${1:-$default_version}"
	printf '%s' "$version"
}

resolve_tag() {
	local explicit_tag="$1"
	local version="$2"

	# explicit tag wins
	if [[ -n "$explicit_tag" ]]; then
		printf '%s' "$explicit_tag"
		return
	fi

	# if version contains prerelease identifier, use it as tag
	if [[ "$version" == *"-rc"* ]]; then
		printf 'rc'
	elif [[ "$version" == *"-beta"* ]]; then
		printf 'beta'
	elif [[ "$version" == *"-alpha"* ]]; then
		printf 'alpha'
	else
		# stable version but no explicit tag — safety: still use rc
		warn "stable version detected without explicit tag, defaulting to 'rc'"
		warn "pass 'latest' as second arg to publish as latest"
		printf '%s' "$default_tag"
	fi
}

# ── preflight checks ────────────────────────────────────────────────

preflight() {
	info "preflight checks"

	command -v node >/dev/null || die "node not found"
	command -v npm >/dev/null  || die "npm not found"
	ok "node $(node --version) / npm $(npm --version)"

	[[ -f "$script_dir/package.json" ]] || die "package.json not found"
	ok "package.json exists"

	# ensure clean working tree in this directory
	local dirty
	dirty=$(git -C "$script_dir" diff --name-only HEAD -- . 2>/dev/null || true)
	if [[ -n "$dirty" ]]; then
		warn "uncommitted changes detected:"
		printf '  %s\n' $dirty
		confirm "publish with uncommitted changes?"
	else
		ok "working tree clean"
	fi
}

# ── typecheck ────────────────────────────────────────────────────────

run_typecheck() {
	info "running typecheck"
	(cd "$script_dir" && npm run typecheck) || die "typecheck failed"
	ok "typecheck passed"
}

# ── npm pack dry-run ─────────────────────────────────────────────────

run_pack_dryrun() {
	info "dry-run pack (verifying contents)"
	local pack_output
	pack_output=$(cd "$script_dir" && npm pack --dry-run 2>&1) \
		|| die "npm pack dry-run failed"
	printf '%s\n' "$pack_output"
	ok "pack dry-run ok"
}

# ── set version ──────────────────────────────────────────────────────

set_version() {
	local version="$1"
	info "setting version to $version"
	(cd "$script_dir" && npm version "$version" --no-git-tag-version --allow-same-version) \
		|| die "npm version failed"
	ok "version set to $version"
}

# ── publish ──────────────────────────────────────────────────────────

do_publish() {
	local token="$1"
	local tag="$2"
	local tmp_npmrc="$script_dir/.npmrc"

	info "publishing @mem9/mem9 with tag '$tag'"

	printf '//registry.npmjs.org/:_authToken=%s\n' "$token" > "$tmp_npmrc"
	trap 'rm -f "$tmp_npmrc"' EXIT

	(cd "$script_dir" && npm publish --tag "$tag" --access public --auth-type=legacy) \
		|| { rm -f "$tmp_npmrc"; die "npm publish failed"; }

	rm -f "$tmp_npmrc"
	ok "published successfully"
}

# ── post-publish verify ──────────────────────────────────────────────

verify_publish() {
	local version="$1"
	local tag="$2"

	info "verifying published package"

	sleep 2

	local remote_version
	remote_version=$(npm view "@mem9/mem9@$tag" version 2>/dev/null || true)
	if [[ "$remote_version" == "$version" ]]; then
		ok "@mem9/mem9@$tag -> $remote_version"
	else
		warn "remote tag '$tag' shows '$remote_version' (expected '$version')"
		warn "registry propagation may take a moment — check manually"
	fi

	npm view "@mem9/mem9@$version" version >/dev/null 2>&1 \
		&& ok "@mem9/mem9@$version is live on registry" \
		|| warn "@mem9/mem9@$version not yet visible — may take a minute"
}

# ── main ─────────────────────────────────────────────────────────────

main() {
	local version
	version=$(resolve_version "${1:-}")

	local tag
	tag=$(resolve_tag "${2:-}" "$version")

	local token
	token=$(load_token)

	printf '\n'
	info "publish plan"
	printf '  package:  @mem9/mem9\n'
	printf '  version:  %s\n' "$version"
	printf '  tag:      %s\n' "$tag"
	printf '  registry: https://registry.npmjs.org\n'
	printf '\n'

	# safety: require explicit confirmation for 'latest' tag
	if [[ "$tag" == "latest" ]]; then
		warn "you are about to publish to the 'latest' tag!"
		warn "all 'npm install @mem9/mem9' users will get this version"
		confirm "are you sure you want to publish as latest?"
	fi

	preflight
	run_typecheck
	set_version "$version"
	run_pack_dryrun

	confirm "proceed with publish?"

	do_publish "$token" "$tag"
	verify_publish "$version" "$tag"

	printf '\n'
	info "done! install with:"
	printf '  npm install @mem9/mem9@%s\n' "$tag"
	printf '  npm install @mem9/mem9@%s\n' "$version"
	printf '\n'
}

main "$@"
