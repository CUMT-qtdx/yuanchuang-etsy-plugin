# TokenFree 香蕉生图填写步骤

适用插件：2.0.0-etsy.9 及以后。依据 [TokenFree Gemini 生图文档](https://tokenfree.dev/docs/creative?article=banana)。

## 按截图顺序填写

| 步骤 | 界面位置 | 填写内容 |
|---|---|---|
| 名称 | 显示名称 | 自己容易识别的名字，例如「TokenFree 香蕉生图」 |
| 1 | API 地址 | `https://creative.tokenfree.dev` |
| 2 | 接口协议 | **Gemini 原生（generateContent）** |
| 3 | API 密钥 | 每个人填写自己的 TokenFree Key，截图和教学材料不展示密钥 |
| 4 | 检测模型 | 点击「检测模型」，先选 `gemini-3.1-flash-image` |
| 5 | 保存 | 关闭渠道小窗口后，点击设置卡片底部的「保存」 |
| 6 | 实际验证 | 回到生图，选这个渠道和 Flash，先试 1 张、1K、1:1 |

**「完整 URL」保持不勾选。** 插件会按模型自动补上原生调用路径。

你原图中第 2 步的「Chat Completions」对应旧的兼容入口。按照这篇新文档接入时，第 1 步改为 Creative 地址，第 2 步改为 Gemini 原生。第 5 步的底部保存也需要教给使用者。

## 当前模型选择

- 先教大家使用 `gemini-3.1-flash-image`。
- Pro 当前按用户反馈处于上游修复阶段，暂不做真实 Pro 验证。
- 文档中的 `gemini-nano-banana-2.1` 也可在模型检测后选择，实际可用性仍以服务返回为准。
- `gemini-2.5-flash-image`、`gemini-3.1-flash-lite-image` 只选 1K。

## 看到什么才算配好

「检测模型成功」只说明地址、密钥和模型目录可以访问。保存后实际得到图片，才算生图验证通过。

如果看到 `502 当前服务拥挤，请重试`，保留当前配置，记录发生时间与模型，等待供应商恢复。不要把它当成密钥必然填错，也不要连续快速提交。

## 本机临时兼容入口

已经能够出图的旧 Flash 渠道可以保留：API 地址 `https://tokenfree.dev`，协议 `Chat Completions`，完整 URL 不勾选，模型 `gemini-3.1-flash-image`。这是另一套兼容接法，与上面的 Creative 原生接法分别保存在两个渠道中，避免把地址和协议交叉混用。

这份教程不包含密钥。发给其他人时，只需让对方填写自己的 Key。
