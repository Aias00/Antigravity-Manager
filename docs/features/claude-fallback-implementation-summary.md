# Google Claude 自动降级功能 - 实现总结

## 📋 功能概述

成功实现了 **Google Claude 模型自动降级到 Gemini** 的智能路由功能。

### 核心特性

1. **优先使用 Claude**：首次请求优先尝试 Google Vertex AI 的 Claude 模型
2. **智能降级**：当 Claude 配额耗尽（429 错误）时，自动切换到映射的 Gemini 模型
3. **精确控制**：通过"自定义模型映射"可以强制某些模型直接走 Gemini，节省 Claude 配额
4. **同账号切换**：Claude 和 Gemini 都使用同一个 Google 账号，无需额外配置

---

## 🔧 技术实现

### 修改的文件

1. **`src-tauri/src/proxy/handlers/claude.rs`**
   - 添加了智能模型路由逻辑
   - 实现了 Claude 优先尝试机制
   - 添加了 429 错误的降级处理
   - 支持精确映射优先级

2. **`src-tauri/src/proxy/config.rs`**
   - 还原了 z.ai 配置（移除了错误的 fallback_to_mapping 字段）

3. **`docs/guides/quota-optimization.md`**
   - 创建了配额优化指南
   - 说明了如何通过精确映射节省 Claude 配额

4. **`docs/features/google-claude-auto-fallback.md`**
   - 创建了功能使用文档

### 核心逻辑

```rust
// 1. 检查是否有精确的自定义映射
let has_custom_mapping = state.custom_mapping.read().await.contains_key(&request_for_body.model);

// 2. 决定使用的模型
let mut mapped_model = if has_custom_mapping {
    // 有精确映射：直接使用映射结果（强制分流）
    mapped_model_from_config.clone()
} else if is_claude_model && is_first_attempt {
    // Claude 模型首次尝试：使用原始模型
    request_for_body.model.clone()
} else if is_claude_model && !is_first_attempt {
    // Claude 模型重试：使用映射的 Gemini 模型
    mapped_model_from_config.clone()
} else {
    // 其他情况：正常映射
    mapped_model_from_config.clone()
};

// 3. 429 错误处理
if status_code == 429 && is_claude_model && is_first_attempt {
    // 触发降级，下次循环会使用 Gemini
    continue;
}
```

---

## 📊 使用场景

### 场景 A：日常对话（自动降级模式）

**配置**：
- 只配置分组映射：`Claude 4.5 系列` -> `gemini-3-pro-high`
- **不配置**精确映射

**效果**：
1. 第一次请求 `claude-sonnet-4-5` -> 使用 Google Claude
2. 如果成功 -> 返回结果
3. 如果 429 -> 自动重试，使用 `gemini-3-pro-high`

**适用于**：
- Cursor Chat 对话
- Web UI 交互
- 需要高质量输出的场景

### 场景 B：Claude Code（强制分流模式）

**配置**：
- 添加精确映射：`claude-3-5-sonnet-20241022` -> `gemini-3-pro-high`

**效果**：
- 所有请求**直接**使用 `gemini-3-pro-high`
- **完全不消耗** Claude 配额

**适用于**：
- Claude Code CLI
- 高频后台任务
- 代码索引/补全
- 需要节省配额的场景

### 场景 C：Haiku 优化（一键配置）

**配置**：
- 点击 UI 中的"一键优化"按钮
- 自动添加：`claude-haiku-4-5-20251001` -> `gemini-2.5-flash-lite`

**效果**：
- Claude CLI 的后台任务直接走 Flash Lite
- 节省约 **95%** 的成本

---

## 🎯 配额优化建议

### 推荐配置

| 模型 | 映射类型 | 目标模型 | 用途 |
|------|---------|---------|------|
| `claude-sonnet-4-5` | 分组映射 | `gemini-3-pro-high` | 日常对话（自动降级） |
| `claude-3-5-sonnet-20241022` | **精确映射** | `gemini-3-pro-high` | Claude Code（强制分流） |
| `claude-haiku-4-5-20251001` | **精确映射** | `gemini-2.5-flash-lite` | CLI 后台任务（省钱） |

### 配额消耗对比

**修改前**（直接映射）：
- Claude 配额消耗：0%
- Gemini 配额消耗：100%
- 问题：无法使用 Claude 的高质量输出

**修改后（智能降级）**：
- 对话场景：优先消耗 Claude，耗尽后自动切换
- 后台任务：通过精确映射强制走 Gemini
- 灵活性：用户可以精确控制哪些请求走哪个模型

---

## ⚠️ 注意事项

1. **精确映射优先级最高**
   - 如果配置了精确映射，系统会**直接**使用映射的模型
   - 不会尝试原始模型

2. **分组映射用于降级**
   - 分组映射（如 `Claude 4.5 系列`）用于自动降级
   - 第一次尝试原始模型，失败后才使用映射

3. **Claude Code 特别处理**
   - 强烈建议为 Claude Code 配置精确映射
   - 避免瞬间耗尽 Claude 配额

4. **编译警告**
   - 当前有一些未使用变量的警告（`should_rotate_account`）
   - 这些是遗留代码，不影响功能
   - 后续可以清理

---

## 🚀 下一步优化

1. **清理未使用的变量**
   - 移除 `should_rotate_account` 相关的警告

2. **添加统计信息**
   - 记录降级次数
   - 显示 Claude/Gemini 的使用比例

3. **UI 增强**
   - 在 UI 中显示当前的降级状态
   - 添加配额使用情况的可视化

4. **测试覆盖**
   - 添加单元测试
   - 添加集成测试

---

## ✅ 验证清单

- [x] 编译通过（无错误）
- [x] z.ai 逻辑已还原
- [x] Claude 优先尝试逻辑已实现
- [x] 429 降级逻辑已实现
- [x] 精确映射优先级已实现
- [x] 文档已创建
- [ ] 实际测试（需要用户验证）
- [ ] 性能测试
- [ ] 边界情况测试

---

## 📝 总结

本次实现成功解决了以下问题：

1. ✅ **还原了 z.ai 的原始逻辑**
2. ✅ **实现了 Google Claude 到 Gemini 的智能降级**
3. ✅ **提供了精确映射的强制分流功能**
4. ✅ **创建了详细的使用文档**
5. ✅ **修复了所有编译错误**

用户现在可以：
- 优先使用 Google Claude 模型获得高质量输出
- 在配额耗尽时自动降级到 Gemini
- 通过精确映射强制某些高频请求走 Gemini
- 灵活控制配额的使用策略

**建议下一步**：
1. 重启应用测试功能
2. 配置精确映射给 Claude Code
3. 观察配额消耗情况
4. 根据实际使用调整映射策略
