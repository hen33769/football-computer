SHELL := /bin/bash

RELEASE_TYPE ?= patch
DEPLOY_DOMAIN ?= smgr.online
DEPLOY_REMOTE ?= origin
DEPLOY_BRANCH ?= main

.PHONY: help build build-cloudflare clean deploy release release-dry-run release-patch release-minor release-major

help:
	@echo "SMGR 常用命令"
	@echo "  make build           构建单文件静态版"
	@echo "  make build-cloudflare 构建 Cloudflare Worker 版"
	@echo "  make deploy          默认按 patch 版本一键推送并发布"
	@echo "  make release-patch   修复/样式/文案：1.0.0 -> 1.0.1"
	@echo "  make release-minor   功能/行为变化：1.0.0 -> 1.1.0"
	@echo "  make release-major   大改动：1.0.0 -> 2.0.0"
	@echo "  make release-dry-run 只检查发布参数，不提交、推送或部署"

build:
	npm run build:html

build-cloudflare:
	npm run build

clean:
	rm -rf dist

release:
	RELEASE_TYPE="$(RELEASE_TYPE)" \
	DEPLOY_DOMAIN="$(DEPLOY_DOMAIN)" \
	DEPLOY_REMOTE="$(DEPLOY_REMOTE)" \
	DEPLOY_BRANCH="$(DEPLOY_BRANCH)" \
	./scripts/deploy.sh

deploy: release

release-dry-run:
	DRY_RUN=1 \
	RELEASE_TYPE="$(RELEASE_TYPE)" \
	DEPLOY_DOMAIN="$(DEPLOY_DOMAIN)" \
	DEPLOY_REMOTE="$(DEPLOY_REMOTE)" \
	DEPLOY_BRANCH="$(DEPLOY_BRANCH)" \
	./scripts/deploy.sh

release-patch:
	@$(MAKE) release RELEASE_TYPE=patch

release-minor:
	@$(MAKE) release RELEASE_TYPE=minor

release-major:
	@$(MAKE) release RELEASE_TYPE=major
