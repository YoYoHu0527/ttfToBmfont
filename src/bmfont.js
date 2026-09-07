import * as opentype from 'opentype.js';

const MAX_ATLAS_HEIGHT = 8192;
const IGNORED_INPUT_CHARS = new Set(['\r', '\n', '\t']);

export function normalizeCharacters(value) {
  return [...new Set([...value].filter((char) => !IGNORED_INPUT_CHARS.has(char)))];
}

export function parseFont(buffer) {
  return opentype.parse(buffer);
}

export function getFontName(font) {
  const names = font.names?.fontFamily;
  if (!names) return 'Bitmap Font';
  return names.en || names['zh-CN'] || Object.values(names)[0] || 'Bitmap Font';
}

export function findMissingCharacters(font, characters) {
  return characters.filter((char) => font.charToGlyphIndex(char) === 0);
}

function drawPath(context, path) {
  context.beginPath();
  for (const command of path.commands) {
    if (command.type === 'M') context.moveTo(command.x, command.y);
    else if (command.type === 'L') context.lineTo(command.x, command.y);
    else if (command.type === 'C') {
      context.bezierCurveTo(
        command.x1,
        command.y1,
        command.x2,
        command.y2,
        command.x,
        command.y,
      );
    } else if (command.type === 'Q') {
      context.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
    } else if (command.type === 'Z') context.closePath();
  }
}

const OFFSET_DIRECTIONS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
});

function buildGlyphPath2D(path) {
  const path2d = new Path2D();
  for (const command of path.commands) {
    if (command.type === 'M') path2d.moveTo(command.x, command.y);
    else if (command.type === 'L') path2d.lineTo(command.x, command.y);
    else if (command.type === 'C') {
      path2d.bezierCurveTo(
        command.x1,
        command.y1,
        command.x2,
        command.y2,
        command.x,
        command.y,
      );
    } else if (command.type === 'Q') {
      path2d.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
    } else if (command.type === 'Z') path2d.closePath();
  }
  return path2d;
}

// 提取字形路径中的内孔子路径（方向与主轮廓相反的子路径），
// 用于膨胀式描边后恢复内孔透明（否则内孔会被偏移填充填成描边色）。
function extractHoleSubpaths(path) {
  const subpaths = [];
  let current = [];
  for (const command of path.commands) {
    if (command.type === 'M') {
      if (current.length > 0) subpaths.push(current);
      current = [command];
    } else {
      current.push(command);
    }
  }
  if (current.length > 0) subpaths.push(current);

  const signedAreas = subpaths.map((sub) => {
    let area = 0;
    let px = 0;
    let py = 0;
    for (const c of sub) {
      const points = [];
      if (c.x !== undefined) points.push([c.x, c.y]);
      if (c.x1 !== undefined) points.push([c.x1, c.y1]);
      if (c.x2 !== undefined) points.push([c.x2, c.y2]);
      for (const [x, y] of points) {
        if (px !== 0 || py !== 0) area += px * y - py * x;
        px = x;
        py = y;
      }
    }
    return area;
  });

  let mainIndex = 0;
  for (let i = 1; i < signedAreas.length; i += 1) {
    if (Math.abs(signedAreas[i]) > Math.abs(signedAreas[mainIndex])) {
      mainIndex = i;
    }
  }
  const mainSign = Math.sign(signedAreas[mainIndex]) || 1;
  return subpaths.filter(
    (_, i) => i !== mainIndex && Math.sign(signedAreas[i]) !== mainSign,
  );
}

function buildSubpath2D(subpath) {
  const path2d = new Path2D();
  for (const command of subpath) {
    if (command.type === 'M') path2d.moveTo(command.x, command.y);
    else if (command.type === 'L') path2d.lineTo(command.x, command.y);
    else if (command.type === 'C') {
      path2d.bezierCurveTo(
        command.x1,
        command.y1,
        command.x2,
        command.y2,
        command.x,
        command.y,
      );
    } else if (command.type === 'Q') {
      path2d.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
    } else if (command.type === 'Z') path2d.closePath();
  }
  return path2d;
}

