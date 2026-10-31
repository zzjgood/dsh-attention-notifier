$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$cardSource = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.IO;

public class AttnCard : Form
{
    public string TitleText = "";
    public string BodyText = "";
    public string HintText = "";
    public string TipText = "";
    public string FocusUrl = "";
    public string VbsPath = "";
    public string ImagePath = "";
    public Color Accent = Color.FromArgb(76, 141, 255);
    public string Glyph = "?";
    public int TimeoutSeconds = 60;
    public string FontFamily = "Microsoft YaHei UI";

    private const int ShadowMargin = 14;
    private const int CardWidth = 252;
    private const int CardHeight = 200;

    private Image badgeImage;
    private bool hover;
    private bool nearButton;
    private bool nearClose;
    private DateTime started = DateTime.UtcNow;
    private Timer fadeTimer;
    private Timer tickTimer;
    private int currentAlpha = 255;

    public AttnCard()
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        Text = "DeepSeek Harness";
        Size = new Size(CardWidth + ShadowMargin * 2, CardHeight + ShadowMargin * 2);
        BackColor = Color.Black;
        DoubleBuffered = true;
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x00080000; // WS_EX_LAYERED
            return cp;
        }
    }

    private Rectangle CardRect
    {
        get { return new Rectangle(ShadowMargin, ShadowMargin, CardWidth, CardHeight); }
    }

    private Rectangle ButtonRect
    {
        get { return new Rectangle(CardRect.X + 16, CardRect.Y + 124, CardWidth - 32, 34); }
    }

    private Rectangle CloseRect
    {
        get { return new Rectangle(CardRect.Right - 42, CardRect.Y + 10, 30, 30); }
    }

    private static GraphicsPath RoundRect(Rectangle bounds, int radius)
    {
        int d = radius * 2;
        GraphicsPath path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static Color Shade(Color color, int amount)
    {
        return Color.FromArgb(
            color.A,
            Math.Max(0, Math.Min(255, color.R + amount)),
            Math.Max(0, Math.Min(255, color.G + amount)),
            Math.Max(0, Math.Min(255, color.B + amount)));
    }

    // ---- layered-window plumbing ----

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE { public int CX; public int CY; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BLENDFUNCTION
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);
    [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(
        IntPtr hWnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
        IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

    private const int ULW_ALPHA = 2;
    private const byte AC_SRC_OVER = 0;
    private const byte AC_SRC_ALPHA = 1;

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    // Only the newest attention card stays on screen: ask older cards to close
    // before this one is created.
    public static void CloseExistingCards()
    {
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            System.Text.StringBuilder title = new System.Text.StringBuilder(256);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.ToString() != "DeepSeek Harness") return true;
            System.Text.StringBuilder cls = new System.Text.StringBuilder(256);
            GetClassName(hWnd, cls, cls.Capacity);
            if (!cls.ToString().StartsWith("WindowsForms10")) return true;
            PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
            return true;
        }, IntPtr.Zero);
    }

    private void ApplyLayered(Bitmap bitmap)
    {
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memoryDc = CreateCompatibleDC(screenDc);
        IntPtr hBitmap = IntPtr.Zero;
        IntPtr oldBitmap = IntPtr.Zero;
        try
        {
            hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
            oldBitmap = SelectObject(memoryDc, hBitmap);
            SIZE size = new SIZE { CX = Width, CY = Height };
            POINT source = new POINT { X = 0, Y = 0 };
            POINT destination = new POINT { X = Left, Y = Top };
            BLENDFUNCTION blend = new BLENDFUNCTION
            {
                BlendOp = AC_SRC_OVER,
                BlendFlags = 0,
                SourceConstantAlpha = (byte)Math.Max(0, Math.Min(255, currentAlpha)),
                AlphaFormat = AC_SRC_ALPHA,
            };
            UpdateLayeredWindow(Handle, screenDc, ref destination, ref size, memoryDc, ref source, 0, ref blend, ULW_ALPHA);
        }
        finally
        {
            if (hBitmap != IntPtr.Zero)
            {
                SelectObject(memoryDc, oldBitmap);
                DeleteObject(hBitmap);
            }
            DeleteDC(memoryDc);
            ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    private void Render()
    {
        using (Bitmap bitmap = new Bitmap(Width, Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bitmap))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
                DrawShadow(g);
                DrawCard(g);
            }
            ApplyLayered(bitmap);
        }
    }

    private void DrawShadow(Graphics g)
    {
        Rectangle card = CardRect;
        for (int i = ShadowMargin; i >= 1; i--)
        {
            int alpha = 4 + (ShadowMargin - i) / 2;
            using (GraphicsPath path = RoundRect(new Rectangle(card.X - i, card.Y - i + 3, card.Width + i * 2, card.Height + i * 2), 14 + i))
            using (SolidBrush brush = new SolidBrush(Color.FromArgb(alpha, 0, 0, 0)))
            {
                g.FillPath(brush, path);
            }
        }
    }

    private void DrawCard(Graphics g)
    {
        Rectangle card = CardRect;
        using (GraphicsPath path = RoundRect(card, 14))
        {
            Color top = hover ? Color.FromArgb(45, 47, 52) : Color.FromArgb(37, 39, 43);
            Color bottom = hover ? Color.FromArgb(32, 33, 37) : Color.FromArgb(25, 26, 29);
            using (LinearGradientBrush brush = new LinearGradientBrush(new Rectangle(card.X, card.Y, card.Width, card.Height + 1), top, bottom, LinearGradientMode.Vertical))
            {
                g.FillPath(brush, path);
            }
            using (GraphicsPath inner = RoundRect(new Rectangle(card.X + 1, card.Y + 1, card.Width - 2, card.Height - 2), 13))
            using (Pen highlight = new Pen(Color.FromArgb(20, 255, 255, 255), 1f))
            {
                g.DrawPath(highlight, inner);
            }
            using (Pen pen = new Pen(hover ? Color.FromArgb(114, 120, 129) : Color.FromArgb(74, 78, 85), 1f))
            {
                g.DrawPath(pen, path);
            }
        }

        Rectangle badge = new Rectangle(card.X + 16, card.Y + 16, 38, 38);
        using (SolidBrush badgeFill = new SolidBrush(Color.FromArgb(36, Accent)))
        {
            g.FillEllipse(badgeFill, badge);
        }
        using (Pen badgePen = new Pen(Color.FromArgb(130, Accent), 1.4f))
        {
            g.DrawEllipse(badgePen, badge);
        }
        DrawBadge(g, badge);

        int textLeft = card.X + 66;
        int textWidth = card.Width - 66 - 44;
        using (Font titleFont = new Font(FontFamily, 10.5f, FontStyle.Bold, GraphicsUnit.Point))
        using (SolidBrush titleBrush = new SolidBrush(Color.FromArgb(241, 243, 246)))
        using (StringFormat titleFormat = new StringFormat())
        {
            titleFormat.Trimming = StringTrimming.EllipsisCharacter;
            titleFormat.FormatFlags = StringFormatFlags.NoWrap;
            g.DrawString(TitleText, titleFont, titleBrush, new RectangleF(textLeft, card.Y + 22, textWidth, 24), titleFormat);
        }

        using (Font bodyFont = new Font(FontFamily, 9f, FontStyle.Regular, GraphicsUnit.Point))
        using (SolidBrush bodyBrush = new SolidBrush(Color.FromArgb(176, 181, 190)))
        using (StringFormat bodyFormat = new StringFormat())
        {
            bodyFormat.Trimming = StringTrimming.EllipsisCharacter;
            bodyFormat.FormatFlags = StringFormatFlags.LineLimit;
            g.DrawString(BodyText, bodyFont, bodyBrush, new RectangleF(card.X + 16, card.Y + 62, card.Width - 32, 56), bodyFormat);
        }

        Rectangle buttonRect = ButtonRect;
        using (GraphicsPath buttonPath = RoundRect(buttonRect, 8))
        using (SolidBrush buttonBrush = new SolidBrush(nearButton ? Shade(Accent, 28) : Accent))
        {
            g.FillPath(buttonBrush, buttonPath);
        }
        using (Font buttonFont = new Font(FontFamily, 9f, FontStyle.Bold, GraphicsUnit.Point))
        using (StringFormat centered = new StringFormat())
        using (SolidBrush buttonText = new SolidBrush(Color.FromArgb(255, 255, 255)))
        {
            centered.Alignment = StringAlignment.Center;
            centered.LineAlignment = StringAlignment.Center;
            g.DrawString(HintText, buttonFont, buttonText, buttonRect, centered);
        }

        using (Font tipFont = new Font(FontFamily, 8f, FontStyle.Regular, GraphicsUnit.Point))
        using (SolidBrush tipBrush = new SolidBrush(Color.FromArgb(126, 132, 141)))
        using (StringFormat tipFormat = new StringFormat())
        {
            tipFormat.Alignment = StringAlignment.Center;
            tipFormat.LineAlignment = StringAlignment.Center;
            g.DrawString(TipText, tipFont, tipBrush, new RectangleF(card.X + 12, card.Y + 164, card.Width - 24, 18), tipFormat);
        }

        Rectangle closeRect = CloseRect;
        using (Font closeFont = new Font("Segoe UI", 12f, FontStyle.Regular, GraphicsUnit.Point))
        using (StringFormat closeFormat = new StringFormat())
        using (SolidBrush closeBrush = new SolidBrush(nearClose ? Color.FromArgb(235, 238, 242) : Color.FromArgb(108, 114, 123)))
        {
            closeFormat.Alignment = StringAlignment.Center;
            closeFormat.LineAlignment = StringAlignment.Center;
            g.DrawString(((char)0x00D7).ToString(), closeFont, closeBrush, closeRect, closeFormat);
        }

        int trackLeft = card.X + 18;
        int trackWidth = card.Width - 36;
        int trackTop = card.Bottom - 7;
        double remaining = 1.0;
        if (TimeoutSeconds > 0)
        {
            double elapsed = (DateTime.UtcNow - started).TotalSeconds;
            remaining = Math.Max(0.0, 1.0 - elapsed / TimeoutSeconds);
        }
        using (Pen trackPen = new Pen(Color.FromArgb(54, 57, 63), 2f))
        {
            trackPen.StartCap = LineCap.Round;
            trackPen.EndCap = LineCap.Round;
            g.DrawLine(trackPen, trackLeft, trackTop, trackLeft + trackWidth, trackTop);
        }
        if (remaining > 0.01)
        {
            using (Pen fillPen = new Pen(Color.FromArgb(170, Accent), 2f))
            {
                fillPen.StartCap = LineCap.Round;
                fillPen.EndCap = LineCap.Round;
                g.DrawLine(fillPen, trackLeft, trackTop, trackLeft + (int)(trackWidth * remaining), trackTop);
            }
        }
    }

    private void DrawBadge(Graphics g, Rectangle badge)
    {
        if (badgeImage == null && !string.IsNullOrEmpty(ImagePath) && File.Exists(ImagePath))
        {
            try
            {
                badgeImage = Image.FromFile(ImagePath);
            }
            catch
            {
                badgeImage = null;
            }
        }
        if (badgeImage != null)
        {
            // Tint the mascot silhouette to the state color so one artwork reads
            // as blue (question), amber (approval), green (done) or red (error).
            ColorMatrix matrix = new ColorMatrix(new float[][]
            {
                new float[] { 0, 0, 0, 0, Accent.R / 255f },
                new float[] { 0, 0, 0, 0, Accent.G / 255f },
                new float[] { 0, 0, 0, 0, Accent.B / 255f },
                new float[] { 0, 0, 0, 1, 0 },
                new float[] { 0, 0, 0, 0, 1 },
            });
            using (ImageAttributes attributes = new ImageAttributes())
            {
                attributes.SetColorMatrix(matrix, ColorMatrixFlag.Default, ColorAdjustType.Bitmap);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawImage(
                    badgeImage,
                    new Rectangle(badge.X + 3, badge.Y + 3, badge.Width - 6, badge.Height - 6),
                    0, 0, badgeImage.Width, badgeImage.Height,
                    GraphicsUnit.Pixel,
                    attributes);
            }
            return;
        }
        using (Font glyphFont = new Font("Segoe UI", 16f, FontStyle.Bold, GraphicsUnit.Point))
        using (StringFormat centered = new StringFormat())
        using (SolidBrush glyphBrush = new SolidBrush(Accent))
        {
            centered.Alignment = StringAlignment.Center;
            centered.LineAlignment = StringAlignment.Center;
            g.DrawString(Glyph, glyphFont, glyphBrush, badge, centered);
        }
    }

    // ---- interaction ----

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        bool nextNear = ButtonRect.Contains(e.Location);
        bool nextClose = CloseRect.Contains(e.Location);
        if (nextNear != nearButton || nextClose != nearClose || !hover)
        {
            nearButton = nextNear;
            nearClose = nextClose;
            hover = true;
            Render();
        }
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        hover = false;
        nearButton = false;
        nearClose = false;
        Render();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Right || CloseRect.Contains(e.Location))
        {
            Close();
            return;
        }
        if (e.Button == MouseButtons.Left)
        {
            OpenTarget();
        }
    }

    private void OpenTarget()
    {
        try
        {
            if (!string.IsNullOrEmpty(FocusUrl) && !string.IsNullOrEmpty(VbsPath) && File.Exists(VbsPath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "wscript.exe",
                    Arguments = "\"" + VbsPath + "\" \"" + FocusUrl + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
            }
        }
        catch { }
        Close();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        started = DateTime.UtcNow;
        currentAlpha = 0;
        Render();
        fadeTimer = new Timer();
        fadeTimer.Interval = 15;
        fadeTimer.Tick += delegate
        {
            currentAlpha = Math.Min(255, currentAlpha + 48);
            Render();
            if (currentAlpha >= 255)
            {
                fadeTimer.Stop();
                fadeTimer.Dispose();
                fadeTimer = null;
            }
        };
        fadeTimer.Start();
        tickTimer = new Timer();
        tickTimer.Interval = 120;
        tickTimer.Tick += delegate
        {
            if (TimeoutSeconds > 0 && (DateTime.UtcNow - started).TotalSeconds >= TimeoutSeconds)
            {
                Close();
                return;
            }
            Render();
        };
        tickTimer.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (fadeTimer != null) { fadeTimer.Stop(); fadeTimer.Dispose(); fadeTimer = null; }
            if (tickTimer != null) { tickTimer.Stop(); tickTimer.Dispose(); tickTimer = null; }
            if (badgeImage != null) { badgeImage.Dispose(); badgeImage = null; }
        }
        base.Dispose(disposing);
    }
}
'@
Add-Type -TypeDefinition $cardSource -ReferencedAssemblies 'System.Windows.Forms', 'System.Drawing'

