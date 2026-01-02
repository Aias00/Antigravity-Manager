import { X, Clock, AlertCircle, Settings } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Account, ModelQuota } from '../../types/account';
import { formatDate } from '../../utils/format';
import { useTranslation } from 'react-i18next';
import { useAccountStore } from '../../stores/useAccountStore';
import { useState, useEffect } from 'react';

interface AccountDetailsDialogProps {
    account: Account | null;
    onClose: () => void;
}

export default function AccountDetailsDialog({ account, onClose }: AccountDetailsDialogProps) {
    const { t } = useTranslation();
    const { updateThreshold, accounts } = useAccountStore();
    const [threshold, setThreshold] = useState<number | undefined>(account?.min_quota_threshold);
    const [isEditing, setIsEditing] = useState(false);

    // 同步 account 的变化到本地 state
    useEffect(() => {
        if (account) {
            // 从 accounts 列表中获取最新的账户数据
            const latestAccount = accounts.find(acc => acc.id === account.id);
            const latestThreshold = latestAccount?.min_quota_threshold ?? account.min_quota_threshold;
            setThreshold(latestThreshold);
        }
    }, [account, accounts]);

    if (!account) return null;

    const handleSaveThreshold = async () => {
        if (threshold !== undefined) {
            await updateThreshold(account.id, threshold === 0 ? null : threshold);
            setIsEditing(false);
        }
    };

    const handleCancelEdit = () => {
        // 恢复到最新的账户阈值
        const latestAccount = accounts.find(acc => acc.id === account.id);
        const latestThreshold = latestAccount?.min_quota_threshold ?? account.min_quota_threshold;
        setThreshold(latestThreshold);
        setIsEditing(false);
    };

    return createPortal(
        <div className="modal modal-open z-[100]">
            {/* Draggable Top Region */}
            <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 z-[110]" />

            <div className="modal-box relative max-w-3xl bg-white dark:bg-base-100 shadow-2xl rounded-2xl p-0 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-100 dark:border-base-200 bg-gray-50/50 dark:bg-base-200/50 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <h3 className="font-bold text-lg text-gray-900 dark:text-base-content">{t('accounts.details.title')}</h3>
                        <div className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-base-200 border border-gray-200 dark:border-base-300 text-xs font-mono text-gray-500 dark:text-gray-400">
                            {account.email}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="btn btn-sm btn-circle btn-ghost text-gray-400 hover:bg-gray-100 dark:hover:bg-base-200 hover:text-gray-600 dark:hover:text-base-content transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    {/* Threshold Configuration */}
                    <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-base-200/50 border border-gray-100 dark:border-base-200">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <Settings size={16} />
                                <span>{t('accounts.threshold_settings')}</span>
                            </div>
                            {!isEditing ? (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                                >
                                    {t('common.edit')}
                                </button>
                            ) : (
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleCancelEdit}
                                        className="text-xs text-gray-500 hover:text-gray-600"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        onClick={handleSaveThreshold}
                                        className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                                    >
                                        {t('common.save')}
                                    </button>
                                </div>
                            )}
                        </div>

                        {isEditing ? (
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={threshold || 0}
                                    onChange={(e) => setThreshold(parseInt(e.target.value))}
                                    className="range range-xs range-primary flex-1"
                                />
                                <span className="text-sm font-mono w-12 text-right">
                                    {threshold || 0}%
                                </span>
                            </div>
                        ) : (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {threshold
                                    ? t('accounts.threshold_active', { value: threshold })
                                    : t('accounts.threshold_disabled')
                                }
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {account.quota?.models?.map((model: ModelQuota) => (
                            <div key={model.name} className="p-4 rounded-xl border border-gray-100 dark:border-base-200 bg-white dark:bg-base-100 hover:border-blue-100 dark:hover:border-blue-900 hover:shadow-sm transition-all group">
                                <div className="flex justify-between items-start mb-3">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                                        {model.name}
                                    </span>
                                    <span
                                        className={`text-xs font-bold px-2 py-0.5 rounded-md ${model.percentage >= 50 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                            model.percentage >= 20 ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                                'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                            }`}
                                    >
                                        {model.percentage}%
                                    </span>
                                </div>

                                {/* Progress Bar */}
                                <div className="h-1.5 w-full bg-gray-100 dark:bg-base-200 rounded-full overflow-hidden mb-3">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${model.percentage >= 50 ? 'bg-emerald-500' :
                                            model.percentage >= 20 ? 'bg-orange-400' :
                                                'bg-red-500'
                                            }`}
                                        style={{ width: `${model.percentage}%` }}
                                    ></div>
                                </div>

                                <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                                    <Clock size={10} />
                                    <span>{t('accounts.reset_time')}: {formatDate(model.reset_time) || t('common.unknown')}</span>
                                </div>
                            </div>
                        )) || (
                                <div className="col-span-2 py-10 text-center text-gray-400 flex flex-col items-center">
                                    <AlertCircle className="w-8 h-8 mb-2 opacity-20" />
                                    <span>{t('accounts.no_data')}</span>
                                </div>
                            )}
                    </div>
                </div>
            </div>
            <div className="modal-backdrop bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
        </div>,
        document.body
    );
}
