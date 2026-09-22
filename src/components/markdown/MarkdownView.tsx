'use client';

import clsx from 'clsx';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { hueForSpeaker, talkStyle, talkToMarkedText } from '@/lib/markdown/talk';
import { rehypeTalkMarkers } from '@/lib/markdown/talk-rehype';
import type { SpeakerColor } from '@/lib/markdown/speakers';

/**
 * Markdown 渲染。
 *
 * XSS 防护措施：
 * 一，不启用原始 HTML 解析，正文中的 HTML 标签按普通文本处理。
 * 二，再叠加一次白名单清洗，仅允许常见排版标签与安全属性。
 * 三，链接强制加上 noopener noreferrer，并拒绝 javascript 协议。
 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'code',
    'pre',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'title'],
    code: [['className', /^language-./]],
    // 发言元素的类名与角色名是渲染必需的，其余属性一律剥离
    span: [['className', /^talk-line$/], 'data-chara'],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
  },
  strip: ['script'],
};

export type { SpeakerColor };

/** 沿用 ReactMarkdown 自身的插件类型，避免直接依赖 unified 的类型导出 */
type RehypePlugins = NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>;

export function MarkdownView({
  content,
  className,
  onSelectText,
  fontScale,
  speakers,
  talkEnabled = true,
  showSpeakerName = true,
}: {
  content: string;
  className?: string;
  onSelectText?: (text: string) => void;
  fontScale?: number;
  /** 角色发言配色表，未提供的角色按名称推导出稳定色相 */
  speakers?: SpeakerColor;
  /** 是否解析发言标记，关闭后按普通文本原样渲染 */
  talkEnabled?: boolean;
  /** 是否在发言前显示角色名 */
  showSpeakerName?: boolean;
}) {
  const rendered = useMemo(
    () => (talkEnabled ? talkToMarkedText(content) : content),
    [content, talkEnabled],
  );

  /**
   * 插件顺序不能颠倒：发言标记要在清洗之前转成 span，
   * 否则私有区字符会被当作普通文本留在段落里。
   */
  const rehypePlugins = useMemo<RehypePlugins>(
    () =>
      talkEnabled
        ? [rehypeTalkMarkers, [rehypeSanitize, SANITIZE_SCHEMA]]
        : [[rehypeSanitize, SANITIZE_SCHEMA]],
    [talkEnabled],
  );

  const components = useMemo(
    () => ({
      a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a
          {...rest}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-accent-strong underline decoration-accent-border underline-offset-2 transition-colors duration-200 hover:text-accent"
        >
          {children}
        </a>
      ),
      /**
       * 发言元素。
       *
       * rehype 阶段产出的 span 带 data-chara，这里据角色图鉴的配色染色；
       * 不含该属性的 span 按普通元素渲染。
       */
      span: ({ children, ...rest }: React.ComponentProps<'span'>) => {
        const chara = String((rest as Record<string, unknown>)['data-chara'] ?? '');
        if (!chara) return <span {...rest}>{children}</span>;
        const hue = speakers?.[chara] ?? hueForSpeaker(chara);
        return (
          <span className="talk-line" data-chara={chara} style={talkStyle(hue)} title={chara}>
            {children}
          </span>
        );
      },
    }),
    [speakers],
  );

  const handleMouseUp = () => {
    if (!onSelectText) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    onSelectText(text);
  };

  if (!content.trim()) {
    return <p className={clsx('text-sm text-ink-faint', className)}>正文尚未填写。</p>;
  }

  return (
    <div
      className={clsx('prose-novel', !showSpeakerName && 'talk-names-hidden', className)}
      onMouseUp={handleMouseUp}
      style={fontScale ? { fontSize: `${fontScale}px` } : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  );
}
