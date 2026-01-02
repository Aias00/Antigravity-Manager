# 模型映射默认值问题修复

## 问题描述

用户设置了 Claude 4.5 系列映射到 `gemini-3-pro-high`，但映射没有生效，系统仍然使用默认的映射规则。

## 根本原因

### 前端问题
在 `ApiProxy.tsx` 中，所有模型映射下拉框的默认选项使用了 `value=""`：

```tsx
<option value="">gemini-3-pro-high (Default)</option>
```

这导致当用户选择默认选项时，实际传递给后端的是**空字符串**，而不是实际的模型名称。

### 后端问题
在 `model_mapping.rs` 中，映射检查逻辑没有过滤空字符串：

```rust
if let Some(target) = anthropic_mapping.get(family_key) {
    return target.clone();  // 如果 target 是空字符串，会返回空字符串
}
```

这导致空字符串映射被当作有效映射使用，最终导致模型路由失败。

## 解决方案

### 1. 前端修复
将所有默认选项的 `value` 从空字符串改为实际的模型名称：

```tsx
// 修复前
<option value="">gemini-3-pro-high (Default)</option>

// 修复后
<option value="gemini-3-pro-high">gemini-3-pro-high (Default)</option>
```

修改的位置：
- Claude 4.5 系列：`gemini-3-pro-high`
- Claude 3.5 系列：`claude-sonnet-4-5-thinking`
- GPT-4 系列：`gemini-3-pro-high`
- GPT-4o/3.5 系列：`gemini-3-flash`
- GPT-5 系列：`gemini-3-flash`

### 2. 后端修复
在所有映射检查中添加空字符串过滤：

```rust
if let Some(target) = anthropic_mapping.get(family_key) {
    if !target.is_empty() {  // 添加空字符串检查
        return target.clone();
    }
}
```

修改的位置：
- 自定义精确映射检查
- GPT-4 系列映射检查
- GPT-4o/3.5 系列映射检查
- GPT-5 系列映射检查
- Claude 4.5/3.5 系列映射检查
- 旧版精确映射兜底检查

## 修改的文件

1. **前端**：`/Users/aias/Work/github/Antigravity-Manager/src/pages/ApiProxy.tsx`
   - 修改了 5 个默认选项的 value 属性

2. **后端**：`/Users/aias/Work/github/Antigravity-Manager/src-tauri/src/proxy/common/model_mapping.rs`
   - 在 7 处映射检查中添加了空字符串过滤

## 测试建议

1. 清空现有的映射配置
2. 重新设置 Claude 4.5 系列映射为 `gemini-3-pro-high`
3. 重启代理服务
4. 发送 Claude 4.5 请求，检查日志确认使用了正确的映射
5. 测试其他系列的映射是否也能正常工作

## 预期效果

- ✅ 选择默认选项时会正确保存映射
- ✅ 空字符串映射不会被使用
- ✅ 映射配置立即生效（需要重启代理服务）
- ✅ 日志中会显示正确的映射路由信息

## 日志示例

修复后，当使用 Claude 4.5 模型时，应该看到类似的日志：

```
[Router] 使用 Anthropic 系列映射: claude-sonnet-4-5 -> gemini-3-pro-high
```

如果没有设置映射或映射为空，会使用系统默认值：

```
[Router] 使用系统默认映射: claude-sonnet-4-5 -> claude-sonnet-4-5
```
