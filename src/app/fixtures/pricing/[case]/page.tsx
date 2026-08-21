import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Drift-injection fixture.
 *
 * A real pricing page that Bellwether controls, so the heal loop can be
 * measured instead of hoped for. Two markup variants carry IDENTICAL content:
 *
 *   v1  semantic cards — <article class="tier"> with .tier-name / .tier-price
 *   v2  a redesign — table rows, renamed classes, price split across nested
 *       spans, CTA text moved into a data attribute
 *
 * v2 is not "broken" markup. It is what a competent team ships on a Tuesday,
 * and it silently destroys any selector written against v1. That is the whole
 * failure mode: the collector still returns 200 and still returns rows, and
 * every field inside them is null.
 *
 * Flipping fixtures/drift/state.json and redeploying changes the DOM at a
 * stable URL — genuinely the same event a real redesign causes, not a
 * simulation of one.
 */

interface FixtureState {
  variant: string
  drifted: string[]
}

const TIERS = [
  { name: 'Starter', price: '$0', cta: 'Start free', blurb: 'Up to 3 projects' },
  { name: 'Pro', price: '$24', cta: 'Buy now', blurb: 'Unlimited projects, 10 seats' },
  { name: 'Team', price: '$79', cta: 'Buy now', blurb: 'SSO, audit log, 50 seats' },
  { name: 'Enterprise', price: 'Custom', cta: 'Contact sales', blurb: 'SAML, SOC 2 report, SLA' },
]

const CASES = ['1', '2', '3', '4', '5'] as const

export function generateStaticParams() {
  return CASES.map((c) => ({ case: c }))
}

function readState(): FixtureState {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures', 'drift', 'state.json'), 'utf8'),
    ) as FixtureState
  } catch {
    return { variant: 'v1', drifted: [] }
  }
}

export default async function FixturePricing({ params }: { params: Promise<{ case: string }> }) {
  const { case: caseId } = await params
  const state = readState()
  const drifted = state.variant === 'v2' || state.drifted.includes(caseId)

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888' }}>
        Bellwether drift fixture · case {caseId} · markup {drifted ? 'v2' : 'v1'}
      </p>
      <h1 style={{ fontSize: 34, margin: '10px 0 6px', letterSpacing: '-0.02em' }}>Pricing</h1>
      <p style={{ color: '#666', marginBottom: 32, fontSize: 15 }}>
        Simple pricing that scales with your team.
      </p>

      {drifted ? <PricingV2 /> : <PricingV1 />}

      <p style={{ marginTop: 40, fontSize: 12, color: '#999', lineHeight: 1.6 }}>
        This page exists so the self-healing loop can be measured rather than asserted. Both
        variants show the same four tiers at the same prices; only the markup differs. Content is
        fictional and belongs to no real company.
      </p>
    </main>
  )
}

/** The original: semantic cards, one class per field. */
function PricingV1() {
  return (
    <section className="pricing-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
      {TIERS.map((t) => (
        <article key={t.name} className="tier" style={cardStyle}>
          <h2 className="tier-name" style={{ fontSize: 15, margin: 0 }}>
            {t.name}
          </h2>
          <p className="tier-price" style={{ fontSize: 30, margin: '10px 0 4px', fontWeight: 600 }}>
            {t.price}
          </p>
          <p className="tier-blurb" style={{ fontSize: 13, color: '#666', minHeight: 34 }}>
            {t.blurb}
          </p>
          <button className="tier-cta" style={btnStyle}>
            {t.cta}
          </button>
        </article>
      ))}
    </section>
  )
}

/**
 * The redesign. Same content, different everything:
 * a table instead of cards, `plan-*` instead of `tier-*`, the price split into
 * currency and amount spans, and the CTA label moved into a data attribute.
 */
function PricingV2() {
  return (
    <table className="plan-matrix" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {TIERS.map((t) => {
          const [symbol, amount] =
            t.price === 'Custom' ? ['', 'Custom'] : [t.price.slice(0, 1), t.price.slice(1)]
          return (
            <tr key={t.name} className="plan-row" style={{ borderBottom: '1px solid #e5e5e5' }}>
              <td style={{ padding: '18px 12px 18px 0' }}>
                <span className="plan-label">
                  <strong>{t.name}</strong>
                </span>
                <div className="plan-desc" style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                  {t.blurb}
                </div>
              </td>
              <td style={{ padding: '18px 12px', whiteSpace: 'nowrap' }}>
                <span className="plan-cost">
                  <span className="cost-symbol">{symbol}</span>
                  <span className="cost-amount" style={{ fontSize: 24, fontWeight: 600 }}>
                    {amount}
                  </span>
                </span>
              </td>
              <td style={{ padding: '18px 0', textAlign: 'right' }}>
                <a className="plan-action" data-action-label={t.cta} href="#" style={{ ...btnStyle, display: 'inline-block', textDecoration: 'none' }}>
                  {t.cta}
                </a>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e5e5',
  borderRadius: 10,
  padding: 18,
  background: '#fff',
}

const btnStyle: React.CSSProperties = {
  border: '1px solid #d4d4d4',
  borderRadius: 7,
  padding: '7px 13px',
  fontSize: 13,
  background: '#fafafa',
  cursor: 'pointer',
  color: '#111',
}
