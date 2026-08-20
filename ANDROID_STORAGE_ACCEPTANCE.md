# B2 Android 运行时存储延期验收包

状态：**待执行，未形成 Android 运行态通过证据**。

本文件用于在后续具备受控 Android 虚拟设备时，关闭 B2 的低存储、缓存重启恢复和长期压力门禁。当前代码侧的辅助逻辑测试、桌面构建与 Android 制品检查不替代本文件中的运行态验收。

## 1. 固定环境与安全门

验收只允许在可丢弃的虚拟设备上执行。建议固定为 API 35、Google APIs x86_64、`/data` 1536 MiB，并在记录中保存 system image revision、AVD 配置和快照名。创建/下载 AVD 不属于本次收口执行范围。

使用当前 profile 制品：

- APK：`D:\epub_start\src-tauri\gen\android\app\build\outputs\apk\x86_64\profile\app-x86_64-profile.apk`
- 包名：`com.epubstart.reader.profile`
- profile 继承 release Rust 与 release 依赖，关闭 R8，使用 debug 签名并允许 `run-as`；x86_64 APK 只用于匹配 Windows AVD，不是 arm64 发布基线或发布制品。
- 固定 EPUB：`D:\epub_start\这里是终末停滞委员会\epub\6.epub`
- EPUB 大小：8,521,993 字节
- EPUB SHA-256：`1138B2A23BB79F9DF0727D0D34EA6055E8D1E4EA363EAC865D2F8FB2108E5980`

若 x86_64 profile APK 不存在，先用已有 JDK/SDK/NDK 重建；首次执行需允许 Gradle从已配置仓库取得依赖，或提前准备完整缓存。Tauri 的独立 `rustBuildX86_64Profile` 任务依赖上层 CLI WebSocket，不能单独调用；以下步骤直接用同一 NDK 编译 release Rust 库，把它暂存到已忽略的 `jniLibs/x86_64`，再让 Gradle完成 profile 打包。该暂存文件不得提交。

```powershell
$NdkBin = 'D:\Android\Sdk\ndk\27.3.13750724\toolchains\llvm\prebuilt\windows-x86_64\bin'
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'
$env:ANDROID_NDK_HOME = 'D:\Android\Sdk\ndk\27.3.13750724'
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER = Join-Path $NdkBin 'x86_64-linux-android24-clang.cmd'
$env:CC_x86_64_linux_android = Join-Path $NdkBin 'x86_64-linux-android24-clang.cmd'
$env:AR_x86_64_linux_android = Join-Path $NdkBin 'llvm-ar.exe'
cargo build --manifest-path 'D:\epub_start\src-tauri\Cargo.toml' --target x86_64-linux-android --release
if ($LASTEXITCODE -ne 0) { throw 'x86_64 Rust build failed.' }

$JniDir = 'D:\epub_start\src-tauri\gen\android\app\src\main\jniLibs\x86_64'
New-Item -ItemType Directory -Force -Path $JniDir | Out-Null
Copy-Item -LiteralPath 'D:\epub_start\src-tauri\target\x86_64-linux-android\release\libepub_start_lib.so' -Destination (Join-Path $JniDir 'libepub_start_lib.so') -Force
$env:JAVA_HOME = 'D:\Android\jdk17\jdk-17.0.20+8'
$env:GRADLE_OPTS = '-Djava.io.tmpdir=D:\epub_start\src-tauri\target\codex-gradle-jvm-tmp'
& 'C:\Users\OigwenTs\.gradle\wrapper\dists\gradle-8.14.3-bin\cv11ve7ro1n3o1j4so8xd9n66\gradle-8.14.3\bin\gradle.bat' --project-dir 'D:\epub_start\src-tauri\gen\android' --no-daemon '-Pkotlin.compiler.execution.strategy=in-process' :app:assembleX86_64Profile :app:bundleX86_64Profile -x rustBuildX86_64Profile
if ($LASTEXITCODE -ne 0) { throw 'x86_64 profile packaging failed.' }
```

先在 PowerShell 7 执行以下安全门。任何断言失败都必须停止；不得把序列号替换成真机序列号继续执行。