function drawGlyphShape(context, glyphPath, fillStyle, strokeStyle, outlineWidth) {
  if (outlineWidth > 0) {
    // 膨胀式描边：把字形在 16 个方向各平移 outlineWidth 填充成描边色，
    // 再在中心填充本体，交叉处/交汇处天然连续。
    // 平移通过 Path2D.addPath 直接构造偏移路径，不依赖 context.translate
    // （部分渲染环境下对已构建路径的 translate+fill 不生效）。
    const base = buildGlyphPath2D(glyphPath);
    context.fillStyle = strokeStyle;
    for (const [dx, dy] of OFFSET_DIRECTIONS) {
      const shifted = new Path2D();
      shifted.addPath(base, {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: dx * outlineWidth,
        f: dy * outlineWidth,
      });
      context.fill(shifted);
    }
  }
  context.fillStyle = fillStyle;
  context.fill();
  if (outlineWidth > 0) {
    // 膨胀描边的偏移填充会填满字形内孔（0/8/% 等），把内孔区域挖掉恢复透明。
    const holes = extractHoleSubpaths(glyphPath);
    if (holes.length > 0) {
      context.save();
      context.globalCompositeOperation = 'destination-out';
      for (const hole of holes) {
        context.fill(buildSubpath2D(hole));
      }
      context.restore();
    }
  }
}

function scanAlphaBounds(imageData) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] !== 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return maxX < minX ? null : { minX, minY, maxX, maxY };
}