# The Host sends every card string in both languages. The language reported by
# the Client wins; until the page has polled once, or with no page at all, the
# Windows UI language decides.
$reported = ([string]$env:DSH_ATTN_LANG).Trim().ToLowerInvariant()
$lang = ''
if ($reported -like 'zh*') { $lang = 'zh' }
elseif ($reported -like 'en*') { $lang = 'en' }
if (-not $lang) {
  $lang = 'en'
  try {
    if ([System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'zh') { $lang = 'zh' }
  } catch {}
}
function Get-AttnText([string]$name) {
  if ($lang -eq 'zh') { $suffix = '_ZH' } else { $suffix = '_EN' }
  $value = [string][Environment]::GetEnvironmentVariable('DSH_ATTN_' + $name + $suffix)
  if (-not $value) { $value = [string][Environment]::GetEnvironmentVariable('DSH_ATTN_' + $name) }
  return $value
}

$kind = [string]$env:DSH_ATTN_KIND
if ($kind -ne 'question' -and $kind -ne 'approval' -and $kind -ne 'error') { $kind = 'done' }
$title = Get-AttnText 'TITLE'
$body = Get-AttnText 'BODY'
$hint = Get-AttnText 'HINT'
$tip = Get-AttnText 'TIP'
$focus = [string]$env:DSH_ATTN_FOCUS
$vbs = [string]$env:DSH_ATTN_VBS
$image = [string]$env:DSH_ATTN_IMAGE
if (-not $image -or -not (Test-Path $image)) {
  $fallbackImage = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\attention-notifier\attn-whale.png'
  if (Test-Path $fallbackImage) { $image = $fallbackImage }
}
$timeout = 60
[void][int]::TryParse([string]$env:DSH_ATTN_TIMEOUT, [ref]$timeout)
if ($timeout -le 0) { $timeout = 60 }
if (-not $title) { $title = 'Attention' }
if (-not $hint) { $hint = 'Open Harness' }
if (-not $tip) { $tip = 'Click card to open - Right-click to close' }

$cardFont = 'Microsoft YaHei UI'
if ($lang -ne 'zh') { $cardFont = 'Segoe UI' }

$accentByKind = @{
  question = [System.Drawing.Color]::FromArgb(76, 141, 255)
  approval = [System.Drawing.Color]::FromArgb(245, 165, 36)
  done = [System.Drawing.Color]::FromArgb(48, 196, 141)
  error = [System.Drawing.Color]::FromArgb(240, 82, 82)
}
$glyphByKind = @{
  question = '?'
  approval = '!'
  done = ([string][char]0x2713)
  error = ([string][char]0x00D7)
}

# Only the newest attention card stays on screen. A named mutex serializes the
# close-then-create window, so two notifications arriving together cannot leave
# two cards; the mutex is released once the new card has been shown.
$mutex = New-Object System.Threading.Mutex($false, 'Local\DeepSeekHarnessAttentionCard')
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(3000)
} catch [System.Threading.AbandonedMutexException] {
  $ownsMutex = $true
} catch {}
if ($ownsMutex) {
  try { [AttnCard]::CloseExistingCards() } catch {}
  Start-Sleep -Milliseconds 80
}

$card = New-Object AttnCard
$card.TitleText = $title
$card.BodyText = $body
$card.HintText = $hint
$card.TipText = $tip
$card.FocusUrl = $focus
$card.VbsPath = $vbs
$card.ImagePath = $image
$card.Accent = $accentByKind[$kind]
$card.Glyph = $glyphByKind[$kind]
$card.TimeoutSeconds = $timeout
$card.FontFamily = $cardFont

$shadowMargin = 14
$cardWidth = 252
$cardHeight = 200
$screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
$area = $screen.WorkingArea
$card.Left = $area.Right - $cardWidth - 18 - $shadowMargin
$card.Top = $area.Bottom - $cardHeight - 18 - $shadowMargin

try {
  switch ($kind) {
    'question' { [System.Media.SystemSounds]::Exclamation.Play() }
    'approval' { [System.Media.SystemSounds]::Hand.Play() }
    'error' { [System.Media.SystemSounds]::Hand.Play() }
    default { [System.Media.SystemSounds]::Asterisk.Play() }
  }
} catch {}

if ($ownsMutex) {
  $card.add_Shown({ try { $mutex.ReleaseMutex() } catch {} })
}
[System.Windows.Forms.Application]::Run($card)
