#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
site_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${site_dir}/.." && pwd)"
dashboard_dir="${repo_root}/dashboard/app"
site_dist_dir="${site_dir}/dist"
dashboard_dist_dir="${dashboard_dir}/dist"
npm_cache_dir="${repo_root}/.netlify/cache/npm"
pnpm_store_dir="${repo_root}/.netlify/cache/pnpm-store"
corepack_home_dir="${repo_root}/.netlify/cache/corepack"

mkdir -p "${npm_cache_dir}" "${pnpm_store_dir}" "${corepack_home_dir}"

export ASTRO_TELEMETRY_DISABLED=1
export CI=true
export COREPACK_HOME="${corepack_home_dir}"

echo "==> Building site"
rm -rf "${site_dist_dir}"
if [ ! -x "${site_dir}/node_modules/.bin/astro" ]; then
  echo "==> Installing site dependencies"
  npm --prefix "${site_dir}" ci --cache "${npm_cache_dir}"
fi
npm --prefix "${site_dir}" run build:netlify

echo "==> Installing dashboard dependencies"
(
  cd "${dashboard_dir}"
  corepack pnpm --store-dir "${pnpm_store_dir}" install --frozen-lockfile
)

echo "==> Building dashboard"
rm -rf "${dashboard_dist_dir}"
(
  cd "${dashboard_dir}"
  corepack pnpm build
)

echo "==> Merging dashboard into site output"
mkdir -p "${site_dist_dir}/your-memory"
cp -R "${dashboard_dist_dir}/." "${site_dist_dir}/your-memory/"
rm -f "${site_dist_dir}/your-memory/_redirects"
