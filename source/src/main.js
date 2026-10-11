const { app, BrowserWindow, ipcMain, shell, screen, Menu } = require('electron');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// 兼容性开关：避免部分环境 GPU 沙箱崩溃
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// ---------- 单实例锁：防止重复启动多个 Dock ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (dockWin) dockWin.showInactive();
  });
}

let dockWin = null;
let launcherWin = null;
let appsCache = null; // 桌面扫描结果缓存
let runningApps = []; // 正在运行的应用
const iconCache = new Map(); // 图标缓存: filePath -> dataURL
const linkTargetCache = new Map(); // 快捷方式 -> 真实目标路径

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf-8');
    const cfg = JSON.parse(raw);
    if (!Array.isArray(cfg.pinned)) cfg.pinned = [];
    return cfg;
  } catch {
    return { pinned: [] };
  }
}

// 首次运行：自动把桌面上前 6 个应用固定到 Dock，避免空栏
function initConfigIfNeeded() {
  if (fs.existsSync(CONFIG_PATH())) return;
  const apps = scanDesktopApps();
  const cfg = { pinned: apps.slice(0, 6).map((a) => a.path) };
  writeConfig(cfg);
}

function writeConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('writeConfig failed:', e);
  }
}

// ---------- 扫描应用（开始菜单为主，桌面为辅；与桌面是否显示图标无关） ----------
const APP_EXCLUDE = /卸载|uninstall|帮助|help|官网|website|update|更新|指南|反馈|配置|设置|工具|管理器|批处理|签名|重置|输出|输入|发送至|从早期|教程|说明|论坛|客服|修复|检测|诊断|迁移|备份|恢复|驱动|许可|license|readme|command prompt|native tools|installer|cert kit|verifier|gpuview|development kit|administrative|component services|语言首选项|additional tools|powershell|user['’]?s guide|user guide|performance analyzer|documentation for|package manager|computer management|remote desktop|file explorer|control panel/i;

function normName(s) {
  return s.toLowerCase().replace(/[\s\-_()（）\[\]【】]/g, '');
}

function collectLnk(dir, folder, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectLnk(full, e.name, out); // 记录所属文件夹名
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (ext === '.lnk' || ext === '.url') out.push({ path: full, folder });
    }
  }
}

function scanDesktopApps() {
  const startMenuDirs = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
  ];
  const raw = [];
  for (const d of startMenuDirs) collectLnk(d, null, raw);

  const topLevel = [];
  const byFolder = new Map();
  for (const item of raw) {
    const name = path.basename(item.path, path.extname(item.path));
    // 网页链接和附属特征词直接过滤
    if (item.path.toLowerCase().endsWith('.url')) continue;
    if (APP_EXCLUDE.test(name)) continue;
    item.name = name;
    if (!item.folder) topLevel.push(item);
    else {
      if (!byFolder.has(item.folder)) byFolder.set(item.folder, []);
      byFolder.get(item.folder).push(item);
    }
  }
  // 每个文件夹只留"本体"：名字与文件夹名互相包含的那个；没有匹配则留第一个
  const folderPicks = [];
  for (const [folder, items] of byFolder) {
    const nf = normName(folder);
    const main = items.find((i) => {
      const ni = normName(i.name);
      return ni.includes(nf) || nf.includes(ni);
    });
    folderPicks.push(main || items[0]);
  }

  const files = [...topLevel, ...folderPicks];
  // 桌面快捷方式作为补充（用户自己放的，全部保留）
  const desktopDirs = [
    app.getPath('desktop'),
    'C:\\Users\\Public\\Desktop',
  ];
  for (const d of desktopDirs) {
    let fs2 = [];
    try { fs2 = fs.readdirSync(d); } catch { continue; }
    for (const f of fs2) {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.lnk' || ext === '.url') {
        files.push({ path: path.join(d, f), name: path.basename(f, ext) });
      }
    }
  }

  const seen = new Set();
  const apps = [];
  for (const f of files) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    apps.push({ name: f.name, path: f.path, type: f.path.toLowerCase().endsWith('.url') ? 'url' : 'lnk' });
  }
  // 前缀去重：名字以另一个更短的保留项开头的视为附属（如"爱奇艺PC客户端"⊃"爱奇艺"）
  const normList = apps.map((a) => normName(a.name));
  const filtered = apps.filter((a, i) => {
    const ni = normList[i];
    if (ni.length < 2) return true;
    return !normList.some((nj, j) => j !== i && nj.length >= 2 && nj.length < ni.length && ni.startsWith(nj));
  });
  filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return filtered;
}

