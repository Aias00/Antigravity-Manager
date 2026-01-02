# Google Claude 模型自动降级到 Gemini 功能设计

## 需求澄清

用户希望：
1. **优先使用 Google 账号的 Claude 模型**（通过 Vertex AI）
2. **当 Claude 配额耗尽时**，自动降级到 **Gemini 模型**
3. 都使用同一个 Google 账号，只是切换模型

## 当前系统的问题

### 问题 1：映射会直接替换模型
当前如果设置了映射（`claude-sonnet-4-5` → `gemini-3-pro-high`），系统会：
- 在请求开始时就将模型替换为 `gemini-3-pro-high`
- 根本不会尝试调用 `claude-sonnet-4-5`
- 无法实现"先 Claude 后 Gemini"的降级逻辑

### 问题 2：需要区分"映射"和"降级"
- **映射**：直接替换模型，不尝试原模型
- **降级**：先尝试原模型，失败后才使用备用模型

## 解决方案设计

### 方案 A：添加"降级映射"配置（推荐）

在配置中添加一个新的映射类型：`fallback_mapping`

```rust
pub struct ProxyConfig {
    // 现有的直接映射（立即替换）
    pub anthropic_mapping: HashMap<String, String>,
    
    // 新增：降级映射（失败后才替换）
    pub anthropic_fallback_mapping: HashMap<String, String>,
}
```

**工作流程**：
1. 检查 `anthropic_fallback_mapping`，如果有配置，记录降级目标
2. 先尝试使用原始 Claude 模型
3. 如果返回 429（配额耗尽），使用降级目标重试
4. 如果降级也失败，返回错误

**优点**：
- 清晰区分"映射"和"降级"
- 不影响现有的映射功能
- 灵活性高

**缺点**：
- 需要添加新的配置项
- UI 需要添加新的配置界面

### 方案 B：添加"优先级"标志（简单）

在现有映射基础上添加一个标志：`try_original_first`

```rust
pub struct ProxyConfig {
    pub anthropic_mapping: HashMap<String, String>,
    
    // 新增：是否先尝试原始模型
    pub try_original_model_first: bool,
}
```

**工作流程**：
1. 如果 `try_original_model_first = true`：
   - 先尝试原始模型
   - 失败后使用映射的模型
2. 如果 `try_original_model_first = false`：
   - 直接使用映射的模型（当前行为）

**优点**：
- 实现简单
- UI 改动小（只需一个开关）

**缺点**：
- 全局配置，不能针对不同模型设置不同策略
- 语义不够清晰

### 方案 C：智能检测（最简单）

不添加新配置，直接在代码中实现：
1. 检查请求的模型是否是 Claude 模型
2. 检查是否有映射配置
3. 如果有映射，先尝试原始 Claude 模型
4. 如果返回 429，使用映射的 Gemini 模型重试

**优点**：
- 无需配置改动
- 用户无感知
- 实现最简单

**缺点**：
- 行为固定，不够灵活
- 可能不符合某些用户的预期

## 推荐实现：方案 C（智能检测）

考虑到您的具体需求，我推荐使用方案 C，因为：
1. 您的场景很明确：Claude 优先，配额耗尽才用 Gemini
2. 不需要复杂的配置
3. 实现最快

### 实现步骤

#### 1. 修改 Claude Handler

```rust
// 在 claude.rs 的请求处理中
pub async fn handle_messages(...) -> Response {
    let request: ClaudeRequest = ...;
    
    // 1. 检查是否有映射
    let mapped_model = resolve_model_route(...);
    let has_fallback = mapped_model != request.model && mapped_model.starts_with("gemini-");
    
    // 2. 先尝试原始 Claude 模型（如果是 Claude 模型）
    if request.model.starts_with("claude-") {
        let claude_response = try_claude_model(&request, &state).await;
        
        // 3. 检查是否需要降级
        if claude_response.status().as_u16() == 429 && has_fallback {
            tracing::warn!(
                "Claude model {} quota exhausted, falling back to {}",
                request.model,
                mapped_model
            );
            
            // 4. 使用 Gemini 重试
            return try_gemini_model(&request, &mapped_model, &state).await;
        }
        
        return claude_response;
    }
    
    // 如果不是 Claude 模型，使用正常流程
    ...
}
```

