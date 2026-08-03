#!/usr/bin/env bash

set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(git -C "$script_directory" rev-parse --show-toplevel)"
cd "$repository_root"

release_type="${RELEASE_TYPE:-patch}"
deployment_domain="${DEPLOY_DOMAIN:-smgr.online}"
remote_name="${DEPLOY_REMOTE:-origin}"
expected_branch="${DEPLOY_BRANCH:-main}"
d1_database="${D1_DATABASE:-smgr-cloud}"

case "$release_type" in
  patch|minor|major) ;;
  *)
    echo "发布已取消：RELEASE_TYPE 只能是 patch、minor 或 major。" >&2
    exit 1
    ;;
esac

branch_name="$(git symbolic-ref --quiet --short HEAD)" || {
  echo "发布已取消：当前处于 detached HEAD 状态。" >&2
  exit 1
}

if ! git remote get-url "$remote_name" >/dev/null 2>&1; then
  echo "发布已取消：找不到 Git 远程仓库 ${remote_name}。" >&2
  exit 1
fi

if [[ "$branch_name" != "$expected_branch" ]]; then
  echo "发布已取消：当前分支是 ${branch_name}，正式发布分支应为 ${expected_branch}。" >&2
  echo "如确实需要从当前分支发布，请显式运行 DEPLOY_BRANCH=${branch_name} make release。" >&2
  exit 1
fi

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "发布已取消：仓库中仍有未解决的 Git 冲突。" >&2
  exit 1
fi

current_version="$(node -p "require('./package.json').version")"
has_worktree_changes=0
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  has_worktree_changes=1
fi

echo "发布目标："
echo "  分支：${remote_name}/${branch_name}"
echo "  域名：https://${deployment_domain}"
echo "  D1：${d1_database}"
if [[ "$has_worktree_changes" -eq 1 ]]; then
  echo "  版本：v${current_version} -> ${release_type} 自动升级（如尚未提前更新版本）"
else
  echo "  版本：v${current_version}（会在拉取远端状态后判断是否需要升级）"
fi

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "检查完成：DRY_RUN=1，未执行测试、提交、推送或 Cloudflare 部署。"
  exit 0
fi

echo
echo "[1/7] 检查 GitHub 远端状态"
git fetch "$remote_name" "$branch_name"
if ! git merge-base --is-ancestor "$remote_name/$branch_name" HEAD; then
  echo "发布已取消：${remote_name}/${branch_name} 包含本地尚未合并的提交，请先拉取并处理。" >&2
  exit 1
fi
unpushed_commits="$(git rev-list --count "$remote_name/$branch_name..HEAD")"
head_version="$(git show "HEAD:package.json" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => { process.stdout.write(JSON.parse(input).version); });
')"
remote_version="$(git show "$remote_name/$branch_name:package.json" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => { process.stdout.write(JSON.parse(input).version); });
')"
has_release_changes=0
if [[ "$has_worktree_changes" -eq 1 || "$unpushed_commits" -gt 0 ]]; then
  has_release_changes=1
fi
should_bump_version=0
if [[ "$has_release_changes" -eq 1 && "$current_version" == "$head_version" && "$head_version" == "$remote_version" ]]; then
  should_bump_version=1
fi

echo "  待推送提交：${unpushed_commits}"
if [[ "$should_bump_version" -eq 1 ]]; then
  echo "  版本处理：自动执行 ${release_type} 升级"
elif [[ "$has_release_changes" -eq 1 ]]; then
  echo "  版本处理：检测到版本已从远端 v${remote_version} 更新为 v${current_version}，不重复升级"
else
  echo "  版本处理：没有待发布改动，重新部署 v${current_version}"
fi

echo
echo "[2/7] 运行测试"
npm test

echo
echo "[3/7] 构建 Cloudflare 版本"
npm run build

if [[ "$should_bump_version" -eq 1 ]]; then
  echo
  echo "[4/7] 更新版本"
  npm version "$release_type" --no-git-tag-version --force
  next_version="$(node -p "require('./package.json').version")"
  node -e '
    const packageJson = require("./package.json");
    const packageLock = require("./package-lock.json");
    if (packageJson.version !== packageLock.version || packageJson.version !== packageLock.packages[""].version) {
      throw new Error("package.json 与 package-lock.json 版本不一致");
    }
  '
else
  next_version="$current_version"
  echo
  echo "[4/7] 跳过版本更新"
fi

if [[ "$has_worktree_changes" -eq 1 || "$should_bump_version" -eq 1 ]]; then
  git add -A
  git commit -m "chore: release v${next_version}"
else
  echo "  没有未提交文件，跳过发布提交"
fi

echo
echo "[5/7] 推送代码到 GitHub"
git push "$remote_name" "$branch_name"

echo
echo "[6/7] 应用远程 D1 迁移并部署 Cloudflare Worker"
WRANGLER_LOG_PATH=.wrangler/d1-release.log npx wrangler d1 migrations apply "$d1_database" --remote
npm run db:rewrite-orders:remote
npm run deploy:cloudflare

echo
echo "[7/7] 验证正式域名"
health_file="$(mktemp)"
trap 'rm -f "$health_file"' EXIT
health_url="https://${deployment_domain}/api/matches/current"

check_health() {
  local url="$1"
  shift
  curl \
    --silent \
    --location \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 2 \
    --retry-delay 1 \
    --output "$health_file" \
    --write-out "%{http_code}" \
    "$@" \
    "$url"
}

curl_status=0
http_status="$(check_health "$health_url" 2>/dev/null)" || curl_status=$?
verification_method="系统 DNS"
verification_skipped=0

if [[ "$curl_status" -eq 6 ]]; then
  echo "  本机 DNS 暂时无法解析 ${deployment_domain}，改用公共 DNS 验证。"
  public_ip=""
  public_dns_resolver=""
  if command -v dig >/dev/null 2>&1; then
    for resolver in 223.5.5.5 119.29.29.29 1.1.1.1 8.8.8.8; do
      public_ip="$(
        dig +time=2 +tries=1 +short @"$resolver" "$deployment_domain" A 2>/dev/null \
          | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }'
      )"
      if [[ -n "$public_ip" ]]; then
        public_dns_resolver="$resolver"
        break
      fi
    done
  fi

  if [[ -n "$public_ip" ]]; then
    : > "$health_file"
    curl_status=0
    http_status="$(
      check_health "$health_url" --resolve "${deployment_domain}:443:${public_ip}" 2>/dev/null
    )" || curl_status=$?
    verification_method="公共 DNS ${public_dns_resolver}（${public_ip}）"
  else
    echo "  公共 DNS 查询也不可用；Worker 已部署成功，跳过这台电脑上的 HTTP 验证。"
    curl_status=0
    verification_skipped=1
  fi
fi

if [[ "$verification_skipped" -eq 0 ]]; then
  if [[ "$curl_status" -ne 0 ]]; then
    echo "发布验证失败：请求 ${health_url} 时 curl 返回错误码 ${curl_status}。" >&2
    exit 1
  fi
  if [[ "$http_status" != "200" ]]; then
    echo "发布验证失败：${health_url} 返回 HTTP ${http_status}。" >&2
    exit 1
  fi
  node -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!Array.isArray(payload.matches)) throw new Error("matches/current 响应缺少 matches 数组");
  ' "$health_file"
  echo "  验证通过：${verification_method}，HTTP ${http_status}"
fi

echo
echo "发布完成：v${next_version}"
echo "  GitHub：${remote_name}/${branch_name}"
echo "  网站：https://${deployment_domain}"