// 已固定但文件被删除的快捷方式：在开始菜单里找同名应用自动重关联
function repairPinned() {
  const cfg = readConfig();
  const missing = cfg.pinned.filter((p) => !fs.existsSync(p));
  if (!missing.length) return;
  const apps = scanDesktopApps();
  let changed = false;
  cfg.pinned = cfg.pinned.map((p) => {
    if (fs.existsSync(p)) return p;
    const name = path.basename(p, path.extname(p));
    const found = apps.find((a) => a.name === name);
    if (found) { changed = true; return found.path; }
    return p; // 找不到就保留，图标显示占位
  });
  if (changed) writeConfig(cfg);
}

// ---------- 解析快捷方式（带缓存，含自带图标路径） ----------
function resolveLink(lnkPath) {
  if (linkTargetCache.has(lnkPath)) return linkTargetCache.get(lnkPath);
  let info = { target: null, icon: null };
  try {
    if (lnkPath.toLowerCase().endsWith('.lnk')) {
      const link = shell.readShortcutLink(lnkPath);
      info = { target: link.target || null, icon: link.icon || null };
    }
  } catch { /* 忽略 */ }
  linkTargetCache.set(lnkPath, info);
  return info;
}

// 资源根目录：开发时在项目根，打包后 electron-builder 会把 tools/icon-cache 放到 resources/ 下
// （asar 包内的 exe 无法执行，必须放在 asar 之外）
const RES_ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const HELPER_EXE = path.join(RES_ROOT, 'tools', 'dock-helper2.exe');
const FOCUS_PS1 = path.join(RES_ROOT, 'tools', 'focus-window.ps1');
const TASKBAR_PS1 = path.join(RES_ROOT, 'tools', 'toggle-taskbar.ps1');

// 图标缓存目录：打包后写入可写的 userData（安装目录可能只读），并从随包资源复制预置缓存
let ICON_CACHE_DIR = path.join(RES_ROOT, 'icon-cache');
function initIconCacheDir() {
  if (!app.isPackaged) {
    try { fs.mkdirSync(ICON_CACHE_DIR, { recursive: true }); } catch { /* 忽略 */ }
    return;
  }
  const dst = path.join(app.getPath('userData'), 'icon-cache');
  try {
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(dst, { recursive: true });
      const src = path.join(process.resourcesPath, 'icon-cache');
      if (fs.existsSync(src)) {
        for (const f of fs.readdirSync(src)) {
          try { fs.copyFileSync(path.join(src, f), path.join(dst, f)); } catch { /* 单个失败跳过 */ }
        }
      }
    }
  } catch { /* 忽略 */ }
  ICON_CACHE_DIR = dst;
}

// 用原生 helper 提取图标（SHGetImageList 256px，资源管理器同款，支持 .lnk 自动解析）
// 结果缓存在项目 icon-cache 目录，可预生成，二次使用零开销
function extractIconWithHelper(filePath) {
  return new Promise((resolve) => {
    const crypto = require('crypto');
    const out = path.join(
      ICON_CACHE_DIR,
      crypto.createHash('md5').update(filePath.toLowerCase()).digest('hex') + '.png'
    );
    if (fs.existsSync(out)) return resolve(out);
    execFile(HELPER_EXE, ['icon', filePath, out], { windowsHide: true }, (err) => {
      resolve(!err && fs.existsSync(out) ? out : null);
    });
  });
}

// ---------- 提取真实图标（helper 优先，Electron 接口兜底） ----------
async function getIconDataURL(appPath) {
  if (iconCache.has(appPath)) return iconCache.get(appPath);
  let dataURL = null;
  try {
    // helper 直接对 .lnk 取图标（SHGetFileInfo 自动解析快捷方式）
    if (fs.existsSync(HELPER_EXE)) {
      const png = await extractIconWithHelper(appPath);
      if (png) {
        dataURL = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64');
      }
    }
    // 兜底链：target → 快捷方式自带图标 → lnk/exe 本身
    if (!dataURL) {
      let img = null;
      if (appPath.toLowerCase().endsWith('.lnk')) {
        const link = resolveLink(appPath);
        if (link.target && fs.existsSync(link.target)) {
          img = await app.getFileIcon(link.target, { size: 'large' });
        }
        if ((!img || img.isEmpty()) && link.icon && fs.existsSync(link.icon)) {
          img = await app.getFileIcon(link.icon, { size: 'large' });
        }
      }
      if (!img || img.isEmpty()) {
        img = await app.getFileIcon(appPath, { size: 'large' });
      }
      if (img && !img.isEmpty()) dataURL = img.toDataURL();
    }
  } catch { /* 忽略，返回 null 由前端用占位图标 */ }
  iconCache.set(appPath, dataURL);
  return dataURL;
}

