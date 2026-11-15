// Floating 3D navigation dock (polish item 11b): eight raised destinations —
// Home, Chats, Status, Reels, Posts, Communities, Groups, Calls — shared by
// the mobile bottom dock and the desktop sidebar nav so both use one 3D
// language. "Groups" is the chat list with the Groups filter applied (no
// new page); "Reels" is the /reels page and "Posts" the /posts page.
export const NAV_ITEMS = [
  {
    key: 'home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /><path d="M9.5 21v-6h5v6" />
      </svg>
    ),
  },
  {
    key: 'chats',
    label: 'Chats',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.34-4-.97L3 20l1.02-5.5A8.5 8.5 0 1 1 21 11.5Z" />
      </svg>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" strokeDasharray="4.5 3.2" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: 'reels',
    label: 'Reels',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="3.5" /><path d="M10.3 9.3v5.4c0 .8.9 1.3 1.6.9l4.3-2.7c.6-.4.6-1.4 0-1.8l-4.3-2.7c-.7-.4-1.6.1-1.6.9Z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: 'posts',
    label: 'Posts',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" /><rect x="6.5" y="7.5" width="5" height="5" rx="1" /><path d="M14.5 8.5H18M14.5 11.5H18M6.5 16h11" />
      </svg>
    ),
  },
  {
    key: 'communities',
    label: 'Communities',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16.5 15.2c2.1.3 3.5 1.9 4 4.3" />
      </svg>
    ),
  },
  {
    key: 'groups',
    label: 'Groups',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8.5" cy="9" r="3" /><circle cx="16.5" cy="9" r="3" /><path d="M3 20c.5-3 2.6-4.7 5.5-4.7S13.5 17 14 20" /><path d="M13.5 15.6c.7-.2 1.4-.3 2.1-.3 2.9 0 5 1.7 5.5 4.7" />
      </svg>
    ),
  },
  {
    key: 'calls',
    label: 'Calls',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />
      </svg>
    ),
  },
];

function NavButton({ item, active, badge, onNavigate, labelled }) {
  return (
    <button
      type="button"
      className={`nav3d-btn${active ? ' active' : ''}`}
      onClick={() => onNavigate(item.key)}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
    >
      <span className="nav3d-icon">
        {item.icon}
        {badge > 0 && (
          <span className="nav3d-badge" key={badge}>{badge > 99 ? '99+' : badge}</span>
        )}
      </span>
      <span className="nav3d-label">{item.label}</span>
      {labelled && <span className="nav3d-chevron" aria-hidden="true">›</span>}
    </button>
  );
}

// variant 'dock': floating bottom bar (mobile). variant 'side': vertical
// sidebar nav (desktop). Same buttons, same 3D language.
export default function Dock({ active, badges = {}, onNavigate, variant = 'dock' }) {
  return (
    <nav className={variant === 'side' ? 'side-nav' : 'dock'} aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <NavButton
          key={item.key}
          item={item}
          active={active === item.key}
          badge={badges[item.key] || 0}
          onNavigate={onNavigate}
          labelled={variant === 'side'}
        />
      ))}
    </nav>
  );
}
