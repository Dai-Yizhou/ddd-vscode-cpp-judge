# C++ Runner Help

## Basic Usage

1. Open a C++ source file (.cpp).
2. Enter test data in the "Input" column, or enter expected output in the "Expected Output" column.
3. Click the "Run" button (or press Ctrl+Shift+R / Cmd+Shift+R) to compile and run.
4. Results will appear in the "Actual Output" column. If expected output is set, differences will be highlighted automatically.

## Soft Limits

- The "Time" (ms) and "Mem" (MB) fields in the toolbar set soft limits. 0 means no limit.
- Soft limits do not force-terminate the program. They only mark the status as TLE/MLE when exceeded.
- Hard limits are system-enforced (default: 60s time, 4GB memory). Exceeding them force-terminates the process and shows TLE!/MLE!.

## File Input/Output

- **Drag** .in/.txt files into the input column, or click the "Load File" button to select a file. Both methods work identically.
- Large files (>1MB): Only the first 64KB is loaded as a read-only preview (labeled "Large file preview, full content read at runtime"). The full content is used during execution without UI lag.
- Small files (≤1MB): Fully loaded and editable in the text area.
- If the program uses freopen/fopen/fstream for file I/O, the extension auto-detects it:
  - Before running, panel input is written to the program's expected input file.
  - After running, results are read from the program's output file for display and comparison.

## stderr / cerr / clog Output

- cerr / clog / stderr output is always shown in the "stderr" tab.
- When stderr output exists, the tab shows a red "!" badge.
- Compilation errors are also displayed in the stderr tab.

## Performance Conversion

- After running, the equivalent runtime on target judge machines is shown (based on GeekBench 6 single-core scores).
- Judge machine parameters (source: Luogu chen_zhe 2025-06-01: [https://www.luogu.com.cn/article/f3bqyl4w](https://www.luogu.com.cn/article/f3bqyl4w) or [https://www.luogu.me/article/f3bqyl4w](https://www.luogu.me/article/f3bqyl4w)):
  - Luogu: Intel Xeon Platinum 8369HC (GB6 single-core ~1472)
  - CCF 2025 CSP-S: Intel Core Ultra 9 285K (GB6 single-core ~2150)
    Note: CCF updated judge machines. 2018-2024 used i7-8700K (GB6 ~1614). From 2025 CSP-S, switched to Core Ultra 9 285K (source: Luogu chen_zhe 2025-02-25: [https://www.luogu.com.cn/article/csoig4zt](https://www.luogu.com.cn/article/csoig4zt) or [https://www.luogu.me/article/csoig4zt](https://www.luogu.me/article/csoig4zt)).
- Recommended: manually set your device's GeekBench 6 score in settings for more accurate conversion (cppRunner.userDeviceGeekbenchScore).
- Look up device scores: [https://browser.geekbench.com](https://browser.geekbench.com)

## Compilation Options

- The toolbar allows quick switching of C++ standard, optimization level, and warning level.
- Changes are automatically saved to settings.json and restored on next open.
- When warning level is set to "custom", configure warning flags in the settings page.

## Settings

- Click the "Settings" button (gear icon) in the title bar to open the visual settings page.
- Configurable options include: compiler path, C++ standard, optimization level, warning flags, performance baseline, etc.

## Keyboard Shortcuts

All shortcuts can be customized in VS Code's "Keyboard Shortcuts" (Ctrl+K Ctrl+S):

- Open Runner Panel: Ctrl+Alt+R / Cmd+Alt+R
- Compile and Run (editor): Ctrl+Shift+R / Cmd+Shift+R
- Run in panel: Ctrl+Enter (customizable via cppRunner.panelRunKey)
- Open Input Panel: Alt+I
- Load Input File: Alt+L
- Set Expected Output: Alt+E
- Clear Input/Expected: Alt+C
- Set Compile Options: Alt+O
- Set Warning Level: Alt+W
- Open Settings: Alt+S

## Run Status

- AC: Finished normally with matching output (or no expected output set)
- WA: Ran successfully but output does not match
- RE: Runtime error (non-zero exit code or crash)
- TLE: Exceeded soft time limit (advisory, no force-termination)
- TLE!: Exceeded hard time limit (system-enforced, default 60s, force-terminated)
- MLE: Exceeded soft memory limit (advisory, no force-termination)
- MLE!: Exceeded hard memory limit (system-enforced, default 4GB, force-terminated)
- CE: Compilation error, compiler messages shown in stderr tab
