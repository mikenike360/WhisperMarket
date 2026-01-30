/**
 * Footer external links. Use env vars in production (e.g. NEXT_PUBLIC_DOCS_URL).
 */
export const footerLinks = {
  docs: process.env.NEXT_PUBLIC_DOCS_URL || '#',
  github: process.env.NEXT_PUBLIC_GITHUB_URL || '#',
  discord: process.env.NEXT_PUBLIC_DISCORD_URL || '#',
  twitter: process.env.NEXT_PUBLIC_TWITTER_URL || '#',
  terms: process.env.NEXT_PUBLIC_TERMS_URL || '#',
  privacy: process.env.NEXT_PUBLIC_PRIVACY_URL || '#',
};
