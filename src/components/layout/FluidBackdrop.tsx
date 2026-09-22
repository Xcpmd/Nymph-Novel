/**
 * 动态流体背景。
 *
 * 四枚大尺度模糊光斑在视口内缓慢漂移，色相全部跟随 --accent-hue，
 * 换主题色时背景一并改变。整层固定、不接收指针事件，
 * 内容层只要保证层叠顺序在其之上即可。
 *
 * 用纯 CSS 实现而非画布：光斑数量固定，动画交给合成器，
 * 不占用主线程，也不随页面复杂度增长。系统开启减弱动效时动画会自动停下，
 * 静止的色块仍然保留，观感不会塌掉。
 */
export function FluidBackdrop() {
  return (
    <div className="fluid-backdrop" aria-hidden>
      <span className="fluid-blob fluid-blob-a" />
      <span className="fluid-blob fluid-blob-b" />
      <span className="fluid-blob fluid-blob-c" />
      <span className="fluid-blob fluid-blob-d" />
      {/* 薄雾层，把光斑压到刚好能看见的程度，保证正文对比度稳定 */}
      <span className="fluid-veil" />
    </div>
  );
}
