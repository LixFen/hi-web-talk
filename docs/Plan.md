项目完整描述
一、项目定位

这是一个单用户、本地运行、无数据库、基于 React + Node.js 的 AI 对话管理工具。它支持多模型配置、OpenAI 兼容接口、分支式对话图、多视图浏览，以及摘要与上下文筛选能力。它的目标不是做一个普通的“消息顺序聊天页”，而是实现一个：

基于 Block（对话块）图结构的本地 AI 会话管理器。

项目最核心的创新点在于：对话不是按 message 列表组织，而是按 Block 图组织；LLM 实际接收到的只是本地算法从图中提取出的线性上下文。 也就是说，图结构只在本地存在，模型端永远只看到普通的 system / user / assistant 消息序列。

二、核心设计思想
1. Block 是最小业务单元

本项目不把“单条消息”作为核心结构，而是把“一次用户输入 + 一次 AI 回复 + 元数据 + 父引用”封装为一个 Block。因此底层数据结构不是 message[]，而是一个 block graph。

2. 会话本质是一张图

一个会话由一个 system root block 作为起点，其他 dialogue block 通过 parentBlockSHA1 形成有向图。
从根块到任意当前块的唯一路径称为一条“链”，用户平时继续聊天，其实是在当前活动链的末端继续追加新块。

3. 历史不可变

项目强调历史块不可随意篡改，设计原则包括：

不允许编辑历史块
不允许删除中间块但保留后代
重新生成本质上是新块
分支本质上也是新块
复制挂接是复制子树，不修改原历史

这使得整个系统更稳定，也更适合后续扩展和追踪。

4. 模型选择是“发送时决策”

项目最新修订明确认为“会话默认模型”是坏设计。原因是：同一张对话图里，不同块可以由不同模型生成；块才是模型归属的真正单位。于是现在的原则变成：

Session 不再保存默认模型
输入区保留“当前待发送模型”的临时状态
发送时把该模型写入新块
历史块只对自身负责

因此，这个系统更像一个多模型调度工作台，而不是传统的单会话单模型聊天窗口。

三、项目要解决的问题

这个项目本质上是在解决传统聊天产品的几个限制：

第一，传统消息列表对“分支对话”支持很弱，一旦从历史节点继续聊，旧结构就不自然。
第二，传统聊天很难表达“同一段历史下，不同模型生成的多个答案并存”。
第三，传统上下文构造通常直接截断消息列表，不利于做摘要替代、忽略块、压缩历史。
第四，模型配置往往绑定在会话层，不适合你这种希望灵活切换 GPT、Gemini、Claude 等不同模型来完成不同任务的场景。

所以你的项目用“块图 + 本地上下文算法”来解决这些问题。

四、核心数据模型
1. Session

会话对象负责描述一张对话图的整体信息。按照最新修订，它主要保存：

sessionHash
title
createdAt
updatedAt
rootBlockSHA1
activeBlockSHA1
viewState.mode

其中 activeBlockSHA1 表示当前激活块，用户默认就在这条链上继续聊天。

2. Block

Block 是最核心的数据结构，包含：

sha1
blockType: "system" | "dialogue"
createdAt
modelAlias
prompt
response
tokenUsage
contextLength
parentBlockSHA1
flags
meta

其中：

system 块的 response 为空字符串
system 块的 modelAlias 可以为 null
只存父引用，不存 children，子节点关系运行时推导

这保证了存储结构简单，同时又能表达完整图关系。

3. SummaryRecord

摘要单独存储，不和块本体混在一起。摘要记录包括：

blockSHA1
summaryText
createdAt
summaryModelAlias
status
errorMessage

设计上是一块一个摘要记录的第一版方案，失败也会显式记状态。

4. ErrorLogRecord

错误不会写成正式对话块，而是进入单独错误日志表，用来记录：

哪个会话
哪个父块
哪个 prompt
使用哪个模型
报错时间
错误信息
原始错误

这样既不污染正式图，又保留调试和回显能力。

5. ModelProfile

模型配置支持 OpenAI 兼容接口，字段包括：

alias
providerType
baseURL
apiKeyEncrypted
modelName
temperature
topP
maxTokens
contextWindow
supportsStream
enabled

这说明项目从一开始就是面向多模型接入设计的。

五、唯一标识与 SHA-1 规则

项目使用 SHA-1 作为块的全局唯一标识。SHA-1 的计算字段顺序被固定为：

blockType
createdAt
modelAlias
prompt
response
tokenUsage
contextLength

这些字段会先序列化成稳定字符串，再计算 SHA-1。并且项目已经明确：计算 SHA-1 时不包含 parentBlockSHA1。这样做的好处是复制挂接时不会因为父节点改变而破坏块哈希逻辑。
另外，system block 也复用统一规则，只是其 modelAlias = null、response = ""、parentBlockSHA1 = null。

六、图结构行为规则

项目中的图不是只支持线性追加，而是支持分支和复用。

1. 任意块都可继续回复

不要求必须是叶子块。你可以在任意历史块上继续对话，系统会在该块下面新建一个 child block，形成新的分支。

2. 删除规则清晰

当前建议规则是：

可以删除任意叶子块
可以删除某块及其整个后继子树
不允许删除中间块但保留其后代

这保证了图结构始终自洽，不会产生断裂。

3. 复制挂接

项目支持从某个源块开始复制其完整后继子树，再把复制后的入口块挂接到目标块下方。为了避免误操作，超过 30 个块时需要额外确认。