// ---------- 轮询正在运行的应用（有可见窗口的进程） ----------
const RUNNING_EXCLUDE = new Set([
  'textinputhost', 'searchhost', 'startmenuexperiencehost',
  'shellexperiencehost', 'applicationframehost', 'electron',
]);
// 自身可执行文件名（打包后为 "Desktop Dock"），用于把 Dock 自己排除在"运行中应用"之外
const SELF_EXE = path.basename(process.execPath, '.exe').toLowerCase();

function pollRunningApps() {
  const ps = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
    'Get-Process | Where-Object { $_.MainWindowTitle -ne \'\' -and $_.Path } | ' +
    'Select-Object Id,ProcessName,Path,MainWindowHandle | ConvertTo-Json -Compress';
  exec(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    if (err || !stdout || !stdout.trim()) return;
    try {
      let list = JSON.parse(stdout.trim());
      if (!Array.isArray(list)) list = [list];
      const seen = new Set();
      const apps = [];
      for (const p of list) {
        if (!p.Path) continue;
        const exeName = path.basename(p.Path, '.exe').toLowerCase();
        if (RUNNING_EXCLUDE.has(exeName)) continue;
        if (exeName === SELF_EXE) continue; // 排除 Dock 自身
        if (p.Path.toLowerCase().includes('desktop-dock')) continue; // dev 模式下排除自己
        const key = p.Path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        apps.push({ name: p.ProcessName, path: p.Path, pid: p.Id, handle: String(p.MainWindowHandle) });
      }
      apps.sort((a, b) => a.name.localeCompare(b.name));
      const changed = JSON.stringify(apps.map(a => a.path)) !== JSON.stringify(runningApps.map(a => a.path));
      if (changed) {
        runningApps = apps;
        layoutDock();
        if (dockWin) dockWin.webContents.send('running-changed', runningApps);
      }
    } catch { /* 解析失败跳过本轮 */ }
  });
}

// ---------- Dock 窗口几何 ----------
// 窗口比可视 Dock 条大：上下左右留出余量，鱼眼放大时图标不被裁剪
const DOCK_HEIGHT = 92;
const DOCK_BOTTOM_MARGIN = 6;
const ITEM_W = 54;
const MENU_W = 60;
const DOCK_PAD = 24;
const RUN_SEP_W = 10;
const SIDE_MARGIN = 80; // 两侧放大余量

function dockBounds(pinnedCount, runningCount) {
  const { workArea } = screen.getPrimaryDisplay();
  let contentW = MENU_W + pinnedCount * ITEM_W;
  if (runningCount > 0) contentW += RUN_SEP_W + runningCount * ITEM_W;
  contentW += DOCK_PAD;
  contentW = Math.max(contentW, pinnedCount ? 0 : 440); // 空栏提示文字最小宽度
  const w = contentW + SIDE_MARGIN * 2;
  return {
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + workArea.height - DOCK_HEIGHT - DOCK_BOTTOM_MARGIN),
    width: w,
    height: DOCK_HEIGHT,
  };
}

function layoutDock() {
  if (!dockWin) return;
  const cfg = readConfig();
  dockWin.setBounds(dockBounds(cfg.pinned.length, runningApps.length));
}

function createDockWindow() {
  const cfg = readConfig();
  const b = dockBounds(cfg.pinned.length, 0);
  dockWin = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false, // 不置顶：其他应用窗口可以自由覆盖 Dock
    focusable: false, // Dock 不抢焦点，点击不影响当前工作窗口
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dockWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  dockWin.loadFile(path.join(__dirname, 'renderer', 'dock.html'));
  dockWin.on('closed', () => { dockWin = null; });
}

function createLauncherWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 780, H = 480;
  launcherWin = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: Math.round(workArea.y + workArea.height - H - DOCK_HEIGHT - DOCK_BOTTOM_MARGIN - 12),
    width: W,
    height: H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false, // 打开时通过 show()+focus() 自然浮到最前，失焦即收起
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  launcherWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  launcherWin.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
  // 失焦 → 通知渲染层播收回动画，动画结束后由渲染层调 hideLauncher 真正隐藏
  launcherWin.on('blur', () => {
    if (launcherWin && launcherWin.isVisible()) {
      launcherWin.webContents.send('request-exit');
    }
  });
  launcherWin.on('closed', () => { launcherWin = null; });
}

function toggleLauncher() {
  if (!launcherWin) return;
  if (launcherWin.isVisible()) {
    launcherWin.webContents.send('request-exit');
  } else {
    appsCache = scanDesktopApps(); // 每次打开刷新列表，保证新装应用能出现
    launcherWin.webContents.send('apps-changed', appsCache);
    launcherWin.show();
    launcherWin.focus();
  }
}