```powershell
$Repo = 'D:\epub_start'
$Adb = 'D:\Android\Sdk\platform-tools\adb.exe'
$Sqlite = 'D:\msys64\mingw64\bin\sqlite3.exe'
$Package = 'com.epubstart.reader.profile'
$Apk = Join-Path $Repo 'src-tauri\gen\android\app\build\outputs\apk\x86_64\profile\app-x86_64-profile.apk'
$Fixture = Join-Path $Repo '这里是终末停滞委员会\epub\6.epub'
$Evidence = Join-Path $Repo ('target\android-b2-acceptance-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $Evidence | Out-Null

$Online = @(& $Adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })
if ($Online.Count -ne 1) { throw "Expected exactly one authorized Android target; found $($Online.Count)." }
$Serial = ($Online[0] -split "\t")[0]
if (-not $Serial.StartsWith('emulator-', [System.StringComparison]::Ordinal)) {
    throw "Refusing destructive storage tests on non-emulator target: $Serial"
}
$Qemu = (& $Adb -s $Serial shell getprop ro.kernel.qemu).Trim()
if ($Qemu -ne '1') { throw "Target does not report ro.kernel.qemu=1: $Serial" }
if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw "Missing profile APK: $Apk" }
if (-not (Test-Path -LiteralPath $Fixture -PathType Leaf)) { throw "Missing fixed EPUB: $Fixture" }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Fixture).Hash -ne '1138B2A23BB79F9DF0727D0D34EA6055E8D1E4EA363EAC865D2F8FB2108E5980') {
    throw 'Fixed EPUB hash changed.'
}

Get-FileHash -Algorithm SHA256 -LiteralPath $Apk | Format-List | Out-File -Encoding utf8 (Join-Path $Evidence 'profile-apk-sha256.txt')
& $Adb -s $Serial shell getprop | Out-File -Encoding utf8 (Join-Path $Evidence 'getprop-before.txt')
& $Adb -s $Serial shell df -k /data | Out-File -Encoding utf8 (Join-Path $Evidence 'df-before.txt')
& $Adb -s $Serial shell cat /proc/meminfo | Out-File -Encoding utf8 (Join-Path $Evidence 'meminfo-before.txt')
```

## 2. 空白安装基线

卸载只发生在已经通过上方双重虚拟设备检查的 profile 包。它会删除该 profile 包的全部数据；先保存需要保留的快照。

```powershell
$Installed = (& $Adb -s $Serial shell pm path $Package 2>$null) -match '^package:'
if ($Installed) {
    & $Adb -s $Serial uninstall $Package
    if ($LASTEXITCODE -ne 0) { throw 'Profile uninstall failed.' }
}
& $Adb -s $Serial install --no-streaming -t $Apk
if ($LASTEXITCODE -ne 0) { throw 'Profile install failed.' }
& $Adb -s $Serial logcat -c
& $Adb -s $Serial shell monkey -p $Package -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 5

$RunAs = (& $Adb -s $Serial shell run-as $Package pwd).Trim()
if ($LASTEXITCODE -ne 0 -or -not $RunAs.StartsWith('/data/')) { throw 'run-as is unavailable for the profile build.' }
& $Adb -s $Serial shell run-as $Package du -ak . | Out-File -Encoding utf8 (Join-Path $Evidence 'du-blank.txt')
& $Adb -s $Serial shell df -k /data | Out-File -Encoding utf8 (Join-Path $Evidence 'df-blank.txt')
& $Adb -s $Serial shell dumpsys package $Package | Out-File -Encoding utf8 (Join-Path $Evidence 'package.txt')
& $Adb -s $Serial logcat -d -v threadtime | Out-File -Encoding utf8 (Join-Path $Evidence 'logcat-blank.txt')
```

空白安装必须满足：应用可启动；`run-as` 可用；创建 `files/epubstart.db`、`files/source-cache/` 与 `files/covers/`；无 `.source`、封面候选或 journal/WAL 遗留。若实际 `app_data_dir` 布局不同，记录真实路径并停止修改本文件中的相对路径后再继续。

## 3. 统一证据快照

每个检查点执行以下命令。复制数据库前必须先 force-stop，避免把主库与 journal/WAL 拆成不同时间点。

