import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind 配置
 * ------------------------------------------------------------------
 * 颜色全部走 CSS 变量（LoopAI 风格：淡薰衣草底 + 紫色主色 + 薄荷/玫瑰柔色标签），
 * 深色模式只需切换 .dark 类下的变量值，无需为每个组件写 dark: 前缀。
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        /** 内凹/次级面板底色（列表头、工具条、漏斗背景） */
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--surface-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
        },
        /** 状态色：待开发（靛蓝）/ 已开发（薄荷绿）/ 失败（玫瑰红） */
        status: {
          pending: 'hsl(var(--status-pending))',
          developed: 'hsl(var(--status-developed))',
          failed: 'hsl(var(--status-failed))',
        },
        /** 柔色标签：薄荷 / 玫瑰 / 琥珀 / 紫罗兰 */
        mint: {
          DEFAULT: 'hsl(var(--mint))',
          soft: 'hsl(var(--mint-soft))',
        },
        rose: {
          DEFAULT: 'hsl(var(--rose))',
          soft: 'hsl(var(--rose-soft))',
        },
        amberx: {
          DEFAULT: 'hsl(var(--amber))',
          soft: 'hsl(var(--amber-soft))',
        },
        violet: {
          soft: 'hsl(var(--violet-soft))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 6px)',
        '4xl': '2rem',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        island: 'var(--shadow-island)',
        pop: 'var(--shadow-pop)',
        soft: '0 1px 2px hsl(252 30% 25% / 0.04)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s cubic-bezier(.22,.68,.34,1)',
        'pop-in': 'pop-in 0.16s ease-out',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [animate],
} satisfies Config;
