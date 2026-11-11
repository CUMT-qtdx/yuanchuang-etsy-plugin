# Etsy AI Studio — 新增商品摄影与构图规则模块

## 一、任务背景

我已经将 `Needle Felt Realism v1.0` 真实羊毛毡材质规则交给你集成。

现在需要在现有基础上补充两个独立模块：

- `felt_photography_v1_0`：真实羊毛毡商品摄影规则
- `felt_composition_v1_0`：主体画面占比与构图规则

这些规则基于此前 17 张高质量羊毛毡商品参考图的视觉分析。

**本次任务是增量扩展，不是重写此前的材质规则。**

请先检查现有项目和已经完成的 v1.0 集成，复用现有提示词组装、规则管理和界面组件，不要建立重复的系统。

## 二、真实商品摄影规则

### PR-01：真实生活环境

默认商品展示可采用自然木质桌面和柔和的真实室内背景。

英文描述：

"Place the handcrafted wool figurine on a realistic natural wooden tabletop in a softly lit indoor environment. The scene should resemble authentic artisan product photography captured with a real camera."

画面应有明确的桌面、背景及商品之间的空间关系。

避免让商品看起来像简单粘贴在数字背景上。

### PR-02：背景预设

支持以下五种摄影模式：

**A. Preserve Original**

保持用户原始图片背景，不额外添加摄影环境。

适合仅改变商品材质的操作。

**B. Natural Tabletop（建议默认商品摄影预设）**

- 浅橡木或自然原木桌面
- 米白色、暖灰色墙面
- 可见但不突出的室内环境
- 柔和侧窗自然光
- 自然桌面阴影
- 适度背景虚化

**C. Home Lifestyle**

- 真实家居环境
- 木质家具、窗户或少量生活装饰
- 背景内容与商品主题相关
- 柔和自然光
- 主体清晰，背景虚化

**D. Seasonal Lifestyle**

根据商品主题自动选择合理的季节或节庆布景。

例如：

- 秋季商品：暖色家具、秋叶、少量秋季装饰
- 圣诞商品：松枝、暖色灯光、少量节庆装饰
- 阅读主题商品：书桌、书本、柔和台灯

不得为所有商品强制添加节日装饰。

**E. White Studio**

- 纯白背景
- 柔和均匀的摄影棚灯光
- 清楚的商品轮廓
- 自然接触阴影
- 不添加任何背景道具

### PR-03：光照

默认使用：

"Soft diffused natural window light, gentle directional illumination, realistic soft shadows, and balanced color temperature."

要求：

- 避免过度明亮的 CGI 高光
- 不使用夸张的商业滤镜
- 保留真实的羊毛纤维明暗细节
- 保持商品原有颜色，不因暖光产生严重偏色

### PR-04：景深

默认使用：

"Keep the entire figurine clearly recognizable and in focus while allowing the distant background to remain naturally and softly blurred."

不要让浅景深导致商品头部、配件或脚部无故模糊。

不要生成不合理的背景虚化边缘或人工景深效果。

### PR-05：物理接触与空间尺度

商品必须具有可信的桌面接触关系。

要求：

- 接触阴影与光源方向一致
- 玩偶不悬浮
- 桌面纹理符合透视
- 商品与家具、背景道具的相对大小合理
- 不出现不符合真实摄影逻辑的阴影或空间关系

## 三、主体画面占比规则

### CR-01：区分三种比例

系统必须区分：

1. `aspect_ratio`：输出图片画幅比例，例如 1:1
2. `subject_height_ratio`：整个主体占图片总高度的比例
3. `character_proportions`：人物或动物自身的头身比例、四肢比例等

允许改变前两项，但在参考图材质转换任务中，应尽量保持第三项不变。

### CR-02：主体高度占比预设

建议提供以下预设：

- Small：45%
- Standard：60%
- Close-up：75%
- Detail：85%

同时允许用户在合理范围内调整。

默认商品摄影使用：

`subject_height_ratio = 0.60`

这属于构图目标，不是保证模型能够精确执行的像素级约束。

### CR-03：主体位置

对于标准 60% 构图，使用以下英文要求：

"The complete figurine should occupy approximately 60% of the total image height, leaving generous natural negative space around it. Position the subject horizontally centered, with its feet or base naturally resting on the tabletop near the lower portion of the composition."

要求：

- 主体完整显示
- 帽子、耳朵、尾巴和配饰不被裁切
- 画面上方保留适当留白
- 主体水平居中，除非用户选择其他构图
- 商品在桌面上自然放置
- 不为了缩小主体而改变商品自身比例

对于横向动物、多人组合或宽度较大的商品，应同时检查整个主体的宽度，避免裁切。

多主体组合按照整体外接范围计算占比。

### CR-04：参考图的构图覆盖策略

这是非常重要的一条。

此前图生图流程可能包含类似：

"Keep the framing and character scale consistent with the reference."

当用户明确指定新的主体占比时，这句话必须调整。

此时应该保留：

- Character identity
- Facial features
- Body proportions
- Pose
- Clothing
- Colors
- Accessories

