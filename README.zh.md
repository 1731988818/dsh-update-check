# dsh-update-check

DeepSeek Harness 的启动更新检查：每次启动查一次，右下角一张卡片，一次点击更新一项。

[![license](https://img.shields.io/badge/license-MIT-0f172a)](LICENSE)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

一个 DeepSeek Harness 社区插件。它只读版本、只在你点击时安装——不会自己升级任何东西，不会在你点击之外改动 profile，路由上也只暴露版本号。

## 检查什么

| 对象 | 数据来源 |
| --- | --- |
| DeepSeek Harness 本体 | 读取运行中构建的 `resources/app.asar/dsh/package.json`，与官方 `nightly.yml` 更新 feed 比对 |
| profile 里每个 bundle | 运行中 profile 的 `package.json` 的 `dependencies`，逐个查 npm registry |
| `rea-agents` CLI | `%APPDATA%\npm\node_modules\rea-agents` 下的全局安装 |

npm 查询在 `registry.npmjs.org` 失败时自动回退到 `registry.npmmirror.com`，所以一个源被挡只影响单个对象，而不是整次检查。

## 你会看到

右下角一张卡片，只在确实有东西落后时出现：

- 每个过期对象一行 `包名  1.2.3 → 1.2.4`，最多显示 4 行，其余折叠成计数
- profile 插件每行一个 **更新** 按钮，底部 **全部更新（N）**
- 三类无法在运行中自行更新的对象标 `需手动`（见[限制](#限制)）
- **重新检查** 与 **×**——它是提醒，不是催促

全部是最新版时什么都不渲染。

每次启动只提示一次。这张卡片由 Host 发一次「可以弹」的许可，页面读到的那一刻就用掉了——所以关掉它、切换页面、刷新页面都不会再弹。重新打开 Harness 时它才会带着一次新的检查结果再出现一次。

## 怎么工作

1. Host 侧注册 `GET /dsh-update-check/api/status`，bundle 激活时发起一次检查。
2. 检查以 6 路并发跑：一次 feed 读取、每个 bundle 一次 npm 读取、CLI 一次本地版本读取。
3. Client 侧轮询该路由，然后渲染进 `shell.overlay` 插槽——那是覆盖所有栏目的全框浮动层，所以卡片不属于某个会话或面板。
4. 点击 **更新** 会向 `/dsh-update-check/api/install` POST `{ "name": "..." }`。该路由只接受本次检查判定为"过期且可安装"的名字，因此不能当通用安装代理使用。
5. 安装本身是两步：先 `installBundle`；如果管理器回 `already-installed`（DSH 0.2.1 把对已有依赖的 `add` 直接当成已安装，见 issue #896），就 `removeBundle` 再 `installBundle`。这与官方 Plugins 页用的是同一种形态——这个管理器没有原地更新能力。
6. 安装结束后再查一次，卡片反映新版本。

## 限制

- **`dshmarket` 及其他市场类插件不能自我更新。** 卸载该 bundle 会先卸载掉执行重装的代码（issue #900），所以这些行保持 `需手动` 并给出要跑的命令。
- **DeepSeek Harness 本体**是 nightly feed 后面 289 MB 的桌面构建；卡片只报告新版本，下载交给你。
- **`rea-agents`** 是全局 npm 安装，不是 profile 依赖：`npm i -g rea-agents@latest`。
- 版本只做比对，不做假设：读不到当前版本、或 registry 没有任何响应时报告 `unknown`，而不是当成已是最新。

## 安装

```bash
dsh plugin --profile <profile> add github:1731988818/dsh-update-check
```

`pnpm` 按 commit hash 缓存 git 依赖，推了新代码要重跑同一条命令才会拿到。

在会话内，同一条安装也能用一次工具调用完成：

```
plugin_manager install_bundle github:1731988818/dsh-update-check
```

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-update-check/api/status` | 上次检查的快照，`?refresh=1` 强制重查 |
| `POST` | `/dsh-update-check/api/install` | body `{ "name": "包名" }`，只接受本次检查判定为过期且可安装的插件 |

该路由只返回版本号与包名；它不读取请求里的任何文件，也不安装卡片没有提供过的对象。

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-update-check
```

不留残余：插件不写文件、不跨启动保存状态，路由随 bundle 一起消失。

## 许可证

[MIT](LICENSE)
