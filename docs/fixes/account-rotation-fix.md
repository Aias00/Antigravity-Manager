# 账号轮询问题修复

## 问题描述

在请求 Claude Code 模型（以及其他模型）时，每个请求会自动向所有账号挨个轮询请求，导致每个账号的配额都会减少。

## 根本原因

在三个 handler 文件中（`claude.rs`、`openai.rs`、`gemini.rs`），重试逻辑存在问题：

```rust
// 旧代码 - 有问题的逻辑
let force_rotate_token = attempt > 0;  // 每次重试都强制轮换账号
```

这导致：
1. 第一次请求（`attempt = 0`）时，`force_rotate_token = false`，使用 60 秒锁定机制
2. 如果遇到任何错误需要重试，`attempt = 1`，此时 `force_rotate_token = true`
3. 当 `force_rotate = true` 时，会**忽略 60 秒锁定**，强制切换到下一个账号
4. 这样每次重试都会切换账号，最终轮询所有账号，导致所有账号配额都被消耗

## 解决方案

引入 `should_rotate_account` 标志，**只在遇到特定错误时才轮换账号**：

```rust
// 新代码 - 修复后的逻辑
let mut should_rotate_account = false;  // 只在遇到特定错误时才轮换账号

for attempt in 0..max_attempts {
    // 只在明确需要轮换账号时才设置 force_rotate_token = true
    let force_rotate_token = should_rotate_account;
    
    // ... 请求逻辑 ...
    
    // 只有在遇到特定错误时才标记需要轮换
    if status_code == 429 || status_code == 403 || status_code == 401 {
        should_rotate_account = true;  // 标记下次循环需要轮换账号
        continue;
    }
}
```

## 修改的文件

1. `/Users/aias/Work/github/Antigravity-Manager/src-tauri/src/proxy/handlers/claude.rs`
2. `/Users/aias/Work/github/Antigravity-Manager/src-tauri/src/proxy/handlers/openai.rs`
3. `/Users/aias/Work/github/Antigravity-Manager/src-tauri/src/proxy/handlers/gemini.rs`

## 修改详情

### 1. 添加标志变量
在每个 handler 的重试循环前添加：
```rust
let mut should_rotate_account = false;  // 只在遇到特定错误时才轮换账号
```

### 2. 修改 Token 获取逻辑
将：
```rust
let force_rotate_token = attempt > 0;
```
改为：
```rust
let force_rotate_token = should_rotate_account;
```

### 3. 在错误处理中设置标志
在遇到需要轮换账号的错误（429/403/401）时：
```rust
should_rotate_account = true;  // 标记下次循环需要轮换账号
```

## 效果

修复后的行为：
- ✅ 默认情况下，同一个请求会复用同一个账号（60 秒锁定机制）
- ✅ 只有在遇到特定错误（429 限流、403 权限、401 认证失效）时才会切换账号
- ✅ 避免了不必要的账号轮换，保护账号配额
- ✅ 提高了请求效率和成功率

## 测试建议

1. 测试正常请求是否使用同一个账号
2. 测试遇到 429 错误时是否正确轮换账号
3. 测试遇到其他错误（如 400）时是否不会轮换账号
4. 观察日志中的账号使用情况

## 日志变化

修复后的日志会显示：
```
Claude Upstream 429 on attempt 1/3, will rotate account on next attempt
```
而不是之前的：
```
Claude Upstream 429 on attempt 1/3, rotating account
```

这更清楚地表明账号轮换发生在**下次循环**，而不是当前循环。
