import { strToU8, zipSync } from 'fflate';
import {
  canvasToBlob,
  findMissingCharacters,
  generateBmFont,
  getFontName,
  normalizeCharacters,
  parseFont,
} from './bmfont.js';
import './style.css';

const elements = Object.fromEntries(
  [
    'fontFile',
    'fileDrop',
    'fileName',
    'fontMeta',
    'characters',
    'characterCount',
    'outputName',
    'fontSize',
    'outlineWidth',
    'glyphPadding',
    'atlasPadding',
    'atlasWidth',
    'fillColor',
    'outlineColor',
    'fillColorValue',
    'outlineColorValue',
    'includeKerning',
    'generateButton',
    'status',
    'atlasStats',
    'downloadPng',
    'downloadFnt',
    'downloadZip',
    'canvasStage',
    'emptyPreview',
  ].map((id) => [id, document.getElementById(id)]),
);

let loadedFont = null;
let sourceFile = null;
let generated = null;

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.dataset.type = type;
}

function updateCharacterCount() {
  const count = normalizeCharacters(elements.characters.value).length;
  elements.characterCount.textContent = `${count} 个字符（已去重）`;
}

function updateColorValue(input, output) {
  output.value = input.value.toUpperCase();
}

function sanitizeOutputName(value) {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_') || 'bitmapFont';
}

async function loadFontFile(file) {
  if (!file) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['ttf', 'otf'].includes(extension)) {
    setStatus('请选择 TTF 或 OTF 字体文件', 'error');
    return;
  }

  setStatus('正在解析字体…');
  try {
    const buffer = await file.arrayBuffer();
    const font = parseFont(buffer);
    loadedFont = font;
    sourceFile = file;
    generated = null;
    elements.fileName.textContent = file.name;
    elements.fontMeta.textContent = `${getFontName(font)} · ${(file.size / 1024).toFixed(1)} KB`;
    elements.outputName.value = sanitizeOutputName(file.name.replace(/\.[^.]+$/, ''));
    elements.generateButton.disabled = false;
    resetDownloads();
    setStatus('字体已就绪', 'success');
  } catch (error) {
    loadedFont = null;
    sourceFile = null;
    elements.generateButton.disabled = true;
    setStatus(`字体解析失败：${error.message}`, 'error');
  }
}

function readNumber(element, min, max, name) {
  const value = Number(element.value);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name}应在 ${min}–${max} 之间`);
  }
  return Math.round(value);
}

function readOptions() {
  const outputName = sanitizeOutputName(elements.outputName.value);
  elements.outputName.value = outputName;
  return {
    outputName,
    fontSize: readNumber(elements.fontSize, 4, 256, '字号'),
    outlineWidth: readNumber(elements.outlineWidth, 0, 32, '描边宽度'),
    glyphPadding: readNumber(elements.glyphPadding, 0, 32, '字形留白'),
    atlasPadding: readNumber(elements.atlasPadding, 0, 32, '图集间距'),
    atlasWidth: Number(elements.atlasWidth.value),
    fillColor: elements.fillColor.value,
    outlineColor: elements.outlineColor.value,
    includeKerning: elements.includeKerning.checked,
  };
}

function resetDownloads() {
  for (const button of [elements.downloadPng, elements.downloadFnt, elements.downloadZip]) {
    button.disabled = true;
  }
  elements.atlasStats.textContent = '尚未生成';
}

function showGenerated(result) {
  elements.emptyPreview.hidden = true;
  elements.canvasStage.querySelector('canvas')?.remove();
  elements.canvasStage.append(result.canvas);
  elements.atlasStats.textContent = `${result.atlasWidth} × ${result.atlasHeight} · ${result.glyphCount} 字形 · ${result.kerningCount} 字距`;
  for (const button of [elements.downloadPng, elements.downloadFnt, elements.downloadZip]) {
    button.disabled = false;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildFiles() {
  const name = generated.options.outputName;
  const pngBlob = await canvasToBlob(generated.canvas);
  const fntBlob = new Blob([generated.descriptor], { type: 'text/plain;charset=utf-8' });
  return { name, pngBlob, fntBlob };
}

async function generate() {
  if (!loadedFont || !sourceFile) return;
  const characters = normalizeCharacters(elements.characters.value);
  if (characters.length === 0) {
    setStatus('字符集不能为空', 'error');
    return;
  }

  const missing = findMissingCharacters(loadedFont, characters);
  if (missing.length > 0) {
    const preview = missing.slice(0, 16).map((char) => JSON.stringify(char)).join(' ');
    const suffix = missing.length > 16 ? ` 等 ${missing.length} 个` : '';
    setStatus(`字体缺少字符：${preview}${suffix}`, 'error');
    return;
  }

  elements.generateButton.disabled = true;
  setStatus('正在生成图集…');
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const options = readOptions();
    const result = generateBmFont(loadedFont, characters, options);
    generated = { ...result, options };
    showGenerated(generated);
    setStatus('生成完成', 'success');
  } catch (error) {
    setStatus(`生成失败：${error.message}`, 'error');
  } finally {
    elements.generateButton.disabled = false;
  }
}

elements.fontFile.addEventListener('change', (event) => loadFontFile(event.target.files[0]));
elements.characters.addEventListener('input', updateCharacterCount);
elements.fillColor.addEventListener('input', () =>
  updateColorValue(elements.fillColor, elements.fillColorValue),
);
elements.outlineColor.addEventListener('input', () =>
  updateColorValue(elements.outlineColor, elements.outlineColorValue),
);
elements.generateButton.addEventListener('click', generate);

for (const eventName of ['dragenter', 'dragover']) {
  elements.fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.fileDrop.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.fileDrop.classList.remove('is-dragging');
  });
}
elements.fileDrop.addEventListener('drop', (event) => loadFontFile(event.dataTransfer.files[0]));

elements.downloadPng.addEventListener('click', async () => {
  const { name, pngBlob } = await buildFiles();
  downloadBlob(pngBlob, `${name}.png`);
});
elements.downloadFnt.addEventListener('click', async () => {
  const { name, fntBlob } = await buildFiles();
  downloadBlob(fntBlob, `${name}.fnt`);
});
elements.downloadZip.addEventListener('click', async () => {
  const { name, pngBlob, fntBlob } = await buildFiles();
  const archive = zipSync({
    [`${name}.png`]: new Uint8Array(await pngBlob.arrayBuffer()),
    [`${name}.fnt`]: strToU8(await fntBlob.text()),
  });
  downloadBlob(new Blob([archive], { type: 'application/zip' }), `${name}.zip`);
});

updateCharacterCount();
updateColorValue(elements.fillColor, elements.fillColorValue);
updateColorValue(elements.outlineColor, elements.outlineColorValue);
