# Issue tracker: GitHub

本仓库的 issue 与规格说明存放在 GitHub Issues，所有操作使用 `gh` CLI。仓库远程为 `origin`（`https://github.com/CaramelizedCUDA/epub-start.git`）。

## Conventions

创建或修改远程 tracker 状态（包括 issue、PR、评论、标签、指派、认领和关闭）属于外部写操作。只有当前任务已经明确授权该具体动作时才运行写命令；本文档只记录语法，本身不授予任何权限。

- **Create an issue**：Windows 上优先使用 PowerShell 示例，Bash 示例只在 Bash shell 中使用。两者都会远程创建 issue，需要上述授权。

### PowerShell (preferred on Windows)

多行正文以无 BOM 的 UTF-8 写入临时文件，再用 `gh issue create --body-file <path>` 传入：

```powershell
$title = 'Investigate the export failure'
$body = @'
## Observed
Export fails after selecting a valid file.

## Expected
The selected file is exported without an error.
'@

# Write a temporary UTF-8 body file without a BOM so gh reads the full text cleanly.
$bodyPath = Join-Path $env:TEMP (([guid]::NewGuid().ToString('N')) + '.md')
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
try {
    [System.IO.File]::WriteAllText($bodyPath, $body, $utf8NoBom)

    # This creates an issue remotely; run it only with existing task authorization.
    gh issue create --title $title --body-file $bodyPath
    if ($LASTEXITCODE -ne 0) {
        throw "gh issue create failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
}
```

### Bash (only when the current shell is Bash)

使用带引号的 here-document 放在命令替换中。不要把这段 Bash 语法粘贴进 PowerShell：

```bash
gh issue create --title "Investigate the export failure" --body "$(cat <<'BODY'
## Observed
Export fails after selecting a valid file.

## Expected
The selected file is exported without an error.
BODY
)"
```

- **Read an issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **List issues**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 与 `--state` 过滤。
- **Make an issue a sub-issue of a parent**：`gh issue create --parent <parent> ...`，或创建后用 `gh issue edit <parent> --add-sub-issue <child>`（需要 `gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（使用数字 database id，见下文 **Blocking**）。未启用 sub-issues 时，在子 issue 正文顶部写 `Part of #<parent>`。
- **Comment on an issue**：`gh issue comment <number> --body "..."`
- **Apply / remove labels**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**：`gh issue close <number> --comment "..."`

在仓库目录内运行时，`gh` 会自动从 `git remote -v` 推断仓库。

## Pull requests as a triage surface

**PRs as a request surface: no.** _(设为 `yes` 时，外部 PR 按 issue 的标签与状态流程处理；`/triage` 读取此开关。)_

设为 `yes` 时，PR 使用与 issue 相同的标签与状态，对应命令为 `gh pr` 系列：

- **Read a PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **List external PRs for triage**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **Comment / label / close**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用编号空间，裸 `#42` 可能指两者之一：先用 `gh pr view 42` 判断，失败再回退 `gh issue view 42`。

## When a skill says "publish to the issue tracker"

创建一个 GitHub issue。

## When a skill says "fetch the relevant ticket"

按上文 **Read an issue** 读取。

## Wayfinding operations

由 `/wayfinder` 使用。**map** 是一个标记为 `wayfinder:map` 的 issue，正文包含 Notes / Decisions-so-far / Fog；**child** 是通过 GitHub sub-issue 关联到 map 的 issue。

- **Map**：`gh issue create --label wayfinder:map`，正文包含 Notes / Decisions-so-far / Fog。
- **Child ticket**：通过 sub-issue 关联到 map（见上文 **Make an issue a sub-issue of a parent**）；未启用 sub-issues 时，在 map 正文的任务列表中加入，并在子 issue 正文顶部写 `Part of #<map>`。标签为 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后指派给驱动的开发者。
- **Blocking**：使用 GitHub 原生 issue dependencies。添加依赖边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞项的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#number` 也不是 `node_id`）。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告仍未关闭的阻塞项，这是实时闸门。依赖接口不可用时，在子 issue 正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞项关闭后才解除阻塞。
- **Frontier query**：列出 map 下的未关闭子项（`gh issue list --state open`，限定在 map 的 sub-issues / 任务列表中），去掉仍有未关闭阻塞项（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中有未关闭 issue）或已有指派人的项；按 map 顺序取第一个。
- **Claim**：`gh issue edit <n> --add-assignee @me`，这是会话中的第一次写操作。
- **Resolve**：`gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，然后把上下文指针（摘要与链接）追加到 map 的 Decisions-so-far。
