import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Apple, Download, Globe, Laptop, MonitorDown, RefreshCw, Smartphone, Terminal } from 'lucide-react'
import { canPromptInstall, isRunningInstalled, promptInstall, subscribeInstall } from '../../pwaInstall'
import {
  archName,
  detectSystem,
  formatBytes,
  isDownloadable,
  loadManifest,
  platformName,
  type DetectedSystem,
  type Platform,
  type ReleaseBuild,
  type ReleaseManifest,
} from '../releases'
import { AppLink, Callout, PageHead, SectionHead } from '../ui'
import { usePageMeta } from '../meta'

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; manifest: ReleaseManifest }

const platforms: { id: Platform; icon: typeof Laptop; blurb: string }[] = [
  { id: 'windows', icon: Laptop, blurb: 'Windows 10 and 11' },
  { id: 'macos', icon: Apple, blurb: 'Apple Silicon and Intel Macs' },
  { id: 'linux', icon: Terminal, blurb: 'AppImage and Debian package' },
]

export default function Downloads() {
  usePageMeta('Downloads', 'Get Document Vault for Windows, macOS and Linux, install it from your browser, or open the web app.')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [system, setSystem] = useState<DetectedSystem>({ platform: null, arch: null })

  const fetchManifest = useCallback((signal?: AbortSignal) => {
    loadManifest(signal)
      .then((manifest) => setState(manifest ? { status: 'ready', manifest } : { status: 'error' }))
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') setState({ status: 'error' })
      })
  }, [])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    fetchManifest()
  }, [fetchManifest])

  useEffect(() => {
    const controller = new AbortController()
    fetchManifest(controller.signal)
    void detectSystem().then(setSystem)
    return () => controller.abort()
  }, [fetchManifest])

  const manifest = state.status === 'ready' ? state.manifest : null

  return (
    <>
      <PageHead eyebrow="Downloads" title="Get Document Vault">
        Use it in the browser, install it as an app from your browser, or download the desktop app.
      </PageHead>

      <section className="site-section site-section--tight">
        <div className="site-container">
          <Recommendation state={state} system={system} onRetry={retry} />
        </div>
      </section>

      <section className="site-section site-section--sand site-section--tight" aria-labelledby="desktop-title">
        <div className="site-container">
          <SectionHead eyebrow="Desktop app" title="Windows, macOS and Linux" id="desktop-title">
            The desktop app is the full workspace in its own window, plus search across folders you choose on your computer.
            {manifest ? ` Current version: ${manifest.version}.` : ''}
          </SectionHead>
          {state.status === 'error' ? (
            <ManifestError onRetry={retry} />
          ) : (
            <div className="site-grid site-grid--3">
              {platforms.map((platform) => (
                <PlatformCard
                  key={platform.id}
                  platform={platform}
                  builds={manifest?.builds.filter((build) => build.platform === platform.id) ?? null}
                  version={manifest?.version ?? null}
                  releasedAt={manifest?.releasedAt ?? null}
                  highlight={system.platform === platform.id}
                />
              ))}
            </div>
          )}
          {manifest && manifest.notes.length > 0 ? (
            <div className="site-prose site-gap-top">
              <h3>What is new in {manifest.version}</h3>
              <ul>
                {manifest.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              {manifest.notesUrl ? (
                <p>
                  <a href={manifest.notesUrl} rel="noopener noreferrer">
                    Full release notes
                  </a>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="site-section site-section--tight" id="install" aria-labelledby="install-title">
        <div className="site-container">
          <SectionHead eyebrow="Web and installed app" title="No download needed" id="install-title">
            The web app works in any modern browser. On most devices you can also install it, so it opens in its own window from
            your home screen, Dock or Start menu.
          </SectionHead>
          <div className="site-grid site-grid--2">
            <article className="site-card site-card--fit">
              <span className="site-card__icon">
                <Globe aria-hidden="true" />
              </span>
              <h3>Web app</h3>
              <p>Chrome, Edge, Safari and Firefox, on computers, tablets and phones.</p>
              <div className="site-card__foot">
                <AppLink className="site-button site-button--primary">Open the web app</AppLink>
              </div>
            </article>
            <InstallCard system={system} />
          </div>
        </div>
      </section>

      <section className="site-section site-section--sand site-section--tight" aria-labelledby="mac-title">
        <div className="site-container site-split">
          <div>
            <span className="site-eyebrow">For Mac users</span>
            <h2 id="mac-title" className="site-h2">
              Which Mac do I have?
            </h2>
            <p className="site-lead site-gap-top">
              There are two Mac downloads. Pick the one that matches your Mac’s chip; the other one will not open or will run
              slowly.
            </p>
          </div>
          <div className="site-prose">
            <ol>
              <li>
                Click the Apple menu in the top-left corner of the screen and choose <strong>About This Mac</strong>.
              </li>
              <li>
                If the window shows <strong>Chip</strong> followed by <strong>Apple M1</strong>, M2, M3, M4 or later, download{' '}
                <strong>Apple Silicon</strong>.
              </li>
              <li>
                If it shows <strong>Processor</strong> followed by <strong>Intel</strong>, download <strong>Intel</strong>.
              </li>
            </ol>
            <p>Most Macs bought since 2021 have Apple Silicon. If you are unsure, check before downloading.</p>
          </div>
        </div>
      </section>

      <section className="site-section site-section--tight" aria-labelledby="verify-title">
        <div className="site-container">
          <SectionHead eyebrow="Before you install" title="Opening the app for the first time" id="verify-title" />
          <div className="site-grid site-grid--2">
            <details className="site-details">
              <summary>Windows says “Windows protected your PC”</summary>
              <div>
                <p>
                  The installer is not yet signed with a paid code-signing certificate, so Microsoft SmartScreen does not
                  recognise it. If you downloaded it from this page:
                </p>
                <ol>
                  <li>Choose <strong>More info</strong>.</li>
                  <li>Check that the publisher line and file name match what you downloaded.</li>
                  <li>Choose <strong>Run anyway</strong>.</li>
                </ol>
              </div>
            </details>
            <details className="site-details">
              <summary>macOS says the app “cannot be opened”</summary>
              <div>
                <p>
                  The Mac app is not yet signed and notarised by Apple, so Gatekeeper blocks the first launch. If you downloaded it
                  from this page:
                </p>
                <ol>
                  <li>Open the disk image and drag Document Vault into Applications.</li>
                  <li>Open Document Vault once; macOS will refuse.</li>
                  <li>
                    Open <strong>System Settings</strong>, then <strong>Privacy &amp; Security</strong>, scroll down and choose{' '}
                    <strong>Open Anyway</strong> next to Document Vault.
                  </li>
                </ol>
              </div>
            </details>
            <details className="site-details">
              <summary>Linux: running the AppImage</summary>
              <div>
                <ol>
                  <li>
                    Make it executable: <code>chmod +x Document-Vault-*.AppImage</code>
                  </li>
                  <li>
                    Run it: <code>./Document-Vault-*.AppImage</code>
                  </li>
                </ol>
                <p>
                  Some distributions need <code>libfuse2</code> (Ubuntu 22.04) or <code>libfuse2t64</code> (Ubuntu 24.04 and later)
                  to run AppImages. The <code>.deb</code> package does not.
                </p>
              </div>
            </details>
            <details className="site-details">
              <summary>Checking a download is genuine (SHA-256)</summary>
              <div>
                <p>Each download lists a SHA-256 checksum. Compute it on your computer and compare:</p>
                <ul>
                  <li>
                    Windows (PowerShell): <code>Get-FileHash .\Document-Vault-Setup-*.exe</code>
                  </li>
                  <li>
                    macOS: <code>shasum -a 256 Document-Vault-*.dmg</code>
                  </li>
                  <li>
                    Linux: <code>sha256sum Document-Vault-*</code>
                  </li>
                </ul>
                <p>If the values differ, do not open the file.</p>
              </div>
            </details>
          </div>
          <p className="site-gap-top">
            Step-by-step instructions are in the <Link to="/documentation/desktop-app">desktop app guide</Link>.
          </p>
        </div>
      </section>
    </>
  )
}

function Recommendation({ state, system, onRetry }: { state: LoadState; system: DetectedSystem; onRetry: () => void }) {
  if (system.platform === 'android' || system.platform === 'ios') {
    return (
      <div className="site-recommend">
        <div>
          <h2>On your {system.platform === 'ios' ? 'iPhone or iPad' : 'Android device'}</h2>
          <p>There is no separate phone app to download. Open the web app, or install it to your home screen.</p>
        </div>
        <div className="site-cta__actions">
          <AppLink className="site-button site-button--primary">Open the web app</AppLink>
          <a href="#install" className="site-button site-button--secondary">
            <Smartphone aria-hidden="true" />
            Install
          </a>
        </div>
      </div>
    )
  }

  if (!system.platform) {
    return (
      <div className="site-recommend">
        <div>
          <h2>Choose your system below</h2>
          <p>We could not tell which system you are using. The web app works on all of them.</p>
        </div>
        <AppLink className="site-button site-button--primary">Open the web app</AppLink>
      </div>
    )
  }

  const name = platformName(system.platform)
  if (state.status === 'loading') {
    return (
      <div className="site-recommend" role="status">
        <div>
          <h2>Document Vault for {name}</h2>
          <p>Checking the latest release...</p>
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="site-recommend">
        <div>
          <h2>Document Vault for {name}</h2>
          <p>The list of downloads could not be loaded. You can still use the web app.</p>
        </div>
        <div className="site-cta__actions">
          <button type="button" className="site-button site-button--secondary" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </button>
          <AppLink className="site-button site-button--primary">Open the web app</AppLink>
        </div>
      </div>
    )
  }

  const builds = state.manifest.builds.filter((build) => build.platform === system.platform)
  const ready = builds.filter(isDownloadable)
  // A Mac browser rarely says which chip it has, so both Mac downloads are offered.
  const matching = system.arch ? ready.filter((build) => build.arch === system.arch) : ready
  const offered = matching.length > 0 ? matching : []

  if (offered.length === 0) {
    return (
      <div className="site-recommend">
        <div>
          <h2>Document Vault for {name}</h2>
          <p>
            The {name} desktop app is not yet available to download. Until it is, use the web app or install it from your
            browser; it is the same workspace.
          </p>
        </div>
        <div className="site-cta__actions">
          <AppLink className="site-button site-button--primary">Open the web app</AppLink>
          <a href="#install" className="site-button site-button--secondary">
            Install from browser
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="site-recommend">
      <div>
        <h2>
          Document Vault {state.manifest.version} for {name}
        </h2>
        <p>
          {system.platform === 'macos' && !system.arch
            ? 'Your browser does not say which Mac chip you have. See “Which Mac do I have?” below if you are not sure.'
            : 'Recommended for this computer.'}
        </p>
      </div>
      <div className="site-cta__actions">
        {offered.map((build) => (
          <a key={build.id} href={build.url!} className="site-button site-button--primary" rel="noopener noreferrer">
            <Download aria-hidden="true" />
            {system.platform === 'macos' ? archName('macos', build.arch).split(' (')[0] : build.label}
            {formatBytes(build.size) ? ` (${formatBytes(build.size)})` : ''}
          </a>
        ))}
      </div>
    </div>
  )
}

function PlatformCard({
  platform,
  builds,
  version,
  releasedAt,
  highlight,
}: {
  platform: (typeof platforms)[number]
  builds: ReleaseBuild[] | null
  version: string | null
  releasedAt: string | null
  highlight: boolean
}) {
  return (
    <article className="site-platform" data-highlight={highlight} aria-labelledby={`platform-${platform.id}`}>
      <div className="site-platform__head">
        <span className="site-card__icon">
          <platform.icon aria-hidden="true" />
        </span>
        <div>
          <h3 id={`platform-${platform.id}`}>{platformName(platform.id)}</h3>
          <p>{highlight ? 'Your system' : platform.blurb}</p>
        </div>
      </div>
      {builds === null ? (
        <p role="status">Loading...</p>
      ) : builds.length === 0 ? (
        <p>No {platformName(platform.id)} build is listed for this release.</p>
      ) : (
        builds.map((build) => <BuildRow key={build.id} build={build} version={version} releasedAt={releasedAt} />)
      )}
    </article>
  )
}

function BuildRow({ build, version, releasedAt }: { build: ReleaseBuild; version: string | null; releasedAt: string | null }) {
  const ready = isDownloadable(build)
  const size = formatBytes(build.size)
  return (
    <div className="site-build">
      <div className="site-build__title">
        <strong>{archName(build.platform, build.arch)}</strong>
        <span className={`site-badge${ready ? ' site-badge--ok' : ''}`}>{ready ? 'Available' : 'Not yet available'}</span>
      </div>
      <dl>
        <dt>Format</dt>
        <dd>{build.label}</dd>
        {version ? (
          <>
            <dt>Version</dt>
            <dd>{version}</dd>
          </>
        ) : null}
        <dt>Requires</dt>
        <dd>{build.minimumOs}</dd>
        {ready && size ? (
          <>
            <dt>Size</dt>
            <dd>{size}</dd>
          </>
        ) : null}
        {ready && releasedAt ? (
          <>
            <dt>Released</dt>
            <dd>{new Date(releasedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
          </>
        ) : null}
        {ready && build.sha256 ? (
          <>
            <dt>SHA-256</dt>
            <dd>
              <code>{build.sha256}</code>
            </dd>
          </>
        ) : null}
        {ready ? (
          <>
            <dt>Signed</dt>
            <dd>{build.signed ? 'Yes' : 'Not yet (see “Opening the app for the first time”)'}</dd>
          </>
        ) : null}
      </dl>
      {build.note ? <p>{build.note}</p> : null}
      {ready ? (
        <a href={build.url!} className="site-button site-button--primary site-button--block" rel="noopener noreferrer">
          <MonitorDown aria-hidden="true" />
          Download {build.label}
        </a>
      ) : (
        <p className="site-build__pending">This build has not been published yet. Use the web app in the meantime.</p>
      )}
    </div>
  )
}

function ManifestError({ onRetry }: { onRetry: () => void }) {
  return (
    <Callout tone="warn">
      <p>
        <strong>The list of downloads could not be loaded.</strong> Check your connection and try again. The web app still
        works.
      </p>
      <p className="site-callout__action">
        <button type="button" className="site-button site-button--secondary" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </button>
      </p>
    </Callout>
  )
}

function InstallCard({ system }: { system: DetectedSystem }) {
  const promptReady = useSyncExternalStore(subscribeInstall, canPromptInstall, () => false)
  const [installed, setInstalled] = useState(isRunningInstalled)
  const [message, setMessage] = useState<string | null>(null)

  async function install() {
    const outcome = await promptInstall()
    if (outcome === 'accepted') {
      setInstalled(true)
      setMessage('Installed. Open Document Vault from your apps.')
    } else if (outcome === 'dismissed') {
      setMessage('Installation was cancelled. You can install later from the browser menu.')
    }
  }

  return (
    <article className="site-card">
      <span className="site-card__icon">
        <Smartphone aria-hidden="true" />
      </span>
      <h3>Install from your browser</h3>
      {installed ? (
        <p>You are using the installed app already.</p>
      ) : promptReady ? (
        <>
          <p>Your browser can install Document Vault now. It will open in its own window.</p>
          <div className="site-card__foot">
            <button type="button" className="site-button site-button--primary" onClick={() => void install()}>
              <Download aria-hidden="true" />
              Install app
            </button>
          </div>
        </>
      ) : (
        <InstallSteps system={system} />
      )}
      {message ? <p role="status">{message}</p> : null}
    </article>
  )
}

function InstallSteps({ system }: { system: DetectedSystem }) {
  const guides = [
    {
      id: 'ios',
      title: 'iPhone and iPad (Safari)',
      steps: ['Open the web app in Safari.', 'Tap the Share button.', 'Choose Add to Home Screen, then Add.'],
    },
    {
      id: 'android',
      title: 'Android (Chrome)',
      steps: ['Open the web app in Chrome.', 'Tap the ⋮ menu.', 'Choose Install app or Add to Home screen.'],
    },
    {
      id: 'desktop',
      title: 'Computer (Chrome or Edge)',
      steps: ['Open the web app.', 'Click the install icon at the right of the address bar, or open the browser menu.', 'Choose Install Document Vault.'],
    },
    {
      id: 'macos',
      title: 'Mac (Safari 17 or later)',
      steps: ['Open the web app in Safari.', 'Choose File, then Add to Dock.'],
    },
  ]
  const preferred = system.platform === 'ios' ? 'ios' : system.platform === 'android' ? 'android' : system.platform === 'macos' ? 'macos' : 'desktop'
  const ordered = [...guides].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))

  return (
    <>
      <p>Your browser has not offered an install button here. Use these steps instead:</p>
      {ordered.map((guide, index) => (
        <details key={guide.id} className="site-details" open={index === 0}>
          <summary>{guide.title}</summary>
          <div>
            <ol>
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </details>
      ))}
      <p>Firefox on computers cannot install web apps; use the web app in a tab or the desktop app.</p>
    </>
  )
}