七、上下文构造算法

这是项目最重要的算法部分，也是答辩时最值得讲的地方。

系统发给 LLM 的并不是整张图，而是根据当前块反向回溯父链后，提取出一个线性 messages[]。规则大致是：

从当前块沿 parentBlockSHA1 一路向上回溯，直到 system root
如果某块 ignoreInContext = true，则跳过
如果某块配置了 summaryPinned / preferSummary 且已有摘要，则用摘要代替原始内容
按模型配置限制最多纳入多少有效上下文块
结合 tokenUsage 或字符近似估算控制上下文长度
最前面始终插入 system prompt

也就是说，你的系统本质是：图结构负责表达历史与分支，ContextBuilder 负责把图压平成模型可消费的线性上下文。
另外，摘要消息推荐以更自然的 system message 形式注入，而不是用过于花哨的标记。

八、摘要系统设计

摘要系统是项目的“上下文压缩层”。

目前设计特点是：

摘要只针对单个块
摘要模型可单独配置
摘要不直接存进块，而是外置到 summaries.json
采用懒加载策略

典型流程是：

用户先给某块打上摘要相关标记
真正需要展示或构造上下文时再查摘要
若摘要不存在，则调用摘要模型生成并写入
若生成失败，则记录失败状态

这套设计非常适合作为后期优化上下文窗口的基础。

九、模型系统设计

项目支持多模型配置，但不在会话层绑定模型。

当前正确口径是：

模型 alias 全局唯一
每次发送前由用户决定当前使用哪个模型
新块保存自己的 modelAlias
历史块只记录自己当时使用的模型、token 消耗和上下文长度


十、存储结构设计

项目强调本地运行、无数据库，因此采用 JSON 文件持久化。推荐目录结构为：

/data/sessions/{sessionHash}/session.json
/data/sessions/{sessionHash}/summaries.json
/data/sessions/{sessionHash}/errors.json
/data/config/models.json
/data/config/app-settings.json

其中：

session.json 保存会话元数据和 blocks map
summaries.json 保存块摘要
errors.json 保存错误日志
models.json 保存模型配置

这说明你的项目是典型的轻量本地桌面式/本地服务式架构，非常适合作业展示和 MVP 实现。

十一、前端交互与多视图设计

项目至少包含三种视图：

1. 聊天视图

只显示当前活动链，以最接近 ChatGPT 的方式进行日常使用。

2. 当前卡片链视图

把每个 block 以明显卡片展示，可展开元数据，并可执行：

复制
重新生成
创建分支
查看 SHA1
ignore 标记
摘要优先标记
查看元数据

这个视图非常适合作业演示，因为它能突出你的 Block 设计。

3. 网状图视图

显示整张会话图，支持选中任意块、查看分支关系、切换 active block。这是你项目创新性的最直观展示方式。

十二、前后端模块划分
前端

前端规划包含：

页面层：SessionListPage、ChatWorkspacePage
视图组件：ChatView、ChainCardView、GraphView
Block 组件：BlockCard、BlockMetaPanel、ErrorBlockCard
配置组件：ModelSelector、ModelSettingsPanel、SystemPromptPresetSelector
输入组件：PromptInputBox
状态管理：推荐 Zustand

这说明前端不仅负责渲染聊天，还要负责图浏览、模型选择和块级操作。

后端

后端模块规划较完整，包括：

SessionService
BlockGraphService
ContextBuilderService
ModelConfigService
LLMProviderService
SummaryService
ErrorLogService

这说明你后端不是简单转发 API，而是承担了图维护、上下文构造、摘要调度和本地持久化等核心职责。

十三、接口设计

资料中已经有比较清晰的 API 草图，分为：

Session API：创建、读取、删除会话，切换 active block
Block API：reply、regenerate、branch、copy-subtree、delete subtree、patch flags、get meta
Summary API：生成和获取块摘要
Model API：模型配置增删改查

这说明项目后端接口已经具有较强的可实施性，不只是概念性描述。

十四、MVP 路线

项目的开发顺序也比较清楚：

第一阶段先做最小可运行骨架：

会话创建
system block 初始化
普通聊天
当前链展示
session.json 存储
activeBlock 切换
多模型配置
OpenAI 兼容请求

第二阶段做核心亮点：

分支创建
重新生成 sibling block
卡片链视图
网状图视图
SHA1 检索
任意块继续回复

第三阶段做上下文高级能力：

ignore
preferSummary
summary 文件
完整 ContextBuilder
token/字符双模式长度控制

第四阶段再做增强项：

复制子树挂接
大规模复制确认
错误日志面板
深色模式
移动端适配

这个路线安排说明项目有明确的 MVP 思维，不是一开始就追求一次做满。

十五、项目特色总结

把这份项目概括成一句话，就是：

这是一个把 AI 对话从“消息列表”升级为“对话块图”的本地多模型聊天系统。

它的特色不只是能聊天，而是：

能在任意历史节点继续分支
能把不同模型的回答都作为图中的块保存
能通过本地算法对上下文做裁剪、压缩和摘要替换
能在聊天视图、链式视图和图视图之间切换
能以 JSON 文件完成完整持久化，无需数据库

如果用于作业展示，这个项目的亮点会非常集中：数据结构创新、上下文算法明确、产品交互有差异化、工程实现边界清晰。 这些都已经在当前资料中体现出来。