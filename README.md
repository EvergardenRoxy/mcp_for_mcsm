# mcsm-mcp-secure

**English** | [中文](README_zh.md)

[![AI Assisted](https://img.shields.io/badge/AI-Claude%20Opus%205.5%20%2B%20Claude%20Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](#ai-disclosure) [![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE) [![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#installation)

A least-privilege MCP server (stdio) for **MCSManager V10** that works with any MCP-capable client. It lets an AI assistant check instance status and read logs and files. With the matching switches on, it can also send console commands and start or stop instances. The API key and the panel address are stored separately, and the key never appears in the client config or in any output.

> [!NOTE]
> Verified on a real V10 panel: instance discovery, status, logs, file listing and reading, and `send_command`. Start/stop/restart/kill have only been tested against a mock panel. See [checklist.md](checklist.md) for the full status and known issues.
>
> Tool output and error messages are in Chinese.

## Security design

- **Separated secrets**: the key lives in its own `api-key` file (or the `MCSM_API_KEY` environment variable). `config.json` holds only the address, instances and switches, and the MCP client config holds only the path to `config.json`. The server refuses to start if `config.json` contains `api_key`.
- **Unsafe setups are refused**: on Linux/macOS both files must be mode `600`; non-local addresses must use https; redirects are never followed.
- **Redacted output**: the key, panel address, node IPs and the instance's path on the host never appear in tool results, errors or logs.
- **Write tools are not registered by default**: `send_command`, start/stop/restart and kill must be enabled under `allow`. Until then, the model cannot see them.
- **Also**: paths containing `..` are rejected; commands containing line breaks are rejected; requests are limited to 60 per minute by default; write actions are recorded in `audit.log`.

> [!WARNING]
> The command blocklist can be bypassed and is not a security boundary ([S4](checklist.md#s4)). In-game chat and logs can carry prompt injection to the model ([S3](checklist.md#s3)). `read_file` passes passwords in config files to the model as-is ([S5](checklist.md#s5)). The real boundary is the panel account's permissions.

## Installation

Requires Node.js ≥ 18.

```bash
git clone https://github.com/EvergardenRoxy/mcp_for_mcsm.git mcsm-mcp-secure
cd mcsm-mcp-secure
npm install
npm test   # optional end-to-end tests (permission tests are skipped on Windows)
```

## Configuration

**Linux / macOS**

```bash
mkdir -p ~/.config/mcsm-mcp && chmod 700 ~/.config/mcsm-mcp
cp config.example.json ~/.config/mcsm-mcp/config.json && chmod 600 ~/.config/mcsm-mcp/config.json
# Key: typed with read -s so it stays out of shell history
read -rs MCSM_KEY && printf '%s' "$MCSM_KEY" > ~/.config/mcsm-mcp/api-key && unset MCSM_KEY
chmod 600 ~/.config/mcsm-mcp/api-key
```

**Windows (PowerShell)**: do not write the key with `>` or `Out-File`; PowerShell 5.1 writes UTF-16.

```powershell
$dir = "$HOME\.config\mcsm-mcp"; New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item config.example.json "$dir\config.json"
$k = Read-Host "API Key" -AsSecureString
[IO.File]::WriteAllText("$dir\api-key", [Net.NetworkCredential]::new('', $k).Password); Remove-Variable k
icacls "$dir\api-key" /inheritance:r /grant:r "${env:USERNAME}:F"   # current user only
```

Main `config.json` fields:

| Field | Meaning |
| --- | --- |
| `base_url` | Panel address, e.g. `https://panel.example.com` (a sub-path is fine) |
| `instances` | Alias → `uuid` + `daemon_id` (the `instanceId` and `daemonId` in the panel's instance page URL) |
| `wildcard` | `enabled: true` discovers every instance automatically (**requires an admin key**); `allowed_daemons` limits it to certain nodes |
| `allow` | `read_files` (on by default), `send_command`, `power`, `kill` (off by default) |
| `blocked_command_prefixes` | Forbidden command prefixes; default `stop`, `op `, `deop `, `save-off` |

> [!CAUTION]
> An API key has exactly the permissions of the account that created it. Create it from a **dedicated low-privilege account** that only has the instances you need. Never paste the key into any chat.

## Connecting an MCP client

Any client that supports stdio MCP servers works. It needs three things: the command `node`, the absolute path to `server.mjs` as the argument, and the environment variable `MCSM_MCP_CONFIG` pointing to `config.json`. The client config contains neither the key nor the panel address.

**`mcpServers` JSON format** (used by Claude Desktop's `claude_desktop_config.json` and many other clients; see your client's docs for the file location):

```json
{
  "mcpServers": {
    "mcsm": {
      "command": "node",
      "args": ["/absolute/path/mcsm-mcp-secure/server.mjs"],
      "env": { "MCSM_MCP_CONFIG": "/absolute/path/.config/mcsm-mcp/config.json" }
    }
  }
}
```

**From the command line** (Claude Code as an example):

```bash
claude mcp add mcsm -e MCSM_MCP_CONFIG=$HOME/.config/mcsm-mcp/config.json -- node /absolute/path/mcsm-mcp-secure/server.mjs
```

## Tools

| Tool | Visible when | Description |
| --- | --- | --- |
| `list_instances` | always | Lists the configured instance aliases |
| `discover_instances` | `wildcard.enabled` | Lists instances on all nodes (nickname, status, UUID) |
| `get_instance_info` | always | Status, resource usage, player count (no start command) |
| `get_output_log` | always | Last N lines of console output, colour codes removed |
| `list_files` | `allow.read_files` | Lists a directory; `filter` matches names, `page` starts at 0 |
| `read_file` | `allow.read_files` | Reads a text file; `lines` + `from: tail/head` pick a part; binary and compressed files are refused |
| `send_command` | `allow.send_command` | Sends a console command and returns the new output |
| `start_instance` / `stop_instance` / `restart_instance` | `allow.power` | Start / stop / restart |
| `kill_instance` | `allow.kill` | Force kill |

In wildcard mode, the `instance` argument accepts an alias, an instance nickname (case-insensitive) or a UUID. Duplicate nicknames are rejected instead of guessed.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `MCSM_MCP_CONFIG` | Path to `config.json` (default `~/.config/mcsm-mcp/config.json`) |
| `MCSM_API_KEY` | Supplies the key directly; takes priority over the key file |
| `MCSM_MCP_AUDIT` | Audit log path (default `audit.log` next to the config) |
| `MCSM_MCP_ALLOW_LOOSE_PERMS=1` | Skips the file permission check (not recommended) |

## Public panels

1. Serve the panel over https (reverse proxy + certificate). If it is mapped to localhost through a tunnel such as FRP, make sure the tunnel itself is encrypted ([S6](checklist.md#s6)).
2. MCSManager only accepts the key as a URL query parameter, so strip the query string from reverse-proxy logs ([S1](checklist.md#s1)):
   ```nginx
   log_format safe '$remote_addr [$time_local] "$request_method $uri" $status $body_bytes_sent';
   ```
3. Restrict source IPs at the proxy, and rotate keys regularly.

## Known issues

See **[checklist.md](checklist.md)** (English and Chinese) for issues, severity and review points. Notes for AI assistants working on this code are in [handoff.md](handoff.md).

<a id="ai-disclosure"></a>

## AI disclosure

> [!IMPORTANT]
> **AI disclosure: generative AI took part in the architecture, code, documentation and tests of mcsm-mcp-secure.** All AI-generated or AI-modified content is reviewed and verified by the project maintainer, who is responsible for its maintenance.
>
> AI involved: **Claude Opus 5.5** (via **Claude Code**): architecture design, coding, testing and security review, checking the API against the MCSManager source and fixing defects, and writing the README, the review checklist (`checklist.md`) and the handoff notes (`handoff.md`).

## License

[MIT](LICENSE) © 2026 EvergardenRoxy
