# dsh-update-check

DeepSeek Harness 的启动更新检查：每次启动查一遍，一张卡片，一次点击更新一项。

[![license](https://img.shields.io/badge/license-MIT-0f172a)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1%2B-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-topic-2f6fed)](https://github.com/topics/dsh-plugin)

[English](README.md) | 中文

<img src="assets/card-preview.svg" width="352" alt="更新卡片：两行插件带更新按钮，一行市场标为需手动，底部是全部更新与重新检查。">

一个 profile 就是一串包版本，而这些版本不会等你：插件发了修复、市场出了补丁、应用自己发了新的 nightly。运行中的应用对这些一个字都不说。

这个插件补上那段。每次启动，它把你正在跑的版本和已经发布的版本比一遍；只要有落后的，就在窗口角落放一张卡片——每个落后项一行，每个更新一个按钮，全都最新时什么都不显示。

它只读版本、只在点击时安装。不会自己升级任何东西，不会碰你没点过的包，路由上只暴露版本号。

## 检查什么

| 对象 | 当前版本来自 | 新版本来自 |
| --- | --- | --- |
| DeepSeek Harness 本体 | 运行中构建的 `resources/app.asar/dsh/package.json` | 官方 `nightly.yml` 更新 feed |
| profile 里的插件 | 运行中 profile 的 `package.json` 中的 `dependencies` | npm registry |
| `rea-agents` CLI | `%APPDATA%\npm\node_modules\rea-agents` 下的全局安装 | npm registry |

每个对象独立检查，所以一个源连不上只会让对应行变成 `unknown`，不会拖垮整次检查。npm 查询在 `registry.npmjs.org` 失败时回退到 `registry.npmmirror.com`。

## 你会看到

右下角一张卡片，只在确实有东西落后时出现：

- 每个落后对象一行 `包名  1.2.3 → 1.2.4`，最多显示 4 行，其余折叠成计数
- 能在这里装的行走一个 **更新** 按钮，底部 **全部更新** 一次做完
- 装不了的走 **需手动**——应用本体、CLI、以及插件市场（见[限制](#限制)）
- **重新检查** 重跑一次检查，**×** 关掉。放着不管的话 15 秒后自动消失——鼠标悬停时暂停计时，正在安装时保持打开

全部是最新版时什么都不渲染。

卡片每**次启动**只提供一次，而不是每加载一次页面。Host 只把这张"可以弹"的许可发出去一次，第一个读到它的页面就用掉了——所以关掉它、切换面板、刷新页面都不会再弹。退出 Harness 再打开，才会带着一次新的检查结果重新出现。

> 界面文案目前是中文；布局与路由与语言无关。

## 怎么工作

1. Host 侧注册 `GET /dsh-update-check/api/status`，bundle 激活时发起一次检查。
2. 这次检查以 6 路并发跑：一次 feed 读取、每个插件一次 npm 读取、CLI 一次本地版本读取。
3. Client 侧轮询该路由，渲染进 `shell.overlay` 插槽——那是覆盖所有栏目的全框浮动层，所以卡片不属于任何会话或面板。
4. 点 **更新** 会向 `/dsh-update-check/api/install` POST `{ "name": "..." }`。该路由只接受本次检查判定为"过期且可安装"的名字，因此不能当通用安装代理。
5. 安装是两步：先 `installBundle`；如果管理器回 `already-installed`，就 `removeBundle` 再 `installBundle`。这与应用自带的 Plugins 页是同一种形态——这个管理器没有原地更新能力。
6. 安装结束后再查一次，卡片反映新版本。

## 限制

- **市场类插件不能自我更新。** 卸载该 bundle 会先卸掉执行重装的代码（上游 issue #900），所以这些行保持手动，并给出要跑的命令。
- **应用本体**是 nightly feed 后面一个桌面构建；卡片只报告新版本，下载交给你。
- **`rea-agents`** 是全局 npm 安装，不是 profile 依赖：`npm i -g rea-agents@latest`。
- **版本只做比对，不做假设。** 读不到当前版本、或 registry 没有任何响应时，报告 `unknown` 而不是当成已是最新。
- 替换插件会重载它的 Host 模块。这正是更新无需重启就能生效的原因，也意味着本插件自己被重装时，它的"本次启动提示"会重置。

## 安装

```bash
dsh plugin --profile <profile> add github:1731988818/dsh-update-check
```

这条命令同时会把这个 bundle 注册进 profile 的 `dsh.profile.bundles`，所以下次启动就会加载它。

`pnpm` 按 commit hash 缓存 git 依赖，推了新代码要重跑同一条命令才会拿到。

在会话内，同一条安装也能用一次工具调用完成：

```
plugin_manager install_bundle github:1731988818/dsh-update-check
```

需要 DeepSeek Harness 0.2.1 或更新的版本，桌面版或 Web 版都可以。

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-update-check/api/status` | 上次检查的快照，`?refresh=1` 发起新检查 |
| `POST` | `/dsh-update-check/api/install` | body `{ "name": "包名" }`，只接受本次检查判定为过期且可安装的插件 |

该路由只返回版本号与包名；它不读取请求里的任何文件，也不安装卡片没有提供过的对象。

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-update-check
```

不留残余：插件不写文件、不跨启动保存状态，路由随 bundle 一起消失。

## 许可证

[MIT](LICENSE)
