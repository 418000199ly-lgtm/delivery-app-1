/**
 * 手机号脱敏工具（2026-10-10新增）
 * 非本人查看场景使用，防止截屏外泄暴露隐私
 * @example maskPhone('15509601222') => '155****1222'
 */
export const maskPhone = (p: string | undefined | null): string => {
  if (!p || typeof p !== 'string') return '';
  const clean = p.trim();
  // 11位手机号：155****1222；A后缀商户号：155****1222A
  if (/^\d{11}A?$/i.test(clean)) {
    return clean.slice(0, 3) + '****' + clean.slice(7, 11) + (clean.length > 11 ? clean.slice(11) : '');
  }
  return clean;
};

export default maskPhone;
