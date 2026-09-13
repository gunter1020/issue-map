# Changelog

## [0.4.1](https://github.com/gunter1020/issue-map/compare/v0.4.0...v0.4.1) (2026-09-13)


### Bug Fixes

* **map:** 被擋著的主票下一步改講阻擋者，不再說可以關掉了 ([b5ae001](https://github.com/gunter1020/issue-map/commit/b5ae00156c4f517e1f2bd69a8ddeb898f2a2bd76))

## [0.4.0](https://github.com/gunter1020/issue-map/compare/v0.3.1...v0.4.0) (2026-09-11)


### Features

* **build:** 建置時就把整頁畫好，沒有 JS 也看得到地圖 ([ad83db2](https://github.com/gunter1020/issue-map/commit/ad83db2e657633f7f2aae7f59b2de896cf97027f))
* **serve:** 預設讓 OS 挑 port，啟動訊息印出目錄與網址 ([7bc06dc](https://github.com/gunter1020/issue-map/commit/7bc06dc87f306ba37049c3e41ac490acbc56b65c))
* **serve:** 預設讓 OS 挑 port，啟動訊息印出目錄與網址 ([05c4139](https://github.com/gunter1020/issue-map/commit/05c41397490a24b18e929e02e0f42967b4ebc79b))


### Bug Fixes

* **build:** issue-map-build 產出完整 HTML 文件，不再是片段 ([d6f0670](https://github.com/gunter1020/issue-map/commit/d6f0670abd44ad04aa1b343acb9e7808fc69e783))
* **build:** 把 issue-map-view.ts 加進 package.json 的 files ([254cc31](https://github.com/gunter1020/issue-map/commit/254cc31405f8f8065a015416f2a63a38b79e0f3c))
* **build:** 沒有 JS 也看得到內容；線名不再蓋住第一站 ([54ab849](https://github.com/gunter1020/issue-map/commit/54ab84934747b4780fccd84a08d59c6b4740179b))
* **fetch:** 一個票號查不到不再讓整張圖產不出來 ([b1ee1a2](https://github.com/gunter1020/issue-map/commit/b1ee1a2f983bb9bedf97ab1573280b7b13b41bff))


### Performance Improvements

* **view:** 沒有阻擋關係的組別超過上限就不畫圖 ([f26a849](https://github.com/gunter1020/issue-map/commit/f26a849ae8f1a4f1bfb0d728688ea5650e3a5e32))

## [0.3.1](https://github.com/gunter1020/issue-map/compare/v0.3.0...v0.3.1) (2026-09-11)


### Bug Fixes

* **fetch:** closed issue 改成指名抓，CLI 訊息改英文 ([540cacf](https://github.com/gunter1020/issue-map/commit/540cacf4fcf33378195709df654bc7f6b5306e5f))

## [0.3.0](https://github.com/gunter1020/issue-map/compare/v0.2.0...v0.3.0) (2026-09-11)


### Features

* **ui:** 網頁加上 i18n，預設英文並支援繁中、簡中、日文 ([6adc776](https://github.com/gunter1020/issue-map/commit/6adc776b8379bf2b70ee7bd721ecb104d4247b86))

## [0.2.0](https://github.com/gunter1020/issue-map/compare/v0.1.0...v0.2.0) (2026-09-10)


### Features

* server 起來就開瀏覽器，watch 模式關掉 ([4bb025e](https://github.com/gunter1020/issue-map/commit/4bb025e9b7a6b3cb886dc9affc5def453093745d))
* 把開發地圖搬出來成獨立工具 ([2e8a426](https://github.com/gunter1020/issue-map/commit/2e8a4262ad63b486954eb4868a0c557056f2ffcf))


### Bug Fixes

* oxfmt 略過 release-please 產生的 CHANGELOG.md ([f793c32](https://github.com/gunter1020/issue-map/commit/f793c322e872997bbea9779eef3276f970ae188b))
