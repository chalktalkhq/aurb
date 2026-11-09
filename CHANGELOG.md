# Changelog

## [0.3.1](https://github.com/chalktalkhq/aurb/compare/v0.3.0...v0.3.1) (2026-11-09)


### Bug Fixes

* **cli:** exit with the right code on Windows instead of crashing after a network request ([#17](https://github.com/chalktalkhq/aurb/issues/17)) ([8dfd39e](https://github.com/chalktalkhq/aurb/commit/8dfd39ed6f5a62a0f7b1b66ad36f17b53d853dbd))


### Documentation

* add badges to the player README and to every generated orb README ([#13](https://github.com/chalktalkhq/aurb/issues/13)) ([4c0a810](https://github.com/chalktalkhq/aurb/commit/4c0a8100c1232a1b6c720e5ab9a5e140fd36d0ec))

## [0.3.0](https://github.com/chalktalkhq/aurb/compare/v0.2.3...v0.3.0) (2026-11-09)


### Features

* a professional orb picker on @clack/core, and no more stacked menus ([#11](https://github.com/chalktalkhq/aurb/issues/11)) ([b52e3be](https://github.com/chalktalkhq/aurb/commit/b52e3be4b87c875612fcb92a8f30f174b19779d7))

## [0.2.3](https://github.com/chalktalkhq/aurb/compare/v0.2.2...v0.2.3) (2026-11-07)


### Bug Fixes

* republishing an orb that already has its README publishes nothing ([#9](https://github.com/chalktalkhq/aurb/issues/9)) ([b74f465](https://github.com/chalktalkhq/aurb/commit/b74f4659f6e780d27dbab24ea3d20dc6d4b20900))

## [0.2.2](https://github.com/chalktalkhq/aurb/compare/v0.2.1...v0.2.2) (2026-11-07)


### Bug Fixes

* give every published orb a README ([#7](https://github.com/chalktalkhq/aurb/issues/7)) ([a5ea8e2](https://github.com/chalktalkhq/aurb/commit/a5ea8e237ac67eccbecd5fd468b595db622d1f94))

## [0.2.1](https://github.com/chalktalkhq/aurb/compare/v0.2.0...v0.2.1) (2026-11-05)


### Bug Fixes

* pin the copied script tag to @aurb/player@0, and run the workflows on Node 24 actions ([#5](https://github.com/chalktalkhq/aurb/issues/5)) ([a19200c](https://github.com/chalktalkhq/aurb/commit/a19200cff7e73ec378fcc61943eb3d150dbecf21))

## [0.2.0](https://github.com/chalktalkhq/aurb/compare/v0.1.0...v0.2.0) (2026-11-04)


### ⚠ BREAKING CHANGES

* import from @aurb/player, @aurb/player/react, @aurb/player/rest and @aurb/player/prefetch instead of aurb, and load the script from cdn.jsdelivr.net/npm/@aurb/player/dist/aurb.global.js.

### Features

* publish as @aurb/player, play community orbs from their own packages, and handle one-theme orbs ([#2](https://github.com/chalktalkhq/aurb/issues/2)) ([b1bda61](https://github.com/chalktalkhq/aurb/commit/b1bda616c7467f1e0bb7d6bf6a287fff05547e2e))