```powershell
& $Adb -s $Serial shell am force-stop $Package
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
& $Adb -s $Serial shell run-as $Package du -ak . | Out-File -Encoding utf8 (Join-Path $Evidence "du-$Stamp.txt")
& $Adb -s $Serial shell df -k /data | Out-File -Encoding utf8 (Join-Path $Evidence "df-$Stamp.txt")
& $Adb -s $Serial exec-out run-as $Package cat files/epubstart.db > (Join-Path $Evidence "epubstart-$Stamp.db")
& $Adb -s $Serial shell run-as $Package ls -al files files/source-cache files/covers | Out-File -Encoding utf8 (Join-Path $Evidence "files-$Stamp.txt")
& $Adb -s $Serial logcat -d -v threadtime | Out-File -Encoding utf8 (Join-Path $Evidence "logcat-$Stamp.txt")
& $Sqlite (Join-Path $Evidence "epubstart-$Stamp.db") 'PRAGMA integrity_check; PRAGMA foreign_key_check; SELECT COUNT(*) AS books FROM books; SELECT COUNT(*), COALESCE(SUM(cache_size_bytes),0) FROM source_cache_entries; SELECT COUNT(*), COALESCE(SUM(length(CAST(title AS BLOB)) + length(CAST(body AS BLOB))),0) FROM search_documents;' | Out-File -Encoding utf8 (Join-Path $Evidence "sqlite-$Stamp.txt")
```

通过条件：`integrity_check` 为 `ok`，`foreign_key_check` 无行；文件清单、数据库元数据和 `du` 数字可以互相解释。主库、`-journal`、`-wal`、`-shm`、来源缓存、封面缓存必须分别记录，不能只写系统设置页总量。

## 4. 固定样本与软上限淘汰

先准备 46 个不同文件名但内容相同的受控样本。46 份来源字节为 392,211,678；样本中的 `cover.jpg` 为 1,484,820 字节，46 份为 68,301,720，分别足以越过来源 256 MiB 与封面 64 MiB 软上限。重复内容只用于存储治理，不作为不同作品身份测试。

```powershell
$FixtureDir = Join-Path $Repo 'target\b2-android-fixtures'
New-Item -ItemType Directory -Force -Path $FixtureDir | Out-Null
1..46 | ForEach-Object {
    Copy-Item -LiteralPath $Fixture -Destination (Join-Path $FixtureDir ('b2-cache-{0:D2}.epub' -f $_)) -Force
}
& $Adb -s $Serial shell mkdir -p /sdcard/Download/epubstart-b2
& $Adb -s $Serial push (Join-Path $FixtureDir '.') /sdcard/Download/epubstart-b2/
if ($LASTEXITCODE -ne 0) { throw 'Fixture upload failed.' }
```

在应用 picker 中一次选择这 46 份 EPUB，等待所有导入结束。随后打开第 46 本并连续翻页，再执行第 3 节快照。

通过条件：

- 来源缓存最终不超过 256 MiB，除当前候选或短暂活动租约外按 `source_cache_entries.last_accessed_at` 从旧到新淘汰；数据库记录的 `cache_size_bytes` 等于真实文件大小。
- 封面缓存最终不超过 64 MiB，按 `books.updated_at, books.id` 确定顺序淘汰；被淘汰图书的 `cover_cache_path` 置空，不留下孤儿文件。
- 当前正在读取或刚命中的来源不得在该请求生命周期内消失。设备侧并发观察只能补充单元测试，不能单独证明所有 hard-limit 分支。
- 任何无法安全淘汰的拒绝必须以 `BOOK_RESOURCE_LIMIT_EXCEEDED:` 开头，且数据库、旧封面与旧缓存保持一致。

## 5. 中断、重启与孤儿恢复

### 5.1 人工注入可重建垃圾

先 force-stop，再只在 profile 包私有目录注入固定文件：

```powershell
& $Adb -s $Serial shell am force-stop $Package
& $Adb -s $Serial shell run-as $Package sh -c 'printf orphan > files/source-cache/orphan.source'
& $Adb -s $Serial shell run-as $Package sh -c 'printf orphan > files/source-cache/orphan.fingerprint.json'
& $Adb -s $Serial shell run-as $Package sh -c 'printf partial > files/source-cache/interrupted.source.tmp'
& $Adb -s $Serial shell run-as $Package sh -c 'printf orphan > files/covers/orphan.jpg'
& $Adb -s $Serial shell run-as $Package sh -c 'printf partial > files/covers/.interrupted.jpg.tmp'
& $Adb -s $Serial shell monkey -p $Package -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 5
& $Adb -s $Serial shell run-as $Package ls -al files/source-cache files/covers
```

