// 只拆分书名中已经明确写出的“第 N 卷”，不根据编号猜系列或写回元数据。
// 没有显式卷标的书仍原样显示标题；作者等真实信息由调用方选择作副标题。
export function bookDisplayTitle(title: string): { heading: string; subtitle: string | null } {
  const suffix = /^(.*?)\s*(第\s*\d+(?:\.\d+)?\s*卷)\s*$/u.exec(title);
  if (suffix?.[1].trim()) return { heading: suffix[2], subtitle: suffix[1].trim() };
  const prefix = /^(第\s*\d+(?:\.\d+)?\s*卷)\s+(.+)$/u.exec(title);
  if (prefix) return { heading: prefix[1], subtitle: prefix[2].trim() };
  return { heading: title, subtitle: null };
}
