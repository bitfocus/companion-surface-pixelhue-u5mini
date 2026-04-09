# companion-surface-pixelhue-u5mini

Pixelhue U5 Mini 的 Companion 4.3 **Surface 模块**（独立包 + 子进程 + plugin 出站）。

## 开发与构建（与 `companion-surface-elgato-stream-deck` 一致）

1. 在本目录执行 `yarn` 安装依赖。
2. `yarn build`：将 `src/main.ts` 编译到 `dist/main.js`。
3. `yarn package`：先 `build`，再运行 `companion-surface-build` 生成可导入 Companion 的模块包（与官方 surface 模块流程一致）。

`companion/manifest.json` 中 `runtime.entrypoint` 为 `../dist/main.js`，主机从模块根目录解析，因此发布或拷贝模块时需包含 **`companion/` 与 `dist/`**（或由 `companion-surface-build` 产出的完整包）。

## 安装到 Companion

将构建/打包产物（或 `yarn package` 生成的 `.tgz`）通过 Companion 的 Surface 模块导入流程安装；在 Companion 中新建 **Surface 实例**，选择模块 **pixelhue-u5-mini**。

## 说明

- **已实现**：`init` / `destroy`、`getPluginFeatures`（`supportsOutbound`）、发现、`setupRemoteConnections` 内建 TCP、`notifyOpenedDiscoveredSurface`、`draw` / `blankSurface` / `closeDevice`、按键通过 `surfaceEvents` 上报。
- **可选依赖**：`@pixelhue/event-controller-sdk`（动态导入）；未安装时模块可加载，发现与远程连接能力受限。
