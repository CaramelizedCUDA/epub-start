# Domain Docs

本仓库的工程技能按以下规则读取领域文档。

## 本仓库配置

- **布局**：单上下文（single-context）。
- **词汇文件**：根目录 `CONTEXT.md`（既有文件，保留原名与位置，不重命名为 `GLOSSARY.md`）。
- **ADR 目录**：`docs/adr/`，当前包含 `0001-reading-duration-history.md`。
- **不存在**：`GLOSSARY-MAP.md` 与 `CONTEXT-MAP.md`，本仓库不使用多上下文布局。

## Select the vocabulary documents

优先使用用户、项目指令或本配置中明确声明的位置。本仓库即根目录 `CONTEXT.md`。若将来出现多份词汇文件，再读取对应的 `GLOSSARY-MAP.md` 或 `CONTEXT-MAP.md` 并跟随其实际链接。

词汇文件保持既有文件名与位置。若同一上下文出现两份文件，以声明的权威文件为准；没有声明时，比较内容：内容相同可用于阅读，但写入需要选定一个目标；定义不同则先向用户提出，再修改该词汇。只解决影响当前工作的歧义。

阅读与当前范围相关的 ADR，包括项目链接或声明的上下文 ADR 目录。缺少可选的领域文档不阻塞普通工作。阅读词汇与 ADR 是只读操作；只有任务明确要求某个产物或决策记录时才创建或修改。

## File structure

本仓库采用的单上下文结构：

```text
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-reading-duration-history.md
└── src/
```

既有 `CONTEXT.md` 布局继续有效。不要为了采用默认名称而重命名既有文档，或复制出重复副本。

## Use the glossary's vocabulary

在 issue 标题、重构提案、假设或测试中提到领域概念时，使用所选词汇文件中定义的术语。若需要的术语不存在，先判断它是真实的词汇缺口，还是项目刻意避免的同义词。仅阅读或解释术语不会触发写入流程。

## Flag ADR conflicts

若产出与既有 ADR 矛盾，应指出冲突及其理由，不得静默覆盖该决策。
