/**
 * usage hints — 检索/写入结果尾随的 JIT 使用提示
 * （原 engine/config.yaml usage_hint 段，随 TS 化迁为常量）
 */

export const USAGE_HINT_SEARCH = `检索结果按 cos+kw 加权排序。要点：
1. 同一话题可能同时有「失败尝试」和「成功方法」两条记录：若 top 命中显示 下载失败/无法/被拦截 且 pattern=try，往下翻找 pattern=succeed 且写明实际成功的记录，或换说法再搜。
2. 只看 summary 不够，用 neuron_source 工具取完整 men.content 确认真实结果。
3. men.core_file[].path 存可复用脚本的相对路径（如 l3.raw/xxx.py），按路径读取复用，不要重新造轮子。
4. 查询用自然语句（做了什么/怎么做的），不要关键词堆砌（BGE 对自然语句友好）。
5. 用户给了完整链接/ID 时，把 URL 或关键标识直接拼进查询，命中带相同 ID 的既有记录更准。
6. 结果与现实不符 → 用 remember(update) supersede 修正旧条目。`

export const USAGE_HINT_SOURCE = `按 men.core_file[].path 读 l3.raw/ 下脚本复用；若 core_file 为空，直接按 men.content 描述手动操作。`

export const USAGE_HINT_PRECOG_ANNOTATE = `本次检索已写入 precog 记录（见 precog.record_id）。请顺手用 neuron_fill_precog 工具标注这条：
1. description ≥60 字：概括本次查询意图 + 检索命中情况。
2. accuracy_list 逐条对应 precog.results：true=结果直接回答了查询；revelant=相关但非直接答案；false=无关噪音。
刚用过这些结果，此刻标注最准；标注后的 precog 喂入认知聚合。`

export const USAGE_HINT_COGNITION_COLD = `本次检索命中的记忆尚未聚合出认知簇（cognition.nodes/communities 为空）。
用 neuron_fill_precog 标注本次 precog（record_id 见上）后，
这些记忆会在认知话题域聚合出节点/社群，下次检索即可反查溯源。`

/** remember 写入回执提示（回显通用录入约定；库个性文案经 config prompts.add_memory 注入） */
export const USAGE_HINT_REMEMBER = `录入约定：content 保留 [用户]/[Agent] 前缀对话格式；pattern 用 succeed/try/failed 标注结果性质；summary 一句话（检索列表只显示它）；可复用脚本放 core_file。纠错用 action=update（supersede，旧条目自动废弃不删除）。`
