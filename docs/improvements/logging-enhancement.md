# 日志增强 - 添加 trace_id 和账号信息

## 📋 改进内容

为所有关键日志添加了 `trace_id` 和账号信息（`email`），提高请求的可追溯性。

---

## ✅ 已改进的日志

### 1. **账号选择日志**
```rust
// 修改前
info!("✓ Using account: {} (type: {})", email, config.request_type);

// 修改后
info!("[{}] ✓ Using account: {} (type: {})", trace_id, email, config.request_type);
```

**输出示例**：
```
INFO [abc123] ✓ Using account: user@gmail.com (type: agent)
```

---

### 2. **自定义映射日志**
```rust
// 修改前
tracing::info!(
    "[Claude] Custom mapping found, respecting override: {} -> {}",
    request_for_body.model,
    &mapped_model_from_config
);

// 修改后
tracing::info!(
    "[{}][Claude] Custom mapping found, respecting override: {} -> {}",
    trace_id,
    request_for_body.model,
    &mapped_model_from_config
);
```

**输出示例**：
```
INFO [abc123][Claude] Custom mapping found, respecting override: claude-sonnet-4-5 -> gemini-3-pro-high
```

---

### 3. **首次尝试日志**
```rust
// 修改前
tracing::info!(
    "[Claude] First attempt with original model: {} (fallback mapping available: {} -> {})",
    request_for_body.model,
    request_for_body.model,
    &mapped_model_from_config
);

// 修改后
tracing::info!(
    "[{}][Claude] First attempt with original model: {} (fallback mapping available: {} -> {})",
    trace_id,
    request_for_body.model,
    request_for_body.model,
    &mapped_model_from_config
);
```

**输出示例**：
```
INFO [abc123][Claude] First attempt with original model: claude-sonnet-4-5 (fallback mapping available: claude-sonnet-4-5 -> gemini-3-pro-high)
```

---

### 4. **重试降级日志**
```rust
// 修改前
tracing::warn!(
    "[Claude] Retry attempt {}, falling back to mapped model: {} -> {}",
    attempt + 1,
    request_for_body.model,
    &mapped_model_from_config
);

// 修改后
tracing::warn!(
    "[{}][Claude] Retry attempt {}, falling back to mapped model: {} -> {}",
    trace_id,
    attempt + 1,
    request_for_body.model,
    &mapped_model_from_config
);
```

**输出示例**：
```
WARN [abc123][Claude] Retry attempt 2, falling back to mapped model: claude-sonnet-4-5 -> gemini-3-pro-high
```

---

### 5. **配额耗尽日志**
```rust
// 修改前
tracing::warn!(
    "[Claude] Quota exhausted for {}, immediately falling back to {} for next attempt",
    request_for_body.model,
    &mapped_model_from_config
);

// 修改后
tracing::warn!(
    "[{}][Claude] Quota exhausted for {}, immediately falling back to {} for next attempt | Account: {}",
    trace_id,
    request_for_body.model,
    &mapped_model_from_config,
    email
);
```

**输出示例**：
```
WARN [abc123][Claude] Quota exhausted for claude-sonnet-4-5, immediately falling back to gemini-3-pro-high for next attempt | Account: user@gmail.com
```

---

### 6. **上游错误日志**
```rust
// 修改前
tracing::warn!("Claude Upstream {} on attempt {}/{}, will rotate account on next attempt", status, attempt + 1, max_attempts);

// 修改后
tracing::warn!("[{}] Claude Upstream {} on attempt {}/{}, will rotate account on next attempt | Account: {}", trace_id, status, attempt + 1, max_attempts, email);
```

**输出示例**：
```
WARN [abc123] Claude Upstream 503 on attempt 1/3, will rotate account on next attempt | Account: user@gmail.com
```

---

## 🎯 改进效果

