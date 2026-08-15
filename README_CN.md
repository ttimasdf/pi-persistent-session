# pi-persistent-session

[English](./README.md) | 中文

一个最小化的 Pi 扩展，用于在工作区目录移动后，迁移该工作区对应的非活动会话 JSONL 文件。

## 工作方式

在 `session_start` 时，扩展会在工作区内创建或读取这个身份标记：

```text
.pi/persistent-session.json
```

```json
{
  "version": 1,
  "sessionNamespaceId": "--previous-workspace-path--",
  "observedCwd": "/previous/workspace/path"
}
```

`sessionNamespaceId` 是 Pi 默认 `<agentDir>/sessions/<sessionNamespaceId>` 映射中的目录名。保留这个名称而不是绝对路径，可以让扩展在当前 agent 目录下找到被复制过来的 Pi 会话树。

当 `observedCwd` 和 Pi 当前 cwd 不一致，并且旧路径已不存在时，扩展会尝试迁移旧工作区的会话：

1. 按 Pi 默认存储规则，用 `<currentAgentDir>/sessions/<sessionNamespaceId>` 重建源目录。自定义会话目录会直接在原位置迁移。
2. 读取源目录下每个 `.jsonl` 文件。
3. 要求文件头是 `type: "session"`、`version: 3`。
4. 只迁移其 `cwd` 与 `observedCwd` 匹配的头。
5. 重写头里的 cwd，并把完整文件写入 Pi 当前会话目录。
6. 可选地仅在目标完整写入后删除原文件。
7. 每个匹配文件都无错误完成后，才更新标记为当前 cwd 对应的新命名空间。

活动会话文件不会被迁移或删除。如果它位于源目录中，请在移动后的工作区里启动一个新会话再运行迁移。迁移前请关闭占用源会话的其他 Pi 进程；Pi 不会锁定非活动会话文件。

迁移完成后，用 `/resume` 选择已迁移的会话。`/reload` 只会重新加载扩展和资源，不会重新打开已移动的会话文件。

如果旧 cwd 仍然存在，扩展会把它视为复制而不是移动，因此不会自动迁移会话。

## 安装

在当前 checkout 中：

```bash
pi install /absolute/path/to/pi-persistent-session
```

单次运行测试：

```bash
pi -e ./index.ts
```

## 设置

Pi 没有插件设置注册 API。此扩展将设置存储在：

```text
~/.pi/agent/extension-settings/pi-persistent-session.json
```

使用 `/persistent-session-settings` 一次修改一个设置。

| Setting | Values | Default |
|---|---|---|
| `sessionNamespacePolicy` | `auto`, `prompt`, `never` | `prompt` |
| `gitignorePolicy` | `auto`, `prompt`, `never` | `prompt` |
| `relocationPolicy` | `auto`, `prompt`, `warn` | `prompt` |
| `removeOriginalSessions` | boolean | `false` |

启用 Git 处理时，扩展会建议或添加 `.pi/persistent-session.json` 的精确忽略规则。如果该文件已经被跟踪，扩展会警告，但不会修改 Git 索引。

## 命令

- `/persistent-session-migrate` - 手动运行检测到的迁移。
- `/persistent-session-settings` - 配置扩展策略。

## 安全行为

在迁移未解决时，正常输入会在不添加用户消息的情况下被处理，工具调用会被阻止。如果当前 cwd 在运行期间消失，也会触发同样的保护。

Pi 在启动和切换会话时会检查已保存会话的 cwd。交互模式可以用当前 cwd 重新打开会话；非交互模式会拒绝。Pi 不会持续阻止目录消失后对内部会话元数据的追加，所以这个扩展无法保证覆盖所有内建命令或运行中途发生的移动。

这个扩展会读取并重写 Pi 管理的非活动会话文件，因为 Pi 没有公开的迁移 API。它会先完整写入目标，再按需删除源文件，拒绝修改活动会话，并在目标内容冲突时中止。
