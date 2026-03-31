/**
 * Institutional Login — BrowserWindow-based CARSI / Shibboleth authentication.
 *
 * Opens a modal BrowserWindow where the user logs in through their university's
 * identity provider (IdP). After successful authentication, session cookies are
 * captured and stored in the CookieJar for subsequent PDF downloads.
 *
 * Currently supports Chinese universities via CARSI federation.
 */

import { BrowserWindow, session } from 'electron';
import type { CookieJar } from '../core/infra/cookie-jar';
import type { Logger } from '../core/infra/logger';
import { getAllPublisherCookieDomains } from '../core/acquire/publisher-resolver';

// ─── Institution Configuration ───

export interface InstitutionConfig {
  id: string;
  name: string;
  nameEn: string;
  /** Shibboleth IdP entityID — used to construct CARSI login URLs */
  idpEntityId: string;
  /** Per-publisher CARSI SP entry URLs (user lands on publisher after IdP auth) */
  carsiEntrypoints: Record<string, string>;
  /** Cookie domains to capture after login */
  cookieDomains: string[];
}

// ─── Pre-configured Chinese Institutions ───

const CHINA_INSTITUTIONS: InstitutionConfig[] = [
  {
    id: 'zju',
    name: '浙江大学',
    nameEn: 'Zhejiang University',
    idpEntityId: 'https://idp.zju.edu.cn/idp/shibboleth',
    carsiEntrypoints: {
      ieee: 'https://ieeexplore.ieee.org/servlet/Login?loginurl=https%3A%2F%2Fieeexplore.ieee.org%2F&authType=Shibboleth&entityID=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth',
      elsevier: 'https://www.sciencedirect.com/user/institution/login?targetURL=https%3A%2F%2Fwww.sciencedirect.com&idp=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth',
      springer: 'https://fsso.springer.com/saml/login?idp=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth&targetUrl=https%3A%2F%2Flink.springer.com',
      wiley: 'https://onlinelibrary.wiley.com/action/ssostart?idp=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth&redirectUri=https%3A%2F%2Fonlinelibrary.wiley.com',
      acs: 'https://pubs.acs.org/action/ssostart?idp=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth&redirectUri=https%3A%2F%2Fpubs.acs.org',
      rsc: 'https://pubs.rsc.org/en/content/federatedaccess?idp=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth',
      cnki: 'https://fsso.cnki.net/Shibboleth.sso/Login?entityID=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth&target=https%3A%2F%2Ffsso.cnki.net%2FSecure%2Fdefault.aspx',
      wanfang: 'https://www.wanfangdata.com.cn/Shibboleth.sso/Login?entityID=https%3A%2F%2Fidp.zju.edu.cn%2Fidp%2Fshibboleth&target=https%3A%2F%2Fwww.wanfangdata.com.cn%2F',
    },
    cookieDomains: [
      'ieeexplore.ieee.org', 'ieee.org',
      'sciencedirect.com', 'elsevier.com',
      'link.springer.com', 'springer.com', 'springernature.com', 'nature.com',
      'onlinelibrary.wiley.com', 'wiley.com',
      'tandfonline.com',
      'pubs.acs.org',
      'pubs.rsc.org',
      'journals.sagepub.com',
      'academic.oup.com', 'oup.com',
      'cambridge.org',
      'zju.edu.cn',
      // Chinese academic databases
      'cnki.net', 'cnki.com.cn', 'fsso.cnki.net', 'kns.cnki.net',
      'wanfangdata.com.cn', 'd.wanfangdata.com.cn',
    ],
  },
  // Other institutions can be added here following the same pattern,
  // or users can use the "Custom IdP" option in Settings.
];

// ─── Custom institution support ───

export interface CustomInstitutionConfig {
  id: string;
  name: string;
  idpEntityId: string;
}

/**
 * Build a CARSI entrypoint URL for a custom institution.
 * Uses the standard Shibboleth SP login URL pattern with the given IdP entityID.
 */
