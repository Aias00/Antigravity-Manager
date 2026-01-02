# Google Claude 自动降级 Gemini 功能指南

## 功能概述
本功能实现了**优先使用 Google 账号的 Claude 模型**，仅在配额耗尽时**自动降级到 Gemini 模型**的机制。

- **使用同一个 Google 账号**：不需要额外配置其他服务商。
- **Claude 优先**：默认先尝试调用 `claude-sonnet-4-5` 等 Claude 模型。
- **自动降级**：当 Google 返回配额耗尽 (429) 错误时，自动切换到映射的 Gemini 模型（如 `gemini-3-pro-high`）。

## 如何配置

### 1. 确保已有 Google 账号
确保您已在"账号管理"中添加了 Google 账号。

### 2. 配置模型映射
在"模型路由中心"配置 Claude 到 Gemini 的映射。

**推荐配置**：
- **Claude 4.5 系列**：映射到 `gemini-3-pro-high`
- **Claude 3.5 系列**：映射到 `claude-sonnet-4-5-thinking` 或 `gemini-2.5-flash`

> **注意**：即使配置了映射，系统现在也会**先尝试原始模型**。只有在原始模型不可用（配额耗尽）时，才会使用这个映射配置。

## 工作原理

1. **第 1 次尝试**：
    - 用户请求 `claude-sonnet-4-5`。
    - 系统忽略映射，直接向 Google 请求 `claude-sonnet-4-5`。
    - **如果成功**：直接返回结果。

2. **配额耗尽 (429)**：
    - Google 返回 429 Resource Exhausted 错误。
    - 系统检测到错误，并发现存在有效的映射配置。
    - 系统记录警告日志：`[Claude] Quota exhausted..., falling back to gemini-3-pro-high`。

3. **第 2 次尝试 (自动重试)**：
    - 系统使用映射后的模型 `gemini-3-pro-high` 发起请求。
    - 依然使用同一个 Google 账号。
    - **如果成功**：返回结果（客户端只会感觉到稍微慢了一点点，无感知切换）。

## 日志示例

当发生降级时，您会在日志中看到：

```text
[Claude] First attempt with original model: claude-sonnet-4-5 (mapping available: claude-sonnet-4-5 -> gemini-3-pro-high)
[Claude] Upstream Error Response: ... RESOURCE_EXHAUSTED ...
[Claude] Quota exhausted for claude-sonnet-4-5, immediately falling back to gemini-3-pro-high for next attempt
[Claude] Retry attempt 1, falling back to mapped model: claude-sonnet-4-5 -> gemini-3-pro-high
```

## 常见问题

**Q: 我需要开启什么开关吗？**
A: 不需要。只要您配置了模型映射，这个功能就是自动生效的。

**Q: 如果我想直接一直用 Gemini，不尝试 Claude 怎么办？**
A: 目前的设计是优先尝试 Claude。如果您完全不想用 Claude 模型，可以在客户端直接请求 Gemini 模型。或者，未来我们可以添加一个"强制映射"的开关。

**Q: 这会消耗两倍的请求额度吗？**
A: 不会。第一次失败的请求不计费（或者只算失败），只有成功的请求才会实际消耗 Token。
