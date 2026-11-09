# Texterkennung mit der eingebauten Windows-OCR (Windows.Media.Ocr), englisch.
# Läuft dauerhaft: liest pro Zeile einen Bildpfad von stdin und schreibt pro Bild
# eine JSON-Zeile mit allen Wörtern und ihren Positionen auf stdout.
#   {"words":[{"t":"Ash","x":10,"y":20,"w":30,"h":12}, ...]}   oder   {"error":"..."}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
    Select-Object -First 1

function Await($op, [Type]$type) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }

# "FG" statt eines Pfads: Name des Programms im Vordergrund (für die Alt-Tab-Erkennung)
Add-Type -Namespace Native -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
'@

while ($true) {
    $path = [Console]::In.ReadLine()
    if ($null -eq $path) { break }
    if ($path.Trim() -eq '') { continue }
    if ($path.Trim() -eq 'FG') {
        $fgPid = [uint32]0
        $null = [Native.User32]::GetWindowThreadProcessId([Native.User32]::GetForegroundWindow(), [ref]$fgPid)
        $name = try { (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch { '' }
        [Console]::Out.WriteLine((@{ fg = $name } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
        continue
    }
    try {
        $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
        $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $words = foreach ($line in $result.Lines) {
            foreach ($w in $line.Words) {
                $r = $w.BoundingRect
                [ordered]@{ t = $w.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
            }
        }
        $stream.Dispose()
        $bitmap.Dispose()
        [Console]::Out.WriteLine((@{ words = @($words) } | ConvertTo-Json -Compress -Depth 4))
    } catch {
        [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
    [Console]::Out.Flush()
}
