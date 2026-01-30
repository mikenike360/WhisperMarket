import Link from 'next/link';
import routes from '@/config/routes';
import { footerLinks } from '@/config/footerLinks';
import { Discord } from '@/components/icons/discord';
import { Twitter } from '@/components/icons/twitter';

export default function Footer() {
  return (
    <footer className="py-10 px-4 sm:px-6 lg:px-8 text-sm bg-base-100 text-base-content border-t border-base-200">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-8">
          <div>
            <h3 className="font-semibold text-base-content mb-3">Product</h3>
            <ul className="space-y-2">
              <li>
                <Link href={routes.markets} className="link link-hover">
                  Markets
                </Link>
              </li>
              <li>
                <Link href={routes.portfolio} className="link link-hover">
                  Portfolio
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-base-content mb-3">Resources</h3>
            <ul className="space-y-2">
              <li>
                <a
                  href={footerLinks.docs}
                  className="link link-hover"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Docs
                </a>
              </li>
              <li>
                <a
                  href={footerLinks.github}
                  className="link link-hover"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-base-content mb-3">Community</h3>
            <ul className="flex items-center gap-4">
              <li>
                <a
                  href={footerLinks.discord}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-base-200 hover:bg-base-300 transition-colors text-base-content [&_path]:fill-current"
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
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-base-200 hover:bg-base-300 transition-colors text-base-content [&_path]:fill-current"
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
            <h3 className="font-semibold text-base-content mb-3">Legal</h3>
            <ul className="space-y-2">
              <li>
                <a
                  href={footerLinks.terms}
                  className="link link-hover"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Terms
                </a>
              </li>
              <li>
                <a
                  href={footerLinks.privacy}
                  className="link link-hover"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="pt-6 border-t border-base-200 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-base-content/70">
            &copy; {new Date().getFullYear()} WhisperMarket. Made by{' '}
            <a
              href="https://venomlabs.xyz"
              className="font-semibold hover:underline"
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
