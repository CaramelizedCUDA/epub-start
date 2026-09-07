# 文档索引与维护职责

面向使用者的入口是 [README](../README.md)。当前任务只在 [TODO](../TODO.md) 排序；下面按职责查阅，避免在多个文件重复维护状态。

| 文档 | 唯一职责 |
| --- | --- |
| [TODO](../TODO.md) | 当前执行顺序、状态、完成标准和验收证据入口 |
| [ROADMAP](../ROADMAP.md) | 长期阶段、进入/退出门禁与冻结范围 |
| [验证策略](VERIFICATION.md) | 验证影响面、必跑/建议、阶段门禁、证据复用与停止条件 |
| [开发指南](DEVELOPMENT.md) | 环境、开发/验证命令及样本使用 |
| [CONVENTIONS](../CONVENTIONS.md) | 实现规则、唯一依赖白名单和引入审批 |
| [ARCHITECTURE](../ARCHITECTURE.md) | 当前模块职责与目标设计的明确区分 |
| [DATABASE](../DATABASE.md) | 当前 Schema、字段生命周期与追加迁移规则 |
| [IPC](../IPC.md) | 当前 Command、共享模型与错误语义 |
| [CONTEXT](../CONTEXT.md) | 领域词汇；不预设表或接口 |
| [SECURITY](../SECURITY.md) | 安全、隐私、资源防护和漏洞反馈 |
| [AGENTS](../AGENTS.md) | Agent 工作入口与验证诚实规则，Luna 同样必须遵守 |
| [ADR](adr/0001-reading-duration-history.md) | 已接受的重要设计决策及其理由 |

## 验收与历史

- [验收索引](verification/README.md)：区分历史记录与当前复测范围。
- [BACKEND_AUDIT](../BACKEND_AUDIT.md)：后端审计及当前自动统计。
- [B3 历史冻结候选](../B3_CONTRACT_FREEZE.md)：保留旧快照，不充当当前阶段锁。

## 修改与冲突处理

同一事实由职责最专门的文档维护，其他文档使用链接。README 只给使用者必要的功能/平台摘要，不重复测试数字和完整阶段时间线。

现状修正应依据当前代码、最新明确确认及对应验收记录；不得用新摘要改写历史证据。归档保留原始日期、测试范围和未测项，过期任务不再参与执行排序。新增验收记录放入 `docs/verification/`；现有根目录验收文件保留原路径以避免断链。

未来设计先写 ROADMAP 的对应阶段；形成已接受决策后再记录 ADR。规划、批准实施、代码已实现、自动验证、设备验收和正式发布是不同状态。文档整理不解锁 P3/P4，不批准新依赖、不修改数据库或 IPC。

涉及依赖、契约或 Schema 的真实变更，仍按 CONVENTIONS/AGENTS 的审批、同步和变红验证规则处理；不能把规范冲突仅解释为文档排版问题。
