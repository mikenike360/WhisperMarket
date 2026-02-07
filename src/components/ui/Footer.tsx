import Link from 'next/link';
import routes from '@/config/routes';
import { footerLinks } from '@/config/footerLinks';
import { Discord } from '@/components/icons/discord';
import { Twitter } from '@/components/icons/twitter';

interface FooterProps {
  isLanding?: boolean;
}

export default function Footer({ isLanding = false }: FooterProps) {
  return (
    <footer
      className={`py-10 px-4 sm:px-6 lg:px-8 text-sm border-t ${isLanding ? '' : 'bg-base-100 text-base-content border-base-200'}`}
      style={isLanding ? { backgroundColor: '#171717', borderColor: '#404040' } : undefined}
    >
      <div className="max-w-6xl mx-auto">
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-8 mb-8 ${isLanding ? '' : ''}`}>
          <div>
            <h3 className={`font-extrabold mb-3 ${isLanding ? 'landing-opaque-text' : 'text-base-content'}`} style={isLanding ? { textShadow: '0 2px 4px rgba(0,0,0,0.8)' } : undefined}>
              Product
            </h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href={routes.markets}
                  className={isLanding ? 'font-bold hover:underline landing-opaque-text' : 'link link-hover'}
                  style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
                >
                  Markets
                </Link>
              </li>
              <li>
                <Link
                  href={routes.portfolio}
                  className={isLanding ? 'font-bold hover:underline landing-opaque-text' : 'link link-hover'}
                  style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
                >
                  Portfolio
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={`font-extrabold mb-3 ${isLanding ? 'landing-opaque-text' : 'text-base-content'}`} style={isLanding ? { textShadow: '0 2px 4px rgba(0,0,0,0.8)' } : undefined}>
              Resources
            </h3>
            <ul className="space-y-2">
              <li>
                <a
                  href={footerLinks.docs}
                  className={isLanding ? 'font-bold hover:underline landing-opaque-text' : 'link link-hover'}
                  style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Docs
                </a>
              </li>
              <li>
                <a
                  href={footerLinks.github}
                  className={isLanding ? 'font-bold hover:underline landing-opaque-text' : 'link link-hover'}
                  style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={`font-extrabold mb-3 ${isLanding ? 'landing-opaque-text' : 'text-base-content'}`} style={isLanding ? { textShadow: '0 2px 4px rgba(0,0,0,0.8)' } : undefined}>
              Community
            </h3>
            <ul className="flex items-center gap-4">
              <li>
                <a
                  href={footerLinks.discord}
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors [&_path]:fill-current ${isLanding ? 'hover:opacity-90' : 'bg-base-200 hover:bg-base-300 text-base-content'}`}
                  style={isLanding ? { backgroundColor: '#404040', color: '#ffffff' } : undefined}
                  aria-label="Discord"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Discord className="w-4 h-4" />
                </a>
              </li>
              <li>
                <a
                  href={footerLinks.twitter}
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors [&_path]:fill-current ${isLanding ? 'hover:opacity-90' : 'bg-base-200 hover:bg-base-300 text-base-content'}`}
                  style={isLanding ? { backgroundColor: '#404040', color: '#ffffff' } : undefined}
                  aria-label="Twitter"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Twitter className="w-4 h-4" />
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className={`font-extrabold mb-3 ${isLanding ? 'landing-opaque-text' : 'text-base-content'}`} style={isLanding ? { textShadow: '0 2px 4px rgba(0,0,0,0.8)' } : undefined}>
              Legal
            </h3>
            <ul className="space-y-2">
              <li>
                <a
                  href={footerLinks.terms}
                  className={isLanding ? 'font-bold hover:underline landing-opaque-text' : 'link link-hover'}
                  style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Terms
                </a>
              </li>
              <li>
                <a
                  href={footerLinks.privacy}
                  className={isLanding ? 'font-bold hover:underline landing-opaque-text' : 'link link-hover'}
                  style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className={`pt-6 flex flex-col sm:flex-row justify-between items-center gap-4 ${isLanding ? 'border-t' : 'border-t border-base-200'}`} style={isLanding ? { borderColor: '#404040' } : undefined}>
          <p className={isLanding ? 'font-bold landing-opaque-text' : 'text-base-content'} style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}>
            &copy; {new Date().getFullYear()} WhisperMarket. Made by{' '}
            <a
              href="https://venomlabs.xyz"
              className={isLanding ? 'font-extrabold hover:underline landing-opaque-text' : 'font-extrabold hover:underline'}
              style={isLanding ? { textShadow: '0 1px 3px rgba(0,0,0,0.8)' } : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              VenomLabs
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
