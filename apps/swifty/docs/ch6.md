# 权限

## 三种攻击

- prompt 注入
- 越权
- 数据泄露

## 多层防御

1. 危险命令拦截, 例如 rm -rf / 绝对拒绝
2. 路径沙箱: 工作目录外的文件操作需要用户确认
   - 计算绝对路径
   - 解析符号链接 TODO
   - 检查路径前缀, 判断是否在工作目录内
3. 权限规则
   - `allow: ["Bash(git *)"]`
4. 权限模式
   - plan: 读放行, 写确认, shell 命令确认; 通过 prompt 约束 LLM 行为, 使得 LLM 只读
   - default: 读放行, 写确认, shell 命令确认
   - acceptEdits: 读写放行, shell 命令确认
   - bypassPermissions: 绕过权限, 读/写/ shell 命令全部放行, 但仍然拒绝 rm -rf / 等危险命令
5. HITL (Human-in-the-Loop): 人在回路, 用户确认

## 第 1 层: 危险命令黑名单

黑名单只针对 bash 工具; ReadFile, WriteFile 工具有路径沙箱保护, 不需要黑名单

```js
const DANGEROUS_PATTERNS = [
  // 递归强制删除根目录
  {
    re: /rm\s+(-rf?|--recursive)\s+[/~]/,
    reason: "recursive force delete root",
  },
  // 递归强制删除
  { re: /rm\s+-rf?\s+\*/, reason: "recursive force delete wildcard" },
  // 格式化磁盘
  { re: /mkfs\./, reason: "format disk" },
  // 直接写磁盘设备
  { re: /dd\s+if=/, reason: "direct write to disk device" },
  // 覆盖磁盘设备
  { re: />\s*\/dev\/sd/, reason: "overwrite disk device" },
  // 递归修改根目录权限
  { re: /chmod\s+-R?\s*777\s+\//, reason: "recursive chmod root" },
  // fork bomb
  { re: /:\(\)\{\s*:\|\s*:\s*&\s*\}\s*;/, reason: "fork bomb" },
  // 管道执行远程脚本
  { re: /curl\s+.*\|\s*(ba)?sh/, reason: "pipe remote script" },
  // 管道执行远程脚本
  { re: /wget\s+.*\|\s*(ba)?sh/, reason: "pipe remote script" },
  { re: /git\s+push\s+.*--force/, reason: "force push" },
  { re: /git\s+reset\s+--hard/, reason: "hard reset" },
  { re: /git\s+clean\s+-f/, reason: "force clean untracked files" },
  { re: /git\s+checkout\s+\./, reason: "discard all changes" },
  { re: /git\s+branch\s+-D/, reason: "force delete branch" },
];
```

## 第 2 层: 路径沙箱

  <!-- 源码: src/permissions/checker.ts -->

- 计算绝对路径 (通过 path.resolve)
- 解析符号链接
- 检查路径前缀, 判断是否在允许的目录内
- 默认允许两个目录
  - 项目根目录 (启动 Agent 的工作目录)
  - 系统临时目录 (`os.tmpdir()`, MacOS 是 /var/folders, /tmp, Linux 是 /tmp, /var/tmp)

## 第 3 层: 权限规则

权限规则

- 允许执行 git push, 但不允许执行 `git push --force`
- 允许读取 src/ 目录下的文件, 但不允许读取 .env 文件
- 允许运行 pnpm lint, 但不允许运行 pnpm lint:fix

### Claude jsonl 配置

```jsonl
// 权限规则 (json)
{
  "permissions": {
    "allow": ["Bash(pnpm add *)", "Bash(pnpm dev)"]
  }
}

// 权限模式 (json)
{
  "permissions": {
    "defaultMode": "auto"
  },
}
```

<!-- 源码: src/permissions/checker.ts -->

- 本地规则 .swifty/permissions.local.yaml (优先级最高)
- 项目规则 .swifty/permissions.yaml
- 全局规则 ~/.swifty/permissions.yaml (优先级最低)

```yaml
# 权限规则 (yaml)
- rule: Bash(git *)
  effect: allow

- rule: Bash(git push --force*)
  effect: deny

- rule: ReadFile(/path/to/src/*)
  effect: allow

- rule: ReadFile(*.env*)
  effect: deny

- rule: EditFile(*.ts)
  effect: allow
```

