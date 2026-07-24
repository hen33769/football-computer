#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(git -C "$script_directory" rev-parse --show-toplevel)"
cd "$repository_root"

branch_name="$(git symbolic-ref --quiet --short HEAD)" || {
  echo "部署已取消：当前处于 detached HEAD 状态。" >&2
  exit 1
}
remote_name="${DEPLOY_REMOTE:-origin}"

if ! git remote get-url "$remote_name" >/dev/null 2>&1; then
  echo "部署已取消：找不到 Git 远程仓库 ${remote_name}。" >&2
  exit 1
fi

npm version patch --no-git-tag-version --force
next_version="$(node -p "require('./package.json').version")"

git add -A
git commit -m "chore: release v${next_version}"
git push "$remote_name" "$branch_name"

echo "已发布 v${next_version} 到 ${remote_name}/${branch_name}。"
