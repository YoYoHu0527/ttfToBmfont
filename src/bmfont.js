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
  const { fontSize, outlineWidth, glyphPadding, fillColor, outlineColor } = options;
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

  const safety = outlineWidth + glyphPadding + 3;
  const logicalLeft = Math.floor(bounds.x1 * scale) - safety;
  const logicalRight = Math.ceil(bounds.x2 * scale) + safety;
  const logicalTop = Math.floor(-bounds.y2 * scale) - safety;
  const logicalBottom = Math.ceil(-bounds.y1 * scale) + safety;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, logicalRight - logicalLeft);
  canvas.height = Math.max(1, logicalBottom - logicalTop);

  const context = canvas.getContext('2d', { willReadFrequently: true });
  const originX = -logicalLeft;
  const baselineY = -logicalTop;
  const glyphPath = glyph.getPath(originX, baselineY, fontSize);
  drawPath(context, glyphPath);
  context.lineJoin = 'round';
  context.miterLimit = 2;

  if (outlineWidth > 0) {
    context.strokeStyle = outlineColor;
    context.lineWidth = outlineWidth * 2;
    context.stroke();
  }
  context.fillStyle = fillColor;
  context.fill();

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
