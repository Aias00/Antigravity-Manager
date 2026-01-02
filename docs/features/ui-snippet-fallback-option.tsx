/* 
 * 将以下代码添加到 src/pages/ApiProxy.tsx
 * 位置：在 z.ai API Key 输入框之后（约第 896 行）
 * 在 {/* Model Mapping Section */} 注释之前
    */

                                    </div >

    {/* Fallback to Gemini Mapping Option */ }
    < div className = "space-y-1" >
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
                                    </div >

    {/* Model Mapping Section */ }
