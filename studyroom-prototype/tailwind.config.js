/** 통합 설계서 §4 디자인 시스템 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        warm: 'var(--bg-warm)',
        sage: 'var(--bg-sage)',
        lavender: 'var(--bg-lavender)',
        peach: 'var(--bg-peach)',
        coral: 'var(--accent-coral)',
        ink: 'var(--text-dark)',
        strong: 'var(--text-strong)',
        subtle: 'var(--text-subtle)',
        muted: 'var(--text-muted)',
        hairline: 'var(--border-hairline)',
        surface: 'var(--surface)',
        'surface-dark': 'var(--surface-dark)',
        danger: 'var(--danger)',
        'danger-bg': 'var(--danger-bg)',
        'chart-track': 'var(--chart-track)',
        'chart-focus': 'var(--chart-focus)',
        disabled: 'var(--disabled)',
      },
      borderRadius: { sm: '12px', md: '16px', lg: '24px', xl: '40px' },
      boxShadow: {
        soft: '0 1px 2px rgba(41,37,36,.04), 0 8px 24px rgba(41,37,36,.06)',
        pop: '0 2px 6px rgba(41,37,36,.06), 0 16px 40px rgba(41,37,36,.10)',
      },
      transitionTimingFunction: { soft: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
}