function rasterizeGlyph(font, char, options, base) {
  const {
    fontSize,
    outlineWidth,
    glyphPadding,
    fillColor,
    outlineColor,
    shadowEnabled,
    shadowOffsetX,
    shadowOffsetY,
    shadowBlur,
    shadowColor,
  } = options;
  const scale = fontSize / font.unitsPerEm;
  const glyph = font.charToGlyph(char);
  const xadvance = Math.round((glyph.advanceWidth || 0) * scale);
  const bounds = glyph.getBoundingBox();

  if (bounds.x1 === bounds.x2 && bounds.y1 === bounds.y2) {
    return {
      char,
      id: char.codePointAt(0),
      glyph,
      width: 0,
      height: 0,
      xoffset: 0,
      yoffset: 0,
      xadvance,
      canvas: null,
    };
  }

  const hasShadow =
    shadowEnabled &&
    (shadowOffsetX !== 0 || shadowOffsetY !== 0 || shadowBlur > 0);
  const shadowReach = hasShadow
    ? shadowBlur + Math.max(Math.abs(shadowOffsetX), Math.abs(shadowOffsetY))
    : 0;
  const safety = outlineWidth + glyphPadding + shadowReach + 3;
  const logicalLeft = Math.floor(bounds.x1 * scale) - safety;
  const logicalRight = Math.ceil(bounds.x2 * scale) + safety;
  const logicalTop = Math.floor(-bounds.y2 * scale) - safety;
  const logicalBottom = Math.ceil(-bounds.y1 * scale) + safety;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, logicalRight - logicalLeft);
  canvas.height = Math.max(1, logicalBottom - logicalTop);

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (hasShadow) {
    const shadowPath = glyph.getPath(-logicalLeft, -logicalTop, fontSize);
    context.shadowColor = shadowColor;
    context.shadowOffsetX = shadowOffsetX;
    context.shadowOffsetY = shadowOffsetY;
    context.shadowBlur = shadowBlur;
    // 用与主层一致的「膨胀描边 + 本体」形状生成阴影，
    // 让阴影覆盖到描边外沿（旧实现只对字形 fill 取影，大描边时阴影会被
    // 主层完全盖住；而早期用 stroke 取影又会在尖角/凹口处产生尖刺状凸起）。
    if (outlineWidth > 0) {
      drawGlyphShape(context, shadowPath, fillColor, outlineColor, outlineWidth);
    } else {
      drawPath(context, shadowPath);
      context.fillStyle = fillColor;
      context.fill();
    }
    context.shadowColor = 'transparent';
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.shadowBlur = 0;
    // 清除形状本体（略放大 1px 以覆盖抗锯齿边缘），只保留阴影层
    context.globalCompositeOperation = 'destination-out';
    if (outlineWidth > 0) {
      drawGlyphShape(context, shadowPath, '#000000', '#000000', outlineWidth + 1);
    } else {
      drawPath(context, shadowPath);
      context.fillStyle = '#000000';
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
  }

  if (outlineWidth > 0) {
    // 2x 超采样绘制：在 2 倍分辨率上用膨胀式描边（16 方向偏移）画描边+本体，
    // 再缩回 1x。膨胀保证交叉处描边连续，2x 降采样让边缘抗锯齿平滑锐利，
    // 避免 1x 下多方向偏移边缘错位造成的发虚。
    const hi = document.createElement('canvas');
    hi.width = canvas.width * 2;
    hi.height = canvas.height * 2;
    const hctx = hi.getContext('2d');
    hctx.lineJoin = 'round';
    hctx.miterLimit = 2;
    const glyphPath2 = glyph.getPath(-logicalLeft * 2, -logicalTop * 2, fontSize * 2);
    drawPath(hctx, glyphPath2);
    drawGlyphShape(hctx, glyphPath2, fillColor, outlineColor, outlineWidth * 2);
    context.drawImage(hi, 0, 0, hi.width, hi.height, 0, 0, canvas.width, canvas.height);
  } else {
    const glyphPath = glyph.getPath(-logicalLeft, -logicalTop, fontSize);
    drawPath(context, glyphPath);
    context.fillStyle = fillColor;
    context.fill();
  }

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const alphaBounds = scanAlphaBounds(pixels);
  if (!alphaBounds) {
    throw new Error(`字符 ${JSON.stringify(char)} 未能绘制`);
  }

  const srcX = Math.max(0, alphaBounds.minX - glyphPadding);
  const srcY = Math.max(0, alphaBounds.minY - glyphPadding);
  const srcRight = Math.min(canvas.width, alphaBounds.maxX + 1 + glyphPadding);
  const srcBottom = Math.min(canvas.height, alphaBounds.maxY + 1 + glyphPadding);

  return {
    char,
    id: char.codePointAt(0),
    glyph,
    canvas,
    srcX,
    srcY,
    width: srcRight - srcX,
    height: srcBottom - srcY,
    xoffset: logicalLeft + srcX,
    yoffset: base + logicalTop + srcY,
    xadvance,
  };
}

function packGlyphs(glyphs, atlasWidth, atlasPadding) {
  let cursorX = atlasPadding;
  let cursorY = atlasPadding;
  let rowHeight = 0;

  for (const glyph of glyphs) {
    if (glyph.width === 0 || glyph.height === 0) {
      glyph.x = 0;
      glyph.y = 0;
      continue;
    }
    if (glyph.width + atlasPadding * 2 > atlasWidth) {
      throw new Error(`字符 ${JSON.stringify(glyph.char)} 宽于当前图集，请增大图集宽度`);
    }
    if (cursorX + glyph.width + atlasPadding > atlasWidth) {
      cursorX = atlasPadding;
      cursorY += rowHeight + atlasPadding;
      rowHeight = 0;
    }
    glyph.x = cursorX;
    glyph.y = cursorY;
    cursorX += glyph.width + atlasPadding;
    rowHeight = Math.max(rowHeight, glyph.height);
  }

  const contentHeight = Math.max(1, cursorY + rowHeight + atlasPadding);
  const atlasHeight = Math.max(32, 2 ** Math.ceil(Math.log2(contentHeight)));
  if (atlasHeight > MAX_ATLAS_HEIGHT) {
    throw new Error('字符过多，图集高度超过 8192；请增大图集宽度或减少字符');
  }
  return atlasHeight;
}

