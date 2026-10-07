# Tiny static file server (no dependencies) for previewing the journal over http.
param(
    [int]$Port = 8731,
    [string]$Root = (Split-Path $PSScriptRoot -Parent)
)

$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://127.0.0.1:$Port/ (Ctrl+C to stop)"

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
        $path = Join-Path $Root $rel
        if ((Test-Path $path -PathType Leaf) -and $path.StartsWith($Root)) {
            $ext = [IO.Path]::GetExtension($path).ToLower()
            $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
            $bytes = [IO.File]::ReadAllBytes($path)
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
        $ctx.Response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
