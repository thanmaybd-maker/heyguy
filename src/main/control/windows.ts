// Windows desktop automation and user takeover detection.
// Integrates Windows UI Automation / process queries and guarded input injection
// with immediate user takeover detection.
import { screen } from 'electron';
import { exec } from 'node:child_process';
import type { WindowInfo } from '../../shared/types';

const execAsync = (cmd: string): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 6000 }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });

export class WindowsController {
  private lastSyntheticPoint = { x: -1, y: -1 };
  private activeLease = false;
  private takeoverCallback: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastUserCursor = { x: -1, y: -1 };

  constructor() {}

  /** Inspect active foreground window using PowerShell Win32 APIs */
  async getActiveWindow(): Promise<WindowInfo | null> {
    if (process.platform !== 'win32') {
      return {
        handle: '0x0',
        title: 'Mock Foreground Window (Non-Windows)',
        processName: 'test.exe',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      };
    }

    const script = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  }
"@
$hwnd = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][Win32]::GetWindowText($hwnd, $sb, 256)
$pidOut = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pidOut)
$proc = (Get-Process -Id $pidOut -ErrorAction SilentlyContinue).ProcessName
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
"$($hwnd.ToInt64())|$($sb.ToString())|$proc|$($rect.Left),$($rect.Top),$w,$h"
`;

    try {
      const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/\r?\n/g, ' ')}"`);
      const parts = stdout.trim().split('|');
      if (parts.length >= 4) {
        const [x, y, w, h] = parts[3]!.split(',').map(Number);
        return {
          handle: parts[0]!,
          title: parts[1] || 'Desktop',
          processName: parts[2] || 'unknown',
          bounds: { x: x || 0, y: y || 0, width: w || 800, height: h || 600 },
        };
      }
    } catch {
      // fallback
    }
    return null;
  }

  /** Acquire desktop control lease with immediate user takeover monitoring */
  acquireControlLease(onTakeover: () => void): boolean {
    if (this.activeLease) return false;
    this.activeLease = true;
    this.takeoverCallback = onTakeover;
    this.lastUserCursor = screen.getCursorScreenPoint();

    this.pollTimer = setInterval(() => {
      const cur = screen.getCursorScreenPoint();
      // If cursor moved and did not match our synthetic coordinates
      const dist = Math.hypot(cur.x - this.lastUserCursor.x, cur.y - this.lastUserCursor.y);
      const isSynthetic = Math.hypot(cur.x - this.lastSyntheticPoint.x, cur.y - this.lastSyntheticPoint.y) < 4;
      if (dist > 16 && !isSynthetic) {
        this.releaseControlLease();
        this.takeoverCallback?.();
      }
      this.lastUserCursor = cur;
    }, 25);

    return true;
  }

  releaseControlLease(): void {
    this.activeLease = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.takeoverCallback = null;
  }

  /** Guarded mouse click with synthetic tag */
  async click(x: number, y: number): Promise<boolean> {
    if (!this.activeLease) return false;
    this.lastSyntheticPoint = { x, y };

    if (process.platform !== 'win32') return true;

    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Mouse {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
  }
"@
[Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 40
[Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
`;
    try {
      await execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/\r?\n/g, ' ')}"`);
      return true;
    } catch {
      return false;
    }
  }

  /** Guarded keyboard typing with synthetic tag */
  async type(text: string): Promise<boolean> {
    if (!this.activeLease) return false;
    if (process.platform !== 'win32') return true;

    const escaped = text.replace(/[{}+^%~()\[\]]/g, '{$&}');
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${escaped.replace(/"/g, '`"')}")
`;
    try {
      await execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/\r?\n/g, ' ')}"`);
      return true;
    } catch {
      return false;
    }
  }
}
