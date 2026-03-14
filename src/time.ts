export function formatRelativeTime(epochSeconds: number, nowMs = Date.now()): string {
  const diffSeconds = Math.max(0, Math.floor(nowMs / 1000) - epochSeconds);
  if (diffSeconds < 60) return '刚刚';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  if (diffSeconds < 86400 * 7) return `${Math.floor(diffSeconds / 86400)} 天前`;
  if (diffSeconds < 86400 * 30) return `${Math.floor(diffSeconds / (86400 * 7))} 周前`;
  if (diffSeconds < 86400 * 365) return `${Math.floor(diffSeconds / (86400 * 30))} 个月前`;
  return `${Math.floor(diffSeconds / (86400 * 365))} 年前`;
}

export function formatAbsoluteTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
