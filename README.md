# mcsm-mcp-secure

给 MCSManager **V10** 用的最小权限 MCP 服务端。让 Claude 读日志、看状态、（可选）发命令和启停，同时把密钥和面板地址和 Claude 的配置隔离开。

> ⚠️ 本项目只对照官方 API 文档、用严格模拟的 V10 服务器测试过（`npm test`，全部通过），**还没有连过真实面板**。第一次请先用只读模式（默认）试一遍。

## 设计要点

| 问题 | 做法 |
| --- | --- |
| 密钥写进 Claude 配置会泄露 | 密钥放在**单独的文件** `api-key`（或环境变量 `MCSM_API_KEY`）；地址、实例 ID、权限放在 `config.json`；Claude 配置里只写 `config.json` 的路径 |
| 文件被别的用户读到 | 两个文件权限不是 `600` 就**拒绝启动**；配置里直接写 `api_key` 也会拒绝启动 |
| 公网明文传输 | 非本机地址必须 `https`，否则拒绝启动 |
| 被重定向到别的主机 | 不跟随任何重定向，密钥不会被转发 |
| 错误信息里带出密钥/地址 | 所有工具输出和错误都会脱敏（密钥、面板地址会被替换成 `<redacted>`） |
| 模型乱操作 | 写类工具默认**不注册**，模型根本看不到；只能访问配置里列出的实例别名，拿不到 UUID |
| 危险命令 | `send_command` 默认禁止 `stop`、`op`、`deop`、`save-off`（可改）；拒绝换行（防止夹带第二条命令） |
| 事后追查 | 写操作记录到 `audit.log`（权限 600，不含密钥） |
| 失控循环 | 默认每分钟最多 60 次请求 |

## 安装

需要 Node.js ≥ 18。

```bash
cd mcsm-mcp-secure
npm install
npm test        # 可选：跑完整的端到端测试（Linux / macOS）
```

## 配置（密钥与地址分开存放）

```bash
mkdir -p ~/.config/mcsm-mcp && chmod 700 ~/.config/mcsm-mcp

# 1) 地址、实例、权限 —— 编辑后保存
cp config.example.json ~/.config/mcsm-mcp/config.json
chmod 600 ~/.config/mcsm-mcp/config.json

# 2) 密钥 —— 单独文件。用 read -s 输入，避免进入 shell 历史和屏幕
read -rs MCSM_KEY && printf '%s' "$MCSM_KEY" > ~/.config/mcsm-mcp/api-key && unset MCSM_KEY
chmod 600 ~/.config/mcsm-mcp/api-key
```

`config.json` 里要填的东西：

- `base_url`：面板的 **https** 地址，如 `https://panel.example.com`（有子路径也可以）。
- `instances`：每个实例一个别名，填 `uuid` 和 `daemon_id`（一般能在面板实例页的地址栏里看到 `instanceId` 和 `daemonId`，不同版本可能略有差异）。
- `allow`：`read_files` 默认开；`send_command`、`power`（启动/停止/重启）、`kill` 默认关，需要时再开。

> 密钥务必用**专用的低权限面板账号**生成：API Key 的权限和该账号完全一致，管理员账号生成的 Key 就是管理员权限。给这个账号只分配要管理的那个实例。

## 接入 Claude

**Claude Desktop**（跑在你自己的电脑上，通过 https 访问公网面板）。在配置文件里添加，注意这里**没有任何密钥或地址**，只有路径：

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

**Claude Code**：

```bash
claude mcp add mcsm -e MCSM_MCP_CONFIG=$HOME/.config/mcsm-mcp/config.json -- node /绝对路径/mcsm-mcp-secure/server.mjs
```

## 工具

| 工具 | 是否默认可见 | 说明 |
| --- | --- | --- |
| `list_instances` | 是 | 列出可管理的实例别名 |
| `get_instance_info` | 是 | 状态、资源占用、玩家数（不含启动命令） |
| `get_output_log` | 是 | 终端输出最后 N 行，已去除颜色码 |
| `list_files` / `read_file` | `allow.read_files`（默认开） | 只读浏览和读取实例文件，拒绝 `..` |
| `send_command` | `allow.send_command` | 发送命令并返回新增输出 |
| `start_instance` / `stop_instance` / `restart_instance` | `allow.power` | 启停重启 |
| `kill_instance` | `allow.kill` | 强制终止 |

