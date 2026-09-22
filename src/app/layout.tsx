import type { Metadata, Viewport } from 'next';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './globals.css';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from '@/components/layout/AppShell';
import { getAppSettings } from '@/lib/repo/settings';
import { zh } from '@/lib/i18n/zh';

/**
 * 应用为本地单用户工具，全部数据保存在本机。
 * 因此关闭静态预渲染，所有页面在请求时读取本地数据库与文件系统。
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: zh.meta.appName,
  description: zh.meta.description,
  applicationName: zh.meta.appName,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = getAppSettings();

  /*
   * 首屏主题脚本。服务端渲染时还不确定系统偏好，
   * 因此在这里先把 data-theme 写上，避免暗色用户看到一闪而过的白屏。
   */
  const themeScript = `(function(){try{var m=${JSON.stringify(settings.themeMode)};var d=m==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):m;document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;}catch(e){}})();`;

  return (
    <html lang="zh-Hans" data-density={settings.density} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SettingsProvider initialSettings={settings}>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
