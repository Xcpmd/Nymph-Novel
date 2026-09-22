import { asInt, asString, handle, readBody } from '@/lib/api/http';
import { DEFAULT_APP_SETTINGS, getAppSettings, updateAppSettings } from '@/lib/repo/settings';
import { getDatabaseSize, getDataDir, getSchemaVersion } from '@/lib/db';
import { ensureDefaultProviders } from '@/lib/service/bootstrap';
import { listProviders } from '@/lib/repo/library';
import { DEFAULT_BUDGET } from '@/lib/repo/settings';

/** GET /api/settings 读取全局设置与运行环境信息。 */
export async function GET() {
  return handle(() => {
    ensureDefaultProviders();
    return {
      settings: getAppSettings(),
      environment: {
        dataDir: getDataDir(),
        databaseSize: getDatabaseSize(),
        schemaVersion: getSchemaVersion(),
        nodeVersion: process.version,
        platform: process.platform,
      },
      providers: listProviders(),
    };
  });
}

/** PATCH /api/settings 更新全局设置。 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    const patch: Record<string, unknown> = {};

    const accentHue = asInt(body.accentHue, 0, 360);
    if (accentHue !== undefined) patch.accentHue = accentHue;
    const themeMode = asString(body.themeMode);
    if (themeMode === 'light' || themeMode === 'dark' || themeMode === 'system') {
      patch.themeMode = themeMode;
    }
    const locale = asString(body.locale);
    if (locale !== undefined) patch.locale = locale;
    const density = asString(body.density);
    if (density === 'comfortable' || density === 'compact') patch.density = density;
    const readerFontSize = asInt(body.readerFontSize, 12, 32);
    if (readerFontSize !== undefined) patch.readerFontSize = readerFontSize;
    const readerWidth = asInt(body.readerWidth, 28, 100);
    if (readerWidth !== undefined) patch.readerWidth = readerWidth;
    if (typeof body.showStreamingRaw === 'boolean') patch.showStreamingRaw = body.showStreamingRaw;
    if (typeof body.showSpeakerName === 'boolean') patch.showSpeakerName = body.showSpeakerName;
    if (body.activeProviderId !== undefined) {
      patch.activeProviderId = asString(body.activeProviderId) ?? null;
    }
    if (body.budget && typeof body.budget === 'object') {
      const incoming = body.budget as Record<string, unknown>;
      patch.budget = {
        total: asInt(incoming.total) ?? DEFAULT_BUDGET.total,
        always: asInt(incoming.always) ?? DEFAULT_BUDGET.always,
        recalled: asInt(incoming.recalled) ?? DEFAULT_BUDGET.recalled,
        outlines: asInt(incoming.outlines) ?? DEFAULT_BUDGET.outlines,
        reserved: asInt(incoming.reserved) ?? DEFAULT_BUDGET.reserved,
      };
    }

    updateAppSettings(patch as Partial<typeof DEFAULT_APP_SETTINGS>);
    return { settings: getAppSettings() };
  });
}
