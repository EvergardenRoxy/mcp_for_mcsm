# mcsm-mcp-secure

[English](README.md) | **中文**

[![AI Assisted](https://img.shields.io/badge/AI-Claude%20Opus%205.5%20%2B%20Claude%20Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](#ai-制作声明) [![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE) [![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#安装)

一个 **MCSManager V10** 用的最小权限 MCP 服务端（stdio），可接入任何支持 MCP 的客户端。AI 助手可以用它查看实例状态、读日志和文件；开启相应开关后，也能发命令、启停实例。API Key 和面板地址分开存放，Key 不会出现在客户端配置或任何输出里。

> [!NOTE]
> 已在真实 V10 面板上验证：实例发现、状态、日志、文件列表与读取、`send_command`。启停和强制终止只在模拟面板上测过。完整现状和问题见 [checklist.md](checklist.md)。

## 安全设计

- **密钥分离**：Key 放在单独的 `api-key` 文件（或环境变量 `MCSM_API_KEY`）；`config.json` 只放地址、实例和开关；MCP 客户端配置里只写 `config.json` 的路径。`config.json` 里写了 `api_key` 会直接拒绝启动。
- **拒绝不安全配置**：Linux / macOS 上两个文件不是 `600` 权限就拒绝启动；非本机地址必须 https；不跟随重定向。
- **输出脱敏**：Key、面板地址、节点 IP、服务器上的实例路径不会出现在工具输出、错误信息和日志里。
- **写类工具默认不注册**：`send_command`、启停、强制终止要在 `allow` 里开启，否则模型根本看不到。
- **其他**：路径拒绝 `..`；命令拒绝换行；默认每分钟最多 60 次请求；写操作记录到 `audit.log`。

> [!WARNING]
> 命令黑名单可以绕过，不是安全边界（[S4](checklist.md#s4)）；游戏内聊天和日志可能对模型进行提示注入（[S3](checklist.md#s3)）；`read_file` 会把配置文件里的密码原样交给模型（[S5](checklist.md#s5)）。真正的边界是面板账号的权限。

## 安装

需要 Node.js ≥ 18。

```bash
git clone https://github.com/EvergardenRoxy/mcp_for_mcsm.git mcsm-mcp-secure
cd mcsm-mcp-secure
npm install
npm test   # 可选：端到端测试（Windows 上会跳过文件权限相关测试）
```

## 配置

**Linux / macOS**

```bash
mkdir -p ~/.config/mcsm-mcp && chmod 700 ~/.config/mcsm-mcp
cp config.example.json ~/.config/mcsm-mcp/config.json && chmod 600 ~/.config/mcsm-mcp/config.json
# 密钥：用 read -s 输入，不进 shell 历史
read -rs MCSM_KEY && printf '%s' "$MCSM_KEY" > ~/.config/mcsm-mcp/api-key && unset MCSM_KEY
chmod 600 ~/.config/mcsm-mcp/api-key
```

**Windows（PowerShell）**：不要用 `>` 或 `Out-File` 写密钥，PowerShell 5.1 会写成 UTF-16。

```powershell
$dir = "$HOME\.config\mcsm-mcp"; New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item config.example.json "$dir\config.json"
$k = Read-Host "API Key" -AsSecureString
[IO.File]::WriteAllText("$dir\api-key", [Net.NetworkCredential]::new('', $k).Password); Remove-Variable k
icacls "$dir\api-key" /inheritance:r /grant:r "${env:USERNAME}:F"   # 只允许当前用户访问
```

`config.json` 的主要字段：

| 字段 | 说明 |
| --- | --- |
| `base_url` | 面板地址，如 `https://panel.example.com`（可带子路径） |
| `instances` | 别名 → `uuid` + `daemon_id`（面板实例页地址栏里的 `instanceId`、`daemonId`） |
| `wildcard` | `enabled: true` 时自动发现所有实例（**需要管理员 Key**）；`allowed_daemons` 限定节点 |
| `allow` | `read_files`（默认开）、`send_command`、`power`、`kill`（默认关） |
| `blocked_command_prefixes` | 禁止的命令前缀，默认 `stop`、`op `、`deop `、`save-off` |

> [!CAUTION]
> API Key 的权限与生成它的账号完全一致。请用**专用低权限账号**生成，只分配需要管理的实例。不要把 Key 贴进任何聊天。

## 接入 MCP 客户端

任何支持 stdio MCP 服务端的客户端都可以使用，需要三项：命令 `node`、参数 `server.mjs` 的绝对路径、环境变量 `MCSM_MCP_CONFIG`（指向 `config.json`）。客户端配置里没有密钥，也没有面板地址。

**`mcpServers` JSON 格式**（Claude Desktop 的 `claude_desktop_config.json` 等许多客户端采用这种格式，具体文件位置见各客户端文档）：

```json
{
  "mcpServers": {
    "mcsm": {
      "command": "node",
      "args": ["/绝对路径/mcsm-mcp-secure/server.mjs"],
      "env": { "MCSM_MCP_CONFIG": "/绝对路径/.config/mcsm-mcp/config.json" }
    }
  }
}
```

**命令行添加**（以 Claude Code 为例）：

```bash
claude mcp add mcsm -e MCSM_MCP_CONFIG=$HOME/.config/mcsm-mcp/config.json -- node /绝对路径/mcsm-mcp-secure/server.mjs
```

## 工具

| 工具 | 何时可见 | 说明 |
| --- | --- | --- |
| `list_instances` | 始终 | 列出已配置的实例别名 |
| `discover_instances` | `wildcard.enabled` | 列出所有节点上的实例（昵称、状态、UUID） |
| `get_instance_info` | 始终 | 状态、资源占用、玩家数（不含启动命令） |
| `get_output_log` | 始终 | 终端输出最后 N 行，已去除颜色码 |
| `list_files` | `allow.read_files` | 列目录；`filter` 按名称过滤，`page` 从 0 开始 |
| `read_file` | `allow.read_files` | 读文本文件；`lines` + `from: tail/head` 选取部分；拒绝二进制和压缩文件 |
| `send_command` | `allow.send_command` | 发送命令并返回新增输出 |
| `start_instance` / `stop_instance` / `restart_instance` | `allow.power` | 启动 / 停止 / 重启 |
| `kill_instance` | `allow.kill` | 强制终止 |

通配模式下，`instance` 参数可以用别名、实例昵称（不区分大小写）或 UUID；昵称重复时会拒绝猜测。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `MCSM_MCP_CONFIG` | `config.json` 路径（默认 `~/.config/mcsm-mcp/config.json`） |
| `MCSM_API_KEY` | 直接提供密钥，优先于密钥文件 |
| `MCSM_MCP_AUDIT` | 审计日志路径（默认与配置同目录的 `audit.log`） |
| `MCSM_MCP_ALLOW_LOOSE_PERMS=1` | 跳过文件权限检查（不推荐） |

## 公网面板建议

1. 面板走 https（反向代理 + 证书）。如果通过 FRP 等隧道映射到本机，请确认隧道本身加密（[S6](checklist.md#s6)）。
2. MCSM 只支持把 Key 放在 URL 查询参数里，反向代理日志要去掉查询串（[S1](checklist.md#s1)）：
   ```nginx
   log_format safe '$remote_addr [$time_local] "$request_method $uri" $status $body_bytes_sent';
   ```
3. 在反代层限制来源 IP；定期轮换 Key。

## 已知问题

问题清单、严重度和审查要点见 **[checklist.md](checklist.md)**（中英双语）。给 AI 助手的交接说明见 [handoff.md](handoff.md)。

<a id="ai-制作声明"></a>

## AI 制作声明

> [!IMPORTANT]
> **AI 制作声明：mcsm-mcp-secure 采用生成式 AI 参与架构设计、编码、文档与测试。** AI 生成或修改的内容由项目维护者审阅、验证并承担最终维护责任。
>
> 参与的 AI：**Claude Opus 5.5**（通过 **Claude Code**）参与架构设计、编码、测试与安全审查，对照 MCSManager 源码核对接口并修复缺陷，以及 README、审查清单（`checklist.md`）与交接文档（`handoff.md`）的编写。

## 许可证

[MIT](LICENSE) © 2026 EvergardenRoxy