## 权限档位与通配模式

默认是**只读 + 逐个登记实例**。需要自动化调试、需要更高权限时，分两件事：

**1) 管理员 Key** —— 服务端不关心 Key 的等级，它只是把 Key 发给面板。用管理员账号生成的 Key 就是管理员权限；MCP 能做什么，仍由 `allow` 开关决定。

**2) 通配模式** —— 不用逐个登记实例，自动发现面板上所有节点和实例。**必须使用管理员 Key**（面板的节点和实例列表接口只对管理员开放）。

```json
{
  "wildcard": { "enabled": true, "allowed_daemons": [] },
  "allow": { "read_files": true, "send_command": true, "power": true, "kill": false },
  "blocked_command_prefixes": ["stop", "op ", "deop ", "save-off"]
}
```

- `allowed_daemons` 为空表示所有节点；填节点 UUID 列表则只在这些节点内通配。
- 开启后多一个 `discover_instances` 工具；其他工具的 `instance` 参数除别名外，还可以用**实例昵称（不区分大小写）或 UUID**。昵称重复时会拒绝猜测，要求改用 UUID。
- 离线节点会被跳过；节点 IP 不会出现在任何输出里。

推荐的三档：

| 档位 | 配置 | 适合 |
| --- | --- | --- |
| 只读（默认） | `allow` 全默认，逐个登记实例，低权限 Key | 先试用、只看日志 |
| 调试档 | `send_command` + `power` 开，`kill` 关，保留黑名单 | 日常排障、重启 |
| 管理员档 | 通配 + 管理员 Key + 全部开关，`blocked_command_prefixes` 置空 | 完全信任的自动化 |

> ⚠️ 管理员档下，Claude 能对面板上**所有**实例发送任意控制台命令（包括 `stop`、`op`、`execute` 等）、启停、强制终止；这个 Key 一旦泄露，就是面板管理员权限。建议：只在需要时临时切换，用完改回调试档；定期更换 Key；留意 `audit.log`。

## 公网部署安全清单

1. **面板必须走 https**（反向代理 + 证书）。
2. **MCSM 的 API 只支持把密钥放在 URL 查询参数里**（`?apikey=...`），所以反向代理的访问日志会记下完整 URL。Nginx 请改用不含查询串的日志格式：
   ```nginx
   log_format safe '$remote_addr [$time_local] "$request_method $uri" $status $body_bytes_sent';
   access_log /var/log/nginx/mcsm.access.log safe;
   ```
3. 在反代层**限制来源 IP**（你的固定 IP 或 VPN）。
4. 专用低权限账号、只授权必要实例，并**定期轮换** Key。Key 一旦怀疑泄露，立刻在面板里重新生成。
5. 不要把 Key 贴进聊天。本工具不会把 Key 返回给模型。

## 已知限制

- `blocked_command_prefixes` 只是减少误操作的护栏，**不是安全边界**。真正的边界是面板账号的权限。开启 `send_command` 后，Claude 能执行任何未被拦截的控制台命令（如 `give`、`execute`），建议平时保持关闭。
- 600 权限只能挡住同机的其他用户，挡不住以你身份运行的恶意程序。
- Windows 上不做 POSIX 权限检查，请自行用 NTFS 权限限制两个文件。
- `get_instance_info` 的字段取自面板返回，不同版本可能有出入。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `MCSM_MCP_CONFIG` | `config.json` 的路径（默认 `~/.config/mcsm-mcp/config.json`） |
| `MCSM_API_KEY` | 直接提供密钥，优先于密钥文件 |
| `MCSM_MCP_AUDIT` | 审计日志路径（默认与配置同目录的 `audit.log`） |
| `MCSM_MCP_ALLOW_LOOSE_PERMS=1` | 跳过权限检查（不推荐） |
