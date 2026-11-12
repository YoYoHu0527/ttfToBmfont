import { canvasToBlob, downloadBlob } from './download.js';
import { drawRoundedImage } from './rounded-corners.js';

const elements = Object.fromEntries(
  [
    'imageFile',
    'imageDrop',
    'imageFileName',
    'imageMeta',
    'imageSettings',
    'imageRadiusRange',
    'imageRadiusNumber',
    'imageRadiusHint',
    'imageStatus',
    'imageStats',
    'imageCanvas',
    'imageEmptyPreview',
    'downloadRoundedImage',
  ].map((id) => [id, document.getElementById(id)]),
);

let loadedImage = null;
let sourceFile = null;
let radius = 32;
let loadVersion = 0;

function setStatus(message, type = '') {
  elements.imageStatus.textContent = message;
  elements.imageStatus.dataset.type = type;
}

function renderImage() {
  if (!loadedImage) return;

  const canvas = elements.imageCanvas;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布');
    drawRoundedImage(context, loadedImage, radius);

    canvas.hidden = false;
    elements.imageEmptyPreview.hidden = true;
    elements.imageStats.textContent = `${canvas.width} × ${canvas.height} px · 圆角 ${radius} px`;
    elements.downloadRoundedImage.disabled = false;
    setStatus('预览已更新，可下载 PNG', 'success');
  } catch (error) {
    canvas.hidden = true;
    elements.imageEmptyPreview.hidden = false;
    elements.downloadRoundedImage.disabled = true;
    setStatus(`图片处理失败：${error.message}`, 'error');
  }
}

function updateRadius(value) {
  const maxRadius = Number(elements.imageRadiusNumber.max);
  radius = Math.min(maxRadius, Math.max(0, Math.round(value)));
  elements.imageRadiusRange.value = radius;
  elements.imageRadiusNumber.value = radius;
  renderImage();
}

async function loadImageFile(file) {
  if (!file) return;
  const version = ++loadVersion;
  const supportedType = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  const supportedExtension = !file.type && /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!supportedType && !supportedExtension) {
    elements.imageSettings.disabled = !loadedImage;
    elements.downloadRoundedImage.disabled = !loadedImage || elements.imageCanvas.hidden;
    setStatus('请选择 PNG、JPG 或 WebP 图片', 'error');
    return;
  }

  elements.imageSettings.disabled = true;
  elements.downloadRoundedImage.disabled = true;
  setStatus('正在载入图片…');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (version !== loadVersion) return;
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');

    loadedImage = image;
    sourceFile = file;
    const maxRadius = Math.floor(Math.min(image.naturalWidth, image.naturalHeight) / 2);
    elements.imageRadiusRange.max = maxRadius;
    elements.imageRadiusNumber.max = maxRadius;
    elements.imageRadiusHint.textContent = `四角统一调整，当前最大半径 ${maxRadius} px`;
    elements.imageFileName.textContent = file.name;
    elements.imageMeta.textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${(file.size / 1024).toFixed(1)} KB`;
    elements.imageCanvas.width = image.naturalWidth;
    elements.imageCanvas.height = image.naturalHeight;
    elements.imageSettings.disabled = false;
    updateRadius(radius);
  } catch (error) {
    if (version !== loadVersion) return;
    elements.imageSettings.disabled = !loadedImage;
    elements.downloadRoundedImage.disabled = !loadedImage || elements.imageCanvas.hidden;
    setStatus(`图片载入失败：${error.message}`, 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
}

elements.imageFile.addEventListener('change', (event) => {
  loadImageFile(event.target.files[0]);
  event.target.value = '';
});

for (const eventName of ['dragenter', 'dragover']) {
  elements.imageDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.imageDrop.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.imageDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.imageDrop.classList.remove('is-dragging');
  });
}
elements.imageDrop.addEventListener('drop', (event) => loadImageFile(event.dataTransfer.files[0]));

for (const input of [elements.imageRadiusRange, elements.imageRadiusNumber]) {
  input.addEventListener('input', () => {
    if (input.value === '' || !Number.isFinite(Number(input.value))) return;
    updateRadius(Number(input.value));
  });
}
elements.imageRadiusNumber.addEventListener('change', () => updateRadius(radius));

elements.downloadRoundedImage.addEventListener('click', async () => {
  if (!loadedImage || !sourceFile) return;
  const version = loadVersion;
  const name = sourceFile.name.replace(/\.[^.]+$/, '') || 'image';
  elements.downloadRoundedImage.disabled = true;
  try {
    const blob = await canvasToBlob(elements.imageCanvas);
    if (version !== loadVersion) return;
    downloadBlob(blob, `${name}-rounded.png`);
    setStatus('PNG 已导出', 'success');
  } catch (error) {
    if (version !== loadVersion) return;
    setStatus(`导出失败：${error.message}`, 'error');
  } finally {
    if (version === loadVersion) {
      elements.downloadRoundedImage.disabled = elements.imageCanvas.hidden;
    }
  }
});