// 固定项扩展信息：附带解析后的真实目标，用于"正在运行"小圆点
function pinnedWithTargets() {
  return readConfig().pinned.map((p) => ({ path: p, target: resolveLink(p).target }));
}

function broadcastPinned() {
  const data = pinnedWithTargets();
  layoutDock();
  if (dockWin) dockWin.webContents.send('pinned-changed', data);
  if (launcherWin && launcherWin.isVisible()) {
    launcherWin.webContents.send('pinned-changed', data);
  }
}

// ---------- IPC ----------
ipcMain.handle('get-apps', () => {
  if (!appsCache) appsCache = scanDesktopApps();
  return appsCache;
});

ipcMain.handle('get-icon', async (_e, appPath) => getIconDataURL(appPath));

ipcMain.handle('get-pinned', () => pinnedWithTargets());

ipcMain.handle('get-running', () => runningApps);

ipcMain.handle('launch', async (_e, appPath) => {
  try {
    const err = await shell.openPath(appPath);
    return !err;
  } catch {
    return false;
  }
});

// 切换到正在运行的应用窗口：原生 helper exe（~50ms），失败回退 ps1 脚本
ipcMain.handle('focus-window', (_e, handle, pid) => {
  return new Promise((resolve) => {
    const ps1 = FOCUS_PS1;
    const runPs1 = () => {
      execFile('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', ps1, String(handle), String(pid || ''),
      ], { windowsHide: true }, (err) => resolve(!err));
    };
    if (fs.existsSync(HELPER_EXE)) {
      execFile(HELPER_EXE, ['focus', String(handle)], { windowsHide: true }, (err) => {
        if (!err) resolve(true);
        else runPs1(); // helper 失败（如权限问题）→ ps1 兜底
      });
    } else {
      runPs1();
    }
  });
});

ipcMain.handle('pin', (_e, appPath) => {
  const cfg = readConfig();
  if (!cfg.pinned.includes(appPath)) {
    cfg.pinned.push(appPath);
    writeConfig(cfg);
  }
  broadcastPinned();
});

ipcMain.handle('unpin', (_e, appPath) => {
  const cfg = readConfig();
  cfg.pinned = cfg.pinned.filter((p) => p !== appPath);
  writeConfig(cfg);
  broadcastPinned();
});

ipcMain.on('toggle-launcher', toggleLauncher);

ipcMain.on('hide-launcher', () => {
  if (launcherWin && launcherWin.isVisible()) launcherWin.hide();
});

// 切换 Windows 任务栏自动隐藏（让 Dock 成为底部主入口，可随时恢复）
function setTaskbarHidden(hidden) {
  execFile('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', TASKBAR_PS1, hidden ? 'hide' : 'show',
  ], { windowsHide: true }, () => { /* 忽略结果 */ });
}

ipcMain.on('dock-menu', () => {
  const menu = Menu.buildFromTemplate([
    {
      label: '重新扫描应用',
      click: () => {
        appsCache = scanDesktopApps();
        iconCache.clear();
        linkTargetCache.clear();
        if (launcherWin && launcherWin.isVisible()) {
          launcherWin.webContents.send('apps-changed', appsCache);
        }
      },
    },
    { type: 'separator' },
    { label: '隐藏 Windows 任务栏', click: () => setTaskbarHidden(true) },
    { label: '显示 Windows 任务栏', click: () => setTaskbarHidden(false) },
    { type: 'separator' },
    { label: '退出 Dock', click: () => app.exit(0) },
  ]);
  menu.popup({ window: dockWin });
});

// ---------- 生命周期 ----------
app.whenReady().then(() => {
  initIconCacheDir(); // 初始化图标缓存目录（打包后写到 userData，并复制随包预置缓存）
  // 开机自启动：打包后 execPath 即自身 exe；dev 模式需把应用路径作为参数传给 electron.exe
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [] });
  } else {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [app.getAppPath()] });
  }
  initConfigIfNeeded();
  repairPinned(); // 修复因桌面快捷方式被删而失效的固定项
  createDockWindow();
  createLauncherWindow();
  pollRunningApps();
  setInterval(pollRunningApps, 5000); // 每 5 秒刷新运行中应用（平衡实时性与性能）

  // 分辨率/缩放变化时重新居中
  screen.on('display-metrics-changed', layoutDock);
});

app.on('window-all-closed', () => {
  // 两个窗口都关闭时退出（正常不会触发，Dock 常驻）
  app.quit();
});
