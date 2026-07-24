#!/usr/bin/env bash

set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "部署已取消：请先提交或清理当前工作区变更。" >&2
  exit 1
fi

branch_name="$(git symbolic-ref --quiet --short HEAD)" || {
  echo "部署已取消：当前处于 detached HEAD 状态。" >&2
  exit 1
}
remote_name="${DEPLOY_REMOTE:-origin}"

if ! git remote get-url "$remote_name" >/dev/null 2>&1; then
  echo "部署已取消：找不到 Git 远程仓库 ${remote_name}。" >&2
  exit 1
fi

npm version patch --no-git-tag-version
next_version="$(node -p "require('./package.json').version")"

git add package.json package-lock.json
git commit -m "chore: release v${next_version}"
git push "$remote_name" "$branch_name"

echo "已发布 v${next_version} 到 ${remote_name}/${branch_name}。"
