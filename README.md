# Desktop Dock

> 液态玻璃风格的 Windows 桌面 Dock —— 给 Windows 一个 macOS 式的应用底座。

一个基于 **Electron** 的桌面 Dock 应用：底部常驻一条液态玻璃质感的 Dock，中部是你固定的常用应用，右侧实时同步当前正在运行的应用，左侧九宫格一键呼出应用启动面板。

---

## ✨ 功能特性

### 液态玻璃视觉
- 遵循「Liquid Glass」视觉规范：`blur(16px) + saturate(150%)` 材质层、2~3px 暗色玻璃厚度外圈、1px 内发光、底部内阴影
- 顶部弧形高光带默认缓慢流动，鼠标进入后跟随指针移动
- 支持 `backdrop-filter: url()` 真折射（浏览器支持时自动启用，不支持则平滑降级）

### Dock 主体
- **左侧九宫格按钮**：点击从 Dock 位置弹性展开「应用启动面板」
- **中部固定区**：你固定的常用应用，图标下方圆点表示正在运行
- **右侧运行区**：分隔线右边实时同步当前正在运行的应用
- 悬停任意图标弹出名称标签，并标注「已固定」/「正在运行」
- 点击图标智能判断：已运行则切换到该窗口（最小化的自动还原），未运行则启动

### 应用启动面板
- 搜索框输入即实时过滤
- 滚轮上下翻页，或使用 `←` / `→` 方向键翻页
- 面板内右键任意应用 → 「固定到 Dock」
- 点击面板外任意处或按 `Esc` 收起

### 应用扫描
- 扫描「开始菜单」中所有已安装应用（与桌面是否放图标无关）
- 自动过滤附属项（首页、配置工具、指南、卸载程序等），只保留应用本体
- 桌面快捷方式作为补充合并进列表

### 图标提取
- 通过 Windows 原生接口提取 **256×256** 高清图标
- 新装应用首次显示时自动提取并缓存，之后加载零开销

### 任务栏管理
- Dock 设计为底部主入口，可右键 Dock 空白处随时「隐藏 / 显示 Windows 任务栏」

### 其他
- 单实例锁，防止重复启动多个 Dock
- 支持开机自启
- 右键 Dock 空白处：重新扫描应用 / 隐藏任务栏 / 显示任务栏 / 退出

---

## 🚀 快速开始

### 下载安装（普通用户）

前往 [Releases](../../releases) 页面下载：

| 文件 | 说明 |
| --- | --- |
| `Desktop-Dock-Setup-x.x.x.exe` | 安装版，自动创建桌面与开始菜单快捷方式，并默认勾选「运行」 |
| `desktop-dock-vX.X-便携版.zip` | 便携版，解压即用，无需安装 |

安装后默认开启开机自启。卸载：`设置 → 应用 → 已安装的应用 → Desktop Dock`。

### 从源码运行（开发者）

需要 Node.js 18+ 与 Windows 环境。

```bash
cd source
npm install
npm start
```

也可以直接双击 `source/启动Dock.bat`（需先执行过 `npm install`）。

### 打包

```bash
cd source
npm run dist
```

产物输出到 `source/dist/`，安装包名为 `Desktop-Dock-Setup-<version>.exe`。

---

## 📁 项目结构

```
desktop-dock/
├── source/                     # 应用源码
│   ├── src/
│   │   ├── main.js             # Electron 主进程：窗口、应用扫描、图标提取、IPC
│   │   ├── preload.js          # 预加载脚本（contextBridge 安全桥接）
│   │   └── renderer/
│   │       ├── dock.html       # Dock 主体界面 + 液态玻璃样式
│   │       └── launcher.html   # 应用启动面板
│   ├── tools/                  # 原生辅助工具
│   │   ├── dock-helper.cs      # C# 窗口枚举 / 切换 / 任务栏控制
│   │   ├── dock-helper2.exe    # 编译后的辅助程序
│   │   ├── focus-window.ps1    # 窗口聚焦
│   │   ├── toggle-taskbar.ps1  # 任务栏显隐
│   │   ├── pre-extract-icons.ps1
│   │   ├── pre-extract-running.ps1
│   │   └── compile-helper.ps1
│   ├── build/icon.ico          # 应用图标
│   ├── package.json
│   └── 启动Dock.bat
├── 使用说明.txt                 # 面向终端用户的中文使用说明
└── README.md
```

> `source/icon-cache/` 为运行时自动生成的图标缓存目录，未纳入版本控制。

---

## 🛠 技术要点

| 模块 | 实现方式 |
| --- | --- |
| 应用枚举 | 解析开始菜单 `.lnk` 快捷方式 + 桌面快捷方式合并去重 |
| 运行中检测 | 轮询系统进程，筛选出拥有可见窗口的进程 |
| 图标提取 | C# 辅助程序调用 Windows 原生接口提取 256×256 图标，Electron API 兜底 |
| 窗口切换 | C# 枚举窗口 → 匹配进程 → `SetForegroundWindow`，最小化窗口先还原 |
| 任务栏显隐 | PowerShell 操作 `Shell_TrayWnd` 窗口状态 |
| 界面渲染 | 透明无边框窗口 + HTML/CSS，`backdrop-filter` 实现液态玻璃材质 |

---

## ⚠️ 已知限制

- 仅支持 **Windows**（依赖开始菜单、Win32 窗口 API、任务栏句柄）
- 若某应用以「管理员权限」运行，普通权限的 Dock 无法跨权限切换其窗口 —— 这是 Windows 系统安全机制，属正常现象
- 图标提取依赖 PowerShell 执行策略，首次运行可能需要在系统允许的范围内执行脚本

---

## 📄 License

[MIT](LICENSE)

---

## 🙏 反馈

欢迎提交 [Issue](../../issues) 反馈问题或建议。
