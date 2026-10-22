# dsh-update-check

给 DeepSeek Harness 用的启动检查插件：每次打开 Harness 自动检查 DSH 本体、已装插件和 rea-agents 是否有新版本，在右下角弹提示——**只告诉你，不自动安装**。

## 它检查什么

| 对象 | 数据来源 |
| --- | --- |
| DSH 本体 | 官方 `nightly.yml` 更新 feed，比对 `version` 字段 |
| 已装插件 / bundle | 逐个查 npm registry，失败自动回退国内镜像 |
| rea-agents | 全局安装的 CLI 版本 |

## 它怎么工作

1. Harness 启动时插件被加载，立刻发起一次检查
2. 检查结果通过 `GET /dsh-update-check/api/status` 暴露
3. 界面上的卡片轮询这个接口，拿到结果后显示
4. 有更新时右下角浮出卡片，列出「包名 当前版本 → 最新版本」
5. 插件类条目每行有「更新」按钮，底部有「全部更新」

## 哪些能一键更新，哪些不能

- **能**：普通插件。内部走两步——先卸载再安装，因为 DSH 0.2.1 的插件管理器没有原地更新能力。
- **不能**：`dshmarket` 这类「卸载自己会中断自身执行」的插件，以及 DSH 本体（需下载安装包）、`rea-agents`（需 `npm i -g rea-agents@latest`）。卡片会给这些标「需手动」。

## 安装

打包：

```bash
npm pack
```

把生成的 `.tgz` 交给 DSH 装：

```
plugin_manager install_bundle <tgz 绝对路径>
```

## 改它自己

改完源码后：改 `package.json` 的 `version` → `npm pack` → 重新 `install_bundle`。

已装插件的替换由 DSH 的 HMR 接管，**不需要重启 Harness**。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-update-check/api/status` | 检查结果快照，支持 `?refresh=1` 强制重查 |
| `POST` | `/dsh-update-check/api/install` | body `{ "name": "包名" }`，只接受本次检查判定为过期的插件 |
