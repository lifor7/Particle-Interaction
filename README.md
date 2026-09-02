# LIZI-3D

**粒子辉光 · Three.js 星系级环状粒子交互系统**

基于 Three.js 与 MediaPipe 的实时粒子可视化项目，呈现星系级沉浸式视觉体验。

## ✨ 特性

- **双形态切换** — 球形螺旋星云 ↔ 无定形云，一键切换
- **逐粒子概率着色** — 三环平滑过渡，每颗粒子独立色彩概率分布
- **辉光后处理** — UnrealBloomPass 泛光，营造真实星云光晕
- **深邃星空配色** — 黑蓝紫底色 + 多色相粒子，沉浸感拉满
- **手势交互** — MediaPipe Hand Landmarker 实时追踪，手势斥力推挤粒子
- **控制面板** — 毛玻璃风格侧栏，实时调节粒子参数

## 🚀 快速开始

### 方式一：直接打开

双击 `index.html` 即可在浏览器中查看（部分功能受限）。

### 方式二：本地服务器（推荐）

需要 Node.js，用于加载 MediaPipe ESM 模块和 WASM 资源：

```bash
node server.js
# 浏览器打开 http://localhost:8123/index.html
```

> 默认端口 `8123`，可通过 `PORT=xxxx node server.js` 自定义。

## 📁 项目结构

```
LIZI-3D/
├── index.html          # 主页面（当前版本，双形态星云 + 控制面板）
├── 粒子辉光.html        # 旧版（球形内核 + 单环带，手势斥力）
├── server.js           # 极简静态文件服务器（Node.js）
├── mediapipe/          # MediaPipe 手势追踪资源
│   ├── hand_landmarker.task
│   ├── vision_bundle.mjs
│   └── wasm/
└── README.md
```

## 🛠 技术栈

| 技术 | 用途 |
| --- | --- |
| [Three.js](https://threejs.org/) | 3D 渲染引擎、粒子系统、辉光后处理 |
| [MediaPipe](https://developers.google.com/mediapipe) | 手部关键点检测（WASM 本地推理） |
| 原生 JavaScript | 粒子物理模拟、形态插值、交互逻辑 |

## 📝 开发约定

- **所有迭代以 `index.html` 为准**，`粒子辉光.html` 为历史版本，仅作参考
- 讨论重点集中在**粒子效果**（形态、颜色、运动、辉光、密度等观感）