### 修改前的日志
```
INFO ✓ Using account: user@gmail.com (type: agent)
INFO [Claude] First attempt with original model: claude-sonnet-4-5
WARN Upstream endpoint returned 429 Too Many Requests
WARN [Claude] Quota exhausted for claude-sonnet-4-5
WARN [Claude] Retry attempt 2, falling back to mapped model
INFO ✓ Using account: another@gmail.com (type: agent)
```

**问题**：
- ❌ 无法关联同一个请求的多条日志
- ❌ 不知道哪个账号触发了 429 错误
- ❌ 难以追踪请求流程

---

### 修改后的日志
```
INFO [abc123] ✓ Using account: user@gmail.com (type: agent)
INFO [abc123][Claude] First attempt with original model: claude-sonnet-4-5 (fallback mapping available: claude-sonnet-4-5 -> gemini-3-pro-high)
WARN Upstream endpoint returned 429 Too Many Requests
WARN [abc123][Claude] Quota exhausted for claude-sonnet-4-5, immediately falling back to gemini-3-pro-high for next attempt | Account: user@gmail.com
WARN [abc123][Claude] Retry attempt 2, falling back to mapped model: claude-sonnet-4-5 -> gemini-3-pro-high
INFO [abc123] ✓ Using account: another@gmail.com (type: agent)
```

**优势**：
- ✅ 通过 `trace_id` 可以关联同一请求的所有日志
- ✅ 清楚知道哪个账号触发了错误
- ✅ 完整的请求流程追踪
- ✅ 便于问题诊断和性能分析

---

## 📊 日志格式规范

### 标准格式
```
[LEVEL] [trace_id][Component] Message | Account: email
```

### 示例
```
INFO [abc123][Claude] First attempt with original model: claude-sonnet-4-5
WARN [abc123][Claude] Quota exhausted | Account: user@gmail.com
INFO [abc123] ✓ Using account: user@gmail.com (type: agent)
```

### 组件标识
- `[Claude]` - Claude 请求处理
- `[Router]` - 模型路由
- `[AUTO]` - 后台任务自动降级
- 无组件标识 - 通用日志

---

## 🔍 使用场景

### 1. 追踪单个请求
```bash
# 通过 trace_id 过滤
grep "abc123" logs.txt
```

### 2. 分析账号使用情况
```bash
# 查看特定账号的所有请求
grep "user@gmail.com" logs.txt
```

### 3. 诊断降级问题
```bash
# 查看所有降级日志
grep "falling back" logs.txt
```

### 4. 监控配额耗尽
```bash
# 查看配额耗尽事件
grep "Quota exhausted" logs.txt
```

---

## ⚠️ 注意事项

### 1. **trace_id 的作用域**
- 每个请求生成唯一的 `trace_id`
- 在整个请求生命周期中保持不变
- 包括重试和降级

### 2. **email 的可用性**
- 只有在获取 token 之后才能使用
- 早期的日志（如模型映射决策）只能包含 `trace_id`

### 3. **日志级别**
- `INFO` - 正常流程
- `WARN` - 降级、重试、配额耗尽
- `ERROR` - 不可恢复的错误
- `DEBUG` - 详细的调试信息

---

## 📝 后续改进建议

1. **添加请求时长**
   ```rust
   info!("[{}] Request completed in {}ms | Account: {}", trace_id, duration_ms, email);
   ```

2. **添加 token 使用量**
   ```rust
   info!("[{}] Tokens: in={}, out={} | Account: {}", trace_id, input_tokens, output_tokens, email);
   ```

3. **添加模型信息**
   ```rust
   info!("[{}] Model: {} -> {} | Account: {}", trace_id, original_model, final_model, email);
   ```

4. **结构化日志**
   - 考虑使用 JSON 格式
   - 便于日志分析工具处理

---

**修改版本**：v3.3.11+  
**修改日期**：2026-01-02  
**相关文件**：`src-tauri/src/proxy/handlers/claude.rs`  
**改进类型**：日志增强