function buildCarsiUrl(publisher: string, idpEntityId: string): string {
  const encodedIdp = encodeURIComponent(idpEntityId);
  switch (publisher) {
    case 'ieee':
      return `https://ieeexplore.ieee.org/servlet/Login?loginurl=${encodeURIComponent('https://ieeexplore.ieee.org/')}&authType=Shibboleth&entityID=${encodedIdp}`;
    case 'elsevier':
      return `https://www.sciencedirect.com/user/institution/login?targetURL=${encodeURIComponent('https://www.sciencedirect.com')}&idp=${encodedIdp}`;
    case 'springer':
      return `https://fsso.springer.com/saml/login?idp=${encodedIdp}&targetUrl=${encodeURIComponent('https://link.springer.com')}`;
    case 'wiley':
      return `https://onlinelibrary.wiley.com/action/ssostart?idp=${encodedIdp}&redirectUri=${encodeURIComponent('https://onlinelibrary.wiley.com')}`;
    case 'acs':
      return `https://pubs.acs.org/action/ssostart?idp=${encodedIdp}&redirectUri=${encodeURIComponent('https://pubs.acs.org')}`;
    case 'rsc':
      return `https://pubs.rsc.org/en/content/federatedaccess?idp=${encodedIdp}`;
    case 'cnki':
      return `https://fsso.cnki.net/Shibboleth.sso/Login?entityID=${encodedIdp}&target=${encodeURIComponent('https://fsso.cnki.net/Secure/default.aspx')}`;
    case 'wanfang':
      return `https://www.wanfangdata.com.cn/Shibboleth.sso/Login?entityID=${encodedIdp}&target=${encodeURIComponent('https://www.wanfangdata.com.cn/')}`;
    default:
      return `https://ieeexplore.ieee.org/servlet/Login?loginurl=${encodeURIComponent('https://ieeexplore.ieee.org/')}&authType=Shibboleth&entityID=${encodedIdp}`;
  }
}

// ─── Public API ───

export interface InstitutionListItem {
  id: string;
  name: string;
  nameEn: string;
  publishers: string[];
}

/** Get list of pre-configured institutions. */
export function getInstitutionList(): InstitutionListItem[] {
  return CHINA_INSTITUTIONS.map((i) => ({
    id: i.id,
    name: i.name,
    nameEn: i.nameEn,
    publishers: Object.keys(i.carsiEntrypoints),
  }));
}

/** Find an institution by ID. */
export function getInstitutionById(id: string): InstitutionConfig | null {
  return CHINA_INSTITUTIONS.find((i) => i.id === id) ?? null;
}

/** Resolve institution name from ID. */
export function resolveInstitutionName(id: string): string | null {
  const inst = getInstitutionById(id);
  return inst?.name ?? null;
}

// ─── Login publishers for convenience ───

export const LOGIN_PUBLISHERS = [
  { id: 'ieee', name: 'IEEE Xplore', domain: 'ieeexplore.ieee.org' },
  { id: 'elsevier', name: 'Elsevier / ScienceDirect', domain: 'sciencedirect.com' },
  { id: 'springer', name: 'Springer / Nature', domain: 'link.springer.com' },
  { id: 'wiley', name: 'Wiley', domain: 'onlinelibrary.wiley.com' },
  { id: 'acs', name: 'ACS Publications', domain: 'pubs.acs.org' },
  { id: 'rsc', name: 'RSC', domain: 'pubs.rsc.org' },
  { id: 'cnki', name: 'CNKI (知网)', domain: 'cnki.net' },
  { id: 'wanfang', name: 'Wanfang (万方)', domain: 'wanfangdata.com.cn' },
] as const;

// ─── SSO Bridge Configuration ───

/**
 * After CARSI auth completes, some publishers (CNKI, Wanfang) land on an SSO portal
 * rather than the actual service site. The SSO→service handoff happens via JS redirect,
 * so we need to keep the BrowserWindow open and navigate to the service site to capture
 * the proper session cookies.
 */
const SSO_BRIDGE: Record<string, {
  /** After CARSI auth lands on a URL matching this, trigger bridge navigation */
  triggerPattern: string;
  /** URLs to visit (in order) to complete the SSO handoff and set session cookies */
  bridgeUrls: string[];
  /** Extra time (ms) to wait on each bridge page for JS to execute */
  bridgeWaitMs: number;
}> = {
  cnki: {
    triggerPattern: 'fsso.cnki.net',
    bridgeUrls: [
      // Visit the KNS search page — FSSO session cookie lets the server set KNS session cookies
      'https://kns.cnki.net/kns8s/defaultresult/index',
    ],
    bridgeWaitMs: 4000,
  },
  wanfang: {
    triggerPattern: 'www.wanfangdata.com.cn',
    bridgeUrls: [
      // Visit the search subdomain so cookies are set for s.wanfangdata.com.cn too
      'https://s.wanfangdata.com.cn/',
    ],
    bridgeWaitMs: 4000,
  },
};

