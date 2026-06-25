import { useLocale } from "../contexts/LocaleContext";

export default function ChatHero({ hasModels, onOpenSettings, children }) {
  const { t } = useLocale();

  return (
    <div className="empty-state" style={{ padding: '0 2rem', textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}>
      {/* Icon Graphic */}
      <div
        className="hero-logo-container"
        style={{
          marginBottom: '2rem',
          width: '64px',
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-glass)',
          borderRadius: '24px',
          boxShadow: 'var(--shadow-sm), inset 0 2px 4px rgba(255,255,255,0.4)'
        }}
      >
        {hasModels ? (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="var(--accent-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>

      <h2 className="hero-title" style={{
        fontSize: '2rem',
        fontWeight: 600,
        letterSpacing: '-0.02em',
        color: 'var(--text-primary)',
        marginBottom: '1rem'
      }}>
        {hasModels ? t("chat.heroTitle") : t("chat.heroNoModels")}
      </h2>

      {children}

      <p style={{
        color: 'var(--text-muted)',
        fontSize: '1rem',
        marginBottom: '2.5rem',
        maxWidth: '420px',
        textAlign: 'center',
        lineHeight: 1.6
      }}>
        {hasModels
          ? " "
          : t("chat.heroNoModelsDesc")}
      </p>

      {!hasModels && (
        <button
          onClick={onOpenSettings}
          style={{
            padding: '0.875rem 1.75rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            fontWeight: 600,
            fontSize: '0.95rem',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-color)',
            borderRadius: '999px',
            boxShadow: 'var(--shadow-sm)',
            cursor: 'pointer',
            color: 'var(--text-primary)',
            transition: 'all var(--duration-fast) var(--ease-out-expo)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.borderColor = 'var(--border-strong)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.borderColor = 'var(--border-color)';
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          {t("chat.heroConfigure")}
        </button>
      )}
    </div>
  );
}