function calculateKernings(font, glyphs, fontSize, enabled) {
  if (!enabled) return [];
  if (glyphs.length > 1500) {
    throw new Error('启用字距时最多支持 1500 个字符；请关闭“写入字体字距”后重试');
  }

  const hasKerningData =
    Boolean(font.position?.defaultKerningTables) ||
    Object.keys(font.kerningPairs || {}).length > 0;
  if (!hasKerningData) return [];

  const scale = fontSize / font.unitsPerEm;
  const kernings = [];
  for (const first of glyphs) {
    for (const second of glyphs) {
      const amount = Math.round(font.getKerningValue(first.glyph, second.glyph) * scale);
      if (amount !== 0) {
        kernings.push({ first: first.id, second: second.id, amount });
      }
    }
  }
  return kernings;
}

function escapeFaceName(value) {
  return value.replaceAll('"', "'");
}

function buildDescriptor(font, glyphs, kernings, options, atlasHeight, base, lineHeight) {
  const fontName = escapeFaceName(getFontName(font));
  const bold = /bold/i.test(font.names?.fontSubfamily?.en || '') ? 1 : 0;
  const pageName = `${options.outputName}.png`;
  const lines = [
    `info face="${fontName}" size=${options.fontSize} bold=${bold} italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=${options.glyphPadding},${options.glyphPadding},${options.glyphPadding},${options.glyphPadding} spacing=${options.atlasPadding},${options.atlasPadding} outline=${options.outlineWidth}`,
    `common lineHeight=${lineHeight} base=${base} scaleW=${options.atlasWidth} scaleH=${atlasHeight} pages=1 packed=0 alphaChnl=0 redChnl=0 greenChnl=0 blueChnl=0`,
    `page id=0 file="${pageName}"`,
    `chars count=${glyphs.length}`,
    ...glyphs.map(
      (glyph) =>
        `char id=${glyph.id} x=${glyph.x} y=${glyph.y} width=${glyph.width} height=${glyph.height} xoffset=${glyph.xoffset} yoffset=${glyph.yoffset} xadvance=${glyph.xadvance} page=0 chnl=15`,
    ),
    `kernings count=${kernings.length}`,
    ...kernings.map(
      ({ first, second, amount }) =>
        `kerning first=${first} second=${second} amount=${amount}`,
    ),
    '',
  ];
  return lines.join('\n');
}

export function generateBmFont(font, characters, options) {
  const scale = options.fontSize / font.unitsPerEm;
  const base = Math.ceil(font.ascender * scale);
  const lineGap = font.tables?.hhea?.lineGap || 0;
  const lineHeight = Math.ceil((font.ascender - font.descender + lineGap) * scale);
  const glyphs = characters.map((char) => rasterizeGlyph(font, char, options, base));
  const atlasHeight = packGlyphs(glyphs, options.atlasWidth, options.atlasPadding);
  const canvas = document.createElement('canvas');
  canvas.width = options.atlasWidth;
  canvas.height = atlasHeight;
  const context = canvas.getContext('2d');

  for (const glyph of glyphs) {
    if (!glyph.canvas) continue;
    context.drawImage(
      glyph.canvas,
      glyph.srcX,
      glyph.srcY,
      glyph.width,
      glyph.height,
      glyph.x,
      glyph.y,
      glyph.width,
      glyph.height,
    );
  }

  const kernings = calculateKernings(
    font,
    glyphs,
    options.fontSize,
    options.includeKerning,
  );
  const descriptor = buildDescriptor(
    font,
    glyphs,
    kernings,
    options,
    atlasHeight,
    base,
    lineHeight,
  );

  return {
    canvas,
    descriptor,
    glyphCount: glyphs.length,
    kerningCount: kernings.length,
    atlasWidth: canvas.width,
    atlasHeight: canvas.height,
  };
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 编码失败'));
    }, 'image/png');
  });
}
