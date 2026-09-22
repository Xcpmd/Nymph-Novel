import { redirect } from 'next/navigation';

/**
 * 设置已改为顶部导航栏右侧的中间弹窗，不再占用独立页面。
 * 保留该路由，直接进来的旧链接会被送回书架并自动打开设置。
 */
export default function SettingsPage() {
  redirect('/?settings=1');
}
