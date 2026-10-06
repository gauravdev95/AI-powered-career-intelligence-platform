export function Icon({ name, className = 'sidebar-icon' }) {
  const props = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  // Solid (filled) variants for the dashboard — matches the reference design.
  const solid = { className, viewBox: '0 0 24 24', fill: 'currentColor', stroke: 'none' }
  switch (name) {
    case 'user-solid':
      return <svg {...solid}><path d="M12 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2.2c-4.9 0-8.8 2.4-8.8 5.8v1.5a1 1 0 0 0 1 1H19.8a1 1 0 0 0 1-1V19c0-3.4-3.9-5.8-8.8-5.8Z" /></svg>
    case 'bolt':
      return <svg {...solid}><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" /></svg>
    case 'case-solid':
      return <svg {...solid}><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2h5a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1h5Zm2 0h4V5a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v2Z" /></svg>
    case 'target-solid':
      return <svg {...solid}><path fillRule="evenodd" d="M12 1.8a10.2 10.2 0 1 0 0 20.4 10.2 10.2 0 0 0 0-20.4Zm0 4.2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z" clipRule="evenodd" /></svg>
    case 'building':
      return <svg {...props}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 21v-3.5h6V21M8.5 7.5h2M8.5 11h2M13.5 7.5h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2" /></svg>
    case 'flag':
      return <svg {...solid}><path d="M5 2a1 1 0 0 0-1 1v18a1 1 0 1 0 2 0v-6.3h11.6a.5.5 0 0 0 .4-.8L14.6 8.6a1 1 0 0 1 0-1.2L18 2.1a.5.5 0 0 0-.4-.1H5Z" /></svg>
    case 'user':
      return <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
    case 'skill':
      return <svg {...props}><path d="M12 2v20M2 12h20" /><circle cx="12" cy="12" r="5" /></svg>
    case 'startup':
      return <svg {...props}><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" /><path d="M9 21v-4h3v4M8 7h1M12 7h1M8 11h1M12 11h1M19 21v-8h-2" /></svg>
    case 'hackathon':
      return <svg {...props}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 7H4a3 3 0 0 0 3 3M17 7h3a3 3 0 0 1-3 3" /></svg>
    case 'graph':
      return <svg {...props}><circle cx="6" cy="7" r="3" /><circle cx="18" cy="7" r="3" /><circle cx="12" cy="18" r="3" /><path d="M8.8 9.5 10.8 15.4M15.2 9.5 13.2 15.4M9 7h6" /></svg>
    case 'search':
      return <svg {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    case 'refresh':
      return <svg {...props}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
    case 'fullscreen':
      return <svg {...props}><path d="M8 3H3v5M21 8V3h-5M3 16v5h5M16 21h5v-5" /></svg>
    case 'menu':
      return <svg {...props}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    case 'list':
      return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
    case 'gap':
      return <svg {...props}><path d="m3 17 6-6 4 4 7-8" /><path d="M14 7h6v6" /></svg>
    case 'home':
      return <svg {...props}><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></svg>
    case 'chat':
      return <svg {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
    case 'roadmap':
      return <svg {...props}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
    case 'journey':
      return <svg {...props}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
    case 'ingest':
      return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
    case 'wiki':
      return <svg {...props}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
    case 'briefcase':
      return <svg {...props}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
    case 'target':
      return <svg {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
    case 'resume':
      return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>
    case 'interview':
      return <svg {...props}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    case 'settings':
      return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
    case 'help':
      return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
    case 'bell':
      return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
    case 'chevron-down':
      return <svg {...props}><path d="m6 9 6 6 6-6" /></svg>
    case 'chevron-left':
      return <svg {...props}><path d="m15 18-6-6 6-6" /></svg>
    case 'sparkles':
      return <svg {...props}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
    case 'crown':
      return <svg {...props}><path d="m2 8 4 4 6-7 6 7 4-4-1.5 10.5h-17Z" /></svg>
    case 'x':
      return <svg {...props}><path d="M18 6 6 18M6 6l12 12" /></svg>
    case 'filter':
      return <svg {...props}><path d="M4 5h16l-6.5 7.5V19l-3 2v-8.5L4 5Z" /></svg>
    case 'chevron':
      return <svg {...props}><path d="m9 6 6 6-6 6" /></svg>
    case 'code':
      return <svg {...props}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></svg>
    default:
      return <svg {...props}><circle cx="12" cy="12" r="8" /></svg>
  }
}
