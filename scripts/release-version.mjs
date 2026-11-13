// 安装器兼容历史包名；递进规则按元创的每组十版约定执行。
export function isInstallerVersion(version) {
  return typeof version === 'string' && version.trim() === version && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-etsy(?:\.[1-9]\d*)?)?$/.test(version)
}

export function nextReleaseVersion(version) {
  if (version === '2.0.0-etsy.9') return '2.0.10-etsy'
  if (version === '2.0.10-etsy') return '2.1.1'
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!parts || !isInstallerVersion(version)) throw new Error('请从 2.0.10-etsy 或纯数字正式版本计算下一版')
  const [major, minor, patch] = parts.slice(1).map(Number)
  if (![major, minor, patch].every(Number.isSafeInteger) || patch < 1 || patch > 10) throw new Error('每组版本的第三段必须为 1 到 10')
  return patch === 10 ? `${major}.${minor + 1}.1` : `${major}.${minor}.${patch + 1}`
}
