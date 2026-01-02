# z.ai 自动降级到 Gemini 功能实现指南

## 功能说明

实现了一个新功能：**当 z.ai (Claude API) 配额耗尽时，自动降级到 Gemini 映射**。

这样可以：
1. 优先使用真实的 Claude API（通过 z.ai）
2. 当 Claude 配额耗尽时，自动切换到 Google 账号的 Gemini 模型
3. 无需手动切换，实现无缝降级

## 已完成的后端修改

### 1. 配置结构修改 (`src-tauri/src/proxy/config.rs`)

在 `ZaiConfig` 结构中添加了新字段：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZaiConfig {
    // ... 其他字段 ...
    
    /// When z.ai quota is exhausted, automatically fallback to Gemini mapping if available.
    #[serde(default)]
    pub fallback_to_mapping: bool,
}
```

默认值为 `false`（不启用降级）。

### 2. Claude Handler 修改 (`src-tauri/src/proxy/handlers/claude.rs`)

修改了 z.ai 调用逻辑，添加了错误检测和降级处理：

```rust
if use_zai {
    let zai_response = crate::proxy::providers::zai_anthropic::forward_anthropic_json(
        &state,
        axum::http::Method::POST,
        "/v1/messages",
        &headers,
        body.clone(),
    )
    .await;
    
    // Check if we should fallback to Gemini mapping on quota exhaustion
    if zai.fallback_to_mapping {
        let should_fallback = match &zai_response {
            resp if resp.status().as_u16() == 429 => true,  // 配额耗尽
            resp if resp.status().as_u16() >= 500 => true,  // 服务错误
            _ => false
        };
        
        if should_fallback {
            // 检查是否有有效的 Gemini 映射
            let mapped_model = resolve_model_route(...);
            
            if mapped_model != request.model && mapped_model.starts_with("gemini-") {
                // 有效的映射，继续使用 Gemini 流程
                tracing::warn!("z.ai quota exhausted, falling back to Gemini: {} -> {}", 
                    request.model, mapped_model);
            } else {
                // 没有有效映射，返回原始错误
                return zai_response;
            }
        } else {
            // 没有错误，返回 z.ai 响应
            return zai_response;
        }
    } else {
        // 降级功能未启用，直接返回 z.ai 响应
        return zai_response;
    }
}

// 如果到达这里，说明需要使用 Gemini 流程
// ... 继续 Gemini 请求处理 ...
```

## 需要手动添加的前端 UI

在 `src/pages/ApiProxy.tsx` 文件中，找到 z.ai API Key 输入框（约第 896 行），在其后添加以下代码：

```tsx
</div>

{/* Fallback to Gemini Mapping Option */}
<div className="space-y-1">
    <label className="flex items-center gap-2 cursor-pointer">
        <input
            type="checkbox"
            className="checkbox checkbox-sm checkbox-primary"
            checked={!!appConfig.proxy.zai?.fallback_to_mapping}
            onChange={(e) => updateZaiGeneralConfig({ fallback_to_mapping: e.target.checked })}
        />
        <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
            配额耗尽时自动降级到 Gemini 映射
        </span>
    </label>
    <p className="text-[10px] text-gray-500 dark:text-gray-400 ml-6">
        启用后，当 z.ai 配额耗尽时，会自动切换到使用 Google 账号的 Gemini 模型（如果已配置映射）
    </p>
</div>

{/* Model Mapping Section */}
```

**插入位置**：在 API Key 输入框的 `</div>` 之后，`{/* Model Mapping Section */}` 注释之前。

## 使用方法

### 1. 配置 z.ai

```yaml
proxy:
  zai:
    enabled: true
    api_key: "your-z.ai-api-key"
    dispatch_mode: "exclusive"  # 优先使用 z.ai
    fallback_to_mapping: true   # 启用降级功能
```

### 2. 配置 Gemini 映射

在"模型路由中心"中设置 Claude 到 Gemini 的映射：

```
Claude 4.5 系列 -> gemini-3-pro-high
Claude 3.5 系列 -> gemini-2.5-flash
```

### 3. 添加 Google 账号

确保已添加至少一个 Google 账号，用于 Gemini 请求。

## 工作流程

1. **正常情况**：
   - 请求 Claude 模型
   - 使用 z.ai (真实 Claude API)
   - 返回 Claude 响应

2. **z.ai 配额耗尽**：
   - 请求 Claude 模型
   - z.ai 返回 429 错误
   - 检测到 `fallback_to_mapping = true`
   - 检查是否有 Gemini 映射（如 `claude-sonnet-4-5` -> `gemini-3-pro-high`）
   - 自动切换到 Gemini 流程
   - 使用 Google 账号调用 Gemini API
   - 将 Gemini 响应转换为 Claude 格式返回

3. **没有映射或映射无效**：
   - z.ai 返回 429 错误
   - 没有找到有效的 Gemini 映射
   - 返回原始的 429 错误给客户端

## 日志示例

### 成功降级
```
[Claude] z.ai returned 429, checking for fallback to Gemini mapping
[Claude] z.ai quota exhausted, falling back to Gemini mapping: claude-sonnet-4-5 -> gemini-3-pro-high
[Router] 使用 Anthropic 系列映射: claude-sonnet-4-5 -> gemini-3-pro-high
Using account: user@gmail.com for request (type: agent)
```

### 无法降级
```
[Claude] z.ai returned 429, checking for fallback to Gemini mapping
[Claude] z.ai quota exhausted but no valid Gemini mapping found, returning error
```

## 优点

1. **优先使用真实 Claude**：在配额充足时使用真实的 Claude API，获得最佳体验
2. **自动降级**：配额耗尽时自动切换，无需手动干预
3. **无缝切换**：客户端无感知，继续使用 Claude API 格式
4. **灵活配置**：可以选择启用或禁用降级功能
5. **成本优化**：优先消耗 z.ai 配额，只在必要时使用 Google 配额

## 注意事项

1. **需要同时配置**：
   - z.ai API Key
   - Gemini 模型映射
   - Google 账号

2. **降级条件**：
   - 只在 429 (配额耗尽) 和 5xx (服务错误) 时降级
   - 其他错误（如 400, 401）不会触发降级

3. **映射要求**：
   - 映射的目标模型必须是 `gemini-` 开头
   - 映射必须不为空

4. **配额消耗**：
   - 正常情况下消耗 z.ai 配额
   - 降级后消耗 Google 账号配额

## 测试建议

1. 配置 z.ai 和 Gemini 映射
2. 启用 `fallback_to_mapping`
3. 发送 Claude 请求，观察使用 z.ai
4. 模拟 z.ai 配额耗尽（或等待真实耗尽）
5. 观察自动降级到 Gemini
6. 检查日志确认降级流程
