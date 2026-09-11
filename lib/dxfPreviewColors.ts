/** Raise dark drawing colors to at least 4.5:1 against the viewer's black background.
 * Mix toward white to retain color differences; never modify the DXF source data.
 */
export function visibleDxfColor(color: number): number {
  const channels = [(color >>> 16) & 255, (color >>> 8) & 255, color & 255];
  const luminance = (rgb: number[]) => rgb.map(value => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  if (luminance(channels) >= 0.175) return color;
  let low = 0;
  let high = 1;
  const mix = (amount: number) => channels.map(c => Math.ceil(c + (255 - c) * amount));
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (luminance(mix(mid)) < 0.175) low = mid;
    else high = mid;
  }
  const [r, g, b] = mix(high);
  return (r << 16) | (g << 8) | b;
}
