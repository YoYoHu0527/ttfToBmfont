import assert from 'node:assert/strict';
import test from 'node:test';
import { createCornerCutoutPixels } from '../src/rounded-corners.js';

test('单像素圆角使用圆面积计算半透明覆盖率', () => {
  const pixels = createCornerCutoutPixels(1);
  const expectedAlpha = Math.round((1 - Math.PI / 4) * 255);
  assert.equal(pixels[3], expectedAlpha);
});

test('不同半径的边缘具有透明度过渡，裁除面积符合圆的几何面积', () => {
  for (const radius of [2, 16, 64, 256]) {
    const pixels = createCornerCutoutPixels(radius);
    let cutoutArea = 0;
    let partialPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      const alpha = pixels[index];
      cutoutArea += alpha / 255;
      if (alpha > 0 && alpha < 255) partialPixels++;
    }

    assert.ok(pixels[3] > 0);
    assert.equal(pixels[pixels.length - 1], 0);
    assert.ok(partialPixels >= radius, `半径 ${radius} 的边缘缺少半透明像素`);
    const expectedArea = radius * radius * (1 - Math.PI / 4);
    assert.ok(
      Math.abs(cutoutArea - expectedArea) < radius / 255 + 0.01,
      `半径 ${radius} 的裁除面积偏差过大`,
    );
  }
});
