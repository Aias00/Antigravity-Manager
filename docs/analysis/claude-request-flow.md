# Claude 模型请求流程分析

## 问题
在以下条件下：
1. Claude 额度还有效
2. 没有达到设置的配额阈值
3. 设置了 Gemini Pro 到 Claude 的模型映射
4. Gemini 也没有达到配额阈值

**请求 Claude 模型时，会请求实际的 Claude 模型还是映射后的 Gemini 模型？**

## 答案：**会请求映射后的 Gemini 模型**

## 详细流程分析

### 1. 请求接收（claude.rs:186-191）
```rust
let mut mapped_model = crate::proxy::common::model_mapping::resolve_model_route(
    &request_for_body.model,  // 例如: "claude-sonnet-4-5"
    &*state.custom_mapping.read().await,
    &*state.openai_mapping.read().await,
    &*state.anthropic_mapping.read().await,
);
```

**此时会进行模型映射**：
- 如果设置了 `claude-4.5-series` → `gemini-3-pro-high`
- 那么 `mapped_model` = `"gemini-3-pro-high"`

### 2. 请求类型判断（claude.rs:197）
```rust
let config = crate::proxy::mappers::common_utils::resolve_request_config(
    &request_for_body.model,  // 原始模型名
    &mapped_model,            // 映射后的模型名
    &tools_val
);
```

**`resolve_request_config` 会根据 `mapped_model` 判断请求类型**：
- 如果 `mapped_model` 是 `gemini-3-pro-high`，则 `request_type` = `"agent"`
- 如果 `mapped_model` 是 `gemini-3-pro-image`，则 `request_type` = `"image_gen"`
- 如果启用了联网，则 `request_type` = `"web_search"`

### 3. 获取账号 Token（claude.rs:204）
```rust
let (access_token, project_id, email) = match token_manager.get_token(
    &config.request_type,  // 这里使用的是基于映射后模型的 request_type
    force_rotate_token
).await
```

**关键点**：`get_token` 使用的是 `config.request_type`，这个类型是基于**映射后的模型**决定的。

### 4. 请求转换（claude.rs:276-281）
```rust
request_with_mapped.model = mapped_model;  // 使用映射后的模型名

let gemini_body = match transform_claude_request_in(&request_with_mapped, &project_id) {
    // 将 Claude 请求转换为 Gemini 请求
}
```

**此时请求已经完全转换为 Gemini 格式**。

### 5. 上游调用（claude.rs:305-310）
```rust
let response = match upstream.call_v1_internal(
    method,
    &access_token,  // Google 账号的 access_token
    gemini_body,    // Gemini 格式的请求体
    query
).await
```

**最终调用的是 Google Gemini API**，而不是 Anthropic Claude API。

## 核心逻辑总结

### 映射的作用
模型映射的作用是**将 Claude 协议的请求转换为 Gemini 协议的请求**：

1. **协议层面**：接收 Claude API 格式的请求（`/v1/messages`）
2. **模型映射**：将 Claude 模型名映射到 Gemini 模型名
3. **请求转换**：将 Claude 请求体转换为 Gemini 请求体
4. **账号选择**：使用 Google 账号（而不是 Claude 账号）
5. **上游调用**：调用 Google Gemini API（而不是 Anthropic Claude API）
6. **响应转换**：将 Gemini 响应转换回 Claude 格式返回给客户端

### 为什么这样设计？

这个系统的设计目的是：**使用 Google 账号的 Gemini 模型来模拟 Claude API**

优点：
- ✅ 客户端可以继续使用 Claude SDK/API 格式
- ✅ 实际使用的是 Google 账号的配额
- ✅ 可以利用 Gemini 模型的能力
- ✅ 避免直接消耗 Claude 账号的配额

### 配额消耗情况

在您描述的场景中：
- **Claude 账号配额**：**不会被消耗**（因为根本没有调用 Claude API）
- **Google 账号配额**：**会被消耗**（因为实际调用的是 Gemini API）

## 如果想使用真实的 Claude 模型

如果您想使用真实的 Claude 模型（通过 Claude API），有两种方式：

### 方式 1：使用 z.ai 集成
在配置中启用 z.ai（Anthropic 直通）：
```
proxy.zai.enabled = true
proxy.zai.dispatch_mode = "exclusive"  // 或 "pooled"
```

这样会直接调用 Anthropic 的 Claude API，而不是通过 Google 转换。

### 方式 2：不设置模型映射
如果不设置 Claude 到 Gemini 的映射，系统会使用默认的映射规则，但仍然是通过 Google API 调用。

**注意**：当前系统架构下，所有通过 `/v1/messages` 端点的请求都会：
1. 先尝试 z.ai（如果启用）
2. 否则转换为 Gemini 请求并使用 Google 账号

## 结论

**在您描述的场景中，请求的是映射后的 Gemini 模型，使用的是 Google 账号的配额，而不是 Claude 账号的配额。**

模型映射的本质是：**协议转换 + 账号切换**，而不仅仅是模型名称的替换。
