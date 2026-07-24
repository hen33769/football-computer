.PHONY: build clean deploy

build:
	npm run build:html

clean:
	rm -rf dist

deploy:
	./scripts/deploy.sh