通过条件：所有上述孤儿与 `.tmp` 文件在启动维护后消失，已登记且大小匹配的缓存保留。

### 5.2 元数据指向缺失文件

从第 3 节导出的数据库选择一条来源记录和一条封面记录，记录其 book ID/文件名；force-stop 后删除对应的可重建文件，再启动：

```powershell
$LatestDb = Get-ChildItem -LiteralPath $Evidence -Filter 'epubstart-*.db' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$BookId = (& $Sqlite $LatestDb.FullName 'SELECT book_id FROM source_cache_entries ORDER BY last_accessed_at LIMIT 1;').Trim()
$CoverPath = (& $Sqlite $LatestDb.FullName 'SELECT cover_cache_path FROM books WHERE cover_cache_path IS NOT NULL ORDER BY updated_at LIMIT 1;').Trim()
$CoverName = Split-Path -Leaf $CoverPath
if ([string]::IsNullOrWhiteSpace($BookId) -or [string]::IsNullOrWhiteSpace($CoverName)) { throw 'No cache rows available for missing-file recovery.' }
& $Adb -s $Serial shell am force-stop $Package
& $Adb -s $Serial shell run-as $Package rm -f "files/source-cache/$BookId.source" "files/source-cache/$BookId.fingerprint.json" "files/covers/$CoverName"
& $Adb -s $Serial shell monkey -p $Package -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 5
```

再次导出数据库。通过条件：缺失来源的 `source_cache_entries` 行被删除；缺失封面的 `books.cover_cache_path` 变为 `NULL`；应用和迁移可重复启动，业务图书行不被误删。

### 5.3 真实 force-stop 中断

恢复空白快照或重新安装 profile，开始导入较大样本；在 logcat 出现 `copy_source_atomically start` 后立即执行 `am force-stop`。检查私有目录，再重启并重新导入同一来源。

通过条件：启动后不存在 `.source.tmp` 或封面 `.tmp`；没有半条缓存元数据；重试可成功，数据库完整。必须记录中断发生在目标复制步骤，不能把“导入尚未开始”当作中断验证。

## 6. 受控 ENOSPC

本节只可在已通过第 1 节安全门的可丢弃 AVD 上执行。填充文件固定为 `/data/local/tmp/epubstart-fill.bin`，测试前先确认删除命令有效，并保持第二个终端可随时执行清理。

```powershell
& $Adb -s $Serial shell rm -f /data/local/tmp/epubstart-fill.bin
& $Adb -s $Serial shell df -k /data
$DfLine = (& $Adb -s $Serial shell df -k /data | Select-Object -Last 1).Trim()
$FreeKb = [int64](($DfLine -split '\s+')[3])
$ReserveKb = 12288L
$FillKb = $FreeKb - $ReserveKb
if ($FillKb -le 0) { throw "Insufficient safe headroom: free=$FreeKb KiB" }
& $Adb -s $Serial shell fallocate -l "${FillKb}K" /data/local/tmp/epubstart-fill.bin
if ($LASTEXITCODE -ne 0) { throw 'fallocate unavailable or failed; do not substitute an unbounded fill command.' }
& $Adb -s $Serial shell df -k /data
```

保留约 12 MiB 后，导入一份 8,521,993 字节样本并触发封面写入；如系统预留使操作仍成功，以 1 MiB 为步长增加同一个 fill 文件，但始终保留至少 4 MiB，且每一步都重新执行 `df -k /data`。观察到目标错误后立即清理：

```powershell
& $Adb -s $Serial shell rm -f /data/local/tmp/epubstart-fill.bin
& $Adb -s $Serial shell sync
& $Adb -s $Serial shell df -k /data
```

通过条件：来源复制或封面写入返回 `BOOK_RESOURCE_LIMIT_EXCEEDED:`；不存在半成品、孤儿或部分数据库提交；旧缓存、旧封面和旧索引保持可用；清理 fill 文件后应用可重启并成功重试。若 `adb` 失联或系统服务异常，立即冷启动该可丢弃 AVD 并从快照恢复，本轮判失败。

## 7. 清理与重建

