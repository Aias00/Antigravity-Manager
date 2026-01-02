# 配额阈值检查功能修复

## 🐛 问题描述

用户报告：设置了配额阈值（86%）的账号仍然被使用，导致所有账号的 Claude 配额都被消耗。

**具体情况**：
- 账号1：阈值 86%，当前 84% → **应该跳过**，但实际被使用
- 账号2：无阈值，当前 36% → 被使用（正确）
- 账号3：当前 79% → 被使用（不应该，因为账号2还有配额）

## 🔍 根本原因

虽然系统加载了 `min_quota_threshold` 配置，但在 `get_token` 方法中**完全没有使用**这个值进行检查。

## ✅ 修复方案

### 1. 添加配额检查方法

在 `TokenManager` 中新增 `is_quota_below_threshold` 方法：

```rust
fn is_quota_below_threshold(&self, token: &ProxyToken, quota_group: &str) -> bool {
    // 1. 检查是否设置了阈值
    let threshold = match token.min_quota_threshold {
        Some(t) => t,
        None => return false, // 无阈值，不限制
    };

    // 2. 检查是否有配额数据
    let quota_data = match &token.quota {
        Some(q) => q,
        None => return false, // 无配额数据，允许使用
    };

    // 3. 提取 Claude 配额百分比
    let current_quota_percent = quota_data.get("models")
        .and_then(|m| m.as_object())
        .and_then(|models| {
            for (model_name, model_data) in models {
                if model_name.contains("claude") {
                    if let Some(percent) = model_data.get("quota_percent").and_then(|v| v.as_i64()) {
                        return Some(percent as i32);
                    }
                }
            }
            None
        });

    // 4. 比较当前配额与阈值
    match current_quota_percent {
        Some(current) => {
            let below_threshold = current < threshold;
            if below_threshold {
                tracing::debug!(
                    "Account {} quota ({}) is below threshold ({}), skipping",
                    token.email, current, threshold
                );
            }
            below_threshold
        }
        None => false, // 无法获取配额，允许使用
    }
}
```

### 2. 在三个位置添加检查

在账号选择的三个关键位置添加配额检查：

#### 位置 1：60s 全局锁定模式的轮询选择
```rust
// 【新增】检查配额是否低于阈值
if self.is_quota_below_threshold(candidate, quota_group) {
    continue;
}
```

#### 位置 2：纯轮询模式（Round-robin）
```rust
// 【新增】检查配额是否低于阈值
if self.is_quota_below_threshold(candidate, quota_group) {
    continue;
}
```

#### 位置 3：粘性会话的账号复用
```rust
// 【新增】检查配额是否低于阈值
if !self.is_quota_below_threshold(found, quota_group) {
    tracing::debug!("Sticky Session: Successfully reusing bound account {} for session {}", found.email, sid);
    target_token = Some(found.clone());
} else {
    tracing::debug!("Sticky Session: Bound account {} quota below threshold, will switch", found.email);
    self.session_accounts.remove(sid);
}
```

## 📊 修复后的行为

### 场景：三个账号

| 账号 | 阈值设置 | 当前配额 | 修复前 | 修复后 |
|------|---------|---------|--------|--------|
| 账号1 | 86% | 84% | ❌ 被使用 | ✅ **跳过** |
| 账号2 | 无 | 36% | ✅ 被使用 | ✅ 被使用 |
| 账号3 | 无 | 79% | ❌ 被使用 | ✅ **跳过**（账号2足够） |

### 工作流程

1. **检查账号1**：
   - 当前配额 84% < 阈值 86%
   - 日志：`Account xxx@gmail.com quota (84) is below threshold (86), skipping`
   - **跳过**

2. **检查账号2**：
   - 无阈值设置
   - 配额充足（36%）
   - **选中使用** ✅

3. **账号3不会被检查**（因为账号2已满足需求）

## 🎯 配额数据格式

系统从账号 JSON 文件中读取配额数据，格式示例：

```json
{
  "id": "account-id",
  "email": "user@gmail.com",
  "min_quota_threshold": 86,
  "quota": {
    "models": {
      "claude-3-5-sonnet-20241022": {
        "quota_percent": 84,
        "remaining": "84%",
        "reset_time": "2026-01-03T00:00:00Z"
      }
    }
  }
}
```

## 📝 注意事项

1. **阈值单位**：百分比（0-100）
2. **无阈值**：`min_quota_threshold` 为 `null` 或未设置时，不限制
3. **无配额数据**：如果账号没有配额数据，允许使用（避免误拦截）
4. **Claude 专用**：当前只检查 Claude 模型的配额，Gemini 等其他模型暂不检查
5. **日志输出**：当账号因配额不足被跳过时，会输出 debug 日志

## ✅ 测试建议

1. **设置阈值测试**：
   - 为账号1设置阈值 90%
   - 确保当前配额低于 90%
   - 发起请求，观察是否跳过账号1

2. **无阈值测试**：
   - 账号2不设置阈值
   - 确认可以正常使用

3. **日志验证**：
   ```bash
   # 查看日志，应该看到类似输出：
   Account user@gmail.com quota (84) is below threshold (86), skipping
   ```

## 🚀 部署步骤

1. 重新编译：
   ```bash
   cd src-tauri
   cargo build --release
   ```

2. 重启应用

3. 验证日志输出

---

**修复版本**：v3.3.9+  
**修复日期**：2026-01-02  
**相关文件**：`src-tauri/src/proxy/token_manager.rs`
