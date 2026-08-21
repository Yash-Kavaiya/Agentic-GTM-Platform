import { extractBrandKit } from '../src/core/enrich/brandkit.js'
for (const d of ['posthog.com', 'linear.app', 'vanta.com', 'resend.com']) {
  try {
    const k = await extractBrandKit(d)
    console.log(`${d.padEnd(14)} primary=${(k.primary ?? '-').padEnd(8)} palette=${k.palette.slice(0,4).join(' ')}`)
    console.log(`${''.padEnd(14)} fonts=${k.fonts.join(', ') || '-'}`)
    console.log(`${''.padEnd(14)} logo=${(k.logoUrl ?? '-').slice(0, 68)}`)
    console.log(`${''.padEnd(14)} headline="${(k.headline ?? '-').slice(0, 60)}"`)
    console.log(`${''.padEnd(14)} voice="${(k.voiceSamples[0] ?? '-').slice(0, 62)}"`)
  } catch (e) { console.log(`${d}: ERROR ${(e as Error).message}`) }
}
