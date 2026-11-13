using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Drawing;
using System.Text;
using System.Windows.Forms;
using System.Threading.Tasks;
using System.Security.Cryptography;

class Installer : Form {
    TextBox appPath, log; Button install, choose; CheckBox launch;
    const string PluginVersion = "__PLUGIN_VERSION__";
    static string Quote(string s) { return "\"" + s.Replace("\"", "") + "\""; }
    static string Extract() {
        string dir = Path.Combine(Path.GetTempPath(), "YuanchuangPlugin", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (ZipArchive zip = new ZipArchive(resource, ZipArchiveMode.Read)) {
            foreach (ZipArchiveEntry entry in zip.Entries) {
                string dest = Path.GetFullPath(Path.Combine(dir, entry.FullName));
                if (!dest.StartsWith(dir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("安装资源路径无效。");
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                entry.ExtractToFile(dest);
            }
        }
        return dir;
    }
    static int Run(string dir, string args, Action<string> onLine) {
        string ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        if (!Environment.Is64BitProcess && Environment.Is64BitOperatingSystem) ps = ps.Replace("System32", "Sysnative");
        ProcessStartInfo start = new ProcessStartInfo(ps, "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(Path.Combine(dir, "install-offline.ps1")) + " " + args);
        start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8;
        using (Process p = new Process()) {
            p.StartInfo = start;
            p.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) onLine(e.Data); };
            p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) onLine(e.Data); };
            p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine(); p.WaitForExit(); return p.ExitCode;
        }
    }
    Installer() {
        Text = "元创插件一键安装 · " + PluginVersion; ClientSize = new Size(690, 450);
        Font = new Font("Microsoft YaHei UI", 10); StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        Controls.Add(new Label { Text = "元创生图插件 · 安装与更新", Font = new Font(Font.FontFamily, 18, FontStyle.Bold), Location = new Point(24, 20), AutoSize = true });
        Controls.Add(new Label { Text = "版本 " + PluginVersion, Location = new Point(26, 62), AutoSize = true });
        Controls.Add(new Label { Text = "请先从 DSH「应用 → 退出」退出主程序，再点击安装。", Location = new Point(26, 96), AutoSize = true });
        Controls.Add(new Label { Text = "自动识别主程序；如未找到，可在下方选择 DeepSeek Harness.exe。", Location = new Point(26, 124), AutoSize = true });
        appPath = new TextBox { Location = new Point(26, 156), Size = new Size(503, 29) }; Controls.Add(appPath);
        choose = new Button { Text = "选择主程序", Location = new Point(542, 154), Size = new Size(120, 32) }; Controls.Add(choose);
        choose.Click += delegate {
            using (OpenFileDialog dialog = new OpenFileDialog { Filter = "DeepSeek Harness|DeepSeek Harness.exe", Title = "选择 DSH 主程序" }) {
                if (dialog.ShowDialog() == DialogResult.OK) appPath.Text = dialog.FileName;
            }
        };
        launch = new CheckBox { Text = "安装成功后打开 DeepSeek Harness", Checked = true, Location = new Point(26, 200), AutoSize = true }; Controls.Add(launch);
        install = new Button { Text = "安装 / 更新", Location = new Point(472, 194), Size = new Size(190, 40), BackColor = Color.FromArgb(45, 110, 210), ForeColor = Color.White, FlatStyle = FlatStyle.Flat }; Controls.Add(install);
        log = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Location = new Point(26, 250), Size = new Size(636, 170), BackColor = Color.White };
        log.Text = "就绪。点击「安装 / 更新」即可开始。\r\n已有项目、图片和设置会保留。"; Controls.Add(log);
        install.Click += async delegate {
            install.Enabled = false; choose.Enabled = false; appPath.Enabled = false;
            string args = "-ResultFile " + Quote(Path.Combine(Path.GetTempPath(), "yuanchuang-install-" + Guid.NewGuid().ToString("N") + ".json"));
            if (appPath.Text.Trim().Length > 0) args += " -AppPath " + Quote(appPath.Text.Trim());
            if (!launch.Checked) args += " -NoLaunch";
            log.Clear(); string dir = null;
            try {
                dir = Extract();
                int code = await Task.Run(() => Run(dir, args, line => { if (!IsDisposed) BeginInvoke((Action)(() => log.AppendText(line + "\r\n"))); }));
                log.AppendText(code == 0 ? "\r\n完成。进入主程序的「生图」查看插件。" : "\r\n请按上方提示处理后重新安装。");
                install.Text = code == 0 ? "重新安装" : "重试安装";
            } catch (Exception ex) { log.AppendText("安装未完成：" + ex.Message); }
            finally { install.Enabled = true; choose.Enabled = true; appPath.Enabled = true; if (dir != null) { try { Directory.Delete(dir, true); } catch {} } }
        };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!install.Enabled) { e.Cancel = true; log.AppendText("安装正在进行，请等待完成。\r\n"); } };
    }
    [STAThread] static int Main(string[] args) {
        if (Array.IndexOf(args, "--silent") >= 0 || Array.IndexOf(args, "--extract") >= 0) {
            string dir = null;
            try {
                dir = Extract();
                if (Array.IndexOf(args, "--extract") >= 0) { File.WriteAllText(args[1], dir, Encoding.UTF8); return 0; }
                string parameters = "";
                for (int i = 0; i < args.Length; i++) {
                    if (args[i] == "--app") parameters += " -AppPath " + Quote(args[++i]);
                    else if (args[i] == "--data") parameters += " -DataDirectory " + Quote(args[++i]);
                    else if (args[i] == "--result") parameters += " -ResultFile " + Quote(args[++i]);
                    else if (args[i] == "--no-launch") parameters += " -NoLaunch";
                    else if (args[i] == "--check") parameters += " -CheckOnly";
                }
                return Run(dir, parameters, delegate(string line) {});
            } catch { return 1; }
            finally { if (dir != null && Array.IndexOf(args, "--extract") < 0) { try { Directory.Delete(dir, true); } catch {} } }
        }
        try {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new Installer()); return 0;
        } catch (Exception ex) {
            MessageBox.Show("安装器无法启动：" + ex.Message, "元创插件安装器", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
