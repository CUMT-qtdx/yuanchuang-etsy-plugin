"""生成可复核的解码样本；生产清理模块不依赖 Pillow。"""
from pathlib import Path
from PIL import Image, ImageCms

root = Path(__file__).resolve().parent / 'fixtures' / 'metadata'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (48, 32))
image.putdata([((x * 5) % 256, (y * 7) % 256, (x * 3 + y * 2) % 256) for y in range(32) for x in range(48)])
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
image.save(root / 'base.jpg', quality=91, icc_profile=icc, dpi=(144, 144))
image.save(root / 'progressive.jpg', quality=87, progressive=True, icc_profile=icc)
image.save(root / 'base.png', icc_profile=icc)
image.save(root / 'base.webp', quality=91, icc_profile=icc)
alpha = image.convert('RGBA')
alpha.putalpha(Image.frombytes('L', image.size, bytes((x * 5 + y * 3) % 256 for y in range(32) for x in range(48))))
alpha.save(root / 'alpha.png', icc_profile=icc)
alpha.save(root / 'lossless.webp', lossless=True, icc_profile=icc)
alpha.save(root / 'animated.webp', save_all=True, append_images=[alpha.transpose(Image.Transpose.FLIP_LEFT_RIGHT)], duration=[80, 120], loop=2, lossless=True, icc_profile=icc)
alpha.save(root / 'animated.png', save_all=True, append_images=[alpha.transpose(Image.Transpose.FLIP_LEFT_RIGHT)], duration=[80, 120], loop=2, icc_profile=icc)
print('已生成 8 个 JPG、PNG、WebP 像素与色彩验收样本')