但是允许改变：

- Camera framing
- Subject size within the image
- Background
- Photographic environment

不要同时要求保持原始构图和使用新的主体占比。

### CR-05：真实空间中的主体缩放

用户选择 60% 主体占比时，目标是让整个商品在画面中看起来更小、周围拥有更多空间。

不要把玩偶自身的头部、帽子、身体或者四肢单独缩小。

也不要只是把主体缩小后机械粘贴到背景。

应让桌面、阴影、摄影机视角和环境空间关系一起保持合理。

## 四、用户控制优先级

请增加或复用摄影与构图配置：

- `photography_preset`
- `subject_height_ratio`
- `aspect_ratio`
- `framing_policy`

其中 `framing_policy` 至少支持：

- `preserve_reference`：保留原图构图
- `override_reference`：使用用户选择的主体占比

用户还应能独立选择是否保留原图背景。

处理优先级：

1. 用户明确指令
2. 原始人物或商品的辨识度
3. 用户选择的摄影和构图设置
4. 羊毛毡材质规则
5. 自动推荐的默认摄影效果

如果用户要求“仅修改材质”，则默认保留原图的背景和构图。

如果用户选择“商品摄影展示”，则可以应用自然桌面背景与标准主体占比。

若用户明确选择某种背景或构图，不得被自动规则覆盖。

## 五、提示词拼接结构

建议最终 Prompt 采用以下模块：

1. SUBJECT / REFERENCE PRESERVATION
2. MATERIAL / NEEDLE-FELT REALISM
3. PHYSICAL STRUCTURE
4. PHOTOGRAPHY / BACKGROUND
5. COMPOSITION / SUBJECT OCCUPANCY
6. NEGATIVE CONSTRAINTS

避免同一条 Prompt 中出现相互矛盾的要求。

背景、构图规则不应重新定义羊毛毡纤维密度。

## 六、默认英文摄影和构图模板

以下是适用于 60% 主体占比及自然桌面摄影的基础文本：

"Photograph the handcrafted wool figurine as a small physical collectible placed on a realistic natural wooden tabletop inside a softly lit home environment.

Use soft diffused daylight entering from one side, natural contact shadows, realistic tabletop perspective, and a softly blurred warm neutral interior background.

The complete figurine should occupy approximately 60% of the total image height, leaving generous negative space above and around the subject.

Keep the entire figurine visible, horizontally centered, with its feet or base naturally resting on the tabletop.

Preserve the character's exact internal proportions, facial features, pose, clothing, and accessories.

Use a square 1:1 composition unless the user specifies otherwise.

The image should look like real artisan product photography, with authentic spatial depth and natural environmental lighting.

Do not enlarge the figurine to fill the entire frame. Do not crop the hat, ears, limbs, or accessories. Do not alter the figurine's anatomy or material texture."

这段仅在用户选择对应预设时加入。

其他背景类型应使用各自的模板，不能所有模式都强制加入木桌。

## 七、界面与工程要求

请根据现有项目 UI 设计增加或复用：

1. 摄影背景选择
2. 主体高度占比控制
3. 保留原构图 / 使用新构图切换
4. 图片画幅比例设置（若项目已有则直接复用）

要求：

- 不破坏现有剪辑模式
- 不破坏高级工具与无限画布
- 不改变原有四方向生图机制
- 不修改既有材质规则的有效版本
- 不覆盖用户自行输入的背景要求
- 尽量复用已有参数和预设系统
- 不重复拼接同一段摄影规则
- 保留最终 Prompt 的查看及调试能力

如果没有必要，不要新增复杂的摄影参数界面。

## 八、验收标准

至少检查以下场景：

**场景 1：蓝帽小男孩**

输入原始卡通参考图。

选择羊毛毡 v1.0、自然木桌、主体高度 60%、正方形画幅。

期望：

- 保持原人物造型和动作
- 主体不再占满图片
- 出现真实木桌及柔和室内背景
- 接触阴影合理
- 羊毛毡材质不变

**场景 2：仅材质转换**

使用相同参考图。

选择保留原背景和原始构图。

期望：

- 不擅自更换背景
- 不擅自缩小人物
- 只转换材质

**场景 3：动物横向构图**

输入乌龟或鲸鱼类参考图。

期望：

- 保留完整横向身体
- 不因为固定主体高度而裁切身体
- 桌面和整体位置自然

**场景 4：节庆商品**

选择节庆生活方式背景。

期望：

- 背景与商品主题相符
- 装饰不过度
- 主体仍然清晰
- 不改变原始商品设计

## 九、最终交付

完成后请说明：

1. 本次实际修改了哪些文件
2. 摄影规则存放位置
3. 构图规则存放位置
4. 如何与 `needle_felt_v1_0` 协同
5. 用户如何修改背景和主体占比
6. 两种不同预设生成的完整 Prompt 示例
7. 已完成的测试及未解决的问题

请先检查代码，再在现有架构上实施。

本次仅增加摄影与构图能力，不要重构无关功能，不要重新设计羊毛毡材质规则。