using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class DockHelper
{
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr hIcon);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

    [DllImport("shell32.dll", EntryPoint = "#727")]
    static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IMAGELISTDRAWPARAMS
    {
        public int cbSize;
        public IntPtr himl;
        public int i;
        public IntPtr hdcDst;
        public int x, y, cx, cy, xBitmap, yBitmap;
        public int rgbBk, rgbFg, fStyle, dwRop, fState, Frame, crEffect;
    }

    [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IImageList
    {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, ref int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, ref int piF);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, ref int pi);
        [PreserveSig] int Draw(ref IMAGELISTDRAWPARAMS pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, out IntPtr picon);
    }

    const uint SHGFI_ICON = 0x000000100;
    const uint SHGFI_SYSICONINDEX = 0x000004000;
    const int SHIL_EXTRALARGE = 2; // 48x48
    const int SHIL_JUMBO = 4;      // 256x256

    static bool Focus(long hwndLong)
    {
        IntPtr hwnd = new IntPtr(hwndLong);
        // SW_RESTORE = 9 (restore minimized window)
        ShowWindowAsync(hwnd, 9);
        bool ok = false;
        IntPtr fg = GetForegroundWindow();
        if (fg != IntPtr.Zero)
        {
            uint fgPid;
            uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
            uint curThread = GetCurrentThreadId();
            if (fgThread != 0 && fgThread != curThread)
            {
                AttachThreadInput(curThread, fgThread, true);
                BringWindowToTop(hwnd);
                ok = SetForegroundWindow(hwnd);
                AttachThreadInput(curThread, fgThread, false);
            }
        }
        if (!ok)
        {
            BringWindowToTop(hwnd);
            ok = SetForegroundWindow(hwnd);
        }
        return ok;
    }

    // Hi-res icon via SHGetImageList (JUMBO 256px, fallback EXTRALARGE 48px)
    static bool ExtractIconHiRes(string path, string outPath)
    {
        SHFILEINFO info = new SHFILEINFO();
        IntPtr res = SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_ICON | SHGFI_SYSICONINDEX);
        if (info.hIcon != IntPtr.Zero) DestroyIcon(info.hIcon);
        if (res == IntPtr.Zero) return false;
        Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
        int[] lists = { SHIL_JUMBO, SHIL_EXTRALARGE };
        foreach (int il in lists)
        {
            IImageList iml;
            int hr1 = SHGetImageList(il, ref iid, out iml);
            if (hr1 != 0 || iml == null) continue;
            IntPtr hIcon;
            int hr2 = iml.GetIcon(info.iIcon, 0, out hIcon);
            if (hr2 != 0 || hIcon == IntPtr.Zero) continue;
            try
            {
                using (Icon ic = Icon.FromHandle(hIcon))
                using (Bitmap bmp = ic.ToBitmap())
                {
                    bmp.Save(outPath, ImageFormat.Png);
                }
                return true;
            }
            finally
            {
                DestroyIcon(hIcon);
            }
        }
        return false;
    }

    static bool ExtractIcon(string path, string outPath)
    {
        // Plan A: hi-res via SHGetImageList
        try
        {
            if (ExtractIconHiRes(path, outPath)) return true;
        }
        catch { /* fall through to plan B */ }
        // Plan B: .NET built-in ExtractAssociatedIcon (32px)
        try
        {
            using (Icon ic = Icon.ExtractAssociatedIcon(path))
            {
                if (ic != null)
                {
                    using (Bitmap bmp = ic.ToBitmap())
                    {
                        bmp.Save(outPath, ImageFormat.Png);
                    }
                    return true;
                }
            }
        }
        catch { /* fall through to plan C */ }
        // Plan C: plain SHGetFileInfo icon
        SHFILEINFO info = new SHFILEINFO();
        IntPtr res = SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_ICON);
        if (res == IntPtr.Zero || info.hIcon == IntPtr.Zero) return false;
        try
        {
            using (Icon ic = Icon.FromHandle(info.hIcon))
            using (Bitmap bmp = ic.ToBitmap())
            {
                bmp.Save(outPath, ImageFormat.Png);
            }
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            DestroyIcon(info.hIcon);
        }
    }

    public static int Main(string[] args)
    {
        if (args.Length < 1) return 2;
        try
        {
            if (args[0] == "focus" && args.Length >= 2)
                return Focus(long.Parse(args[1])) ? 0 : 1;
            if (args[0] == "icon" && args.Length >= 3)
                return ExtractIcon(args[1], args[2]) ? 0 : 1;
            return 2;
        }
        catch
        {
            return 1;
        }
    }
}