在可丢弃 profile 数据中，先导出快照，再 force-stop 并删除全部可重建文件；不得删除 `epubstart.db`：

```powershell
& $Adb -s $Serial shell am force-stop $Package
& $Adb -s $Serial shell run-as $Package rm -rf files/source-cache files/covers
& $Adb -s $Serial shell monkey -p $Package -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 5
```

通过条件：目录被安全重建；来源缓存元数据与缺失文件完成协调；图书、阅读进度、设置、系列、标签和批注不丢失。重新打开或重新导入固定 EPUB 后来源与封面可重建；搜索索引通过现有“重建索引”流程重建。任何一步都不得通过删除业务表来满足预算。

## 8. 长期与累计 2 GiB 压力

以 46 份固定样本为一轮，执行“批量导入 → 打开/翻页 → 索引 → force-stop/重启 → 逐本删除”六轮。六轮输入字节为 `8,521,993 × 46 × 6 = 2,352,070,068`（约 2.19 GiB）；执行前仍必须用下面命令生成准确数字并把输出写入证据，禁止只依赖手抄统计：

```powershell
$PerFile = (Get-Item -LiteralPath $Fixture).Length
$Rounds = 6L
$CopiesPerRound = 46L
$CumulativeBytes = $PerFile * $Rounds * $CopiesPerRound
[pscustomobject]@{
    PerFileBytes = $PerFile
    CopiesPerRound = $CopiesPerRound
    Rounds = $Rounds
    CumulativeBytes = $CumulativeBytes
    CumulativeGiB = $CumulativeBytes / 1GB
} | Format-List | Out-File -Encoding utf8 (Join-Path $Evidence 'pressure-input.txt')
```

每轮前后执行第 3 节快照；第 2、4 轮在导入或索引的目标步骤中 force-stop，第 6 轮保留全部图书并等待 30 分钟后复测。缓存命中不计入“复制压力”；若同 URI 命中缓存，必须先通过应用删除图书并确认来源缓存文件已删除后再计入下一轮。

通过条件：累计输入超过 2 GiB；无崩溃、死锁、永久 pending/building、数据库损坏或不可解释的单调存储增长；来源/封面回落到软上限；搜索账面硬上限与任务累计上限返回稳定错误并保留旧索引。主库、journal/WAL 峰值、缓存峰值、每轮耗时及失败前缀必须逐轮记录。

## 9. 验收矩阵与结论模板

| 项目 | 必须记录 | 通过条件 | 当前状态 |
| --- | --- | --- | --- |
| 空白安装 | APK hash、镜像/AVD、`df`、`du`、日志 | 可启动且私有目录为空/一致 | 阻塞：无可运行 AVD |
| 来源软/硬预算 | 文件与 DB 字节、LRU 顺序、活动读取 | 256/512 MiB 闭环、稳定错误 | 辅助逻辑已测；Android 阻塞 |
| 封面软/硬预算 | 文件与 `cover_cache_path` | 64/128 MiB 闭环、无孤儿 | 辅助逻辑已测；Android 阻塞 |
| 中断/重启 | 目标步骤日志、重启前后快照 | 无 `.tmp`/半提交，可重试 | 辅助逻辑已测；Android 阻塞 |
| ENOSPC | fill 大小、`df`、错误前缀、DB 校验 | 稳定拒绝并保留旧状态 | Android 阻塞 |
| 清理/重建 | 删除前后 DB/目录 | 只重建可重建数据 | Android 阻塞 |
| 长期/2 GiB | 自动计算累计字节、六轮快照 | 无泄漏/损坏/永久任务 | Android 阻塞 |

最终结论必须分别写：

1. **辅助逻辑（自动验证）**：列出具体测试名、变红注入点与绿色命令。
2. **桌面端**：列出实际人工运行态；没有执行就写“待人工验证”。
3. **Android 环境**：列出 AVD/设备、APK hash、步骤、日志和快照；任一必测项未执行就写“阻塞”，不得签发 B2 Android 存储完成证明。

验收结束后删除 `/data/local/tmp/epubstart-fill.bin`、停止 logcat 捕获并执行 `adb kill-server`。是否保留 AVD 快照由人工决定；不得在验收脚本中自动删除 AVD、SDK 或宿主机 Gradle/Cargo 缓存。
