# 图片导出元数据处理

- 上游：[muqadasejaz/AIMetaScrubber](https://github.com/muqadasejaz/AIMetaScrubber)
- 项目：AI Metadata Remover & Viewer
- 固定提交：`6d8c2660cacd6dfeb1d98c5b45327e3ba842ef0a`
- 许可证：MIT，Copyright (c) 2026 Muqadas Ejaz；全文见同目录 LICENSE。
- 复用部分：`index.html` 的 `kind` 格式识别、`strip` JPEG／PNG／WebP 分段拼接、`exif` 字节序读取、`crc` 和 `chunk` 校验／写入方法。
- 未嵌入上游网页、扫描器界面、Canvas 示例生成或网页编辑器。

本地扩展包括严格长度／PNG CRC 校验、EXIF 与 XMP／IPTC 署名保留、PNG／WebP 方向保留、错误关闭导出、统一结果报告。像素压缩数据及色彩块直接复制，不经过解码、重绘或压缩。

C2PA 默认保留。对于可解析且数据摘要匹配的 `c2pa.hash.data` 绑定，只允许在全部已知排除范围内等长改写，并复核改写后的摘要；无法确认安全范围、盒哈希、压缩清单、外部凭证等情况导出原文件并标记“未清理”。此模块不验证签名者身份，也不将保留凭证等同于验证凭证有效。原有有效签名的绑定字节、凭证及偏移保持不变。

导出保留作者、版权、授权、色彩与方向；未提供删除这些信息的选项。元数据处理不移除 SynthID 或可见水印。