#### 2. 提取公共逻辑

```rust
async fn try_claude_model(
    request: &ClaudeRequest,
    state: &AppState
) -> Response {
    // 使用 Claude 模型调用 Vertex AI
    let gemini_body = transform_claude_request_in(request, &project_id)?;
    
    upstream.call_v1_internal(
        method,
        &access_token,
        gemini_body,
        query
    ).await
}

async fn try_gemini_model(
    request: &ClaudeRequest,
    gemini_model: &str,
    state: &AppState
) -> Response {
    // 修改请求模型为 Gemini
    let mut gemini_request = request.clone();
    gemini_request.model = gemini_model.to_string();
    
    // 使用 Gemini 模型调用
    let gemini_body = transform_claude_request_in(&gemini_request, &project_id)?;
    
    upstream.call_v1_internal(
        method,
        &access_token,
        gemini_body,
        query
    ).await
}
```

## 配额检测逻辑

### 如何判断 Claude 配额耗尽？

Google Vertex AI 返回的 429 错误格式：

```json
{
  "error": {
    "code": 429,
    "message": "Quota exceeded for quota metric 'GenerateContent requests' ...",
    "status": "RESOURCE_EXHAUSTED"
  }
}
```

检测逻辑：
```rust
fn is_quota_exhausted(response: &Response) -> bool {
    if response.status().as_u16() != 429 {
        return false;
    }
    
    // 检查错误消息
    if let Ok(error_text) = response.text().await {
        error_text.contains("RESOURCE_EXHAUSTED") 
            || error_text.contains("Quota exceeded")
            || error_text.contains("QUOTA_EXHAUSTED")
    } else {
        false
    }
}
```

## 使用示例

### 配置

```yaml
proxy:
  anthropic_mapping:
    claude-4.5-series: "gemini-3-pro-high"
    claude-3.5-series: "gemini-2.5-flash"
```

### 工作流程

1. **Claude 配额充足**：
   ```
   请求: claude-sonnet-4-5
   ↓
   尝试: claude-sonnet-4-5 (Google Vertex AI)
   ↓
   成功: 返回 Claude 响应
   ```

2. **Claude 配额耗尽**：
   ```
   请求: claude-sonnet-4-5
   ↓
   尝试: claude-sonnet-4-5 (Google Vertex AI)
   ↓
   失败: 429 RESOURCE_EXHAUSTED
   ↓
   检查映射: claude-4.5-series → gemini-3-pro-high
   ↓
   重试: gemini-3-pro-high (Google Vertex AI)
   ↓
   成功: 返回 Gemini 响应（转换为 Claude 格式）
   ```

## 日志示例

```
[Claude] Received request for model: claude-sonnet-4-5
[Claude] Trying original Claude model first
Using account: user@gmail.com for request (type: agent)
[Claude] Upstream Error Response: 429 RESOURCE_EXHAUSTED
[Claude] Claude model claude-sonnet-4-5 quota exhausted, falling back to gemini-3-pro-high
Using account: user@gmail.com for request (type: agent)
[Claude] Request finished. Model: gemini-3-pro-high, Tokens: In 100, Out 200
```

## 优势

1. **无需额外配置**：使用现有的映射配置
2. **自动降级**：配额耗尽时自动切换
3. **同一账号**：都使用 Google 账号，不涉及多个服务商
4. **透明切换**：客户端无感知
5. **成本优化**：优先使用 Claude 配额

## 注意事项

1. **只对 Claude 模型生效**：只有请求 `claude-*` 模型时才会先尝试原模型
2. **需要配置映射**：必须在 `anthropic_mapping` 中配置降级目标
3. **降级目标必须是 Gemini**：降级目标必须以 `gemini-` 开头
4. **同一账号**：Claude 和 Gemini 使用同一个 Google 账号的配额

## 下一步

我将实现方案 C，修改 `claude.rs` 来支持这个功能。
