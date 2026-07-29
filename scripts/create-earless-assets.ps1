param(
  [string]$ProjectRoot = (Get-Location).Path
)

Add-Type -AssemblyName System.Drawing

$publicDir = Join-Path $ProjectRoot "public"
$leftEarPath = Join-Path $publicDir "knopik-ear-left.png"
$rightEarPath = Join-Path $publicDir "knopik-ear-right.png"

function Read-BitmapBytes {
  param([System.Drawing.Bitmap]$Bitmap)

  $rect = [System.Drawing.Rectangle]::new(0, 0, $Bitmap.Width, $Bitmap.Height)
  $data = $Bitmap.LockBits(
    $rect,
    [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $bytes = New-Object byte[] ($data.Stride * $data.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  return @{ Data = $data; Bytes = $bytes }
}

function Write-BitmapBytes {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    $Locked,
    [string]$Destination
  )

  [System.Runtime.InteropServices.Marshal]::Copy(
    $Locked.Bytes,
    0,
    $Locked.Data.Scan0,
    $Locked.Bytes.Length
  )
  $Bitmap.UnlockBits($Locked.Data)
  $Bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Remove-EarRegion {
  param(
    [byte[]]$BaseBytes,
    [int]$BaseStride,
    [int]$FrameOffset,
    [int]$FrameWidth,
    [int]$FrameHeight,
    [byte[]]$EarBytes,
    [int]$EarStride,
    [byte[]]$SilhouetteBytes,
    [int]$SilhouetteStride,
    [int]$EarWidth,
    [int]$EarHeight,
    [double]$LeftRatio,
    [double]$WidthRatio
  )

  $targetX = [int][Math]::Round($FrameWidth * $LeftRatio)
  $targetWidth = [int][Math]::Round($FrameWidth * $WidthRatio)
  $targetHeight = [int][Math]::Round($FrameHeight * 0.3988)

  for ($targetY = 0; $targetY -lt $targetHeight; $targetY++) {
    $sourceY = [Math]::Min(
      $EarHeight - 1,
      [int][Math]::Floor($targetY * $EarHeight / $targetHeight)
    )
    $verticalRatio = $targetY / [double]$targetHeight
    $fade = if ($verticalRatio -le 0.72) {
      1.0
    } elseif ($verticalRatio -ge 0.98) {
      0.0
    } else {
      1.0 - (($verticalRatio - 0.72) / 0.26)
    }

    for ($targetLocalX = 0; $targetLocalX -lt $targetWidth; $targetLocalX++) {
      $sourceX = [Math]::Min(
        $EarWidth - 1,
        [int][Math]::Floor($targetLocalX * $EarWidth / $targetWidth)
      )
      $earAlphaIndex = $sourceY * $EarStride + $sourceX * 4 + 3
      $silhouetteAlphaIndex = $sourceY * $SilhouetteStride + $sourceX * 4 + 3
      if (
        $EarBytes[$earAlphaIndex] -le 8 -or
        $SilhouetteBytes[$silhouetteAlphaIndex] -le 8
      ) { continue }

      $baseX = $FrameOffset + $targetX + $targetLocalX
      if ($baseX -lt 0 -or $baseX -ge ($FrameOffset + $FrameWidth)) { continue }
      $baseAlphaIndex = $targetY * $BaseStride + $baseX * 4 + 3
      $remaining = 1.0 - $fade
      $BaseBytes[$baseAlphaIndex] = [byte][Math]::Round(
        $BaseBytes[$baseAlphaIndex] * $remaining
      )
    }
  }
}

function New-SilhouetteBitmap {
  param(
    [int]$Width,
    [int]$Height,
    [System.Drawing.PointF[]]$Points
  )

  $mask = [System.Drawing.Bitmap]::new(
    $Width,
    $Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($mask)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.FillPolygon([System.Drawing.Brushes]::White, $Points)
  $graphics.Dispose()
  return $mask
}

function Create-EarlessAsset {
  param(
    [string]$SourceName,
    [string]$DestinationName,
    [int]$FrameCount
  )

  $sourcePath = Join-Path $publicDir $SourceName
  $destinationPath = Join-Path $publicDir $DestinationName
  $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
  $bitmap = [System.Drawing.Bitmap]::new(
    $sourceImage.Width,
    $sourceImage.Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.DrawImage($sourceImage, 0, 0, $sourceImage.Width, $sourceImage.Height)
  $graphics.Dispose()
  $sourceImage.Dispose()

  $leftEar = [System.Drawing.Bitmap]::FromFile($leftEarPath)
  $rightEar = [System.Drawing.Bitmap]::FromFile($rightEarPath)
  $leftSilhouette = New-SilhouetteBitmap $leftEar.Width $leftEar.Height ([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(78, 12),
    [System.Drawing.PointF]::new(163, 20),
    [System.Drawing.PointF]::new(410, 194),
    [System.Drawing.PointF]::new(434, 236),
    [System.Drawing.PointF]::new(385, 302),
    [System.Drawing.PointF]::new(327, 368),
    [System.Drawing.PointF]::new(255, 438),
    [System.Drawing.PointF]::new(180, 488),
    [System.Drawing.PointF]::new(101, 444),
    [System.Drawing.PointF]::new(53, 365),
    [System.Drawing.PointF]::new(28, 246),
    [System.Drawing.PointF]::new(44, 98)
  ))
  $rightSilhouette = New-SilhouetteBitmap $rightEar.Width $rightEar.Height ([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(292, 18),
    [System.Drawing.PointF]::new(372, 10),
    [System.Drawing.PointF]::new(424, 58),
    [System.Drawing.PointF]::new(451, 158),
    [System.Drawing.PointF]::new(456, 264),
    [System.Drawing.PointF]::new(430, 368),
    [System.Drawing.PointF]::new(380, 448),
    [System.Drawing.PointF]::new(304, 492),
    [System.Drawing.PointF]::new(224, 434),
    [System.Drawing.PointF]::new(158, 362),
    [System.Drawing.PointF]::new(84, 302),
    [System.Drawing.PointF]::new(22, 264),
    [System.Drawing.PointF]::new(2, 216),
    [System.Drawing.PointF]::new(78, 220),
    [System.Drawing.PointF]::new(160, 166)
  ))
  $baseLocked = Read-BitmapBytes $bitmap
  $leftLocked = Read-BitmapBytes $leftEar
  $rightLocked = Read-BitmapBytes $rightEar
  $leftSilhouetteLocked = Read-BitmapBytes $leftSilhouette
  $rightSilhouetteLocked = Read-BitmapBytes $rightSilhouette
  $frameWidth = [int]($bitmap.Width / $FrameCount)

  for ($frame = 0; $frame -lt $FrameCount; $frame++) {
    $frameOffset = $frame * $frameWidth
    Remove-EarRegion $baseLocked.Bytes $baseLocked.Data.Stride $frameOffset $frameWidth $bitmap.Height $leftLocked.Bytes $leftLocked.Data.Stride $leftSilhouetteLocked.Bytes $leftSilhouetteLocked.Data.Stride $leftEar.Width $leftEar.Height 0.0279 0.3629
    Remove-EarRegion $baseLocked.Bytes $baseLocked.Data.Stride $frameOffset $frameWidth $bitmap.Height $rightLocked.Bytes $rightLocked.Data.Stride $rightSilhouetteLocked.Bytes $rightSilhouetteLocked.Data.Stride $rightEar.Width $rightEar.Height 0.6061 0.3661
  }

  $leftEar.UnlockBits($leftLocked.Data)
  $rightEar.UnlockBits($rightLocked.Data)
  $leftSilhouette.UnlockBits($leftSilhouetteLocked.Data)
  $rightSilhouette.UnlockBits($rightSilhouetteLocked.Data)
  $leftEar.Dispose()
  $rightEar.Dispose()
  $leftSilhouette.Dispose()
  $rightSilhouette.Dispose()
  Write-BitmapBytes $bitmap $baseLocked $destinationPath
  $bitmap.Dispose()
}

Create-EarlessAsset "knopik-calm.png" "knopik-calm-earless.png" 1
Create-EarlessAsset "knopik-warning.png" "knopik-warning-earless.png" 1
Create-EarlessAsset "knopik-joy-sprite.png" "knopik-joy-sprite-earless.png" 5
Create-EarlessAsset "knopik-rage-sprite.png" "knopik-rage-sprite-earless.png" 5