// ─── BrowserWindow Login Flow ───

export interface LoginResult {
  success: boolean;
  cookieCount: number;
  publisher: string;
}

/**
 * Open a BrowserWindow for the user to complete institutional (CARSI) login.
 *
 * The window navigates to the publisher's Shibboleth SP, which redirects to
 * the university's IdP. After the user authenticates, the browser is redirected
 * back to the publisher with a valid session.
 *
 * For CNKI/Wanfang, an additional "SSO bridge" step navigates to the actual
 * service site to complete the JS-based SSO handoff before capturing cookies.
 */
export async function openInstitutionalLogin(
  parentWindow: BrowserWindow,
  institutionId: string,
  publisher: string,
  cookieJar: CookieJar,
  logger: Logger,
  customIdpEntityId?: string,
): Promise<LoginResult> {
  const inst = getInstitutionById(institutionId);
  const instName = inst?.name ?? institutionId;

  // Determine login URL
  let loginUrl: string;
  if (inst) {
    loginUrl = inst.carsiEntrypoints[publisher] ?? inst.carsiEntrypoints['ieee']!;
  } else if (customIdpEntityId) {
    loginUrl = buildCarsiUrl(publisher, customIdpEntityId);
  } else {
    throw new Error(`Unknown institution "${institutionId}" and no custom IdP entityID provided`);
  }

  const cookieDomains = inst?.cookieDomains ?? [
    ...getAllPublisherCookieDomains(),
    `${institutionId}.edu.cn`,
  ];

  // Use a persistent partition so cookies survive across login attempts
  const loginSession = session.fromPartition(`persist:institutional-${institutionId}`);

  // Spoof User-Agent: IEEE/Elsevier WAF (F5 BigIP) blocks Electron's default UA
  // which contains "Electron" — causes "The requested URL was rejected" errors.
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const loginWindow = new BrowserWindow({
    parent: parentWindow,
    modal: true,
    width: 960,
    height: 720,
    title: `${instName} - ${publisher.toUpperCase()} Login`,
    webPreferences: {
      session: loginSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Set UA on webContents (most reliable), must be before loadURL
  loginWindow.webContents.setUserAgent(chromeUA);

  // Remove menu bar in login window
  loginWindow.setMenuBarVisibility(false);

  logger.info('[InstitutionalLogin] Opening login window', {
    institution: instName,
    publisher,
    url: loginUrl,
  });

  return new Promise<LoginResult>((resolve) => {
    let resolved = false;
    let bridging = false; // true while performing SSO bridge navigation

    /**
     * Navigate the BrowserWindow to a URL and wait for it to finish loading.
     * Returns when did-finish-load fires or timeout expires.
     */
    const navigateAndWait = (navUrl: string, timeoutMs: number): Promise<void> => {
      return new Promise<void>((navResolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; navResolve(); } };
        loginWindow.webContents.once('did-finish-load', finish);
        loginWindow.webContents.once('did-fail-load', finish);
        setTimeout(finish, timeoutMs);
        loginWindow.loadURL(navUrl);
      });
    };

    /**
     * Capture all cookies from the login session and store in the CookieJar.
     */
    const captureAndFinish = async (finalUrl: string) => {
      const allCookies = await loginSession.cookies.get({});

      logger.info('[InstitutionalLogin] Capturing cookies', {
        totalCookies: allCookies.length,
        domains: [...new Set(allCookies.map((c) => c.domain))].join(', '),
      });

      const count = await cookieJar.importFromElectronSession(
        allCookies,
        cookieDomains,
        institutionId,
      );

      logger.info('[InstitutionalLogin] Login complete', {
        institution: instName,
        publisher,
        cookieCount: count,
        finalUrl,
      });

      resolved = true;
      loginWindow.close();
      resolve({ success: count > 0, cookieCount: count, publisher });
    };

    const finishLogin = async (url: string) => {
      if (resolved || bridging) return;

      // Heuristic: login is complete when we're on a publisher page
      // and the URL no longer contains IdP/authentication keywords.
      const lowerUrl = url.toLowerCase();
      const isIdpPage =
        lowerUrl.includes('idp.') ||
        lowerUrl.includes('/idp/') ||
        lowerUrl.includes('shibboleth.sso') ||
        lowerUrl.includes('/saml/') ||
        lowerUrl.includes('/saml2/') ||
        lowerUrl.includes('cas/login') ||
        lowerUrl.includes('passport.') ||
        lowerUrl.includes('iaaa.') ||
        lowerUrl.includes('jaccount.') ||
        lowerUrl.includes('authserver/');

      const isOnPublisher = cookieDomains.some((d) => url.includes(d));

      if (!isIdpPage && isOnPublisher) {
        // Wait briefly for JS to execute and set initial cookies
        await new Promise((r) => setTimeout(r, 2000));

        // ── SSO Bridge: navigate to actual service sites to complete handoff ──
        const bridge = SSO_BRIDGE[publisher];
        if (bridge && url.includes(bridge.triggerPattern)) {
          bridging = true;
          logger.info('[InstitutionalLogin] SSO bridge triggered', {
            publisher,
            currentUrl: url.slice(0, 100),
            bridgeUrls: bridge.bridgeUrls,
          });

          for (const bridgeUrl of bridge.bridgeUrls) {
            try {
              logger.info('[InstitutionalLogin] Bridge navigating', { url: bridgeUrl });
              await navigateAndWait(bridgeUrl, 15_000);
              // Wait for JS on the bridge page to complete (SSO handoff, cookie setting)
              await new Promise((r) => setTimeout(r, bridge.bridgeWaitMs));

              // ── CAPTCHA detection: if the bridge page redirected to a CAPTCHA/verify page,
              // show the window so the user can solve it, then wait for navigation away. ──
              const bridgeFinalUrl = loginWindow.webContents.getURL().toLowerCase();
              if (bridgeFinalUrl.includes('/verify') || bridgeFinalUrl.includes('captcha')) {
                logger.info('[InstitutionalLogin] CAPTCHA detected during bridge, showing window', {
                  url: bridgeFinalUrl.slice(0, 120),
                });
                loginWindow.show();
                loginWindow.focus();

                // Wait for user to solve the CAPTCHA (URL changes away from verify page)
                await new Promise<void>((captchaResolve) => {
                  let captchaDone = false;
                  const checkNav = (_e: Electron.Event, navUrl: string) => {
                    if (captchaDone) return;
                    const lower = navUrl.toLowerCase();
                    if (!lower.includes('/verify') && !lower.includes('captcha')) {
                      captchaDone = true;
                      loginWindow.webContents.removeListener('did-navigate', checkNav);
                      // Wait for post-CAPTCHA page to settle
                      setTimeout(captchaResolve, 3000);
                    }
                  };
                  loginWindow.webContents.on('did-navigate', checkNav);
                  // Safety timeout: 2 minutes
                  setTimeout(() => {
                    if (!captchaDone) {
                      captchaDone = true;
                      loginWindow.webContents.removeListener('did-navigate', checkNav);
                      captchaResolve();
                    }
                  }, 120_000);
                });
                logger.info('[InstitutionalLogin] CAPTCHA resolved, continuing bridge');
              }
            } catch (err) {
              logger.warn('[InstitutionalLogin] Bridge navigation failed', {
                url: bridgeUrl,
                error: (err as Error).message,
              });
            }
          }

          // Capture cookies after bridge navigation (now includes service site cookies)
          await captureAndFinish(loginWindow.webContents.getURL());
          return;
        }

        // ── Standard flow (no bridge needed) ──
        await captureAndFinish(url);
      }
    };

    loginWindow.webContents.on('did-navigate', (_e, url) => {
      logger.debug('[InstitutionalLogin] Navigated', { url: url.slice(0, 120) });
      finishLogin(url);
    });

    loginWindow.webContents.on('did-navigate-in-page', (_e, url) => {
      finishLogin(url);
    });

    // Handle window close without completing login
    loginWindow.on('closed', () => {
      if (!resolved) {
        logger.info('[InstitutionalLogin] Login window closed without completing');
        resolve({ success: false, cookieCount: 0, publisher });
      }
    });

    loginWindow.loadURL(loginUrl);
  });
}

/**
 * Open login windows for all publishers sequentially.
 * Stops early if the user closes a window without logging in.
 */
export async function openBatchInstitutionalLogin(
  parentWindow: BrowserWindow,
  institutionId: string,
  publishers: string[],
  cookieJar: CookieJar,
  logger: Logger,
): Promise<LoginResult[]> {
  const results: LoginResult[] = [];

  for (const pub of publishers) {
    const result = await openInstitutionalLogin(
      parentWindow,
      institutionId,
      pub,
      cookieJar,
      logger,
    );
    results.push(result);

    // If user closed without logging in, stop the batch
    if (!result.success) break;
  }

  return results;
}
