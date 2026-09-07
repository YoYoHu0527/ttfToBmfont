// 构建完成后把 dist 目录整体复制到 docs（用于 GitHub Pages 等静态部署）。
// 复制前会清空 docs 旧内容，保证与 dist 完全一致。
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distDir = resolve(root, 'dist');
const docsDir = resolve(root, 'docs');

if (!existsSync(distDir)) {
  console.error('[copy-dist-to-docs] 未找到 dist 目录，请先执行构建（vite build）。');
  process.exit(1);
}

rmSync(docsDir, { recursive: true, force: true });
cpSync(distDir, docsDir, { recursive: true });
console.log(`[copy-dist-to-docs] 已复制 dist → docs（${docsDir}）`);