```js
function evaluate(toolName, content) {
  for (const path of [userPath, projectPath, localPath]) {
    const rules = loadRulesFile(path);
    // 从后往前遍历, 后面的规则覆盖前面的规则
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.tool !== toolName && r.tool !== "*") continue;
      if (globMatch(r.pattern, content)) {
        return r.effect; // 返回 "allow" 或 "deny"
      }
    }
  }
  return null; // 无匹配规则
}
```

## 第 4 层: 权限模式

- plan: 读放行, 写确认, shell 命令确认; 通过 prompt 约束 LLM 行为, 使得 LLM 只读
- default: 读放行, 写确认, shell 命令确认
- acceptEdits: 读写放行, shell 命令确认
- bypassPermissions: 绕过权限, 读/写/ shell 命令全部放行, 但仍然拒绝 rm -rf / 等危险命令
<!-- 源码: src/permissions/checker.ts, modeDecide 函数 -->

| 模式              | 只读工具 (read) | 写工具 (write) | 命令工具 (command) |
| ----------------- | --------------- | -------------- | ------------------ |
| default           | Allow           | Ask            | Ask                |
| acceptEdits       | Allow           | Allow          | Ask                |
| plan              | Allow           | Ask            | Ask                |
| bypassPermissions | Allow           | Allow          | Allow              |

<!-- 源码: src/permissions/checker.ts, acceptEdits 模式 category 为 command 时返回 ask -->

## 第 5 层: HITL 人在回路

前 4 层都无法确认时, 权限系统会阻塞 agent loop, 弹出对话框让用户确认; 提供「始终允许」选项; 需要确认时, 发送一个权限请求 (permission_request) 事件到事件流, 阻塞等待用户确认; 如果用户选择「始终允许」, 则会将新规则 (CLI 生成) 追加到本地配置文件

权限被拒绝时, 将权限拒绝作为一个 `isError: true` 的工具调用结果返回给 LLM, agent loop 继续运行; LLM 在下一轮 agent loop turn 中看到这个工具调用错误, 调整策略

## OS 级沙箱

- MacOS: seatbelt, 通过一个策略文件定义进程的行为边界
- Linux: bubblewrap + seccomp, bubblewrap 是一个轻量级的用户空间容器工具, 通过 linux 的 namespace 机制创建一个隔离环境, 通过 bubblewrap 执行命令
- OS 级沙箱模式默认断网, 防止数据泄漏
- OS 级沙箱不需要弹权限请求对话框, 用户可以通过 /sandbox 命令在三种模式间切换
  - 开启沙箱 + autoAllow 自动放行
  - 开启沙箱 + 手动确认
  - 关闭沙箱

```txt
(version 1)
(deny default) ;; 默认拒绝
(allow process-exec) ;; 允许执行程序
(allow process-fork) ;; 允许 fork 子进程
(allow file-read* (subpath "/")) ;; 允许读整个文件系统
(allow file-write* (subpath "/project")) ;; 只允许写项目目录
(allow file-write* (subpath "/tmp")) ;; 只允许写临时目录
(deny file-write* (subpath "/project/.swifty/config.yaml")) ;; 禁止写配置文件
(deny network*) ;; 禁止访问网络
```

```bash
bwrap \
--unshare-user \                  # 独立的用户 namespace
--unshare-pid \                   # 独立的进程 namespace
--ro-bind / / \                   # 整个文件系统挂载为只读
--bind /project /project \        # 项目目录可写
--ro-bind /project/.swifty/config.yaml /project/.swifty/config.yaml \  # 配置文件挂载为只读
--unshare-net \                   # 独立的网络 namespace, 禁止访问网络
--proc /proc \                    # 独立的 proc
bash -C "用户命令"
```

seccomp 在系统调用入口过滤: 可以禁止 ptrace 防止调试注入、禁止 mount 防止重新挂载文件系统以逃逸命名空间

### 禁止写项目目录内的敏感路径

- .swifty/config.yaml
- .swifty/permissions.local.yaml
- .swifty/skills
