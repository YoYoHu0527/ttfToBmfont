const EDGE_SAMPLES = 64;

export function createCornerCutoutPixels(radius) {
  const pixels = new Uint8ClampedArray(radius * radius * 4);
  const boundaries = new Float64Array(EDGE_SAMPLES);
  const squaredRadius = radius * radius;

  for (let y = 0; y < radius; y++) {
    // 沿像素高度分层，圆方程给出每一层精确的横向覆盖长度。
    for (let sample = 0; sample < EDGE_SAMPLES; sample++) {
      const distanceY = radius - y - (sample + 0.5) / EDGE_SAMPLES;
      boundaries[sample] = radius - Math.sqrt(squaredRadius - distanceY * distanceY);
    }

    const rowStart = y * radius * 4;
    const opaqueEnd = Math.floor(boundaries[EDGE_SAMPLES - 1]);
    const edgeEnd = Math.ceil(boundaries[0]);
    pixels.fill(255, rowStart, rowStart + opaqueEnd * 4);

    // 完全透明和完全不透明的区域可直接跳过采样计算。
    for (let x = opaqueEnd; x < edgeEnd; x++) {
      let outsideCoverage = 0;
      for (const boundary of boundaries) {
        outsideCoverage += Math.min(1, Math.max(0, boundary - x));
      }
      pixels[rowStart + x * 4 + 3] = Math.round(outsideCoverage / EDGE_SAMPLES * 255);
    }
  }

  return pixels;
}

export function drawRoundedImage(context, image, radius) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  if (radius === 0) return;

  const cutout = document.createElement('canvas');
  cutout.width = radius;
  cutout.height = radius;
  const cutoutContext = cutout.getContext('2d');
  if (!cutoutContext) throw new Error('浏览器无法创建圆角遮罩');
  cutoutContext.putImageData(new ImageData(createCornerCutoutPixels(radius), radius, radius), 0, 0);

  context.save();
  try {
    context.globalCompositeOperation = 'destination-out';
    for (const [scaleX, scaleY, offsetX, offsetY] of [
      [1, 1, 0, 0],
      [-1, 1, width, 0],
      [1, -1, 0, height],
      [-1, -1, width, height],
    ]) {
      context.setTransform(scaleX, 0, 0, scaleY, offsetX, offsetY);
      context.drawImage(cutout, 0, 0);
    }
  } finally {
    context.restore();
  }
}
