# TTF to BMFont

纯浏览器 BMFont 生成器。字体文件只在当前页面内解析，不会上传到服务器，也不要求电脑预先安装该字体。

字体文件和全部参数（字符集、字号、描边、阴影等）保存在浏览器本地（IndexedDB + localStorage），刷新页面后自动恢复。注意：浏览器保存的是字体文件的**副本**，源文件修改不会自动同步，重新选择字体文件即可更新。

选择字体后自动生成图集，修改任意参数会自动刷新预览；手动重新生成请点击"刷新"按钮。

## 功能

- 支持 TTF 和 OTF
- 自定义字符集并自动去重
- 自定义字号、文字颜色、描边（可独立开关）、阴影（偏移/模糊/颜色，烘焙进图集）、留白、图集间距和图集宽度
- 检查字体缺失字符，不使用系统字体回退
- 生成标准文本格式 BMFont（`.fnt + .png`）
- 可选写入 kerning 字距（自动跳过无字距数据的字体）
- 单独下载 PNG/FNT，或打包下载 ZIP

## 本地开发

Windows 可以直接双击 `start-local.cmd`。首次启动会自动安装依赖，随后打开浏览器。

也可以在终端运行：

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建结果位于 `dist/`。部署时只需上传 `dist/` 内的文件，不需要 Node.js 服务端。它可以放到 GitHub Pages、Cloudflare Pages、Netlify、Vercel、Nginx 或对象存储静态网站。

由于 `vite.config.js` 使用相对资源路径，`dist/` 也支持部署在网站的子目录中。

常见静态平台的构建配置：

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node.js：20 或更高版本

## Cocos Creator

生成后把同名 `.fnt` 和 `.png` 放入项目同一目录，等待 Cocos Creator 导入，再把 `.fnt` 资源指定给 Label 的 Font。若描边已生成在图集中，不要再叠加 `LabelOutline`。
