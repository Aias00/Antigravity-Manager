# 添加请求日志以排查空 Thinking 块问题

## 📋 背景

用户继续遇到 `thinking.thinking: Field required` 错误：

```
ERROR [rg4huo] Non-retryable error 400: {
  "error": {
    "message": "messages.1.content.1.thinking.thinking: Field required"
  }
}
```

**关键发现**：错误在 `messages.1.content.1`，说明问题在**请求**中，而不是响应中。

---

## ✅ 添加的日志

### 1. **Claude 请求体日志**（转换前）

```rust
// 【调试】打印即将发送的 Claude 请求体
debug!("[{}] Claude Request Body (before transform): {}", 
    trace_id, 
    serde_json::to_string_pretty(&request_with_mapped).unwrap_or_default()
);
```

**位置**：`claude.rs` 第 472-473 行  
**时机**：在转换为 Gemini 格式之前  
**用途**：查看客户端发送的原始 Claude 请求

---

### 2. **Gemini 请求体日志**（转换后）

```rust
debug!("[{}] Transformed Gemini Body: {}", 
    trace_id, 
    serde_json::to_string_pretty(&b).unwrap_or_default()
);
```

**位置**：`claude.rs` 第 480 行（已存在）  
**时机**：转换为 Gemini 格式之后  
**用途**：查看转换后的 Gemini 请求

---

## 🔍 如何使用日志排查

### 步骤 1：启用 DEBUG 日志

确保应用的日志级别设置为 `DEBUG`。

### 步骤 2：触发错误

重现导致 400 错误的操作。

### 步骤 3：查看日志

查找包含 trace_id 的日志：

```bash
# 假设 trace_id 是 rg4huo
grep "rg4huo" logs.txt
```

### 步骤 4：分析请求体

查看 `Claude Request Body (before transform)` 日志：

```json
{
  "model": "claude-sonnet-4-5",
  "messages": [
    {
      "role": "user",
      "content": "..."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "..."
        },
        {
          "type": "thinking",
          "thinking": "",  // ❌ 找到了！空的 thinking 块
          "signature": "sig_abc123"
        }
      ]
    }
  ]
}
```

---

## 🎯 可能的问题来源

### 1. **客户端发送了空 thinking 块**

如果客户端（如 Claude Code CLI）在历史消息中包含了空的 thinking 块：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "",  // ❌ 客户端的问题
      "signature": "..."
    }
  ]
}
```

**解决方案**：在请求处理中过滤掉空的 thinking 块。

---

### 2. **我们的代码创建了空 thinking 块**

如果在某个转换或处理步骤中创建了空块：

```rust
ContentBlock::Thinking {
    thinking: String::new(),  // ❌ 我们的问题
    signature: Some(...),
    cache_control: None,
}
```

**解决方案**：修复相关代码，不创建空块。

---

### 3. **历史消息中的遗留问题**

如果之前的响应中包含了空 thinking 块，并被保存到历史中：

```json
// 之前的响应
{
  "content": [
    {
      "type": "thinking",
      "thinking": "",  // ❌ 历史遗留
      "signature": "..."
    }
  ]
}

// 下次请求时被包含在 messages 中
{
  "messages": [
    ...,
    {
      "role": "assistant",
      "content": [...]  // 包含上面的空块
    }
  ]
}
```

**解决方案**：在处理请求时过滤历史消息中的空 thinking 块。

---

## 🛠️ 下一步修复方案

### 方案 A：过滤请求中的空 thinking 块

在 `claude.rs` 中，转换前过滤：

```rust
// 过滤掉空的 thinking 块
for msg in request_with_mapped.messages.iter_mut() {
    if let MessageContent::Array(blocks) = &mut msg.content {
        blocks.retain(|b| {
            if let ContentBlock::Thinking { thinking, .. } = b {
                !thinking.is_empty()  // 只保留非空的 thinking
            } else {
                true  // 保留其他类型的块
            }
        });
    }
}
```

---

### 方案 B：在转换时跳过空 thinking 块

在 `request.rs` 的转换逻辑中：

```rust
ContentBlock::Thinking { thinking, signature, .. } => {
    if thinking.is_empty() {
        // 跳过空的 thinking 块
        tracing::debug!("Skipping empty thinking block in request");
        continue;
    }
    // 正常处理非空的 thinking 块
    ...
}
```

---

### 方案 C：修复客户端

如果问题在客户端（如 Claude Code CLI），需要：
1. 更新客户端代码
2. 或者在服务端过滤（方案 A/B）

---

## 📊 日志示例

### 正常请求

```
DEBUG [abc123] Claude Request Body (before transform): {
  "model": "claude-sonnet-4-5",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ]
}
DEBUG [abc123] Transformed Gemini Body: {
  "contents": [
    {
      "role": "user",
      "parts": [{"text": "Hello"}]
    }
  ]
}
```

---

### 有问题的请求

```
DEBUG [rg4huo] Claude Request Body (before transform): {
  "model": "claude-sonnet-4-5",
  "messages": [
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "",  // ❌ 空块！
          "signature": "sig_xyz"
        }
      ]
    }
  ]
}
ERROR [rg4huo] Non-retryable error 400: thinking.thinking: Field required
```

---

## ⚠️ 注意事项

1. **DEBUG 日志可能包含敏感信息**
   - 请求内容可能包含用户数据
   - 生产环境建议使用 INFO 级别

2. **日志量可能很大**
   - 每个请求都会打印完整的 JSON
   - 建议只在调试时启用

3. **性能影响**
   - `serde_json::to_string_pretty` 有一定开销
   - 可以考虑只在出错时打印

---

## 🎯 总结

| 项目 | 内容 |
|------|------|
| **新增日志** | Claude 请求体（转换前） |
| **已有日志** | Gemini 请求体（转换后） |
| **日志级别** | DEBUG |
| **用途** | 排查空 thinking 块来源 |
| **下一步** | 根据日志确定问题来源并修复 |

---

**修改版本**：v3.3.11+  
**修改日期**：2026-01-02  
**修改类型**：调试增强  
**相关文件**：`src-tauri/src/proxy/handlers/claude.rs`
