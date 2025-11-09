# Icons

插件图标文件已创建：

- ✅ icon16.png (16x16 像素)
- ✅ icon48.png (48x48 像素)  
- ✅ icon128.png (128x128 像素)

## 重新生成图标

如果需要重新生成图标，可以运行：

```bash
python3 generate_icons.py
```

脚本会自动安装 Pillow（如果未安装）并生成图标。

## 其他方法

### 使用 ImageMagick
```bash
# 创建 16x16 图标
convert -size 16x16 xc:#0969da -fill white -gravity center -pointsize 10 -annotate +0+0 "GA" icons/icon16.png

# 创建 48x48 图标
convert -size 48x48 xc:#0969da -fill white -gravity center -pointsize 24 -annotate +0+0 "GA" icons/icon48.png

# 创建 128x128 图标
convert -size 128x128 xc:#0969da -fill white -gravity center -pointsize 64 -annotate +0+0 "GA" icons/icon128.png
```

### 使用在线工具
- https://www.favicon-generator.org/
- https://realfavicongenerator.net/

