# 验收记录索引

当前任务状态见 [TODO](../../TODO.md)。本目录用于保存版本/设备明确的证据摘要，记录操作、已测项、未测项、结果及证据位置。旧记录按 [验证策略](../VERIFICATION.md) 判断可复用范围，不能自动外推新前端或新格式。

| 记录 | 用途与范围 |
| --- | --- |
| [首版归并与归档](first-release-closeout-2026-09-16.md) | main 接收验收候选、目录归档、证据复用及发布待办 |
| [当前候选入口](epub-closeout-current-2026-09-15.md) | 当前 main 与旧候选归档位置 |
| [E5–E11 本轮修复与验收](e5-e11-epub-closeout-2026-09-14.md) | 从云端代码接收至双端修复收尾的同阶段事实 |
| [Agent 规范分层](agent-policy-2026-09-12.md) | 按任务与模型读取规范、可选委派及限定范围行为检查 |
| [验证节奏与自动入口](verification-policy-2026-09-07.md) | 本轮规范调整、自动化覆盖与未测范围 |
| [E5 阅读会话隔离](e5-reader-2026-09-08.md) | 开关书旧请求隔离、定向回归及引擎/阶段未完成范围 |
| [E5 封面与排版修复](e5-reader-cover-layout-2026-09-08.md) | EPUB3 封面识别、普通重排图片边界及固定/混合版式范围 |
| [E4 标签管理](e4-tags-2026-09-08.md) | 标签保存后的关联视图及筛选刷新、组件 smoke 和阶段未测范围 |
| [E3 系列协调](e3-series-2026-09-08.md) | 切换与写入隔离修复、组件 smoke 及持久化未测范围 |
| [E2 来源操作](e2-source-actions-2026-09-07.md) | 部分导入失败刷新修复、目标红绿与阶段未测范围 |
| [E1 书架收尾](e1-shelf-closeout-2026-09-07.md) | Windows 状态与双机主路径的限定范围证据 |
| [原 TODO 历史](development-history-through-2026-09-06.md) | 文档整理前完整快照，含 B0–B4 和 F1/F2 限定范围记录；未完成项不是当前执行队列 |
| [原 ROADMAP 补测时间线](roadmap-history-through-2026-09-06.md) | 迁出的逐次补测和前端迭代记录 |
| [后端审计](../../BACKEND_AUDIT.md) | 辅助逻辑、审计缺口与统计口径 |
| [Windows 回归](../../B3_WINDOWS_RUNTIME.md) | 历史桌面开发态/release 回归，不替代新前端完整验收 |
| [Android 存储验收](../../ANDROID_STORAGE_ACCEPTANCE.md) | 受控 AVD 存储压力与恢复；不外推 OEM 性能 |
| [Android 候选](../../B3_ANDROID_RELEASE_CANDIDATE.md) | 技术冻结、候选制品与未签发范围 |
| [固定样本清单](../../B3_ANDROID_SAMPLE_MANIFEST.md) | 历史候选采用的 EPUB 清单与哈希 |

本机 `target/`、日志和测试书籍通常未纳入版本库。引用本机证据时须明确可获取性；公开截图应另行挑选并检查书籍内容和来源隐私，不自动复制本机样本或设备数据。
